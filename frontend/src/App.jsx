import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

marked.setOptions({ breaks: true, gfm: true });
const renderer = new marked.Renderer();
renderer.code = (code, lang) => {
  lang = (typeof code === 'object' ? code.lang : lang || '').trim();
  const text = typeof code === 'object' ? code.text : code;
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return `<pre><code class="hlang-${lang || 'text'}">${esc(text)}</code></pre>`;
};
marked.use({ renderer });

function md(text) {
  if (!text) return '';
  return DOMPurify.sanitize(marked.parse(text), { ADD_ATTR: ['target', 'rel'] });
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

// Static meta hints — extend this map with domains your agent commonly references
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

/* ── UrlPreview ─────────────────────────────────────────────────────────── */
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
            <span style={{ fontSize: 12, color: T.txt3 }}>🌐</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.urlHost}>{meta.title}</div>
          <div style={s.urlShort}>{short}</div>
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" style={s.openBtn}>
          Open
        </a>
      </div>
      <div style={s.urlBody}>
        <div style={s.urlDesc}>{meta.desc}</div>
      </div>
    </div>
  );
}

/* ── CopyButton ─────────────────────────────────────────────────────────── */
function CopyButton({ getText }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      style={{ ...s.copyBtn, ...(copied ? { opacity: 1, color: T.success } : {}) }}
      onClick={() => {
        navigator.clipboard?.writeText(getText()).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      title="Copy"
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

/* ── Bubble ─────────────────────────────────────────────────────────────── */
function Bubble({ msg }) {
  const { role, text, streaming, kind, data } = msg;
  const bubbleRef = useRef(null);

  if (role === 'user') {
    return (
      <div style={s.eventRow}>
        <div style={s.eventMeta}><strong style={s.tag}>YOU</strong><span style={s.evTime}>{msg.time}</span></div>
        <div style={s.eventBody}>
          <div style={s.userMsg}>{text}</div>
        </div>
      </div>
    );
  }

  if (role === 'system') {
    if (kind === 'tool')
      return (
        <div style={s.eventRowSystem}>
          <div style={s.eventMeta}><strong style={{...s.tag, color: T.accent}}>TOOL</strong></div>
          <div style={s.eventBody}><div style={s.sysTool}>→ {data?.tool} {data?.reasoning ? <span style={s.muted}>— {data.reasoning}</span> : null}</div></div>
        </div>
      );
    if (kind === 'status')
      return (
        <div style={s.eventRowSystem}>
          <div style={s.eventMeta}><strong style={s.tag}>SYSTEM</strong></div>
          <div style={s.eventBody}><div style={s.sysStatus}>{data?.intent}{data?.budget!=null? <span style={s.muted}> — budget: {data.budget}</span>:null}</div></div>
        </div>
      );
    if (kind === 'error')
      return (
        <div style={s.eventRowError}>
          <div style={s.eventMeta}><strong style={{...s.tag, color: T.error}}>ERROR</strong></div>
          <div style={s.eventBody}><div style={s.errText}>⚠ {data?.text || text}</div></div>
        </div>
      );
    return null;
  }

  // agent
  const urls = !streaming ? extractBareUrls(text) : [];
  const html = md(text);

  return (
    <div style={s.eventRowAgent}>
      <div style={s.agentMeta}><div style={s.agentMark}>AGENT</div><div style={s.agentTime}>{msg.time}{streaming? <span style={s.streamDot} title="streaming">●</span>:null}</div></div>
      <div style={s.agentBody}>
        <div style={{...s.agentCard, ...(streaming? s.agentStreaming : {})}}>
          {!streaming && <CopyButton getText={() => bubbleRef.current?.innerText || ''} />}
          <div ref={bubbleRef} className="agent-md" dangerouslySetInnerHTML={{ __html: html + (streaming ? '<span class="stream-cursor"></span>' : '') }} />
        </div>
        {urls.map((u, i) => (
          <UrlPreview key={i} url={u} />
        ))}
      </div>
    </div>
  );
}

/* ── TypingIndicator ─────────────────────────────────────────────────────── */
function TypingIndicator() {
  return (
    <div style={s.typingRow}>
      <div style={s.agentMetaSmall}><div style={s.agentMarkSmall}>AGENT</div></div>
      <div style={s.typingBubble}>{[0,1,2].map(i=> <span key={i} className={`typing-dot dot-${i}`} style={s.dot} />)}</div>
    </div>
  );
}

/* ── ConfigStrip ─────────────────────────────────────────────────────────── */
function ConfigStrip({ cfg }) {
  const tools = (cfg.tools || []).slice(0, 6);
  const extra = (cfg.tools || []).length - 6;
  return (
    <div style={s.cfgStrip}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <div style={{fontWeight:700,fontSize:13,color:T.head}}>{cfg.name || 'agents.json'}</div>
        {cfg.environment && <div style={s.envTag}>{cfg.environment}</div>}
      </div>
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        {tools.map((t,i)=> (
          <div key={i} style={s.toolRow} title={t.description}><div style={s.toolDot} />{t.name}</div>
        ))}
        {extra>0 && <div style={s.envTag}>+{extra} more</div>}
      </div>
    </div>
  );
}

/* ── App ─────────────────────────────────────────────────────────────────── */
export default function App() {
  const [url, setUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [connected, setConnectedState] = useState(false);
  const [agentCfg, setAgentCfg] = useState(null);
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState('');
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

  const backendUrl = useMemo(() => {
    const host = window.location.hostname;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${host}:8080/ws`;
  }, []);

  function push(msg) {
    setMessages((p) => [...p, { ...msg, time: fmtTime() }]);
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'init':
        if (msg.ok) {
          setConnectedState(true);
          push({
            role: 'system',
            kind: 'status',
            data: { intent: 'connected', budget: msg.payload?.token_budget },
          });
        } else {
          push({ role: 'system', kind: 'error', data: { text: msg.error || 'init failed' } });
        }
        break;
      case 'query.tool':
        push({
          role: 'system',
          kind: 'tool',
          data: { tool: msg.payload?.tool, reasoning: msg.payload?.reasoning },
        });
        break;
      case 'query.status':
        push({
          role: 'system',
          kind: 'status',
          data: { intent: msg.payload?.intent, budget: msg.payload?.token_budget },
        });
        break;
      case 'query.chunk': {
        const chunk = msg.payload?.text || '';
        if (!chunk) return;
        setStreaming(true);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'agent' && last.streaming) {
            next[next.length - 1] = { ...last, text: last.text + chunk };
          } else {
            next.push({ role: 'agent', text: chunk, streaming: true, time: fmtTime() });
          }
          return next;
        });
        break;
      }
      case 'query':
        setStreaming(false);
        if (msg.ok && msg.payload?.text != null) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'agent' && last.streaming) {
              next[next.length - 1] = { ...last, text: msg.payload.text, streaming: false };
            } else {
              next.push({
                role: 'agent',
                text: msg.payload.text,
                streaming: false,
                time: fmtTime(),
              });
            }
            return next;
          });
        } else if (!msg.ok) {
          push({ role: 'system', kind: 'error', data: { text: msg.error || 'query failed' } });
        }
        break;
      case 'error':
        setStreaming(false);
        push({ role: 'system', kind: 'error', data: { text: msg.error || 'unknown error' } });
        break;
    }
  }

  async function handleCheck() {
    const u = normalizeUrl(url);
    if (!u) {
      push({ role: 'system', kind: 'error', data: { text: 'Invalid URL.' } });
      return;
    }
    setChecking(true);
    setMessages([]);
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
      ws.onerror = () =>
        push({
          role: 'system',
          kind: 'error',
          data: { text: 'WebSocket failed. Is the Go backend running on :8080?' },
        });
      ws.onclose = () => {
        setConnectedState(false);
        setStreaming(false);
      };
    } catch (e) {
      push({ role: 'system', kind: 'error', data: { text: e.message } });
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
    setStreaming(false);
    setAgentCfg(null);
  }

  function sendMsg() {
    const ws = wsRef.current;
    const text = input.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    push({ role: 'user', text });
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
          <div style={s.logoMark}>AC</div>
          <div style={s.productTitle}>Agent Console</div>
        </div>
        <div style={s.navRight}>
          <div style={s.connInfo}>
            <div style={{...s.connDotSmall, background: connected? T.success: T.muted}} />
            <div style={s.connText}>{connected? 'Backend connected':'Disconnected'}</div>
            <div style={s.version}>v0.1</div>
          </div>
        </div>
      </div>

      <div style={s.workspace}>
        <aside style={s.sidebar}>
          <div style={s.sideSection}>
            <div style={s.sideLabel}>ACTIVE AGENT</div>
            {!agentCfg ? (
              <div style={s.sideEmpty}>No agent connected</div>
            ) : (
              <div>
                <div style={s.agentName}>{agentCfg.name}</div>
                <div style={s.agentMetaRow}><div style={{color: connected?T.success:T.muted}}>{connected? 'Connected':'Not connected'}</div><div style={s.agentDomain}>{agentCfg.origin||''}</div></div>
                <div style={s.toolCount}>{(agentCfg.tools||[]).length} tools</div>
              </div>
            )}
          </div>

          <div style={s.sideSection}>
            <div style={s.sideLabel}>AVAILABLE TOOLS</div>
            {agentCfg && agentCfg.tools && agentCfg.tools.length>0 ? (
              <div style={s.toolsList}>
                {agentCfg.tools.map((t,i)=> (
                  <div key={i} style={s.toolItem}><div style={s.toolIcon} /> <div style={s.toolName}>{t.name}</div> <div style={s.toolAvail}>{t.available? 'OK':'—'}</div></div>
                ))}
              </div>
            ) : (
              <div style={s.sideEmptySmall}>No tools discovered</div>
            )}
          </div>
        </aside>

        <main style={s.main}>
          <div style={s.connectBar}>
            {!connected ? (
              <div style={s.connectInner}>
                <div style={s.connectLabel}>CONNECT TO SITE</div>
                <input style={s.connectInput} type="text" placeholder="https://example.com" value={url} onChange={(e)=>setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCheck()} />
                <button style={{...s.discoverBtn, ...(checking?{opacity:0.7}:null)}} onClick={handleCheck} disabled={checking}>{checking? 'Discovering…':'Discover agent'}</button>
              </div>
            ) : (
              <div style={s.connectedStrip}>
                <div style={s.connectedDomain}>{agentCfg?.name} · {new URL(agentCfg?.origin||'http://localhost').hostname}</div>
                <button style={s.disconnectBtn} onClick={disconnect}>Disconnect</button>
              </div>
            )}
          </div>

          <div style={s.conversation}>
            {messages.length===0 ? (
              <div style={s.emptyState}>
                <div style={s.emptyTitle}>READY WHEN YOU ARE.</div>
                <div style={s.emptyDesc}>Connect a website to discover its agent configuration and available tools.</div>
                <div style={s.steps}><div style={s.step}><div style={s.stepNum}>01</div><div>Enter site</div></div><div style={s.step}><div style={s.stepNum}>02</div><div>Discover agent</div></div><div style={s.step}><div style={s.stepNum}>03</div><div>Start a session</div></div></div>
              </div>
            ) : (
              <div style={s.timeline}>
                {messages.map((m,i)=> <div key={i} style={{animation:'fadeIn .14s ease'}}><Bubble msg={m} /></div>)}
                {streaming && messages[messages.length-1]?.role!=='agent' && <TypingIndicator />}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <div style={s.composerBar}>
            <div style={s.prompt}>›</div>
            <input
              ref={inputRef}
              style={{...s.cmdInput, ...(connected?{}:{opacity:0.5})}}
              placeholder={connected? 'Enter a command or question — Enter to send': 'Connect an agent to begin'}
              value={input}
              onChange={(e)=>setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={!connected}
            />
            <div style={s.hint}>Enter to send</div>
            <button style={{...s.sendBtn, ...( (!connected || !input.trim())? {opacity:0.45}: null)}} onClick={sendMsg} disabled={!connected || !input.trim()}>Send</button>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ── Design tokens ──────────────────────────────────────────────────────── */
const T = {
  bg: '#FAF5EA',
  surface: '#fff8ef',
  head: '#111217',
  muted: '#6b6b6b',
  accent: '#d94a2f',
  warm: '#d9871a',
  success: '#1f5f2f',
  border: '#2b2b2b',
  codeBg: '#1e1b18',
  txt: '#111217',
  txtSoft: '#3d3d3d',
  error: '#b83b2a',
};

/* ── Styles ─────────────────────────────────────────────────────────────── */
const s = {
  page: {
    minHeight: '100vh',
    background: T.bg,
    color: T.txt,
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial",
  },
  topNav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 18px',
    borderBottom: `1px solid ${T.border}`,
    background: T.surface,
  },
  navLeft: {display:'flex',alignItems:'center',gap:12},
  logoMark: {width:36,height:36,borderRadius:6,background:T.accent,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,boxShadow:'0 1px 0 rgba(0,0,0,0.06)'},
  productTitle: {fontWeight:700,fontSize:15,color:T.head},
  navRight: {display:'flex',alignItems:'center',gap:8},
  connInfo: {display:'flex',alignItems:'center',gap:10,color:T.txtSoft,fontSize:13},
  connDotSmall:{width:9,height:9,borderRadius:3},
  connText:{fontSize:13,color:T.head},
  version:{fontSize:12,color:T.muted,marginLeft:6},

  workspace: {display:'flex',height:'calc(100vh - 62px)'},
  sidebar: {width:260, borderRight:`1px solid ${T.border}`, padding:16, background:T.surface},
  sideSection: {marginBottom:18},
  sideLabel: {fontSize:11,fontWeight:700,color:T.muted,marginBottom:8,letterSpacing:1},
  sideEmpty:{color:T.muted,fontSize:13,padding:'8px 0'},
  sideEmptySmall:{color:T.muted,fontSize:12,padding:'6px 0'},
  agentName:{fontSize:15,fontWeight:800,color:T.head,marginBottom:6},
  agentMetaRow:{display:'flex',flexDirection:'column',gap:4,fontSize:12,color:T.txtSoft},
  agentDomain:{fontSize:12,color:T.muted},
  toolCount:{marginTop:8,fontSize:12,color:T.head,fontWeight:600},
  toolsList:{display:'flex',flexDirection:'column',gap:8,marginTop:8},
  toolItem:{display:'flex',alignItems:'center',gap:10,padding:'6px 8px',border:`1px solid ${T.border}`,borderRadius:6,background:'#fff'},
  toolIcon:{width:10,height:10,background:T.warm,borderRadius:2},
  toolName:{flex:1,fontSize:13,color:T.head,fontWeight:600},
  toolAvail:{fontSize:12,color:T.muted},

  main: {flex:1,display:'flex',flexDirection:'column'},
  connectBar:{padding:14,borderBottom:`1px solid ${T.border}`,background:T.bg},
  connectInner:{display:'flex',gap:10,alignItems:'center'},
  connectLabel:{fontSize:11,fontWeight:700,color:T.muted,letterSpacing:1},
  connectInput:{flex:1,padding:'8px 10px',border:`1px solid ${T.border}`,borderRadius:6,fontSize:13,background:'#fff',color: T.head},
  discoverBtn:{padding:'8px 12px',background:T.accent,color:'#fff',border:'none',borderRadius:6,cursor:'pointer',fontWeight:700},
  connectedStrip:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10},
  connectedDomain:{fontSize:13,fontWeight:700,color:T.head},
  disconnectBtn:{padding:'6px 10px',border:`1px solid ${T.border}`,background:'#fff',borderRadius:6,cursor:'pointer'},

  conversation:{flex:1,overflowY:'auto',padding:18,background:'transparent'},
  timeline:{display:'flex',flexDirection:'column',gap:12},
  eventRow:{display:'flex',gap:12,alignItems:'flex-start'},
  eventMeta:{width:100,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6},
  tag:{fontSize:11,background:'transparent',padding:'2px 6px',borderRadius:4,color:T.head,fontWeight:800},
  evTime:{fontSize:11,color:T.muted},
  eventBody:{flex:1},
  userMsg:{padding:10,borderLeft:`3px solid ${T.accent}`,background:'#fff',border:`1px solid ${T.border}`,borderRadius:6,color:T.head},

  eventRowSystem:{display:'flex',gap:12,alignItems:'flex-start'},
  sysStatus:{padding:8,background:'#fff',border:`1px solid ${T.border}`,borderRadius:6,color:T.head,fontWeight:600},
  sysTool:{padding:8,background:'#fff',border:`1px dashed ${T.border}`,borderRadius:6,color:T.head,fontFamily:"ui-monospace,monospace"},
  eventRowError:{display:'flex',gap:12,alignItems:'flex-start'},
  errText:{padding:10,background:'#fff',border:`1px solid ${T.border}`,borderRadius:6,color:T.error,fontWeight:700},

  eventRowAgent:{display:'flex',gap:12,alignItems:'flex-start'},
  agentMeta:{width:100,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6},
  agentMetaSmall:{width:100,display:'flex',alignItems:'flex-end'},
  agentMark:{fontWeight:800,color:T.head},
  agentMarkSmall:{fontWeight:700,color:T.head},
  agentTime:{fontSize:11,color:T.muted},
  streamDot:{display:'inline-block',marginLeft:8,color:T.accent,fontSize:12},
  agentBody:{flex:1},
  agentCard:{padding:12,background:'#fff',border:`1px solid ${T.border}`,borderRadius:6,position:'relative'},
  agentStreaming:{boxShadow:'inset 0 -2px 0 rgba(217,74,47,0.06)'},
  agentTimeSmall:{fontSize:11,color:T.muted},

  copyBtn: {position:'absolute',top:8,right:8,padding:'4px 7px',borderRadius:4,background:'#fff',border:`1px solid ${T.border}`,cursor:'pointer',opacity:0.9},

  urlCard:{border:`1px solid ${T.border}`,padding:10,borderRadius:6,background:'#fff',marginTop:10},
  urlCardHeader:{display:'flex',alignItems:'center',gap:10},
  favWrap:{width:26,height:26,borderRadius:4,overflow:'hidden',background:'#fff'},
  fav:{width:20,height:20},
  urlHost:{fontSize:13,fontWeight:700,color:T.head},
  urlShort:{fontSize:12,color:T.muted},
  openBtn:{padding:'6px 8px',border:`1px solid ${T.border}`,borderRadius:6,background:'#fff',color:T.head,textDecoration:'none'},
  urlBody:{paddingTop:8},
  urlTitle:{fontSize:13,fontWeight:700,color:T.head},
  urlDesc:{fontSize:13,color:T.txtSoft},

  cfgStrip:{padding:10,borderTop:`1px solid ${T.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'},
  toolRow:{display:'inline-flex',alignItems:'center',gap:8,padding:'5px 8px',borderRadius:6,border:`1px solid ${T.border}`},
  toolDot:{width:8,height:8,background:T.warm,borderRadius:3},

  emptyState:{padding:40,background:'transparent',display:'flex',flexDirection:'column',alignItems:'center',gap:12},
  emptyTitle:{fontSize:18,fontWeight:900,color:T.head},
  emptyDesc:{fontSize:13,color:T.muted},
  steps:{display:'flex',gap:12,marginTop:12},
  step:{display:'flex',alignItems:'center',gap:10,background:'#fff',padding:'8px 12px',border:`1px solid ${T.border}`,borderRadius:6},
  stepNum:{fontWeight:900,color:T.head,background:T.surface,padding:'6px 8px',borderRadius:4,border:`1px solid ${T.border}`},

  composerBar:{display:'flex',alignItems:'center',gap:10,padding:12,borderTop:`1px solid ${T.border}`,background:T.surface},
  prompt:{fontSize:18,color:T.muted,fontWeight:700},
  cmdInput:{flex:1,padding:'10px 12px',border:`1px solid ${T.border}`,borderRadius:6,background:'#fff',fontSize:14,color: T.head},
  hint:{fontSize:12,color:T.muted},
  sendBtn:{padding:'8px 12px',background:T.accent,color:'#fff',border:'none',borderRadius:6,cursor:'pointer',fontWeight:700},
};

/* ── Global CSS ─────────────────────────────────────────────────────────── */
const globalCSS = `
  @keyframes tdot { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-5px);opacity:1} }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes cpulse { 0%,100%{opacity:1} 50%{opacity:.4} }

  .dot-0{animation:tdot 1.2s infinite ease-in-out}
  .dot-1{animation:tdot 1.2s .2s infinite ease-in-out}
  .dot-2{animation:tdot 1.2s .4s infinite ease-in-out}

  .stream-cursor{display:inline-block;width:2px;height:14px;background:#d94a2f;border-radius:1px;vertical-align:middle;margin-left:2px;animation:blink .9s step-end infinite}

  .agent-md p{margin:0 0 7px}
  .agent-md p:last-child{margin:0}
  .agent-md h1,.agent-md h2,.agent-md h3{margin:10px 0 5px;line-height:1.3;font-weight:600;color:#111217}
  .agent-md h1{font-size:16px} .agent-md h2{font-size:15px} .agent-md h3{font-size:14px}
  .agent-md ul,.agent-md ol{padding-left:18px;margin:4px 0 7px}
  .agent-md li{margin:2px 0}
  .agent-md code{background:#f4efe7;border:1px solid rgba(0,0,0,0.06);padding:1px 5px;border-radius:4px;font-size:12px;font-family:ui-monospace,'SFMono-Regular',Menlo,monospace;color:#111217}
  .agent-md pre{background:#1e1b18;border:1px solid rgba(0,0,0,0.25);border-radius:8px;padding:10px 12px;overflow-x:auto;margin:6px 0}
  .agent-md pre code{background:none;border:none;padding:0;color:#f4efe7;font-size:12px}
  .agent-md strong{font-weight:600;color:#111217}
  .agent-md em{color:#6b6b6b}
  .agent-md a{color:#d94a2f;text-decoration:none;border-bottom:1px solid rgba(217,74,47,.18)}
  .agent-md a:hover{border-bottom-color:rgba(217,74,47,.35)}
  .agent-md blockquote{border-left:3px solid #d9871a;padding:6px 10px;margin:6px 0;background:rgba(217,135,26,.06);border-radius:0 6px 6px 0;color:#6b6b6b}
  .agent-md table{border-collapse:collapse;width:100%;margin:6px 0;font-size:12.5px}
  .agent-md th,.agent-md td{border:1px solid rgba(0,0,0,0.06);padding:5px 9px;text-align:left}
  .agent-md th{background:#f4efe7;font-weight:600;color:#111217}
  .agent-md hr{border:none;border-top:1px solid rgba(0,0,0,0.06);margin:8px 0}
  .bubble:hover .copy-btn-inner{opacity:1!important}
`;
