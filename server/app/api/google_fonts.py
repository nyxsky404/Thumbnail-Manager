"""Same-origin proxy for Google Fonts.

The browser never talks to googleapis.com / gstatic.com directly. Instead it
hits these endpoints, which:
  * keep the API key server-side (never leaks to the client),
  * sidestep ad-blockers / corporate DNS / privacy extensions that commonly
    block fonts.googleapis.com,
  * stay same-origin with the SPA so there is no CORS dance.

Endpoints
---------
GET /api/fonts/google/list
    JSON list of {family, variants, category, ...} from the Google Fonts API.
    Cached in-process for 24h.

GET /api/fonts/google/css?family=Roboto:wght@400;700
    Stylesheet from fonts.googleapis.com/css2 with all gstatic.com font URLs
    rewritten to /api/fonts/google/file?url=... so the browser stays
    same-origin even for the binary font files.

GET /api/fonts/google/file?url=https://fonts.gstatic.com/...
    Streams the raw font binary. URL is whitelisted to gstatic.com.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response

from ..config import settings


def _client(request: Request) -> httpx.AsyncClient:
    """Return the app-wide shared httpx.AsyncClient set up in main.lifespan."""
    client = getattr(request.app.state, "http_client", None)
    if client is None:
        # Defensive — should never happen in normal startup, but keeps tests safe.
        raise HTTPException(
            status_code=500,
            detail="HTTP client not initialised; lifespan did not run",
        )
    return client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/fonts/google", tags=["google_fonts"])

GOOGLE_LIST_URL = "https://www.googleapis.com/webfonts/v1/webfonts"
GOOGLE_CSS_URL = "https://fonts.googleapis.com/css2"

# Pretend to be a modern browser so Google returns woff2 (vs woff/ttf).
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# In-process cache of the catalog (24h TTL). Refreshes lazily on next call.
_LIST_CACHE: dict[str, Any] = {"data": None, "ts": 0.0}
_LIST_TTL_SEC = 24 * 60 * 60
# Serialises concurrent cold-cache callers so only ONE outbound request is
# made to googleapis.com when the cache is empty or expired (thunder-herd guard).
_list_lock: asyncio.Lock = asyncio.Lock()

# Allowed hosts for /file proxy. Must be HTTPS Google CDN domains only.
_ALLOWED_FILE_HOSTS = (
    "https://fonts.gstatic.com/",
    "https://fonts.googleapis.com/",
)

# Match `url(...)` references inside the returned CSS.
_URL_RE = re.compile(r"url\(([^)]+)\)")


async def _fetch_catalog(client: httpx.AsyncClient) -> dict[str, Any]:
    """Return the Google Fonts catalog dict, using the in-process cache.

    Raises HTTPException on configuration / network / upstream errors so
    callers (route handlers OR other services) get consistent error
    semantics.

    Uses double-checked locking: the hot path (cache populated) is lock-free;
    concurrent cold-cache callers serialise so only one outbound request is
    made to googleapis.com per TTL window.
    """
    if not settings.GOOGLE_FONTS_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="GOOGLE_FONTS_API_KEY not configured on the server",
        )

    # Fast path — no lock needed when the cache is warm.
    cached = _LIST_CACHE["data"]
    if cached and time.time() - _LIST_CACHE["ts"] < _LIST_TTL_SEC:
        return cached  # type: ignore[return-value]

    # Slow path — serialise so exactly one caller makes the outbound request.
    async with _list_lock:
        # Re-check under the lock; a concurrent holder may have populated it.
        cached = _LIST_CACHE["data"]
        if cached and time.time() - _LIST_CACHE["ts"] < _LIST_TTL_SEC:
            return cached  # type: ignore[return-value]

        try:
            r = await client.get(
                GOOGLE_LIST_URL,
                params={
                    "key": settings.GOOGLE_FONTS_API_KEY,
                    "sort": "popularity",
                },
                timeout=10.0,
            )
        except httpx.HTTPError as e:
            logger.warning("Google Fonts list fetch failed: %s", e)
            raise HTTPException(status_code=502, detail="Failed to reach Google Fonts API")

        if r.status_code != 200:
            logger.warning(
                "Google Fonts list returned %s: %s", r.status_code, r.text[:200]
            )
            raise HTTPException(
                status_code=r.status_code,
                detail="Google Fonts API error",
            )

        data = r.json()
        _LIST_CACHE["data"] = data
        _LIST_CACHE["ts"] = time.time()
        return data


async def get_known_families(client: httpx.AsyncClient) -> set[str]:
    """Lowercase, whitespace-collapsed family names known to Google Fonts.

    Used by the PSD-import service to decide whether a referenced family is
    available natively or needs to be flagged to the user as missing.
    Falls back to an empty set when the catalog can't be fetched (e.g. no
    API key configured) — the PSD import then conservatively treats *every*
    font as missing, which is fine and obvious to the user.
    """
    try:
        data = await _fetch_catalog(client)
    except HTTPException:
        return set()
    out: set[str] = set()
    for item in data.get("items", []):
        family = item.get("family")
        if isinstance(family, str) and family:
            out.add(_normalise_family(family))
    return out


def _normalise_family(name: str) -> str:
    """Match the same normalisation we apply to PSD-extracted family names."""
    return " ".join(name.lower().split())


@router.get("/list")
async def list_fonts(request: Request):
    """Return the Google Fonts catalog (cached)."""
    return await _fetch_catalog(_client(request))


@router.get("/css")
async def proxy_css(
    request: Request,
    family: str = Query(..., min_length=1, max_length=300),
):
    """Proxy a Google Fonts CSS stylesheet, rewriting font URLs to our /file proxy."""
    headers = {"User-Agent": _USER_AGENT}
    try:
        r = await _client(request).get(
            GOOGLE_CSS_URL,
            params={"family": family, "display": "swap"},
            headers=headers,
            timeout=10.0,
        )
    except httpx.HTTPError as e:
        logger.warning("Google Fonts css fetch failed for %r: %s", family, e)
        raise HTTPException(status_code=502, detail="Failed to reach Google Fonts CSS")

    if r.status_code != 200:
        logger.warning(
            "Google Fonts css returned %s for %r: %s",
            r.status_code,
            family,
            r.text[:200],
        )
        raise HTTPException(
            status_code=r.status_code,
            detail="Google Fonts CSS error",
        )

    css = r.text

    def _rewrite(match: re.Match[str]) -> str:
        raw = match.group(1).strip().strip("'\"")
        if raw.startswith(_ALLOWED_FILE_HOSTS):
            return f"url(/api/fonts/google/file?url={quote(raw, safe='')})"
        return match.group(0)  # leave unknown urls alone

    css = _URL_RE.sub(_rewrite, css)

    return Response(
        content=css,
        media_type="text/css; charset=utf-8",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/file")
async def proxy_file(
    request: Request,
    url: str = Query(..., min_length=1, max_length=2000),
):
    """Stream a font binary from a whitelisted Google CDN host."""
    if not url.startswith(_ALLOWED_FILE_HOSTS):
        raise HTTPException(status_code=400, detail="URL host not allowed")

    try:
        r = await _client(request).get(
            url, headers={"User-Agent": _USER_AGENT}, timeout=15.0
        )
    except httpx.HTTPError as e:
        logger.warning("Google Fonts file fetch failed for %r: %s", url, e)
        raise HTTPException(status_code=502, detail="Failed to fetch font file")

    if r.status_code != 200:
        raise HTTPException(
            status_code=r.status_code,
            detail="Font file fetch error",
        )

    content_type = r.headers.get("content-type", "font/woff2")
    return Response(
        content=r.content,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",  # safe — fonts are public bytes
        },
    )
