import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]
  );

const renderer = new marked.Renderer();

renderer.code = function (codeOrToken, lang) {
  const code = typeof codeOrToken === 'object' ? codeOrToken.text : codeOrToken;
  const language = ((typeof codeOrToken === 'object' ? codeOrToken.lang : lang) || '').trim();
  const langLabel = language ? `<div class="md-lang">${escapeHtml(language)}</div>` : '';
  return `<div class="md-codeblock">${langLabel}<pre class="md-pre"><code class="md-code">${escapeHtml(code)}</code></pre></div>`;
};

renderer.link = function (href, title, text) {
  let h, t, txt;
  if (typeof href === 'object') {
    h = href.href;
    t = href.title;
    txt = href.text;
  } else {
    h = href;
    t = title;
    txt = text;
  }
  const titleAttr = t ? ` title="${escapeHtml(t)}"` : '';
  return `<a href="${escapeHtml(h)}"${titleAttr} target="_blank" rel="noopener noreferrer">${txt}</a>`;
};

renderer.heading = function (text, level) {
  const t = typeof text === 'object' ? text.text : text;
  const lvl = typeof text === 'object' ? text.depth : level;
  return `<h${lvl} class="md-h md-h${lvl}">${t}</h${lvl}>`;
};

renderer.listitem = function (text) {
  const t = typeof text === 'object' ? text.text : text;
  const task = typeof text === 'object' ? text.task : false;
  const checked = typeof text === 'object' ? text.checked : false;
  if (task) {
    return `<li class="md-listitem md-task"><input type="checkbox" disabled ${checked ? 'checked' : ''}/> ${t}</li>`;
  }
  return `<li class="md-listitem">${t}</li>`;
};

marked.setOptions({ breaks: true, gfm: true, renderer });

// Final-render markdown only (used AFTER streaming ends)
function md(text) {
  if (!text) return '';
  const cleaned = String(text).replace(/^\s+/, '');
  return DOMPurify.sanitize(marked.parse(cleaned), { ADD_ATTR: ['target', 'rel'] });
}

const URL_RE = /https?:\/\/[^\s"<>)\]`]+/g;
const MD_LINK_RE = /\[.*?\]\((https?:\/\/[^)]+)\)/g;

function extractBareUrls(text) {
  const mdUrls = new Set([...text.matchAll(MD_LINK_RE)].map((m) => m[1]));
  const seen = new Set();
  return (text.match(URL_RE) || [])
    .map((u) => u.replace(/[.,!?;:]+$/, ''))
    .filter((u) => {
      if (seen.has(u) || mdUrls.has(u)) return false;
      seen.add(u);
      return true;
    });
}

function getHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const META_HINTS = {
  'github.com': { title: 'GitHub repository', desc: 'Source code, issues, and collaboration.' },
  'pkg.go.dev': { title: 'Go package docs', desc: 'Official Go package documentation.' },
  'docs.rs': { title: 'Rust API docs', desc: 'Generated documentation for Rust crates.' },
  'crates.io': { title: 'Crates.io', desc: 'The Rust community crate registry.' },
  'npmjs.com': { title: 'npm package', desc: 'JavaScript package registry.' },
  'developer.mozilla.org': { title: 'MDN Web Docs', desc: 'Web platform reference.' },
  'stackoverflow.com': { title: 'Stack Overflow', desc: 'Developer Q&A.' },
  'arxiv.org': { title: 'arXiv preprint', desc: 'Open-access scientific papers.' },
};

