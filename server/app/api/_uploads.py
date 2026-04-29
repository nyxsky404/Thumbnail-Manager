"""Shared helpers for the upload endpoints."""
from __future__ import annotations

from fastapi import HTTPException, UploadFile, status

# 64 KiB chunks: small enough to bail early on big uploads, large enough that
# small files (a 200 KB PNG) finish in 4-5 reads.
_CHUNK_SIZE = 64 * 1024


async def read_with_limit(file: UploadFile, max_size: int) -> bytes:
    """Read an UploadFile into memory, aborting once `max_size` is exceeded.

    Why: doing `await file.read()` followed by a `len(body) > max_size` check
    means an attacker can force the server to allocate the full payload before
    we reject it. By reading in chunks we can stop pulling bytes off the wire
    the moment we cross the threshold and free what we have.

    Returns the buffered bytes on success.
    Raises HTTP 413 (Payload Too Large) if the stream exceeds `max_size`.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_size:
            # Drop already-buffered data so it can be GC'd promptly.
            chunks.clear()
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds maximum size of {max_size} bytes",
            )
        chunks.append(chunk)
    return b"".join(chunks)
