from pydantic import BaseModel
from typing import Optional, List


class Product(BaseModel):
    id: int
    name: str
    price: float
    category: str
    image_url: str
    description: str
    rating: float
    stock: int
    tags: List[str]
    slug: str


class ProductListResponse(BaseModel):
    data: List[Product]
    total: int
    page: int
    limit: int
    total_pages: int
