from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Optional

import auth_utils
import models
import cache
from database import get_db

router = APIRouter(prefix="/reviews", tags=["reviews"])


class ReviewBody(BaseModel):
    stars:   int          = Field(..., ge=1, le=5)
    comment: Optional[str] = None


@router.post("", status_code=201)
def submit_review(
    body:    ReviewBody,
    current: models.Company = Depends(auth_utils.get_current_company),
    db:      Session         = Depends(get_db),
):
    review = models.Review(
        company_id = current.id,
        stars      = body.stars,
        comment    = body.comment or None,
        status     = "pending",
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    cache.invalidate("approved_reviews")
    return {
        "id":         review.id,
        "stars":      review.stars,
        "comment":    review.comment,
        "status":     review.status,
        "created_at": review.created_at.isoformat(),
    }


@router.get("/mine")
def get_my_review(
    current: models.Company = Depends(auth_utils.get_current_company),
    db:      Session         = Depends(get_db),
):
    review = (
        db.query(models.Review)
        .filter(models.Review.company_id == current.id)
        .order_by(models.Review.created_at.desc())
        .first()
    )
    if not review:
        return {}
    return {
        "id":         review.id,
        "stars":      review.stars,
        "comment":    review.comment,
        "status":     review.status,
        "created_at": review.created_at.isoformat(),
    }


@router.put("/{review_id}")
def update_review(
    review_id: int,
    body:      ReviewBody,
    current:   models.Company = Depends(auth_utils.get_current_company),
    db:        Session         = Depends(get_db),
):
    review = (
        db.query(models.Review)
        .filter(models.Review.id == review_id, models.Review.company_id == current.id)
        .first()
    )
    if not review:
        raise HTTPException(status_code=404, detail="Recensione non trovata")
    review.stars   = body.stars
    review.comment = body.comment or None
    review.status  = "pending"
    db.commit()
    db.refresh(review)
    cache.invalidate("approved_reviews")
    return {
        "id":         review.id,
        "stars":      review.stars,
        "comment":    review.comment,
        "status":     review.status,
        "created_at": review.created_at.isoformat(),
    }


@router.get("")
def get_approved_reviews(db: Session = Depends(get_db)):
    cached = cache.get("approved_reviews")
    if cached is not None:
        return cached

    reviews = (
        db.query(models.Review)
        .filter(models.Review.status == "approved")
        .order_by(models.Review.created_at.desc())
        .all()
    )
    result = [
        {
            "id":         r.id,
            "stars":      r.stars,
            "comment":    r.comment,
            "company":    (r.company.ragione_sociale if r.company else None) or "Cliente verificato",
            "created_at": r.created_at.isoformat(),
        }
        for r in reviews
    ]
    cache.set("approved_reviews", result, ttl=300)  # 5 minuti
    return result
