import logging
from typing import Optional

import boto3
from botocore.exceptions import ClientError

from ..config import settings

logger = logging.getLogger(__name__)


def _client():
    return boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    )


def upload_bytes(key: str, body: bytes, content_type: str) -> str:
    """Upload bytes to S3 and return the public URL.

    Public read access is granted via bucket policy (not per-object ACL),
    since modern buckets default to Bucket Owner Enforced (ACLs disabled).
    """
    client = _client()
    client.put_object(
        Bucket=settings.S3_BUCKET_NAME,
        Key=key,
        Body=body,
        ContentType=content_type,
        CacheControl="public, max-age=31536000",
    )
    return f"{settings.s3_public_base_url}/{key}"


def get_object(key: str) -> tuple[bytes, str]:
    """Fetch object bytes + content_type from S3."""
    resp = _client().get_object(Bucket=settings.S3_BUCKET_NAME, Key=key)
    body = resp["Body"].read()
    content_type = resp.get("ContentType", "application/octet-stream")
    return body, content_type


def delete_object(key: str) -> None:
    try:
        _client().delete_object(Bucket=settings.S3_BUCKET_NAME, Key=key)
    except ClientError as e:
        logger.warning("Failed to delete S3 object %s: %s", key, e)


def delete_prefix(prefix: str) -> None:
    """Delete all objects under a prefix."""
    client = _client()
    try:
        paginator = client.get_paginator("list_objects_v2")
        keys: list[dict] = []
        for page in paginator.paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
            for obj in page.get("Contents", []) or []:
                keys.append({"Key": obj["Key"]})
                if len(keys) >= 1000:
                    client.delete_objects(
                        Bucket=settings.S3_BUCKET_NAME, Delete={"Objects": keys}
                    )
                    keys = []
        if keys:
            client.delete_objects(
                Bucket=settings.S3_BUCKET_NAME, Delete={"Objects": keys}
            )
    except ClientError as e:
        logger.warning("Failed to delete S3 prefix %s: %s", prefix, e)
