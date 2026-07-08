import { Link } from 'react-router-dom'
import './NoisePage.css'

export function CartPage() {
  return (
    <main className="page noise-page">
      <div className="container">
        <header className="page-header">
          <div className="noise-badge">
            <span className="badge badge-error">🚫 robots.txt: Disallowed · agents.json: Excluded</span>
            <span className="text-tertiary noise-note">Session-specific page — disallowed by robots.txt.</span>
          </div>
          <h1>Your Cart</h1>
        </header>

        <div className="empty-state">
          <span className="icon">🛒</span>
          <h2>Your cart is empty</h2>
          <p>Add some products to get started.</p>
          <Link to="/products" className="btn btn-primary">
            Browse Products →
          </Link>
        </div>

        <div className="noise-callout noise-callout-red">
          <span className="noise-callout-icon">🚫</span>
          <div>
            <strong>robots.txt Disallow:</strong> <code className="text-code">/cart</code> is explicitly disallowed.
            It contains session-specific state, no product catalogue data, and changes per user.
            An agent reading robots.txt never visits this path.
          </div>
        </div>
      </div>
    </main>
  )
}

export function CheckoutPage() {
  return (
    <main className="page noise-page">
      <div className="container">
        <header className="page-header">
          <div className="noise-badge">
            <span className="badge badge-error">🚫 robots.txt: Disallowed · agents.json: Excluded</span>
            <span className="text-tertiary noise-note">Multi-step form — disallowed by robots.txt.</span>
          </div>
          <h1>Checkout</h1>
        </header>

        <div className="checkout-stub">
          <div className="checkout-step">
            <div className="checkout-step-num">1</div>
            <div>
              <div className="checkout-step-label">Contact information</div>
              <div className="skeleton" style={{ height: 40, marginTop: 8, borderRadius: 'var(--radius-md)' }} />
              <div className="skeleton" style={{ height: 40, marginTop: 8, borderRadius: 'var(--radius-md)' }} />
            </div>
          </div>
          <div className="checkout-step checkout-step-muted">
            <div className="checkout-step-num checkout-step-num-muted">2</div>
            <div className="text-muted">Shipping address</div>
          </div>
          <div className="checkout-step checkout-step-muted">
            <div className="checkout-step-num checkout-step-num-muted">3</div>
            <div className="text-muted">Payment</div>
          </div>
        </div>

        <div className="noise-callout noise-callout-red">
          <span className="noise-callout-icon">🚫</span>
          <div>
            <strong>robots.txt Disallow:</strong> <code className="text-code">/checkout</code> is disallowed.
            It's a multi-step form containing PII. No agent — polite or otherwise — should visit this path.
          </div>
        </div>
      </div>
    </main>
  )
}
