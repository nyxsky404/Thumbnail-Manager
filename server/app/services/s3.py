"""S3 service wrapper.

A single ``S3Service`` instance is shared for the entire process lifetime.
boto3 clients are thread-safe and maintain an internal urllib3 connection
pool, so reusing one client avoids a fresh TLS handshake on every request.
"""
import logging
from threading import Lock

import boto3
from botocore.exceptions import ClientError

from ..config import settings

logger = logging.getLogger(__name__)


class S3Service:
    """All S3 operations for this application.

    Instantiate once (via ``_get_service()``) and reuse across every request
    so that boto3's internal connection pool is shared.
    """

    def __init__(self) -> None:
        self._client = boto3.client(
            "s3",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        )

    def upload_bytes(self, key: str, body: bytes, content_type: str) -> str:
        """Upload *body* to S3 and return its public URL.

        Public read access is granted via bucket policy (not per-object ACL),
        since modern buckets default to Bucket Owner Enforced (ACLs disabled).
        """
        self._client.put_object(
            Bucket=settings.S3_BUCKET_NAME,
            Key=key,
            Body=body,
            ContentType=content_type,
            CacheControl="public, max-age=31536000",
        )
        return f"{settings.s3_public_base_url}/{key}"

    def get_object(self, key: str) -> tuple[bytes, str]:
        """Fetch object bytes + content_type from S3."""
        resp = self._client.get_object(Bucket=settings.S3_BUCKET_NAME, Key=key)
        body = resp["Body"].read()
        content_type = resp.get("ContentType", "application/octet-stream")
        return body, content_type

    def presigned_url(self, key: str, expires_in: int = 300) -> str:
        """Return a pre-signed GET URL for *key* valid for *expires_in* seconds."""
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.S3_BUCKET_NAME, "Key": key},
            ExpiresIn=expires_in,
        )

    def delete_object(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=settings.S3_BUCKET_NAME, Key=key)
        except ClientError as e:
            logger.warning("Failed to delete S3 object %s: %s", key, e)

    def delete_prefix(self, prefix: str) -> None:
        """Delete all objects under *prefix* (paginated batch delete)."""
        def _check_errors(resp: dict) -> None:
            errors = resp.get("Errors")
            if errors:
                logger.warning(
                    "S3 delete_objects partial failure for prefix %s: %s",
                    prefix,
                    errors,
                )

        try:
            paginator = self._client.get_paginator("list_objects_v2")
            keys: list[dict] = []
            for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
                for obj in page.get("Contents", []) or []:
                    keys.append({"Key": obj["Key"]})
                    if len(keys) >= 1000:
                        resp = self._client.delete_objects(
                            Bucket=settings.S3_BUCKET_NAME, Delete={"Objects": keys}
                        )
                        _check_errors(resp)
                        keys = []
            if keys:
                resp = self._client.delete_objects(
                    Bucket=settings.S3_BUCKET_NAME, Delete={"Objects": keys}
                )
                _check_errors(resp)
        except ClientError as e:
            logger.warning("Failed to delete S3 prefix %s: %s", prefix, e)


# ---------------------------------------------------------------------------
# Process-wide singleton — double-checked locking keeps it thread-safe while
# avoiding lock contention on the hot path once the instance exists.
# ---------------------------------------------------------------------------
_svc: S3Service | None = None
_svc_lock = Lock()


def _get_service() -> S3Service:
    global _svc
    if _svc is None:
        with _svc_lock:
            if _svc is None:
                _svc = S3Service()
    return _svc


# ---------------------------------------------------------------------------
# Module-level convenience functions — preserve the existing call-site API.
# ---------------------------------------------------------------------------

def upload_bytes(key: str, body: bytes, content_type: str) -> str:
    return _get_service().upload_bytes(key, body, content_type)


def get_object(key: str) -> tuple[bytes, str]:
    return _get_service().get_object(key)


def presigned_url(key: str, expires_in: int = 300) -> str:
    return _get_service().presigned_url(key, expires_in)


def delete_object(key: str) -> None:
    _get_service().delete_object(key)


def delete_prefix(prefix: str) -> None:
    _get_service().delete_prefix(prefix)
