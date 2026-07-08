"""
check_endpoints.py
------------------
Quick sanity-check for every NovaMart API endpoint.
Run with:  python check_endpoints.py
The backend must be running at BASE_URL before you execute this.
"""

import sys
import io
import json
import urllib.request
import urllib.error

# Force UTF-8 output on Windows so Unicode chars print correctly
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE_URL = "http://localhost:8000"

# ANSI colours (no third-party libs needed)
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RESET  = "\033[0m"
BOLD   = "\033[1m"


def get(path: str, label: str = "") -> dict | list | str | None:
    url = BASE_URL + path
    print(f"  {CYAN}GET{RESET} {url}  ", end="", flush=True)
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            raw = resp.read().decode()
            status = resp.status
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                data = raw  # plain text (robots.txt, etc.)
            print(f"{GREEN}✓ {status}{RESET}")
            return data
    except urllib.error.HTTPError as e:
        print(f"{RED}✗ {e.code} {e.reason}{RESET}")
        return None
    except urllib.error.URLError as e:
        print(f"{RED}✗ Connection error — is the server running? ({e.reason}){RESET}")
        return None


def show(data, max_items: int = 3):
    """Pretty-print a compact preview of a response."""
    if data is None:
        return
    if isinstance(data, dict):
        keys = list(data.keys())
        print(f"    {YELLOW}keys:{RESET} {keys}")
        if "data" in data and isinstance(data["data"], list):
            items = data["data"][:max_items]
            for item in items:
                name  = item.get("name",  "") if isinstance(item, dict) else item
                price = item.get("price", "") if isinstance(item, dict) else ""
                print(f"      • {name}  ${price}")
            if len(data["data"]) > max_items:
                print(f"      … and {len(data['data']) - max_items} more")
    elif isinstance(data, list):
        preview = data[:max_items]
        print(f"    {YELLOW}items:{RESET} {preview}" + (" …" if len(data) > max_items else ""))
    elif isinstance(data, str):
        lines = data.strip().splitlines()[:2]
        for line in lines:
            print(f"    {line}")


def section(title: str):
    print(f"\n{BOLD}{title}{RESET}")
    print("-" * 50)


def main():
    print(f"\n{BOLD}NovaMart API — Endpoint Checker{RESET}")
    print(f"Base URL: {CYAN}{BASE_URL}{RESET}\n")

    # ── Health & Meta ────────────────────────────────────────────────────────────
    section("Health & Meta")
    show(get("/health"))
    show(get("/robots.txt"))
    show(get("/.well-known/agents.json"))

    # ── Categories ───────────────────────────────────────────────────────────────
    section("Categories")
    categories = get("/api/categories")
    show(categories)

    # ── Products list ─────────────────────────────────────────────────────────────
    section("Products — list")
    show(get("/api/products"))
    show(get("/api/products?page=1&limit=5"))

    # Filter by each category (up to 3)
    if isinstance(categories, list):
        for cat in categories[:3]:
            show(get(f"/api/products?category={cat}"))

    # ── Product detail ────────────────────────────────────────────────────────────
    section("Products — single item")
    show(get("/api/products/1"))
    show(get("/api/products/2"))
    get("/api/products/99999")   # expect 404

    # ── Docs ──────────────────────────────────────────────────────────────────────
    section("API Docs")
    get("/docs")
    get("/redoc")

    print(f"\n{GREEN}{BOLD}Done.{RESET}\n")


if __name__ == "__main__":
    main()
