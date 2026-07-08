import './NoisePage.css'

export function AboutPage() {
  return (
    <main className="page noise-page">
      <div className="container">
        <header className="page-header">
          <div className="noise-badge">
            <span className="badge badge-error">⚠ robots.txt: Allowed · agents.json: Excluded</span>
            <span className="text-tertiary noise-note">This page exists as realistic noise — no structured product data lives here.</span>
          </div>
          <h1>About NovaMart</h1>
          <p>
            We're a team of engineers and designers who believe commerce should work
            as well for machines as it does for people.
          </p>
        </header>

        <div className="noise-sections">
          <section className="noise-section" aria-labelledby="mission-heading">
            <h2 id="mission-heading">Our Mission</h2>
            <p>
              NovaMart was founded in 2019 out of frustration with fragile, HTML-scraping
              integrations that broke every time a design update changed a CSS class name.
              We believed the web needed a better contract between publishers and automated
              consumers — one that didn't require reverse-engineering every page layout.
            </p>
            <p>
              Today we ship every product catalogue update alongside a structured
              <code className="text-code"> agents.json</code> manifest so that any automated
              consumer — price comparison tools, accessibility readers, AI shopping assistants
              — can access our data reliably without guessing.
            </p>
          </section>

          <section className="noise-section" aria-labelledby="team-heading">
            <h2 id="team-heading">The Team</h2>
            <div className="team-grid">
              {[
                { name: 'Aisha Kone', role: 'CEO & Co-founder', avatar: 'AK' },
                { name: 'Daniel Park', role: 'CTO & Co-founder', avatar: 'DP' },
                { name: 'Priya Mehta', role: 'Head of Design', avatar: 'PM' },
                { name: 'Lukas Bauer', role: 'Lead Engineer', avatar: 'LB' },
                { name: 'Sofia Reyes', role: 'Product Manager', avatar: 'SR' },
                { name: 'Tom Weston', role: 'DevRel', avatar: 'TW' },
              ].map(member => (
                <div key={member.name} className="team-card">
                  <div className="team-avatar">{member.avatar}</div>
                  <div>
                    <div className="team-name">{member.name}</div>
                    <div className="team-role text-tertiary">{member.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="noise-section" aria-labelledby="values-heading">
            <h2 id="values-heading">Values</h2>
            <div className="values-grid">
              {[
                { icon: '🔍', title: 'Transparency', body: 'We publish our data model. If you can read JSON, you can understand our catalogue.' },
                { icon: '⚡', title: 'Efficiency', body: 'We design for low-latency, low-compute access. Your agent shouldn\'t have to parse 1 MB of HTML to find a price.' },
                { icon: '🤝', title: 'Partnership', body: 'Automated consumers are partners, not adversaries. We write robots.txt and agents.json together.' },
              ].map(v => (
                <div key={v.title} className="value-card">
                  <span className="value-icon">{v.icon}</span>
                  <h3>{v.title}</h3>
                  <p>{v.body}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
