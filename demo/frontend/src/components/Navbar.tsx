import { NavLink, Link } from 'react-router-dom'
import './Navbar.css'

export function Navbar() {
  return (
    <header className="navbar">
      <div className="container navbar-inner">
        {/* Logo */}
        <Link to="/" className="navbar-logo" aria-label="NovaMart home">
          <span className="navbar-logo-mark">N</span>
          <span className="navbar-logo-text">NovaMart</span>
          <span className="navbar-logo-badge badge badge-teal">demo</span>
        </Link>

        {/* Navigation */}
        <nav className="navbar-nav" aria-label="Main navigation">
          <NavLink to="/products" className={({ isActive }) => `navbar-link ${isActive ? 'is-active' : ''}`}>
            Products
          </NavLink>
          <NavLink to="/about" className={({ isActive }) => `navbar-link ${isActive ? 'is-active' : ''}`}>
            About
          </NavLink>
          <NavLink to="/blog" className={({ isActive }) => `navbar-link ${isActive ? 'is-active' : ''}`}>
            Blog
          </NavLink>
          <NavLink to="/faq" className={({ isActive }) => `navbar-link ${isActive ? 'is-active' : ''}`}>
            FAQ
          </NavLink>
        </nav>

        {/* Actions */}
        <div className="navbar-actions">
          <Link to="/cart" className="btn btn-ghost btn-sm navbar-cart" aria-label="Cart">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
            Cart
          </Link>
          <a
            href="/.well-known/agents.json"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline btn-sm"
            title="View agents.json manifest"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
            agents.json
          </a>
        </div>
      </div>
    </header>
  )
}
