import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .api import fonts, google_fonts, health, templates
from .config import settings


def _client_ip(request: Request) -> str:
    """Best-effort client IP for rate-limiting.

    Behind a reverse proxy (nginx, Cloudflare, ALB), `request.client.host` is
    the proxy's IP, which would cause every caller to share the same bucket
    and trip the global limit. We prefer the first hop in `X-Forwarded-For`
    (set by the proxy), falling back to `X-Real-IP`, then to the socket peer.

    NOTE: this trusts the header. In production, terminate it at your proxy
    and never expose this app directly to the internet.
    """
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # Comma-separated list; first entry is the original client.
        return fwd.split(",")[0].strip()
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    return request.client.host if request.client else "unknown"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

limiter = Limiter(key_func=_client_ip, default_limits=["120/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Single shared httpx.AsyncClient for the whole app, reused across all
    # outbound calls (Google Fonts proxy, etc.). Reusing the client preserves
    # the TCP/TLS connection pool and avoids handshakes per request, which
    # matters because a single font-family CSS load can spawn 5-10 follow-up
    # font-file fetches.
    app.state.http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(15.0, connect=5.0),
        follow_redirects=True,
        limits=httpx.Limits(
            max_keepalive_connections=20, max_connections=50
        ),
    )
    try:
        yield
    finally:
        await app.state.http_client.aclose()


app = FastAPI(title="Thumbnail Manager API", version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Register SlowAPIMiddleware FIRST so it ends up innermost. Without this
# middleware, `default_limits` on the Limiter are silently ignored because
# slowapi only enforces them via this middleware (or per-route
# `@limiter.limit(...)` decorators). The error-catching middleware and CORS
# below get registered after, so they wrap any 429 response correctly.
app.add_middleware(SlowAPIMiddleware)


# IMPORTANT: register the error-catching middleware AFTER SlowAPI but BEFORE
# CORSMiddleware so CORS ends up OUTERMOST. Starlette inserts middleware at
# the head of the stack, so last-registered = outermost. This guarantees any
# response (including 5xx error JSON and 429 rate-limit responses) flows back
# through CORS on its way out and gets the Access-Control-Allow-Origin header.
@app.middleware("http")
async def catch_all_errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Unhandled error on %s %s: %s", request.method, request.url.path, exc
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "error": str(exc)},
        )


# Allow both common dev origins regardless of which one the client uses.
_allowed_origins = list(
    {
        settings.CLIENT_ORIGIN,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    }
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Type", "Cache-Control"],
)


app.include_router(health.router)
app.include_router(templates.router)
app.include_router(fonts.router)
app.include_router(google_fonts.router)
