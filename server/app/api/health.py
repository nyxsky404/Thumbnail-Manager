import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        logger.error("Health check DB query failed: %s", e)
        raise HTTPException(status_code=503, detail="Database unavailable")
    return {"status": "ok"}
