import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="page">
      <div className="container">
        <div className="empty-state">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 72, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '-0.04em', lineHeight: 1 }}>
            404
          </span>
          <h1 style={{ fontSize: 'var(--text-xl)' }}>Page not found</h1>
          <p>The route you're looking for doesn't exist on this site.</p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link to="/" className="btn btn-primary">Go home</Link>
            <Link to="/products" className="btn btn-ghost">Browse products</Link>
          </div>
        </div>
      </div>
    </main>
  )
}
