import json
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, JSONResponse

from routes import router

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="NovaMart API",
    description="Mock e-commerce API powering the agents.json scraping demo.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ───────────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:4173,http://localhost:3000, https://amd-act2-vue-neuclea.vercel.app",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Product routes (prefixed /api) ─────────────────────────────────────────────
app.include_router(router, prefix="/api")

# ── robots.txt ─────────────────────────────────────────────────────────────────
ROBOTS_TXT = """\
# NovaMart robots.txt
# Last updated: 2025-01-01
# Contact: webmaster@novamart.example

User-agent: *

# Allow data-rich, agent-useful paths
Allow: /
Allow: /products
Allow: /products/
Allow: /about
Allow: /blog
Allow: /faq

# API endpoints — structured data, safe to index
Allow: /api/products
Allow: /api/products/
Allow: /api/categories

# Disallow session-specific / PII-containing / non-indexable paths
Disallow: /cart
Disallow: /checkout
Disallow: /account
Disallow: /admin
Disallow: /api/cart
Disallow: /api/orders
Disallow: /api/checkout
Disallow: /api/users

# Disallow parameterised search/filter — combinatorial explosion, no structured data
Disallow: /search?
Disallow: /filter?
Disallow: /products?sort=
Disallow: /products?q=

# Agent manifest — machine-readable, intentionally public
Allow: /agents.json

Sitemap: https://novamart.example/sitemap.xml
"""


@app.get("/robots.txt", include_in_schema=False)
def robots_txt():
    return PlainTextResponse(ROBOTS_TXT)


# ── agents.json ─────────────────────────────────────────────────────────────────
AGENTS_JSON_PATH = Path(_file_).parent / "agents.json"


@app.get("/agents.json", include_in_schema=False)
def agents_manifest():
    data = json.loads(AGENTS_JSON_PATH.read_text(encoding="utf-8"))
    return JSONResponse(content=data)


# ── Health ──────────────────────────────────────────────────────────────────────
@app.get("/health", include_in_schema=False)
def health():
    return {"status": "ok"}
