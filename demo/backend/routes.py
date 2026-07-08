import math
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from models import Product, ProductListResponse
from fixtures import PRODUCTS

router = APIRouter()


def _filter(products: list[Product], category: Optional[str]) -> list[Product]:
    if not category:
        return products
    return [p for p in products if p.category.lower() == category.lower()]


@router.get("/products", response_model=ProductListResponse, tags=["products"])
def list_products(
    category: Optional[str] = Query(None, description="Filter by category name"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
):
    """
    Return a paginated list of products.
    Supports optional ?category= filter and ?page= / ?limit= pagination.
    """
    filtered = _filter(PRODUCTS, category)
    total = len(filtered)
    total_pages = max(1, math.ceil(total / limit))
    start = (page - 1) * limit
    end = start + limit
    return ProductListResponse(
        data=filtered[start:end],
        total=total,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


@router.get("/products/{product_id}", response_model=Product, tags=["products"])
def get_product(product_id: int):
    """Return a single product by its numeric ID."""
    for p in PRODUCTS:
        if p.id == product_id:
            return p
    raise HTTPException(status_code=404, detail=f"Product {product_id} not found")


@router.get("/categories", response_model=list[str], tags=["meta"])
def list_categories():
    """Return all distinct category names."""
    seen: set[str] = set()
    cats: list[str] = []
    for p in PRODUCTS:
        if p.category not in seen:
            seen.add(p.category)
            cats.append(p.category)
    return cats
