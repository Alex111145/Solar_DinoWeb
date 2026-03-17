from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Optional

import auth_utils
import models
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
    return {"message": "Recensione inviata, in attesa di approvazione"}


@router.get("")
def get_approved_reviews(db: Session = Depends(get_db)):
    reviews = (
        db.query(models.Review)
        .filter(models.Review.status == "approved")
        .order_by(models.Review.created_at.desc())
        .all()
    )
    return [
        {
            "id":         r.id,
            "stars":      r.stars,
            "comment":    r.comment,
            "company":    (r.company.ragione_sociale if r.company else None) or "Cliente verificato",
            "created_at": r.created_at.isoformat(),
        }
        for r in reviews
    ]
