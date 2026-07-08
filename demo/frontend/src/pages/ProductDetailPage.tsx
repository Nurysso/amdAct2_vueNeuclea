import { useParams, Link } from 'react-router-dom'
import { useProduct } from '../hooks/useProduct'
import './ProductDetailPage.css'

const CATEGORY_BADGE: Record<string, string> = {
  'Electronics':    'badge-teal',
  'Clothing':       'badge-amber',
  'Home & Garden':  'badge-success',
  'Books':          'badge-ghost',
}

function Stars({ rating }: { rating: number }) {
  const full = Math.floor(rating)
  const half = rating % 1 >= 0.5
  return (
    <span className="stars detail-stars" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ opacity: i < full ? 1 : half && i === full ? 0.5 : 0.2, fontSize: 18 }}>★</span>
      ))}
      <span className="detail-rating tabular font-mono">{rating.toFixed(1)}</span>
    </span>
  )
}

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { product, loading, error } = useProduct(id)

  if (loading) {
    return (
      <main className="page">
        <div className="container detail-container">
          <div className="detail-image-col">
            <div className="skeleton detail-image-skeleton" />
          </div>
          <div className="detail-info-col">
            <div className="skeleton" style={{ height: 32, width: '70%', marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 16, width: '40%', marginBottom: 24 }} />
            <div className="skeleton" style={{ height: 48, width: '50%', marginBottom: 24 }} />
            <div className="skeleton" style={{ height: 80 }} />
          </div>
        </div>
      </main>
    )
  }

  if (error || !product) {
    return (
      <main className="page">
        <div className="container">
          <div className="empty-state" role="alert">
            <span className="icon">🔍</span>
            <h1>{error ?? 'Product not found'}</h1>
            <Link to="/products" className="btn btn-primary">← Back to products</Link>
          </div>
        </div>
      </main>
    )
  }

  const badgeClass = CATEGORY_BADGE[product.category] ?? 'badge-ghost'

  return (
    <main className="page">
      <div className="container">
        {/* Breadcrumb */}
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span className="breadcrumb-sep" aria-hidden="true">/</span>
          <Link to="/products">Products</Link>
          <span className="breadcrumb-sep" aria-hidden="true">/</span>
          <span aria-current="page">{product.name}</span>
        </nav>

        <div className="detail-container">
          {/* Image */}
          <div className="detail-image-col">
            <div className="detail-image-wrap">
              <img
                src={product.image_url}
                alt={product.name}
                className="detail-image"
                width="600"
                height="400"
              />
            </div>
            <div className="detail-tags">
              {product.tags.map(tag => (
                <span key={tag} className="badge badge-ghost">#{tag}</span>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="detail-info-col">
            <span className={`badge ${badgeClass} detail-category`}>{product.category}</span>
            <h1 className="detail-name">{product.name}</h1>

            <div className="detail-rating-row">
              <Stars rating={product.rating} />
              <span className="text-tertiary" style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                {product.stock > 0
                  ? <><span style={{ color: 'var(--success)' }}>●</span> {product.stock} in stock</>
                  : <><span style={{ color: 'var(--error)' }}>●</span> Out of stock</>}
              </span>
            </div>

            <div className="detail-price tabular font-mono">
              ${product.price.toFixed(2)}
            </div>

            <p className="detail-description">{product.description}</p>

            <div className="detail-actions">
              <button className="btn btn-primary btn-lg detail-add-btn" disabled={product.stock === 0} id="detail-add-to-cart">
                {product.stock > 0 ? 'Add to Cart' : 'Out of Stock'}
              </button>
              <Link to="/products" className="btn btn-ghost btn-lg">
                ← Back
              </Link>
            </div>

            {/* ── Agent extraction panel ─────────────────────────────────────── */}
            <div className="detail-agent-panel">
              <div className="detail-agent-header">
                <span className="badge badge-teal">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
                  </svg>
                  agents.json extraction
                </span>
                <span className="text-tertiary" style={{ fontSize: 'var(--text-xs)' }}>
                  what an agent reads from <code className="text-code">/api/products/{product.id}</code>
                </span>
              </div>
              <pre className="detail-agent-code"><code>{JSON.stringify({
                id: product.id,
                name: product.name,
                price: product.price,
                category: product.category,
                rating: product.rating,
                tags: product.tags,
              }, null, 2)}</code></pre>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
