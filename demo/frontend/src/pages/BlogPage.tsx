import './NoisePage.css'

const POSTS = [
  {
    id: 1,
    date: 'Dec 12, 2024',
    category: 'Engineering',
    title: 'Why we ship agents.json with every release',
    excerpt:
      'Every time we update our product catalogue, our CI pipeline regenerates the agents.json manifest before the frontend build. Here\'s why that\'s non-negotiable for us, and how we\'ve structured the automation.',
    readTime: '6 min read',
  },
  {
    id: 2,
    date: 'Nov 28, 2024',
    category: 'Design',
    title: 'The case against nav mega-menus for agent-first commerce',
    excerpt:
      'Mega-menus exist to help humans discover categories they didn\'t know existed. An agent using agents.json already has the category taxonomy. We redesigned our navigation to serve both audiences without compromising either.',
    readTime: '4 min read',
  },
  {
    id: 3,
    date: 'Oct 15, 2024',
    category: 'Industry',
    title: 'robots.txt is not enough: the case for positive agent signals',
    excerpt:
      'robots.txt tells agents what NOT to do. It says nothing about where the good data lives, what fields matter, or how to paginate efficiently. agents.json is the missing positive complement — and we think every commerce site needs one.',
    readTime: '8 min read',
  },
]

export function BlogPage() {
  return (
    <main className="page noise-page">
      <div className="container">
        <header className="page-header">
          <div className="noise-badge">
            <span className="badge badge-error">⚠ robots.txt: Allowed · agents.json: Excluded</span>
            <span className="text-tertiary noise-note">Editorial noise — no structured product data here.</span>
          </div>
          <h1>The NovaMart Blog</h1>
          <p>Thinking on agent-first commerce, structured data, and the web.</p>
        </header>

        <div className="blog-grid">
          {POSTS.map(post => (
            <article key={post.id} className="blog-card">
              <div className="blog-meta">
                <span className="badge badge-ghost">{post.category}</span>
                <span className="text-tertiary" style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                  {post.date} · {post.readTime}
                </span>
              </div>
              <h2 className="blog-title">{post.title}</h2>
              <p className="blog-excerpt">{post.excerpt}</p>
              <button className="btn btn-ghost btn-sm blog-read-btn" disabled>
                Read article →
              </button>
            </article>
          ))}
        </div>

        <div className="noise-callout">
          <span className="noise-callout-icon">💡</span>
          <div>
            <strong>Scraper note:</strong> This page contains editorial copy with no extractable product data.
            An agent following agents.json skips <code className="text-code">/blog</code> entirely and
            goes directly to <code className="text-code">GET /api/products</code>.
          </div>
        </div>
      </div>
    </main>
  )
}
