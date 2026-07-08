import { Link } from 'react-router-dom'
import { useProducts } from '../hooks/useProducts'
import { ProductCard } from '../components/ProductCard'
import './HomePage.css'

export function HomePage() {
  const { products: featured } = useProducts({ limit: 4 })

  return (
    <main className="page home-page">
      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="hero" aria-labelledby="hero-heading">
        <div className="container hero-inner">
          <div className="hero-eyebrow">
            <span className="badge badge-teal">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="12" r="12"/>
              </svg>
              agents.json demo
            </span>
          </div>

          <h1 id="hero-heading" className="hero-heading">
            Commerce built for<br/>
            <span className="hero-accent">machine-readable agents</span>
          </h1>

          <p className="hero-subtext">
            NovaMart ships an <code className="text-code">agents.json</code> manifest that tells
            an agent exactly what to scrape and where — cutting crawl cost by <strong>~92%</strong>{' '}
            vs. naive HTML crawling.
          </p>

          <div className="hero-actions">
            <Link to="/products" className="btn btn-primary btn-lg" id="hero-cta-products">
              Browse Products →
            </Link>
            <a
              href="/.well-known/agents.json"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-lg"
              id="hero-cta-agents"
            >
              View agents.json
            </a>
          </div>

          {/* Efficiency comparison card */}
          <div className="hero-compare">
            <div className="compare-card compare-bad">
              <div className="compare-label badge badge-error">Naive crawler</div>
              <div className="compare-stat">
                <span className="compare-number">26</span>
                <span className="compare-unit">pages crawled</span>
              </div>
              <div className="compare-detail text-tertiary">~1.4 MB HTML · 3% signal</div>
            </div>

            <div className="compare-vs">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </div>

            <div className="compare-card compare-good">
              <div className="compare-label badge badge-teal">agents.json guided</div>
              <div className="compare-stat">
                <span className="compare-number">2</span>
                <span className="compare-unit">API calls</span>
              </div>
              <div className="compare-detail text-tertiary">~22 KB JSON · 100% signal</div>
            </div>
          </div>
        </div>

        {/* Background decoration */}
        <div className="hero-bg" aria-hidden="true">
          <div className="hero-glow" />
          <div className="hero-grid" />
        </div>
      </section>

      {/* ── Featured products ────────────────────────────────────────────────── */}
      <section className="featured-section" aria-labelledby="featured-heading">
        <div className="container">
          <div className="featured-header">
            <h2 id="featured-heading">Featured products</h2>
            <Link to="/products" className="btn btn-ghost btn-sm">
              View all →
            </Link>
          </div>
          {featured.length > 0 && (
            <div className="product-grid">
              {featured.map((p, i) => (
                <ProductCard key={p.id} product={p} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── agents.json explainer ────────────────────────────────────────────── */}
      <section className="explainer-section" aria-labelledby="explainer-heading">
        <div className="container">
          <div className="explainer-inner">
            <div className="explainer-text">
              <h2 id="explainer-heading">The agents.json concept</h2>
              <p>
                Instead of an agent crawling 26 pages, parsing HTML, and guessing which DOM nodes
                contain product data — it reads one structured manifest file that answers every
                question upfront.
              </p>
              <ul className="explainer-list">
                <li>
                  <span className="explainer-icon">📍</span>
                  <span><strong>Exact endpoints</strong> — no link-following required</span>
                </li>
                <li>
                  <span className="explainer-icon">🗂️</span>
                  <span><strong>Schema definition</strong> — field names, types, descriptions</span>
                </li>
                <li>
                  <span className="explainer-icon">📄</span>
                  <span><strong>Pagination hints</strong> — use <code className="text-code">limit=100</code> for one-shot retrieval</span>
                </li>
                <li>
                  <span className="explainer-icon">🚫</span>
                  <span><strong>Explicit excludes</strong> — skip /cart, /blog, /about entirely</span>
                </li>
              </ul>
            </div>

            <div className="explainer-code">
              <div className="code-block-header">
                <span className="code-dot" style={{ background: '#F87171' }} />
                <span className="code-dot" style={{ background: '#FBBF24' }} />
                <span className="code-dot" style={{ background: '#4ADE80' }} />
                <span className="code-filename text-tertiary">/.well-known/agents.json</span>
              </div>
              <pre className="code-block"><code>{`{
  "data_sources": [{
    "endpoint": "/api/products",
    "recommended_call": 
      "GET /api/products?limit=100"
  }],
  "schema": {
    "Product": {
      "fields": {
        "name":     { "type": "string" },
        "price":    { "type": "float"  },
        "category": { "type": "string" },
        "image_url":{ "type": "string" }
      }
    }
  },
  "excludes": {
    "routes": ["/cart", "/checkout",
               "/blog", "/about"]
  }
}`}</code></pre>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
