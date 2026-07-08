# NovaMart — agents.json Demo

A full-stack e-commerce demo that proves a single concept:

> **An agent that reads `agents.json` can extract all product data in 2 API calls.  
> A naive scraper must crawl 26+ pages and parse ~1.4 MB of HTML to get the same data.**

---

## Quick Start

### Local dev (recommended)

**Terminal 1 — Backend**
```bash
cd demo/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend**
```bash
cd demo/frontend
npm install
npm run dev
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/docs |
| agents.json | http://localhost:8000/.well-known/agents.json |
| robots.txt | http://localhost:5173/robots.txt |

### Docker

```bash
cd demo
docker compose -f docker-compose.override.yml up --build
```

Frontend → http://localhost:4173  
Backend → http://localhost:8000

---

## What the demo shows

### The site

NovaMart is a realistic e-commerce storefront with:
- **18 products** across 4 categories (Electronics, Clothing, Home & Garden, Books)
- **Data routes** — `/`, `/products`, `/products/:id` — where product data actually lives
- **Noise routes** — `/about`, `/blog`, `/faq` — realistic copy with zero extractable product data
- **Disallowed routes** — `/cart`, `/checkout`, `/account` — session-specific pages explicitly disallowed in `robots.txt`

### The contrast

| | Naive scraper | agents.json-guided agent |
|---|---|---|
| Pages visited | 26 | 1 (the manifest) |
| API calls | 0 (HTML only) | 2 |
| Bytes processed | ~1.4 MB HTML | ~22 KB JSON |
| HTML parsing required | Yes — 26 pages | None |
| Signal-to-noise | ~3% | 100% |
| Breaking on redesign | Yes | No |
| Compute cost | High | Minimal |

---

## How agents.json works

The manifest lives at `/.well-known/agents.json` (served by the backend). Here's the decision flow for a well-behaved agent:

```
1. Fetch /.well-known/agents.json
   └─ Read data_sources[0].recommended_call: "GET /api/products?limit=100"

2. GET /api/products?limit=100
   └─ Receive { data: [18 products], total: 18 }
   └─ Each product contains: id, slug, name, price, category, image_url,
      description, rating, stock, tags

3. Done. No HTML parsed. No pagination loop needed.
   Skip: /about, /blog, /faq (agents.json excludes.routes)
   Skip: /cart, /checkout (robots.txt Disallow + agents.json excludes.routes)
```

### Key manifest sections

```json
{
  "data_sources": [{
    "endpoint": "/api/products",
    "recommended_call": "GET /api/products?limit=100",
    "pagination_strategy": "offset"
  }],
  "schema": {
    "Product": {
      "fields": {
        "name":      { "type": "string"  },
        "price":     { "type": "float"   },
        "category":  { "type": "string"  },
        "image_url": { "type": "string"  },
        "description":{ "type": "string" }
      }
    }
  },
  "excludes": {
    "routes": ["/cart", "/checkout", "/about", "/blog", "/faq"],
    "html_regions": ["nav", "footer", ".hero-marketing", ".blog-post"]
  },
  "efficiency_hint": {
    "naive_crawler_cost": { "pages_to_crawl": 26, "signal_to_noise_ratio": "3%" },
    "agent_guided_cost":  { "api_calls": 2,        "signal_to_noise_ratio": "100%" }
  }
}
```

---

## Project structure

```
demo/
├── backend/
│   ├── main.py         # FastAPI app, CORS, robots.txt, agents.json endpoints
│   ├── models.py       # Pydantic Product model
│   ├── fixtures.py     # 18 in-memory products
│   ├── routes.py       # GET /api/products, GET /api/products/{id}, GET /api/categories
│   ├── agents.json     # The manifest — served at /.well-known/agents.json
│   └── requirements.txt
│
├── frontend/
│   ├── public/
│   │   ├── robots.txt       # Served statically
│   │   └── agents.json      # Mirror of backend manifest
│   └── src/
│       ├── App.tsx          # React Router — routes commented by robots/agents status
│       ├── components/      # Navbar, Footer, ProductCard (with JSON strip), CategoryFilter
│       ├── hooks/           # useProducts, useProduct
│       ├── pages/
│       │   ├── HomePage.tsx         # Hero + efficiency comparison + explainer
│       │   ├── ProductsPage.tsx     # Full grid with category filter
│       │   ├── ProductDetailPage.tsx # Detail + agent extraction panel
│       │   ├── AboutPage.tsx        # Noise — allowed, excluded
│       │   ├── BlogPage.tsx         # Noise — allowed, excluded
│       │   ├── FaqPage.tsx          # Noise — allowed, excluded
│       │   └── CartPage.tsx         # Noise — disallowed
│       └── styles/index.css         # Full design system tokens
│
└── README.md (this file)
```

---

## API reference

| Method | Path | Description |
|---|---|---|
| GET | `/api/products` | List products. Supports `?category=`, `?page=`, `?limit=` |
| GET | `/api/products/{id}` | Single product by numeric ID |
| GET | `/api/categories` | Distinct category names |
| GET | `/.well-known/agents.json` | The agent manifest |
| GET | `/robots.txt` | Crawl rules |
| GET | `/docs` | Swagger UI |
| GET | `/health` | Health check |

---

## Design decisions

- **No real database** — 18 products are in-memory Python objects. The demo proves the concept without infra complexity.
- **picsum.photos** — product images use `https://picsum.photos/seed/prod-{id}/600/400` for deterministic, CDN-served images without local assets.
- **agents.json at `/.well-known/`** — following the `.well-known` URI convention (RFC 5785) for discoverability.
- **JSON strip on product cards** — the visual signature of this UI. Every product card shows a tiny `{"id": 1, "price": 289.99, "category": "Electronics"}` strip at the bottom, making the agents.json thesis visible at the product-grid level.
