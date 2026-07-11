import './NoisePage.css';

const FAQS = [
  {
    q: 'Do you offer free shipping?',
    a: 'Yes — all orders over $75 ship free within the continental US. Expedited and international rates are calculated at checkout.',
  },
  {
    q: 'What is your return policy?',
    a: "We offer 60-day hassle-free returns on all items in original condition. Start a return from your account dashboard and we'll generate a prepaid shipping label.",
  },
  {
    q: 'Are your products sustainably sourced?',
    a: 'We require all suppliers to submit annual sustainability audits. Electronics use conflict-free minerals; clothing suppliers must hold GOTS or bluesign certification.',
  },
  {
    q: 'How do I track my order?',
    a: "You'll receive a tracking link by email as soon as your order ships. You can also view real-time status from the Orders section of your account.",
  },
  {
    q: 'Can I change or cancel an order?',
    a: "Orders can be modified or cancelled within 2 hours of placement. After that, our fulfilment system has processed the order and we're unable to interrupt it — but returns are always available.",
  },
  {
    q: 'Do you ship internationally?',
    a: 'We ship to 42 countries. International orders may be subject to import duties and taxes, which are the responsibility of the recipient.',
  },
  {
    q: 'How do I use a discount code?',
    a: 'Enter your code in the Promo Code field at checkout. Codes cannot be stacked and are not retroactively applied to placed orders.',
  },
  {
    q: 'Is my payment information secure?',
    a: 'All payments are processed by Stripe. We never store card numbers on our servers — only a tokenised reference that allows refunds.',
  },
  {
    q: 'What is agents.json?',
    a: 'agents.json is a machine-readable manifest we publish at /agents.json. It tells automated agents exactly which API endpoints contain product data, the field schema, and what to skip — eliminating the need to scrape HTML pages.',
  },
  {
    q: 'How do I contact support?',
    a: 'Email support@novamart.example or use the live chat widget in the bottom-right corner. Average response time is under 2 hours on business days.',
  },
];

export function FaqPage() {
  return (
    <main className="page noise-page">
      <div className="container">
        <header className="page-header">
          <div className="noise-badge">
            <span className="badge badge-error">⚠ robots.txt: Allowed · agents.json: Excluded</span>
            <span className="text-tertiary noise-note">
              Q&amp;A noise — no structured product data here.
            </span>
          </div>
          <h1>Frequently Asked Questions</h1>
          <p>Everything you need to know about shopping at NovaMart.</p>
        </header>

        <div className="faq-list" role="list">
          {FAQS.map((item, i) => (
            <div key={i} className="faq-item" role="listitem">
              <h2 className="faq-question">{item.q}</h2>
              <p className="faq-answer">{item.a}</p>
            </div>
          ))}
        </div>

        <div className="noise-callout">
          <span className="noise-callout-icon">💡</span>
          <div>
            <strong>Scraper note:</strong> This FAQ contains {FAQS.length} Q&amp;A pairs. A naive
            crawler must parse all of them to find nothing useful. An agent with agents.json skips{' '}
            <code className="text-code">/faq</code> entirely.
          </div>
        </div>
      </div>
    </main>
  );
}