function normalizeUrl(raw) {
  let s = (raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

async function fetchAgentsJson(origin) {
  const target = origin.replace(/\/$/, '') + '/agents.json';
  const tryGet = async () => {
    const r = await fetch(target, { cache: 'no-store' });
    if (!r.ok) throw new Error(`agents.json not found (HTTP ${r.status})`);
    return r.json();
  };
  try {
    const head = await fetch(target, { method: 'HEAD', cache: 'no-store' });
    if (head.ok) return await tryGet();
    if (head.status !== 405 && head.status !== 403)
      throw new Error(`agents.json not found (HTTP ${head.status})`);
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`Could not reach ${target}. Check URL and CORS.`);
  }
  return await tryGet();
}

function fmtTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ThinkingBlock({ thoughts, tools, durationMs, active }) {
  const [expanded, setExpanded] = useState(false);
  const cleanThoughts = (thoughts || []).filter((t) => t && t.trim());
  const hasTools = tools && tools.length > 0;
  const hasContent = cleanThoughts.length > 0 || hasTools;

  if (!hasContent && !active) return null;

  const seconds = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : 0;

  return (
    <div style={s.thinkingBlock}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          ...s.thinkingHeader,
          ...(expanded ? s.thinkingHeaderOpen : {}),
        }}
      >
        <span style={s.thinkingChevron}>{expanded ? '▾' : '▸'}</span>
        <span style={s.thinkingIcon}>💭</span>
        <span style={s.thinkingLabel}>{active ? 'Thinking' : 'Thought process'}</span>
        {active ? (
          <span style={s.thinkingDots}>
            <span className="tdot d1">.</span>
            <span className="tdot d2">.</span>
            <span className="tdot d3">.</span>
          </span>
        ) : seconds > 0 ? (
          <span style={s.thinkingDuration}>{seconds}s</span>
        ) : null}
      </button>
      {expanded && hasContent && (
        <div style={s.thinkingBody}>
          {cleanThoughts.length > 0 && (
            <ul style={s.thinkingList}>
              {cleanThoughts.map((t, i) => (
                <li key={i} style={s.thoughtItem}>
                  <span style={s.thoughtBullet} aria-hidden>
                    •
                  </span>
                  <span style={s.thoughtContent}>{t}</span>
                </li>
              ))}
            </ul>
          )}
          {hasTools && (
            <div style={s.thinkingTools}>
              {tools.map((t, i) => (
                <div
                  key={i}
                  style={{
                    ...s.toolChip,
                    ...(t.success === false ? s.toolChipError : {}),
                  }}
                  title={t.error || t.name}
                >
                  <span style={s.toolChipIcon}>{t.success === false ? '✕' : '✓'}</span>
                  <span style={s.toolChipName}>{t.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UrlPreview({ url }) {
  const [favErr, setFavErr] = useState(false);
  const host = getHost(url);
  const meta = META_HINTS[host] || { title: host, desc: url };
  const favSrc = `https://www.google.com/s2/favicons?sz=32&domain=${host}`;
  const short = url.length > 55 ? url.slice(0, 52) + '…' : url;

  return (
    <div style={s.urlCard}>
      <div style={s.urlCardHeader}>
        <div style={s.favWrap}>
          {!favErr ? (
            <img src={favSrc} alt="" style={s.fav} onError={() => setFavErr(true)} />
          ) : (
            <span style={{ fontSize: 14 }}>🌐</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.urlHost}>{meta.title}</div>
          <div style={s.urlShort}>{short}</div>
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" style={s.openBtn}>
          Open ↗
        </a>
      </div>
      <div style={s.urlBody}>
        <div style={s.urlDesc}>{meta.desc}</div>
      </div>
    </div>
  );
}

function CopyButton({ getText }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      style={{
        ...s.copyBtn,
        ...(copied ? { color: T.success, borderColor: T.success, background: '#fff' } : {}),
      }}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(getText()).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      title="Copy message"
      type="button"
    >
      {copied ? '✓ Copied' : '⧉ Copy'}
    </button>
  );
}

function UserBubble({ msg }) {
  return (
    <div style={s.userRow}>
      <div style={s.userCol}>
        <div style={s.userBubble}>
          <div style={s.userText}>{msg.text}</div>
        </div>
        <div style={s.userMeta}>{msg.time}</div>
      </div>
      <div style={s.avatarUser}>YOU</div>
    </div>
  );
}

function AgentBubble({ msg }) {
  const urls = !msg.streaming ? extractBareUrls(msg.text || '') : [];
  const hasThinking =
    (msg.thoughts && msg.thoughts.length > 0) || (msg.tools && msg.tools.length > 0);
  const isThinkingActive = msg.streaming && !msg.text;
  const showThinking = hasThinking || isThinkingActive;

  return (
    <div style={s.agentRow}>
      <div style={s.avatarAgent}>AI</div>
      <div style={s.agentCol}>
        {showThinking && (
          <ThinkingBlock
            thoughts={msg.thoughts || []}
            tools={msg.tools || []}
            durationMs={msg.thinkingDuration}
            active={isThinkingActive}
          />
        )}
        {(msg.text || msg.streaming) && (
          <div style={s.agentBubble}>
            {!msg.streaming && msg.text && <CopyButton getText={() => msg.text} />}
            {msg.streaming ? (
              <div className="agent-md agent-md-stream">
                {msg.text}
                <span className="stream-cursor" aria-hidden></span>
              </div>
            ) : (
              <div className="agent-md" dangerouslySetInnerHTML={{ __html: md(msg.text) }} />
            )}
            {urls.map((u) => (
              <UrlPreview key={u} url={u} />
            ))}
            <div style={s.agentMeta}>
              <span>{msg.time}</span>
              {msg.duration && !msg.streaming && (
                <span style={{ marginLeft: 6, opacity: 0.75 }}>
                  · {(msg.duration / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [url, setUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [connected, setConnectedState] = useState(false);
  const [agentCfg, setAgentCfg] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [errorBanner, setErrorBanner] = useState('');
  const wsRef = useRef(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const scrollBottom = useCallback(() => {
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 30);
  }, []);

  useEffect(() => {
    if (connected) inputRef.current?.focus();
  }, [connected]);
  useEffect(() => {
    scrollBottom();
  }, [messages, scrollBottom]);
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = globalCSS;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);
  useEffect(
    () => () => {
      try {
        wsRef.current?.close();
      } catch {}
    },
    []
  );

  // For Create React App
  const backendUrl = useMemo(() => {
    const envUrl = import.meta.env.REACT_APP_WS_URL;
    if (envUrl) {
      return envUrl;
    }

    // Fallback
    const host = window.location.hostname;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${host}:8080/ws`;
  }, []);

  // For health checks or other HTTP requests:
  const httpBackendUrl = useMemo(() => {
    const envUrl = import.meta.env.VITE_BACKEND_URL;
    if (envUrl) {
      return envUrl;
    }
    // Fallback
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }, []);

  function pushError(text) {
    setErrorBanner(text);
    setTimeout(() => setErrorBanner(''), 5000);
  }

  function ensureAgentSlot(prev) {
    const next = [...prev];
    const last = next[next.length - 1];
    if (last?.role === 'agent' && last.streaming) return next;
    next.push({
      role: 'agent',
      text: '',
      thoughts: [],
      tools: [],
      streaming: true,
      time: fmtTime(),
      startTime: Date.now(),
      thinkingStart: Date.now(),
    });
    return next;
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'init':
        if (msg.ok) {
          setConnectedState(true);
        } else {
          pushError(msg.error || 'init failed');
        }
        break;
      case 'query.thought': {
        const thought = msg.payload?.thought || '';
        setMessages((p) => {
          const next = ensureAgentSlot(p);
          const last = next[next.length - 1];
          const thoughts = last.thoughts || [];
          const isFirst = thoughts.length === 0;
          next[next.length - 1] = {
            ...last,
            thoughts: [...thoughts, thought],
            thinkingStart: isFirst ? Date.now() : last.thinkingStart || Date.now(),
          };
          return next;
        });
        break;
      }
      case 'query.tool': {
        const tool = {
          name: msg.payload?.tool || 'unknown',
          success: msg.payload?.success,
          error: msg.payload?.error,
        };
        setMessages((p) => {
          const next = ensureAgentSlot(p);
          const last = next[next.length - 1];
          const tools = last.tools || [];
          next[next.length - 1] = { ...last, tools: [...tools, tool] };
          return next;
        });
        break;
      }
      case 'query.status':
        break;
      case 'query.chunk': {
        const chunk = msg.payload?.text || '';
        if (!chunk) return;
        setMessages((p) => {
          const next = ensureAgentSlot(p);
          const last = next[next.length - 1];
          next[next.length - 1] = {
            ...last,
            text: last.text + chunk,
            thinkingDuration: last.thinkingStart
              ? Date.now() - last.thinkingStart
              : last.thinkingDuration,
          };
          return next;
        });
        break;
      }
      case 'query': {
        setMessages((p) => {
          const next = [...p];
          const last = next[next.length - 1];
          const text = msg.payload?.text;
          if (last?.role === 'agent' && last.streaming) {
            next[next.length - 1] = {
              ...last,
              text: text != null ? text : last.text,
              streaming: false,
              duration: Date.now() - (last.startTime || Date.now()),
              thinkingDuration: last.thinkingStart
                ? Date.now() - last.thinkingStart
                : last.thinkingDuration,
            };
          } else if (text != null) {
            next.push({
              role: 'agent',
              text,
              thoughts: [],
              tools: [],
              streaming: false,
              time: fmtTime(),
            });
          }
          return next;
        });
        if (!msg.ok) pushError(msg.error || 'query failed');
        break;
      }
      case 'error':
        pushError(msg.error || 'unknown error');
        break;
    }
  }

  async function handleCheck() {
    const u = normalizeUrl(url);
    if (!u) {
      pushError('Invalid URL. Please enter a valid website URL.');
      return;
    }
    setChecking(true);
    setMessages([]);
    setErrorBanner('');
    try {
      const cfg = await fetchAgentsJson(u.origin);
      if (typeof cfg !== 'object' || cfg === null)
        throw new Error('agents.json is not a JSON object');
      setAgentCfg(cfg);
      const ws = new WebSocket(backendUrl);
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'init', payload: cfg }));
      ws.onmessage = (ev) => {
        try {
          handleServerMessage(JSON.parse(ev.data));
        } catch {}
      };
      ws.onerror = () => pushError('WebSocket failed. Is the Go backend running on :8080?');
      ws.onclose = () => {
        setConnectedState(false);
      };
    } catch (e) {
      pushError(e.message);
    } finally {
      setChecking(false);
    }
  }

  function disconnect() {
    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;
    setConnectedState(false);
    setAgentCfg(null);
    setMessages([]);
  }

  function sendMsg() {
    const ws = wsRef.current;
    const text = input.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    setMessages((p) => [
      ...p,
      { role: 'user', text, time: fmtTime() },
      {
        role: 'agent',
        text: '',
        thoughts: [],
        tools: [],
        streaming: true,
        time: fmtTime(),
        startTime: Date.now(),
        thinkingStart: Date.now(),
      },
    ]);
    ws.send(JSON.stringify({ type: 'query', payload: { query: text } }));
    setInput('');
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  }

  return (
    <div style={s.page}>
      <div style={s.topNav}>
        <div style={s.navLeft}>
          <div style={s.logoMark}>N</div>
          <div style={s.productTitle}>Neuclea</div>
          {agentCfg && (
            <>
              <div style={s.navDivider} />
              <div style={s.navAgentName}>{agentCfg.name}</div>
            </>
          )}
        </div>
        <div style={s.navRight}>
          {agentCfg && (
            <div style={s.statusPill}>
              <div
                style={{
                  ...s.statusDot,
                  background: connected ? T.success : T.muted,
                }}
              />
              <span style={s.statusText}>{connected ? 'Connected' : 'Disconnected'}</span>
            </div>
          )}
          <button style={s.disconnectBtn} onClick={disconnect}>
            Disconnect
          </button>
        </div>
      </div>

      <div style={s.workspace}>
        <main style={s.main}>
          {!connected ? (
            <div style={s.connectContainer}>
              <div style={s.connectCardWrap}>
                <div style={s.connectCard}>
                  <div style={s.connectEyebrow}>AGENT DISCOVERY</div>
                  <div style={s.connectTitle}>Connect to an agent</div>
                  <div style={s.connectDesc}>
                    Enter a website URL to discover its{' '}
                    <code style={s.inlineCode}>/agents.json</code> configuration and start a
                    session.
                  </div>
                  <div style={s.connectForm}>
                    <input
                      style={s.connectInput}
                      type="text"
                      placeholder="https://amd-act2-vue-neuclea.vercel.app"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
                      autoFocus
                    />
                    <button
                      style={{
                        ...s.discoverBtn,
                        ...(checking ? { opacity: 0.7 } : null),
                      }}
                      onClick={handleCheck}
                      disabled={checking}
                    >
                      {checking ? 'Discovering…' : 'Discover'}
                    </button>
                  </div>
                  {errorBanner && <div style={s.errorBanner}>{errorBanner}</div>}
                  <div style={s.connectSteps}>
                    <div style={s.connectStep}>
                      <div style={s.connectStepNum}>01</div>
                      <div style={s.connectStepLabel}>Enter site URL</div>
                    </div>
                    <div style={s.connectStepArrow}>→</div>
                    <div style={s.connectStep}>
                      <div style={s.connectStepNum}>02</div>
                      <div style={s.connectStepLabel}>Fetch agents.json</div>
                    </div>
                    <div style={s.connectStepArrow}>→</div>
                    <div style={s.connectStep}>
                      <div style={s.connectStepNum}>03</div>
                      <div style={s.connectStepLabel}>Start chatting</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer - Outside the card */}
              <div style={s.footer}>
                <div style={s.footerTeam}>
                  <span style={s.footerLabel}>Team Voyager</span>
                  <span style={s.footerDivider}>·</span>
                  <span style={s.footerBadge}>AMD Hackathon Act 2</span>
                </div>
                <div style={s.footerMembers}>
                  <span style={s.footerMember}>Dawood (nurysso) </span>
                  <span style={s.footerMember}>Ibrahim</span>
                  <span style={s.footerMember}>Omair</span>
                  <span style={s.footerMember}>Emaad</span>
                  <span style={s.footerMember}>Mehran</span>
                </div>
                <div style={s.footerNote}>Proof of Concept for agents.json ecosystem</div>
              </div>
            </div>
          ) : (
            <>
              <div style={s.conversation}>
                {messages.length === 0 ? (
                  <div style={s.emptyState}>
                    <div style={s.emptyIcon}>💬</div>
                    <div style={s.emptyTitle}>Ready when you are</div>
                    <div style={s.emptyDesc}>
                      Send a message to start a session with this agent.
                    </div>
                  </div>
                ) : (
                  <div style={s.timeline}>
                    {messages.map((m, i) => (
                      <div key={i} style={{ animation: 'fadeUp .25s ease' }}>
                        {m.role === 'user' ? <UserBubble msg={m} /> : <AgentBubble msg={m} />}
                      </div>
                    ))}
                    <div ref={endRef} />
                  </div>
                )}
              </div>

              <div style={s.composerBar}>
                <div style={s.composerInner}>
                  <input
                    ref={inputRef}
                    style={s.cmdInput}
                    placeholder="Send a message…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKey}
                  />
                  <button
                    style={{
                      ...s.sendBtn,
                      ...(!input.trim() ? { opacity: 0.45 } : null),
                    }}
                    onClick={sendMsg}
                    disabled={!input.trim()}
                  >
                    Send
                  </button>
                </div>
                <div style={s.composerHint}>
                  Press <kbd style={s.kbd}>Enter</kbd> to send
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

const T = {
  bg: '#FAF5EA',
  surface: '#fffaf0',
  panel: '#fff8ef',
  head: '#1a1a1f',
  muted: '#8a8270',
  mutedSoft: '#a8a08e',
  accent: '#d94a2f',
  accentDark: '#b83b2a',
  warm: '#d9871a',
  success: '#1f5f2f',
  border: '#e8dfc8',
  borderStrong: '#2b2b2b',
  codeBg: '#1e1b18',
  codeText: '#f4efe7',
  error: '#b83b2a',
  userBg: '#ffffff',
  userText: '#1a1a1f',
  agentBg: '#d94a2f',
  agentBgGrad: 'linear-gradient(135deg, #d94a2f 0%, #c43d24 100%)',
  agentText: '#ffffff',
  thinkingBg: '#fdf6e8',
  thinkingText: '#3d3d3d',
};

const s = {
  page: {
    minHeight: '100vh',
    background: T.bg,
    color: T.head,
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial",
    display: 'flex',
    flexDirection: 'column',
  },
  topNav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    borderBottom: `1px solid ${T.border}`,
    background: T.surface,
    flexShrink: 0,
  },
  navLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  navRight: { display: 'flex', alignItems: 'center', gap: 12 },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: T.accent,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: 16,
  },
  productTitle: { fontWeight: 700, fontSize: 15, color: T.head, letterSpacing: -0.2 },
  navDivider: { width: 1, height: 20, background: T.border, margin: '0 4px' },
  navAgentName: { fontSize: 14, fontWeight: 600, color: T.muted },
  statusPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: '#fff',
    border: `1px solid ${T.border}`,
    borderRadius: 999,
    fontSize: 12,
    color: T.head,
    fontWeight: 600,
  },
  statusDot: { width: 8, height: 8, borderRadius: '50%' },
  statusText: { fontSize: 12 },

  workspace: { flex: 1, display: 'flex', minHeight: 0 },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    minWidth: 0,
  },

  // Connect view
  connectView: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '40px 20px 20px',
    minHeight: '100%',
  },
  connectContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    minHeight: 0,
    padding: '0 20px',
  },
  connectCard: {
    width: '100%',
    maxWidth: 520,
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: 16,
    padding: 36,
    boxShadow: '0 1px 0 rgba(0,0,0,0.02)',
  },
  connectCardWrap: {
    flex: 1,
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 0',
  },
  connectEyebrow: {
    fontSize: 11,
    fontWeight: 700,
    color: T.accent,
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  connectTitle: {
    fontSize: 24,
    fontWeight: 800,
    color: T.head,
    marginBottom: 8,
    letterSpacing: -0.4,
  },
  connectDesc: {
    fontSize: 14,
    color: T.muted,
    marginBottom: 24,
    lineHeight: 1.5,
  },
  inlineCode: {
    background: T.bg,
    padding: '1px 6px',
    borderRadius: 4,
    fontSize: 13,
    fontFamily: 'ui-monospace, monospace',
    color: T.head,
    border: `1px solid ${T.border}`,
  },
  connectForm: { display: 'flex', gap: 8, marginBottom: 8 },
  connectInput: {
    flex: 1,
    padding: '11px 14px',
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    fontSize: 14,
    background: '#fff',
    color: T.head,
    outline: 'none',
  },
  discoverBtn: {
    padding: '11px 20px',
    background: T.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 14,
    whiteSpace: 'nowrap',
  },
  errorBanner: {
    padding: '10px 14px',
    background: '#fef0ec',
    border: `1px solid ${T.accent}`,
    borderRadius: 8,
    color: T.error,
    fontSize: 13,
    marginTop: 8,
    marginBottom: 8,
  },
  connectSteps: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    paddingTop: 24,
    borderTop: `1px solid ${T.border}`,
  },
  connectStep: { flex: 1, display: 'flex', alignItems: 'center', gap: 10 },
  connectStepNum: {
    width: 28,
    height: 28,
    borderRadius: 6,
    background: T.bg,
    border: `1px solid ${T.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: 12,
    color: T.head,
    flexShrink: 0,
  },
  connectStepLabel: { fontSize: 12, color: T.muted, fontWeight: 500 },
  connectStepArrow: { color: T.mutedSoft, fontSize: 14 },

  // Conversation header
  conversationHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 20px',
    borderBottom: `1px solid ${T.border}`,
    background: T.surface,
    flexShrink: 0,
  },
  conversationHeaderInfo: { display: 'flex', flexDirection: 'column', gap: 2 },
  conversationHeaderName: { fontSize: 15, fontWeight: 700, color: T.head },
  conversationHeaderMeta: {
    fontSize: 12,
    color: T.muted,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  dotSep: { color: T.mutedSoft },
  disconnectBtn: {
    padding: '7px 14px',
    border: `1px solid ${T.border}`,
    background: '#fff',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    color: T.head,
    fontWeight: 600,
  },

  // Conversation body
  conversation: { flex: 1, overflowY: 'auto', padding: '24px 20px', minHeight: 0 },
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    maxWidth: 860,
    margin: '0 auto',
  },

  // User bubble
  userRow: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  avatarUser: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: T.surface,
    border: `1px solid ${T.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 800,
    color: T.muted,
    flexShrink: 0,
  },
  userCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    maxWidth: '76%',
  },
  userBubble: {
    padding: '12px 16px',
    background: T.userBg,
    border: `1px solid ${T.border}`,
    borderRadius: '16px 16px 4px 16px',
    color: T.userText,
    fontSize: 14.5,
    lineHeight: 1.55,
    wordBreak: 'break-word',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    letterSpacing: -0.1,
    textAlign: 'left',
  },
  userText: { whiteSpace: 'pre-wrap', margin: 0, textIndent: 0 },
  userMeta: { fontSize: 11, color: T.muted, marginTop: 4, marginRight: 4 },

  // Agent bubble
  agentRow: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  avatarAgent: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: T.accent,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 800,
    color: '#fff',
    flexShrink: 0,
  },
  agentCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    maxWidth: '82%',
    gap: 10,
  },
  agentBubble: {
    padding: '14px 18px',
    background: T.agentBgGrad,
    color: T.agentText,
    borderRadius: '16px 16px 16px 4px',
    fontSize: 15,
    lineHeight: 1.7,
    position: 'relative',
    wordBreak: 'break-word',
    minWidth: 80,
    boxShadow: '0 2px 8px rgba(217, 74, 47, 0.18)',
    letterSpacing: -0.1,
    textAlign: 'left',
    textIndent: 0,
  },
  agentMeta: {
    fontSize: 11,
    color: T.muted,
    marginTop: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  streamingDot: { color: T.accent, fontSize: 10, marginLeft: 4, animation: 'cpulse 1s infinite' },

  // Thinking block
  thinkingBlock: {
    background: T.thinkingBg,
    border: `1px solid ${T.border}`,
    borderRadius: 10,
    overflow: 'hidden',
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
  },
  thinkingHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    color: T.thinkingText,
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  thinkingHeaderOpen: {
    borderBottom: `1px solid ${T.border}`,
  },
  thinkingChevron: {
    fontSize: 10,
    color: T.muted,
    width: 12,
    display: 'inline-block',
  },
  thinkingIcon: { fontSize: 13 },
  thinkingLabel: { fontWeight: 600, flex: 1 },
  thinkingDuration: {
    fontSize: 11,
    color: T.muted,
    background: '#fff',
    padding: '1px 6px',
    borderRadius: 4,
    fontWeight: 600,
  },
  thinkingDots: {
    display: 'inline-flex',
    gap: 0,
    fontSize: 16,
    color: T.accent,
    lineHeight: 1,
  },
  thinkingBody: {
    padding: '12px 14px 14px',
    background: '#fffcf3',
    fontSize: 13.5,
    color: T.thinkingText,
    lineHeight: 1.65,
    maxHeight: 360,
    overflowY: 'auto',
    textAlign: 'left',
  },
  thinkingList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  thoughtItem: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    textAlign: 'left',
    textIndent: 0,
  },
  thoughtBullet: {
    color: T.accent,
    fontSize: 14,
    lineHeight: 1.7,
    flexShrink: 0,
    marginTop: 0,
  },
  thoughtContent: {
    flex: 1,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    textAlign: 'left',
    textIndent: 0,
  },
  thinkingTools: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTop: `1px dashed ${T.border}`,
  },
  toolChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 9px',
    background: '#fff',
    border: `1px solid ${T.border}`,
    borderRadius: 999,
    fontSize: 11,
    color: T.head,
  },
  toolChipError: { borderColor: T.accent, color: T.error },
  toolChipIcon: { fontSize: 10, color: T.success, fontWeight: 700 },
  toolChipName: { fontWeight: 600 },

  // URL preview
  urlCard: {
    border: `1px solid ${T.border}`,
    padding: 10,
    borderRadius: 8,
    background: '#fff',
    marginTop: 10,
  },
  urlCardHeader: { display: 'flex', alignItems: 'center', gap: 10 },
  favWrap: {
    width: 26,
    height: 26,
    borderRadius: 4,
    overflow: 'hidden',
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  fav: { width: 20, height: 20 },
  urlHost: { fontSize: 13, fontWeight: 700, color: T.head },
  urlShort: { fontSize: 12, color: T.muted, wordBreak: 'break-all' },
  openBtn: {
    padding: '5px 10px',
    border: `1px solid ${T.border}`,
    borderRadius: 6,
    background: '#fff',
    color: T.head,
    textDecoration: 'none',
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  urlBody: { paddingTop: 8 },
  urlDesc: { fontSize: 13, color: '#4a4a52' },

  // Copy button
  copyBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: '3px 9px',
    borderRadius: 4,
    background: 'rgba(255,255,255,0.18)',
    border: '1px solid rgba(255,255,255,0.25)',
    cursor: 'pointer',
    fontSize: 11,
    color: '#fff',
    fontWeight: 600,
    fontFamily: 'inherit',
  },

  // Empty state
  emptyState: {
    padding: 60,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    textAlign: 'center',
  },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: 800, color: T.head },
  emptyDesc: { fontSize: 13, color: T.muted, maxWidth: 320 },

  // Composer
  composerBar: {
    padding: '12px 20px 20px',
    background: T.bg,
    flexShrink: 0,
  },
  composerInner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    maxWidth: 860,
    margin: '0 auto',
    background: '#fff',
    border: `1px solid ${T.border}`,
    borderRadius: 12,
    padding: 6,
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  },
  cmdInput: {
    flex: 1,
    padding: '8px 12px',
    border: 'none',
    background: 'transparent',
    fontSize: 14,
    color: T.head,
    outline: 'none',
  },
  sendBtn: {
    padding: '8px 16px',
    background: T.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 13,
  },
  composerHint: { fontSize: 11, color: T.muted, textAlign: 'center', marginTop: 8 },
  kbd: {
    padding: '1px 5px',
    background: '#fff',
    border: `1px solid ${T.border}`,
    borderRadius: 3,
    fontSize: 10,
    fontFamily: 'ui-monospace, monospace',
    color: T.head,
  },
  footer: {
    width: '100%',
    maxWidth: 520,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '20px 0 24px',
  },

  footerTeam: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: T.head,
  },

  footerLabel: {
    fontSize: 14,
    fontWeight: 700,
    color: T.accent,
  },

  footerDivider: {
    color: T.mutedSoft,
  },

  footerBadge: {
    fontSize: 11,
    fontWeight: 500,
    color: T.muted,
    background: T.bg,
    padding: '2px 10px',
    borderRadius: 999,
    border: `1px solid ${T.border}`,
  },

  footerMembers: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },

  footerMember: {
    fontSize: 12,
    color: T.muted,
    padding: '2px 8px',
    background: '#fff',
    borderRadius: 4,
    border: `1px solid ${T.border}`,
  },

  footerNote: {
    fontSize: 11,
    color: T.mutedSoft,
    fontStyle: 'italic',
    marginTop: 2,
  },
};

const globalCSS = `
  @keyframes tdot { 0%,80%,100%{transform:translateY(0);opacity:.3} 40%{transform:translateY(-3px);opacity:1} }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes fadeUp { 0%{opacity:0;transform:translateY(8px)} 100%{opacity:1;transform:translateY(0)} }
  @keyframes cpulse { 0%,100%{opacity:1} 50%{opacity:.3} }

  .tdot.d1{animation:tdot 1.4s infinite}
  .tdot.d2{animation:tdot 1.4s .2s infinite}
  .tdot.d3{animation:tdot 1.4s .4s infinite}

  .stream-cursor{
    display:inline-block;
    width:7px;
    height:1.1em;
    background:#fff;
    vertical-align:-3px;
    margin-left:2px;
    animation:blink .9s step-end infinite;
    border-radius:1px
  }

  /* Streaming plain text (no markdown re-parse during streaming) */
  .agent-md-stream {
    font-size: 15px;
    line-height: 1.7;
    color: #fff;
    letter-spacing: -0.1px;
    white-space: pre-wrap;
    word-break: break-word;
    text-align: left;
    text-indent: 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Final rendered markdown (after streaming ends) */
  .agent-md {
    font-size: 15px;
    line-height: 1.7;
    color: #fff;
    letter-spacing: -0.1px;
    text-align: left;
    text-indent: 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .agent-md > *:first-child { margin-top: 0 !important; padding-top: 0 !important; }
  .agent-md > *:last-child { margin-bottom: 0 !important; padding-bottom: 0 !important; }
  .agent-md p {
    margin: 0 0 10px;
    line-height: 1.7;
    text-align: left;
    text-indent: 0;
  }
  .agent-md p:last-child { margin-bottom: 0; }
  .agent-md h1, .agent-md h2, .agent-md h3, .agent-md h4 {
    margin: 14px 0 6px;
    line-height: 1.3;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.2px;
  }
  .agent-md > h1:first-child, .agent-md > h2:first-child, .agent-md > h3:first-child, .agent-md > h4:first-child {
    margin-top: 0;
  }
  .agent-md h1 { font-size: 18px; }
  .agent-md h2 { font-size: 16px; }
  .agent-md h3 { font-size: 15px; }
  .agent-md h4 { font-size: 14px; }
  .agent-md ul, .agent-md ol { padding-left: 22px; margin: 6px 0 10px; }
  .agent-md li { margin: 3px 0; line-height: 1.65; text-align: left; text-indent: 0; }
  .agent-md li > p { margin: 0; }
  .agent-md li > ul, .agent-md li > ol { margin: 2px 0; }
  .agent-md code {
    background: rgba(255,255,255,0.18);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 13px;
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
    color: #fff;
  }
  .agent-md pre {
    background: rgba(0,0,0,0.35);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 0;
    overflow: hidden;
    margin: 8px 0;
  }
  .agent-md .md-codeblock { position: relative; }
  .agent-md .md-lang {
    background: rgba(0,0,0,0.3);
    color: rgba(255,255,255,0.75);
    padding: 5px 12px;
    font-size: 10px;
    font-family: ui-monospace, monospace;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .agent-md pre code {
    display: block;
    background: none;
    padding: 12px 14px;
    color: #f4efe7;
    font-size: 13px;
    line-height: 1.55;
    overflow-x: auto;
    white-space: pre;
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  }
  .agent-md strong { font-weight: 700; color: #fff; }
  .agent-md em { font-style: italic; }
  .agent-md a {
    color: #fff;
    text-decoration: underline;
    text-decoration-color: rgba(255,255,255,0.5);
    text-underline-offset: 2px;
  }
  .agent-md a:hover { text-decoration-color: rgba(255,255,255,1); }
  .agent-md blockquote {
    border-left: 3px solid rgba(255,255,255,0.4);
    padding: 4px 12px;
    margin: 8px 0;
    color: rgba(255,255,255,0.9);
    font-style: italic;
  }
  .agent-md .md-tablewrap { overflow-x: auto; margin: 8px 0; }
  .agent-md table {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
    background: rgba(0,0,0,0.2);
    border-radius: 6px;
    overflow: hidden;
  }
  .agent-md th, .agent-md td {
    border: 1px solid rgba(255,255,255,0.15);
    padding: 6px 10px;
    text-align: left;
  }
  .agent-md th {
    background: rgba(0,0,0,0.25);
    font-weight: 700;
  }
  .agent-md hr {
    border: none;
    border-top: 1px solid rgba(255,255,255,0.2);
    margin: 12px 0;
  }
  .agent-md input[type="checkbox"] {
    margin-right: 6px;
    transform: scale(1.1);
    vertical-align: middle;
  }
  .agent-md img { max-width: 100%; height: auto; border-radius: 6px; }

  * { box-sizing: border-box; }
  body { margin: 0; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }

  button { font-family: inherit; }
  input { font-family: inherit; }
`;
