import { Link } from 'react-router-dom';
import './Footer.css';

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <div className="footer-logo">
            <span className="footer-logo-mark">N</span>
            <span>NovaMart</span>
          </div>
          <p className="footer-tagline">
            A demo storefront proving that structured <code className="text-code">agents.json</code>{' '}
            manifests make web scraping dramatically more efficient than naive crawling.
          </p>
        </div>

        <div className="footer-links">
          <div className="footer-col">
            <h4 className="footer-col-title">Store</h4>
            <Link to="/products">All Products</Link>
            <Link to="/products?category=Electronics">Electronics</Link>
            <Link to="/products?category=Clothing">Clothing</Link>
            <Link to="/products?category=Books">Books</Link>
          </div>
          <div className="footer-col">
            <h4 className="footer-col-title">Company</h4>
            <Link to="/about">About</Link>
            <Link to="/blog">Blog</Link>
            <Link to="/faq">FAQ</Link>
          </div>
          <div className="footer-col">
            <h4 className="footer-col-title">Agents</h4>
            <a href="/.well-known/agents.json" target="_blank" rel="noopener noreferrer">
              agents.json
            </a>
            <a href="/robots.txt" target="_blank" rel="noopener noreferrer">
              robots.txt
            </a>
            <a
              href="https://dummy-backend-amdact2-vueneuclea.onrender.com/docs"
              target="_blank"
              rel="noopener noreferrer"
            >
              API Docs
            </a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="container footer-bottom-inner">
          <span className="text-tertiary" style={{ fontSize: 'var(--text-xs)' }}>
            © 2025 NovaMart. Demo project — not a real store.
          </span>
          <span className="footer-tech-badge">
            <span className="text-muted">built with</span>
            <span className="badge badge-ghost">React</span>
            <span className="badge badge-ghost">FastAPI</span>
            <span className="badge badge-teal">agents.json</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
