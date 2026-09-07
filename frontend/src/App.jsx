import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { BrowserRouter, useLocation, Routes, Route, Link, Navigate } from 'react-router-dom'
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Brain, ChevronRight,
  Clock3, Database, Gauge, LayoutDashboard, SlidersHorizontal,
  Server, Settings, Wifi, Zap, Shield,
} from 'lucide-react'
import {
  AreaChart, Area, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

// ─── WebSocket Context ────────────────────────────────────────────────
const WsCtx = createContext(null)

function WsProvider({ children }) {
  const [data, setData] = useState(null)
  const wsRef = useRef(null)

  useEffect(() => {
    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws`)
      wsRef.current = ws
      ws.onmessage = (e) => setData(JSON.parse(e.data))
      ws.onclose = () => setTimeout(connect, 2000)
      ws.onerror = () => ws.close()
    }
    connect()
    return () => wsRef.current?.close()
  }, [])

  return <WsCtx.Provider value={data}>{children}</WsCtx.Provider>
}

function useWs() { return useContext(WsCtx) }

function toggleMode(currentNaive) {
  fetch(currentNaive ? '/api/mode/adaptive' : '/api/mode/naive', { method: 'POST' })
}

// ─── Navigation items ─────────────────────────────────────────────────
const navAdmin = [
  ['/admin',             'Overview',   LayoutDashboard],
  ['/admin/traffic',     'Traffic',    Wifi],
  ['/admin/pipeline',    'Pipeline',   Activity],
  ['/admin/queues',      'Queues',     Database],
  ['/admin/events',      'Events',     Clock3],
  ['/admin/decisions',   'Decisions',  SlidersHorizontal],
  ['/admin/simulation',  'Simulation', Gauge],
  ['/admin/benchmarks',  'Benchmarks', BarChart3],
  ['/admin/agents',      'AI Agents',  Brain],
  ['/admin/settings',    'Settings',   Settings],
]

// ─── Design tokens ────────────────────────────────────────────────────
const C = {
  bg:           '#F7F5F0',
  surface:      '#FFFFFF',
  border:       '#E5E0D8',
  text:         '#0D0D0D',
  textSec:      '#555',
  textMuted:    '#999',
  accent:       '#E8440A',   // Bland.ai orange — nav active, eyebrows
  accentLight:  '#FFF3F0',
  green:        '#16A34A',   // healthy / positive
  greenLight:   '#DCFCE7',
  amber:        '#F5B400',   // CTA yellow
  red:          '#DC2626',
  orange:       '#EA580C',   // Elevated level
}

// Level escalation colors
const LEVEL_COLORS = [C.green, C.orange, C.red, '#9B1C1C']

// Tier chart colors (semantic)
const TIER_COLORS = ['#EF4444', '#F59E0B', '#6366F1', '#22C55E']
const TYPE_COLORS = {
  payment: '#EF4444', order: '#DC2626',
  inventory: '#F59E0B', click: '#6366F1', log: '#22C55E',
}
const TYPE_TIER = { payment: 1, order: 1, inventory: 2, click: 3, log: 4 }

// ─── Shared primitive components ──────────────────────────────────────

/** Button — variant: primary (black), secondary (white+border), cta (amber) */
function Button({ children, secondary = false, cta = false, onClick, type = 'button', disabled = false }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    border: 'none', transition: 'opacity 0.15s', fontFamily: 'inherit',
  }
  if (cta)       return <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, background: C.amber, color: '#0D0D0D' }}>{children}</button>
  if (secondary) return <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, background: '#fff', color: C.text, border: `1.5px solid ${C.border}` }}>{children}</button>
  return <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, background: C.text, color: '#fff' }}>{children}</button>
}

/** Pill badge */
function Badge({ variant = 'green', children }) {
  const map = {
    green:  { background: '#DCFCE7', color: '#15803D' },
    red:    { background: '#FEE2E2', color: '#B91C1C' },
    amber:  { background: '#FEF3C7', color: '#B45309' },
    blue:   { background: '#EFF6FF', color: '#1D4ED8' },
    orange: { background: '#FFF3F0', color: C.accent },
  }
  return (
    <span style={{ ...map[variant], padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
      {children}
    </span>
  )
}

/** Action badge for pipeline decisions */
function ActionBadge({ action }) {
  const v = action === 'shed' ? 'red' : action === 'defer' ? 'amber' : action === 'batch' ? 'blue' : 'green'
  return <Badge variant={v}>{action}</Badge>
}

/** White surface card */
function Card({ children, style = {} }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      ...style,
    }}>
      {children}
    </div>
  )
}

/** Metric stat card */
function Stat({ label, value, sub, critical = false }) {
  return (
    <Card style={{ padding: '20px 24px' }}>
      <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, margin: 0 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 800, color: critical ? C.red : C.text, margin: '10px 0 0', letterSpacing: '-0.02em' }}>{value}</p>
      <p style={{ fontSize: 12, color: '#888', margin: '6px 0 0' }}>{sub}</p>
    </Card>
  )
}

/** Page heading block */
function PageTitle({ eyebrow, title, desc, action }) {
  return (
    <div style={{ marginBottom: 28, display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: C.accent, margin: 0 }}>{eyebrow}</p>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: C.text, margin: '6px 0 0', letterSpacing: '-0.03em' }}>{title}</h1>
        {desc && <p style={{ fontSize: 13, color: C.textSec, margin: '6px 0 0' }}>{desc}</p>}
      </div>
      {action}
    </div>
  )
}

// ─── Dashboard Shell ──────────────────────────────────────────────────
function Shell({ children }) {
  const loc  = useLocation()
  const data = useWs()
  const levelName  = data ? ['NORMAL', 'ELEVATED', 'CRITICAL', 'EMERGENCY'][data.level] : 'CONNECTING...'
  const levelColor = data ? LEVEL_COLORS[data.level] : '#888'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg }}>
      {/* ── Sidebar ── */}
      <aside style={{
        width: 240, background: C.surface, borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', padding: '0 0 16px',
        position: 'sticky', top: 0, height: '100vh', flexShrink: 0, overflow: 'hidden',
      }}>
        {/* Logo */}
        <Link to="/" style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '18px 20px', textDecoration: 'none',
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{
            width: 30, height: 30, background: C.text, borderRadius: 6,
            display: 'grid', placeItems: 'center', color: '#fff',
            fontSize: 13, fontWeight: 900, flexShrink: 0,
          }}>Q</div>
          <span style={{ fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: '-0.03em' }}>AdaptQ</span>
        </Link>

        {/* Level pill */}
        <div style={{
          margin: '14px 14px 6px',
          padding: '7px 12px',
          background: levelColor + '18',
          borderRadius: 8, textAlign: 'center',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
          color: levelColor,
        }}>{levelName}</div>

        {/* Nav */}
        <div style={{ flex: 1, padding: '6px 10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navAdmin.map(([to, label, Icon]) => {
            const active = loc.pathname === to
            return (
              <Link key={to} to={to} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 10px', borderRadius: 8, fontSize: 13,
                fontWeight: active ? 700 : 500,
                color: active ? C.accent : C.textSec,
                background: active ? C.accentLight : 'transparent',
                borderLeft: active ? `3px solid ${C.accent}` : '3px solid transparent',
                textDecoration: 'none', transition: 'all 0.15s',
              }}>
                <Icon size={15} />{label}
              </Link>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 20px 0' }}>
          <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>AdaptQ v1.0</p>
          <p style={{ fontSize: 11, color: '#bbb', margin: '2px 0 0' }}>8 workers · adaptive pipeline</p>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, minWidth: 0 }}>
        <header style={{
          height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: `1px solid ${C.border}`, background: C.surface,
          padding: '0 32px', position: 'sticky', top: 0, zIndex: 10,
        }}>
          <span style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.textMuted }}>
            Control Room / {loc.pathname.split('/').filter(Boolean).slice(-1)[0] || 'overview'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: C.textSec }}>
            {data && (
              <button onClick={() => toggleMode(data.naive_mode)} style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                cursor: 'pointer', border: 'none', fontFamily: 'inherit',
                background: data.naive_mode ? '#FEE2E2' : C.greenLight,
                color: data.naive_mode ? '#B91C1C' : '#15803D',
              }}>
                {data.naive_mode ? 'NAIVE' : 'ADAPTIVE'}
              </button>
            )}
            <span className="pulse-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: data ? C.green : '#EF4444', display: 'inline-block' }} />
            {data ? 'Pipeline active' : 'Connecting...'}
          </div>
        </header>
        {data?.human_alert?.active && (
          <div style={{
            margin: '0', padding: '12px 32px',
            background: '#FEE2E2', borderBottom: `1px solid ${C.red}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>&#9888;</span>
              <div>
                <span style={{ fontWeight: 700, color: '#B91C1C', fontSize: 13 }}>HUMAN ESCALATION ALERT</span>
                <span style={{ color: '#7F1D1D', fontSize: 12, marginLeft: 12 }}>{data.human_alert.reason}</span>
                {data.human_alert.time && <span style={{ color: '#999', fontSize: 11, marginLeft: 8 }}>at {data.human_alert.time}</span>}
              </div>
            </div>
            <button onClick={() => fetch('/api/alerts/acknowledge', { method: 'POST' })} style={{
              padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700,
              cursor: 'pointer', border: 'none', fontFamily: 'inherit',
              background: '#B91C1C', color: '#fff',
            }}>Acknowledge</button>
          </div>
        )}
        <div style={{ padding: 32 }}>{children}</div>
      </main>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────
const BASE_RATE  = 3400
const TIER_MAX   = { tier1: Infinity, tier2: 5000, tier3: 2000, tier4: 500 }
const LEVEL_NAMES = ['Normal', 'Elevated', 'Critical', 'Emergency']

function sumObj(obj) {
  if (!obj) return 0
  return Object.values(obj).reduce((a, b) => a + b, 0)
}

function tierPressure(queues, tier) {
  if (!queues) return 0
  const depth = queues[tier] || 0
  const max   = TIER_MAX[tier]
  if (!isFinite(max)) return Math.min(depth, 100)
  return Math.round((depth / max) * 100)
}

const chartTooltipStyle = {
  borderRadius: 8, border: 'none',
  boxShadow: '0 4px 16px rgba(0,0,0,0.10)', fontSize: 12,
}

// ─── Admin Overview ───────────────────────────────────────────────────
function Admin() {
  const data = useWs()
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (!data) return
    setHistory(prev => {
      const next = [...prev, sumObj(data.throughput_per_sec)]
      return next.length > 30 ? next.slice(-30) : next
    })
  }, [data])

  if (!data) return <Shell><div style={{ textAlign: 'center', color: C.textMuted, paddingTop: 80 }}>Connecting to pipeline...</div></Shell>

  const classifiedSec = sumObj(data.classified_per_sec)
  const configTraffic = Math.round(data.rate_multiplier * BASE_RATE)
  const traffic    = classifiedSec > 0 ? Math.round(classifiedSec * 60) : configTraffic
  const evtSec     = sumObj(data.throughput_per_sec)
  const fifoDepth  = data.queues.fifo || 0
  const queueDepth = data.naive_mode ? fifoDepth : (data.queues.tier1 || 0) + (data.queues.tier2 || 0) + (data.queues.tier3 || 0) + (data.queues.tier4 || 0)
  const critLost   = data.counters?.shed?.payment || 0
  const deferred   = sumObj(data.counters?.deferred)
  const batched    = sumObj(data.counters?.batched)
  const shed       = sumObj(data.counters?.shed)
  const duplicates = sumObj(data.counters?.duplicates)
  const maxBar     = Math.max(...history, 1)

  const queues = [
    { priority: 'P0', label: 'Critical (Payment/Order)', pressure: tierPressure(data.queues, 'tier1'), color: TIER_COLORS[0] },
    { priority: 'P1', label: 'Important (Inventory)',    pressure: tierPressure(data.queues, 'tier2'), color: TIER_COLORS[1] },
    { priority: 'P2', label: 'Normal (Clicks)',          pressure: tierPressure(data.queues, 'tier3'), color: TIER_COLORS[2] },
    { priority: 'P3', label: 'Low (Logs)',               pressure: tierPressure(data.queues, 'tier4'), color: TIER_COLORS[3] },
  ]

  return (
    <Shell>
      <PageTitle eyebrow="Live control room" title="Adaptive pipeline overview"
        desc={`Level: ${LEVEL_NAMES[data.level]} · Updated every second via WebSocket`}
        action={<Button secondary><Activity size={16} /> Live</Button>} />

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => { if (confirm('Reset all counters and return to Normal level?')) fetch('/api/reset', { method: 'POST' }) }}
          style={{ padding: '6px 16px', fontSize: 13, fontWeight: 600, color: '#b91c1c', background: '#fff', border: '1px solid #fca5a5', borderRadius: 8, cursor: 'pointer' }}>
          Reset Metrics
        </button>
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        <Stat label="Current traffic"     value={`${(traffic / 1000).toFixed(1)}k/min`} sub={`${data.rate_multiplier.toFixed(1)}x multiplier`} />
        <Stat label="Events / sec"        value={evtSec}                                sub="Processing rate" />
        <Stat label="Queue depth"         value={queueDepth.toLocaleString()}           sub="Across all tiers" />
        <Stat label="Critical events lost" value={critLost}                             sub="P0 invariant holding" critical />
        <Stat label="Kafka Overflow"      value={(data.queues.kafka || 0).toLocaleString()} sub="Durable disk buffer" />
      </div>

      <div style={{ marginTop: 24, display: 'grid', gap: 24, gridTemplateColumns: '1.4fr 1fr' }}>
        <Card style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Traffic &amp; throughput</h2>
              <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>Last 30 seconds · live stream</p>
            </div>
            <Badge variant={data.backpressure ? 'red' : 'green'}>{data.backpressure ? 'Backpressure' : 'Healthy'}</Badge>
          </div>
          <div style={{ marginTop: 32, height: 192, display: 'flex', alignItems: 'flex-end', gap: 3, position: 'relative' }}>
            <div style={{ position: 'absolute', top: -20, left: 0, fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Y-Axis: Events / Sec (Throughput)
            </div>
            
            {/* Y-Axis Numerical Labels */}
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 10, color: C.textMuted, pointerEvents: 'none', paddingBottom: 2 }}>
              <span>{maxBar > 1 ? maxBar.toLocaleString() : ''}</span>
              <span>{maxBar > 1 ? Math.round(maxBar / 2).toLocaleString() : ''}</span>
              <span>0</span>
            </div>

            {/* Subtle horizontal grid lines */}
            <div style={{ position: 'absolute', top: 0, left: 40, right: 0, borderTop: `1px dashed ${C.border}`, zIndex: 0 }} />
            <div style={{ position: 'absolute', top: '50%', left: 40, right: 0, borderTop: `1px dashed ${C.border}`, zIndex: 0 }} />
            <div style={{ position: 'absolute', bottom: 0, left: 40, right: 0, borderTop: `1px solid ${C.border}`, zIndex: 0 }} />

            {/* Spacer to push bars right of the y-axis labels */}
            <div style={{ width: 36, flexShrink: 0 }} />

            {history.map((v, i) => (
              <div key={i} style={{
                flex: 1, borderRadius: '3px 3px 0 0',
                background: `linear-gradient(180deg, ${C.accent} 0%, ${C.amber} 100%)`,
                height: `${Math.max((v / maxBar) * 100, 2)}%`,
                transition: 'height 0.3s ease',
                zIndex: 1,
              }} />
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.textMuted, position: 'relative' }}>
            <span>-30s</span>
            <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>X-Axis: Time</span>
            <span>Now</span>
          </div>
        </Card>

        <Card style={{ padding: 24 }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Queue pressure</h2>
          <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>Adaptive decisions by priority</p>
          <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {queues.map(q => (
              <div key={q.priority}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 7 }}>
                  <span style={{ fontWeight: 600 }}>
                    {q.priority}&nbsp;
                    <span style={{ fontWeight: 400, color: C.textMuted }}>{q.label}</span>
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: C.textSec }}>{q.pressure}%</span>
                </div>
                <div style={{ height: 7, borderRadius: 99, background: '#F0EDE8' }}>
                  <div style={{ height: 7, borderRadius: 99, transition: 'width 0.3s', width: `${Math.min(q.pressure, 100)}%`, background: q.color }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 24, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat label="Deferred events"  value={deferred.toLocaleString()}   sub="P1/P2 under load" />
        <Stat label="Batched events"   value={batched.toLocaleString()}    sub="Efficiently grouped" />
        <Stat label="Shed events"      value={shed.toLocaleString()}       sub="Overflowed to Kafka" />
        <Stat label="Duplicates caught" value={duplicates.toLocaleString()} sub="Dedup filter (30s TTL)" />
      </div>

      {data.fault_tolerance && (
        <div style={{ marginTop: 24, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <Stat label="Active workers" value={`${data.fault_tolerance.active_workers}/${data.fault_tolerance.total_workers}`} sub="Processing capacity" />
          <Stat label="Retries" value={data.fault_tolerance.retries_total} sub="Exponential backoff (0.5s-5s)" />
          <Stat label="Idempotent skips" value={data.fault_tolerance.idempotent_skips} sub="Already-processed detected" />
          <Stat label="Dead Letter Queue" value={data.fault_tolerance.dead_letter_count} sub="3 retries failed → DLQ" critical={data.fault_tolerance.dead_letter_count > 0} />
        </div>
      )}

      {data.scheduling && (
        <div style={{ marginTop: 24, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <Stat label="Starvation prevented" value={data.scheduling.starvation_preventions} sub="Aging promoted lower tiers" />
          <Stat label="Strict priority picks" value={data.scheduling.strict_priority_picks} sub="Normal priority order" />
          <Stat label="Permanent failures" value={data.scheduling.permanent_failures} sub="Unrecoverable — dead lettered" critical={data.scheduling.permanent_failures > 0} />
          <Stat label="Scheduling ratio" value={
            data.scheduling.starvation_preventions + data.scheduling.strict_priority_picks > 0
              ? `${Math.round((data.scheduling.starvation_preventions / (data.scheduling.starvation_preventions + data.scheduling.strict_priority_picks)) * 100)}%`
              : '0%'
          } sub="Aging vs strict picks" />
        </div>
      )}

      {data.level >= 1 && (
        <Card style={{ marginTop: 24, border: `2px solid ${LEVEL_COLORS[data.level]}22`, background: `linear-gradient(135deg, ${LEVEL_COLORS[data.level]}08 0%, #fff 100%)` }}>
          <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${C.border}` }}>
            <Shield size={20} color={LEVEL_COLORS[data.level]} />
            <div>
              <h2 style={{ fontWeight: 800, fontSize: 15, margin: 0, color: LEVEL_COLORS[data.level] }}>
                Adaptive Protection Active
              </h2>
              <p style={{ fontSize: 13, color: C.textSec, margin: '2px 0 0' }}>
                Level: {LEVEL_NAMES[data.level]} — same 8 workers, zero payment drops
              </p>
            </div>
          </div>
          <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 12px' }}>Protecting</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: C.green, fontWeight: 900 }}>&#10003;</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Payments</span>
                  <span style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>{(data.counters?.shed?.payment || 0) === 0 ? '0 lost' : `${data.counters.shed.payment} lost!`}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: C.green, fontWeight: 900 }}>&#10003;</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Orders</span>
                  <span style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>{(data.counters?.shed?.order || 0) === 0 ? '0 lost' : `${data.counters.shed.order} lost!`}</span>
                </div>
              </div>
            </div>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 12px' }}>Sacrificing</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(data.counters?.shed?.log || 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: C.red, fontWeight: 900 }}>&#10007;</span>
                    <span style={{ fontSize: 14 }}>Logs</span>
                    <span style={{ fontSize: 13, color: C.red, fontFamily: 'monospace' }}>{(data.counters.shed.log).toLocaleString()} shed</span>
                  </div>
                )}
                {(data.counters?.deferred?.click || 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: C.orange, fontWeight: 900 }}>&#8635;</span>
                    <span style={{ fontSize: 14 }}>Clicks</span>
                    <span style={{ fontSize: 13, color: C.orange, fontFamily: 'monospace' }}>{(data.counters.deferred.click).toLocaleString()} deferred</span>
                  </div>
                )}
                {(data.counters?.batched?.inventory || 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#6366F1', fontWeight: 900 }}>&#9776;</span>
                    <span style={{ fontSize: 14 }}>Inventory</span>
                    <span style={{ fontSize: 13, color: '#6366F1', fontFamily: 'monospace' }}>{(data.counters.batched.inventory).toLocaleString()} batched</span>
                  </div>
                )}
                {(data.counters?.shed?.click || 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: C.red, fontWeight: 900 }}>&#10007;</span>
                    <span style={{ fontSize: 14 }}>Clicks</span>
                    <span style={{ fontSize: 13, color: C.red, fontFamily: 'monospace' }}>{(data.counters.shed.click).toLocaleString()} shed</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}
    </Shell>
  )
}

// ─── Queue Monitor ────────────────────────────────────────────────────
function QueueMonitor() {
  const data = useWs()
  if (!data) return <Shell><div style={{ textAlign: 'center', color: C.textMuted, paddingTop: 80 }}>Connecting...</div></Shell>

  const tiers = [
    { p: 'P0', name: 'Critical',  key: 'tier1', max: '∞',     types: ['payment', 'order'], defKey: null, stratKey: null },
    { p: 'P1', name: 'Important', key: 'tier2', max: '5,000', types: ['inventory'],         defKey: 'deferred_tier2', stratKey: 'tier2' },
    { p: 'P2', name: 'Normal',    key: 'tier3', max: '2,000', types: ['click'],             defKey: 'deferred_tier3', stratKey: 'tier3' },
    { p: 'P3', name: 'Low',       key: 'tier4', max: '500',   types: ['log'],               defKey: null, stratKey: 'tier4' },
  ]

  const level = data.level ?? 0
  const qmStrategy = LEVEL_STRATEGIES[level] || LEVEL_STRATEGIES[0]

  return (
    <Shell>
      <PageTitle eyebrow="Pipeline health" title="Queue monitor" desc="P0 is protected by design. No critical event is ever shed." />
      <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {tiers.map((t, idx) => {
          const depth      = data.queues[t.key] || 0
          const pressure   = tierPressure(data.queues, t.key)
          const defDepth   = t.defKey ? (data.queues[t.defKey] || 0) : 0
          const shedCount  = t.types.reduce((sum, type) => sum + (data.counters?.shed?.[type] || 0), 0)
          const deferCount = t.types.reduce((sum, type) => sum + (data.counters?.deferred?.[type] || 0), 0)
          const lat        = data.latency_ms?.['tier' + (idx + 1)]

          return (
            <Card style={{ padding: 24 }} key={t.p}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 900, color: C.text }}>{t.p}</span>
                  <span style={{ marginLeft: 12, fontSize: 14, color: C.textSec }}>{t.name}</span>
                </div>
                {(() => {
                  const action = t.stratKey ? (qmStrategy[t.stratKey] || 'process') : (t.p === 'P0' && data.backpressure ? 'backpressure' : 'process')
                  const badgeMap = { process: ['green', 'Processing'], batch: ['blue', 'Batching'], defer: ['amber', 'Deferring'], shed: ['red', 'Shedding'], backpressure: ['red', 'Backpressure'] }
                  const [v, l] = badgeMap[action] || ['green', 'Processing']
                  return <Badge variant={v}>{l}</Badge>
                })()}
              </div>
              <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>Current depth</p>
                  <p style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 0' }}>{depth.toLocaleString()}</p>
                </div>
                <div>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>Pressure</p>
                  <p style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 0', color: pressure > 80 ? C.red : pressure > 50 ? C.orange : C.green }}>{pressure}%</p>
                </div>
                <div>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>Deferred</p>
                  <p style={{ fontWeight: 600, margin: '4px 0 0' }}>{deferCount.toLocaleString()}</p>
                </div>
                <div>
                  <p style={{ fontSize: 11, color: C.textMuted, margin: 0 }}>Shed</p>
                  <p style={{ fontWeight: 600, color: t.p === 'P0' ? C.green : 'inherit', margin: '4px 0 0' }}>{shedCount}</p>
                </div>
              </div>
              <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 14, fontSize: 12, color: C.textSec }}>
                Capacity {t.max} · {t.defKey ? `Deferred: ${defDepth}` : 'No deferred queue'} · Latency {lat != null ? `${lat.toFixed(1)}ms` : '—'}
              </div>
            </Card>
          )
        })}
      </div>
    </Shell>
  )
}

// ─── Event Stream ─────────────────────────────────────────────────────
function EventStream() {
  const data   = useWs()
  const events = data?.recent_events || []
  const pLabel = { 1: 'P0', 2: 'P1', 3: 'P2', 4: 'P3' }

  return (
    <Shell>
      <PageTitle eyebrow="Observability" title="Event stream" desc="Live events from the adaptive classifier." />
      <Card>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 700, textAlign: 'left', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Event ID', 'Type', 'Priority', 'Routed To', 'Decision', 'Time'].map(h => (
                  <th key={h} style={{ padding: '14px 20px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '14px 20px', fontFamily: 'monospace', fontSize: 11 }}>{e.id}</td>
                  <td style={{ padding: '14px 20px', fontWeight: 600 }}>{e.type}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <Badge variant={e.priority <= 1 ? 'red' : 'blue'}>{pLabel[e.priority] || `P${e.priority}`}</Badge>
                  </td>
                  <td style={{ padding: '14px 20px' }}>{e.queue}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <Badge variant={e.decision === 'shed' ? 'red' : e.decision === 'defer' ? 'amber' : e.decision === 'duplicate' ? 'orange' : 'green'}>{e.decision}</Badge>
                  </td>
                  <td style={{ padding: '14px 20px', fontFamily: 'monospace', fontSize: 11 }}>{e.time}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '40px 20px', textAlign: 'center', color: C.textMuted }}>Waiting for events...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Shell>
  )
}

// ─── Decision Explorer ────────────────────────────────────────────────
function Decisions() {
  const data      = useWs()
  const decisions = data?.recent_decisions || []
  const scheduling = data?.scheduling?.recent_decisions || []

  return (
    <Shell>
      <PageTitle eyebrow="Observability" title="Decision explorer" desc="Strategy changes, routing decisions, and OS scheduling traces." />
      <Card>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Escalation decisions</h2>
          <p style={{ fontSize: 12, color: C.textSec, margin: '4px 0 0' }}>Level changes from the feedback loop</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 800, textAlign: 'left', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Timestamp', 'Level Change', 'T1 Latency', 'T1 Queue', 'Lower Queue', 'Strategy', 'Reason'].map(h => (
                  <th key={h} style={{ padding: '14px 20px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {decisions.map((d, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '14px 20px', fontFamily: 'monospace', fontSize: 11 }}>{d.time}</td>
                  <td style={{ padding: '14px 20px', fontWeight: 700 }}>{d.from_level} → {d.to_level}</td>
                  <td style={{ padding: '14px 20px', fontFamily: 'monospace' }}>{d.t1_latency}</td>
                  <td style={{ padding: '14px 20px', fontFamily: 'monospace' }}>{d.t1_queue}</td>
                  <td style={{ padding: '14px 20px', fontFamily: 'monospace' }}>{d.lower_queue}</td>
                  <td style={{ padding: '14px 20px' }}>
                    <Badge variant={d.direction === 'escalate' ? 'red' : d.direction === 'steady' ? 'blue' : 'green'}>
                      {d.direction === 'escalate' ? 'ESCALATED' : d.direction === 'steady' ? 'STEADY' : 'DE-ESCALATED'}
                    </Badge>
                  </td>
                  <td style={{ padding: '14px 20px', color: C.textSec }}>{d.reason}</td>
                </tr>
              ))}
              {decisions.length === 0 && data?.naive_mode && (
                <tr><td colSpan={7} style={{ padding: '40px 20px', textAlign: 'center', color: C.textMuted }}>Decision engine is disabled in naive mode. Switch to adaptive mode to see decisions.</td></tr>
              )}
              {decisions.length === 0 && !data?.naive_mode && (
                <tr><td colSpan={7} style={{ padding: '40px 20px', textAlign: 'center', color: C.textMuted }}>Waiting for level changes... Heartbeat updates appear every ~30s.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* OS Scheduling summary + trace */}
      {data?.scheduling && (
        <Card style={{ marginTop: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
            <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>OS scheduling concepts</h2>
            <p style={{ fontSize: 12, color: C.textSec, margin: '4px 0 0' }}>
              Priority aging, exponential backoff, error classification — applied to adaptive routing
            </p>
          </div>

          <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, borderBottom: `1px solid ${C.border}` }}>
            <div>
              <p style={{ fontSize: 11, color: C.textMuted, margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Aging promotions</p>
              <p style={{ fontSize: 24, fontWeight: 800, margin: '6px 0 0', color: data.scheduling.starvation_preventions > 0 ? C.amber : C.textMuted }}>
                {data.scheduling.starvation_preventions}
              </p>
              <p style={{ fontSize: 11, color: C.textSec, margin: '4px 0 0' }}>Lower-tier events promoted over higher-tier via wait-time aging</p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: C.textMuted, margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Strict picks</p>
              <p style={{ fontSize: 24, fontWeight: 800, margin: '6px 0 0' }}>{data.scheduling.strict_priority_picks}</p>
              <p style={{ fontSize: 11, color: C.textSec, margin: '4px 0 0' }}>Normal priority-order dispatch (Tier 1 always strict)</p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: C.textMuted, margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Permanent failures</p>
              <p style={{ fontSize: 24, fontWeight: 800, margin: '6px 0 0', color: data.scheduling.permanent_failures > 0 ? C.red : C.textMuted }}>
                {data.scheduling.permanent_failures}
              </p>
              <p style={{ fontSize: 11, color: C.textSec, margin: '4px 0 0' }}>Unrecoverable — skipped retry, sent to DLQ</p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: C.textMuted, margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Retry backoff</p>
              <p style={{ fontSize: 24, fontWeight: 800, margin: '6px 0 0' }}>{data.fault_tolerance?.retries_total || 0}</p>
              <p style={{ fontSize: 11, color: C.textSec, margin: '4px 0 0' }}>Exponential: 500ms → 1s → 2s → DLQ</p>
            </div>
          </div>

          {/* Concept explainers */}
          <div style={{ padding: '16px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ padding: 14, background: '#F7F5F0', borderRadius: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 4px', color: C.amber }}>Priority Aging (Starvation Prevention)</p>
              <p style={{ fontSize: 12, color: C.textSec, margin: 0, lineHeight: 1.6 }}>
                Like an OS scheduler, waiting events gain effective priority over time: <code style={{ fontSize: 11, background: '#fff', padding: '1px 4px', borderRadius: 3 }}>score = base + min(wait × 10, 50)</code>.
                A Tier 4 event (base 10) waiting 6s reaches score 60, competing with Tier 2 (base 70).
                Tier 1 is exempt — critical events always go first.
              </p>
            </div>
            <div style={{ padding: 14, background: '#F7F5F0', borderRadius: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 4px', color: '#6366F1' }}>Error Classification + Exponential Backoff</p>
              <p style={{ fontSize: 12, color: C.textSec, margin: 0, lineHeight: 1.6 }}>
                Like OS I/O error handling: <strong>transient</strong> errors retry with exponential backoff (500ms → 1s → 2s → 5s cap).
                <strong> Permanent</strong> errors skip retry and go straight to DLQ.
                After 3 failed retries → DLQ. On success → PostgreSQL.
              </p>
            </div>
          </div>

          {/* Only show trace when there are non-trivial entries */}
          {scheduling.length > 0 && (
            <>
              <div style={{ padding: '12px 20px', borderBottom: `1px solid ${C.border}`, background: '#FAFAF8' }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, margin: 0, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Recent non-trivial dispatches (Tier 1 strict picks filtered out)
                </p>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 800, textAlign: 'left', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {['Time', 'Worker', 'Event Type', 'Tier', 'Reason', 'Wait', 'Eff. Priority'].map(h => (
                        <th key={h} style={{ padding: '12px 20px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scheduling.map((s, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: s.reason === 'starvation_prevention' ? '#FEF3C7' : 'transparent' }}>
                        <td style={{ padding: '10px 20px', fontFamily: 'monospace', fontSize: 11 }}>{s.time}</td>
                        <td style={{ padding: '10px 20px', fontFamily: 'monospace' }}>W{s.worker}</td>
                        <td style={{ padding: '10px 20px', fontWeight: 600, textTransform: 'capitalize' }}>{s.event_type}</td>
                        <td style={{ padding: '10px 20px' }}>
                          <Badge variant={s.tier === 1 ? 'red' : s.tier === 2 ? 'amber' : 'blue'}>P{s.tier - 1}</Badge>
                        </td>
                        <td style={{ padding: '10px 20px' }}>
                          <Badge variant={s.reason === 'starvation_prevention' ? 'amber' : s.reason === 'deferred_drain' ? 'blue' : 'green'}>
                            {s.reason === 'starvation_prevention' ? 'AGING' : s.reason === 'deferred_drain' ? 'DRAIN' : 'STRICT'}
                          </Badge>
                        </td>
                        <td style={{ padding: '10px 20px', fontFamily: 'monospace' }}>{s.wait_ms}ms</td>
                        <td style={{ padding: '10px 20px', fontFamily: 'monospace', color: s.effective_priority ? C.text : C.textMuted }}>
                          {s.effective_priority ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {scheduling.length === 0 && (
            <div style={{ padding: '24px 20px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
              No aging or deferred-drain events yet — aging activates at Normal/Elevated levels when multiple tiers compete for workers.
              {data.level >= 2 && <span style={{ display: 'block', marginTop: 6, color: C.amber }}>Currently at {LEVEL_NAMES[data.level]} — lower tiers are deferred/shed, so aging has nothing to compare.</span>}
            </div>
          )}
        </Card>
      )}
    </Shell>
  )
}

// ─── Simulation ───────────────────────────────────────────────────────
function Simulation() {
  const data          = useWs()
  const [localRate, setLocalRate] = useState(null)
  const [mode,     setMode]       = useState(null)
  const lastApplied   = useRef(0)

  const wsRate = data ? Math.round(data.rate_multiplier * BASE_RATE) : 3400
  const rate   = (localRate !== null && Date.now() - lastApplied.current < 3000) ? localRate : wsRate

  const [flooding, setFlooding] = useState(false)
  const [floodResult, setFloodResult] = useState(null)
  const [dedupTesting, setDedupTesting] = useState(false)
  const [dedupResult, setDedupResult] = useState(null)
  const [killing, setKilling] = useState(false)
  const [killResult, setKillResult] = useState(null)
  const [spiking, setSpiking] = useState({})
  const [spikeDur, setSpikeDur] = useState(5)
  const [spikeResults, setSpikeResults] = useState({})

  const EVENT_SPIKE_CONFIG = [
    { type: 'payment',   label: 'Payment',   tier: 'P1 — Critical',  color: '#16A34A', bg: '#DCFCE7', defaultCount: 1000 },
    { type: 'order',     label: 'Order',     tier: 'P1 — Critical',  color: '#0284C7', bg: '#E0F2FE', defaultCount: 1000 },
    { type: 'inventory', label: 'Inventory', tier: 'P2 — Important', color: '#7C3AED', bg: '#EDE9FE', defaultCount: 2000 },
    { type: 'click',     label: 'Click',     tier: 'P3 — Normal',    color: '#EA580C', bg: '#FFF7ED', defaultCount: 4000 },
    { type: 'log',       label: 'Log',       tier: 'P4 — Noise',     color: '#DC2626', bg: '#FEE2E2', defaultCount: 8000 },
  ]

  const [spikeCounts, setSpikeCounts] = useState(() =>
    Object.fromEntries(EVENT_SPIKE_CONFIG.map(c => [c.type, c.defaultCount]))
  )

  const setSpikeCount = (type, val) =>
    setSpikeCounts(prev => ({ ...prev, [type]: Math.max(0, Math.min(50000, val)) }))

  const triggerSpike = useCallback(async (eventType, count) => {
    setSpiking(prev => ({ ...prev, [eventType]: true }))
    setSpikeResults(prev => ({ ...prev, [eventType]: null }))
    try {
      const res = await fetch('/api/event-spike', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: eventType, count, duration_sec: spikeDur }),
      })
      const json = await res.json()
      setSpikeResults(prev => ({ ...prev, [eventType]: json }))
    } catch (e) {
      setSpikeResults(prev => ({ ...prev, [eventType]: { error: e.message } }))
    }
    setTimeout(() => setSpiking(prev => ({ ...prev, [eventType]: false })), spikeDur * 1000)
  }, [spikeDur])

  const fireAll = useCallback(async () => {
    for (const cfg of EVENT_SPIKE_CONFIG) {
      if ((spikeCounts[cfg.type] || 0) > 0) {
        triggerSpike(cfg.type, spikeCounts[cfg.type])
        await new Promise(r => setTimeout(r, 80))
      }
    }
  }, [spikeCounts, triggerSpike])

  useEffect(() => {
    if (mode === null && data) {
      if (wsRate <= 5000)       setMode('Normal')
      else if (wsRate <= 50000) setMode('Spike')
      else                      setMode('Stress')
    }
  }, [data, mode, wsRate])

  const applyRate = useCallback((r) => {
    setLocalRate(r)
    lastApplied.current = Date.now()
    fetch('/api/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events_per_min: r }),
    })
  }, [])

  const triggerFlood = useCallback(async () => {
    setFlooding(true)
    setFloodResult(null)
    try {
      const res = await fetch('/api/flood', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      setFloodResult(await res.json())
    } catch (e) { setFloodResult({ error: e.message }) }
    setTimeout(() => setFlooding(false), 2000)
  }, [])

  const currentLevel = data?.level ?? 0
  const extreme      = rate > 150000
  const high         = rate > 50000

  const decisions = [
    ['P0', 'Stream', 'Critical operations always flow — never shed'],
    ['P1', extreme ? 'Defer' : 'Stream',                    'Inventory events — deferred under extreme load'],
    ['P2', extreme ? 'Defer' : high ? 'Batch' : 'Stream',   'Click events — batched or deferred'],
    ['P3', extreme ? 'Shed'  : high ? 'Shed'  : 'Batch',    'Log events — shed under pressure'],
  ]

  const evtSec         = data ? sumObj(data.throughput_per_sec) : 0
  const critLost       = data?.counters?.shed?.payment || 0
  const totalProcessed = data ? sumObj(data.counters?.processed) : 0

  const totalQueued = EVENT_SPIKE_CONFIG.reduce((s, c) => s + (spikeCounts[c.type] || 0), 0)
  const anyFiring   = EVENT_SPIKE_CONFIG.some(c => spiking[c.type])

  return (
    <Shell>
      <PageTitle eyebrow="Traffic lab" title="Pipeline simulator" desc="Adjust traffic rate and observe adaptive routing decisions in real time." />
      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: '360px 1fr' }}>
        {/* Controls */}
        <Card style={{ padding: 24 }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Scenario</h2>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {['Normal', 'Spike', 'Stress', 'Recovery'].map(x => (
              <button key={x} onClick={() => {
                setMode(x)
                applyRate({ Normal: 3400, Spike: 20000, Stress: 200000, Recovery: 3400 }[x])
              }} style={{
                padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
                border: mode === x ? `2px solid ${C.accent}` : `1.5px solid ${C.border}`,
                background: mode === x ? C.accentLight : '#fff',
                color: mode === x ? C.accent : C.textSec,
              }}>{x}</button>
            ))}
          </div>

          <label style={{ display: 'block', marginTop: 28, fontSize: 13, fontWeight: 600 }}>
            Traffic rate
            <span style={{ float: 'right', fontFamily: 'monospace', color: C.accent }}>{rate.toLocaleString()} / min</span>
          </label>
          {(() => {
            const maxRate = mode === 'Stress' ? 350000 : (mode === 'Spike' ? 50000 : 10000);
            return (
              <>
                <input style={{ marginTop: 20, width: '100%', accentColor: '#1F2937' }} type="range"
                  min="1000" max={maxRate} step="1000" value={Math.min(rate, maxRate)} onChange={e => applyRate(+e.target.value)} />
                <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.textMuted }}>
                  <span>1k</span><span>{maxRate / 1000}k</span>
                </div>
              </>
            )
          })()}

          <p style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.green }}>
            <span className="pulse-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, display: 'inline-block' }} />
            Pipeline always running
          </p>

          <div style={{ marginTop: 20, borderRadius: 8, background: '#F7F5F0', padding: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: C.textSec, margin: 0 }}>Current escalation level</p>
            <p style={{ fontSize: 18, fontWeight: 900, color: LEVEL_COLORS[currentLevel], margin: '4px 0 0' }}>{LEVEL_NAMES[currentLevel]}</p>
          </div>

          <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <button onClick={triggerFlood} disabled={flooding} style={{
              width: '100%', padding: '12px 16px', borderRadius: 8, fontSize: 14, fontWeight: 800,
              cursor: flooding ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              border: `2px solid ${C.red}`, background: flooding ? '#FEE2E2' : '#fff',
              color: C.red, opacity: flooding ? 0.7 : 1, transition: 'all 0.15s',
            }}>
              <Zap size={16} style={{ verticalAlign: 'middle', marginRight: 8 }} />
              {flooding ? 'Flooding...' : 'Flash Flood'}
            </button>
            <p style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>
              Injects ~14k events directly into queues. Triggers EMERGENCY.
            </p>
            {floodResult && !floodResult.error && (
              <div style={{ marginTop: 8, fontSize: 11, color: C.textSec, background: '#F7F5F0', padding: 10, borderRadius: 6 }}>
                Injected: T2={floodResult.injected.tier2} T3={floodResult.injected.tier3} T4={floodResult.injected.tier4} Input={floodResult.injected.input}
              </div>
            )}
          </div>

          <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <button onClick={async () => {
              setDedupTesting(true); setDedupResult(null)
              try {
                const results = []
                for (const t of ['payment', 'order', 'inventory', 'click', 'log']) {
                  const res = await fetch('/api/inject-duplicate', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ event_type: t, count: 2 }),
                  })
                  results.push(await res.json())
                }
                setDedupResult({ ok: true, count: results.length })
              } catch (e) { setDedupResult({ error: e.message }) }
              setTimeout(() => setDedupTesting(false), 1500)
            }} disabled={dedupTesting} style={{
              width: '100%', padding: '12px 16px', borderRadius: 8, fontSize: 14, fontWeight: 800,
              cursor: dedupTesting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              border: `2px solid ${C.amber}`, background: dedupTesting ? '#FEF3C7' : '#fff',
              color: '#92400E', opacity: dedupTesting ? 0.7 : 1, transition: 'all 0.15s',
            }}>
              <Shield size={16} style={{ verticalAlign: 'middle', marginRight: 8 }} />
              {dedupTesting ? 'Injecting...' : 'Test Duplicate Detection'}
            </button>
            <p style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>
              Injects identical event pairs for each type. Check "Duplicates caught" counter.
            </p>
            {dedupResult && !dedupResult.error && (
              <div style={{ marginTop: 8, fontSize: 11, color: C.textSec, background: '#F7F5F0', padding: 10, borderRadius: 6 }}>
                Injected duplicate pairs for {dedupResult.count} event types. Check Overview stats.
              </div>
            )}
          </div>

          <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <button onClick={async () => {
              setKilling(true); setKillResult(null)
              try {
                const res = await fetch('/api/kill-worker', { method: 'POST' })
                setKillResult(await res.json())
              } catch (e) { setKillResult({ error: e.message }) }
              setTimeout(() => setKilling(false), 5000)
            }} disabled={killing} style={{
              width: '100%', padding: '12px 16px', borderRadius: 8, fontSize: 14, fontWeight: 800,
              cursor: killing ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              border: `2px solid #7C3AED`, background: killing ? '#EDE9FE' : '#fff',
              color: '#5B21B6', opacity: killing ? 0.7 : 1, transition: 'all 0.15s',
            }}>
              <Zap size={16} style={{ verticalAlign: 'middle', marginRight: 8 }} />
              {killing ? 'Worker killed (revives in 5s)...' : 'Kill Random Worker (5s)'}
            </button>
            <p style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>
              Disables a random worker for 5 seconds. Events it was processing get retried by others.
            </p>
            {killResult && !killResult.error && (
              <div style={{ marginTop: 8, fontSize: 11, color: C.textSec, background: '#F7F5F0', padding: 10, borderRadius: 6 }}>
                Worker #{killResult.worker_id} killed. Revives in {killResult.revive_in_sec}s. Watch Active Workers on Overview.
              </div>
            )}
          </div>
        </Card>

        {/* Decision preview */}
        <Card style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Decision preview</h2>
              <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>{mode || 'Custom'} · {rate.toLocaleString()} events/min</p>
            </div>
            <Badge variant={data?.backpressure ? 'red' : extreme ? 'amber' : 'green'}>
              {data?.backpressure ? 'Backpressure' : extreme ? 'High load' : 'Contained'}
            </Badge>
          </div>

          <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {decisions.map(([p, d, r]) => (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 14, borderRadius: 8, border: `1px solid ${C.border}`, padding: 14 }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 14 }}>{p}</span>
                <ChevronRight size={14} color={C.textMuted} />
                <ActionBadge action={d.toLowerCase()} />
                <span style={{ fontSize: 13, color: C.textSec }}>{r}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <Stat label="Throughput"       value={`${evtSec}/s`}             sub="events processed" />
            <Stat label="P0 lost"          value={critLost}                   sub="Invariant" critical />
            <Stat label="Total processed"  value={totalProcessed.toLocaleString()} sub="all time" />
          </div>
        </Card>
      </div>

      {/* Admin Event Spike Panel */}
      <Card style={{ marginTop: 24 }}>
        <div style={{
          padding: '20px 24px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Admin Event Spike</h2>
            <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>
              Set exact request counts per event type, then fire individually or all at once
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Duration (s)</label>
              <input
                type="number" value={spikeDur} min={1} max={60} step={1}
                onChange={e => setSpikeDur(Math.max(1, +e.target.value))}
                style={{ width: 64, padding: '6px 8px', borderRadius: 6, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: 'monospace', textAlign: 'center', background: '#fff' }}
              />
            </div>
            <button
              onClick={fireAll}
              disabled={anyFiring || totalQueued === 0}
              style={{
                padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 800,
                cursor: (anyFiring || totalQueued === 0) ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', border: 'none',
                background: anyFiring ? '#FEE2E2' : C.accent,
                color: anyFiring ? C.red : '#fff',
                opacity: totalQueued === 0 ? 0.4 : 1,
                display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.15s',
              }}
            >
              <Zap size={14} />
              {anyFiring ? 'Firing...' : `Fire All (${totalQueued.toLocaleString()} events)`}
            </button>
          </div>
        </div>

        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '200px 1fr 120px 160px 140px',
          padding: '8px 24px', borderBottom: `1px solid ${C.border}`,
          background: '#F7F5F0',
        }}>
          {['Event Type', 'Requests to Inject', 'Status', 'Last Result', 'Action'].map(h => (
            <span key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted }}>{h}</span>
          ))}
        </div>

        {/* Per-type rows */}
        {EVENT_SPIKE_CONFIG.map(({ type, label, tier, color, bg }) => {
          const active   = spiking[type] || (data?.active_spikes?.[type] != null)
          const result   = spikeResults[type]
          const count    = spikeCounts[type] ?? 0
          const wsInfo   = data?.active_spikes?.[type]
          const secsLeft = wsInfo ? Math.max(0, Math.round(wsInfo.end_time - Date.now() / 1000)) : 0

          return (
            <div key={type} style={{
              display: 'grid', gridTemplateColumns: '200px 1fr 120px 160px 140px',
              alignItems: 'center', gap: 16, padding: '14px 24px',
              borderBottom: `1px solid ${C.border}`,
              background: active ? bg + '66' : 'transparent', transition: 'background 0.3s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{label}</p>
                  <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>{tier}</p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number" value={count} min={0} max={50000} step={100}
                  onChange={e => setSpikeCount(type, +e.target.value)}
                  disabled={!!spiking[type]}
                  placeholder="0"
                  style={{
                    width: '100%', maxWidth: 160, padding: '8px 12px', borderRadius: 7,
                    border: `2px solid ${active ? color : C.border}`,
                    fontSize: 15, fontFamily: 'monospace', fontWeight: 700,
                    textAlign: 'right', background: '#fff', color: C.text, outline: 'none',
                    boxShadow: active ? `0 0 0 3px ${color}22` : 'none', transition: 'all 0.2s',
                  }}
                />
                <span style={{ fontSize: 12, color: C.textMuted, whiteSpace: 'nowrap' }}>requests</span>
              </div>

              <div>
                {active ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 99, background: bg, color,
                    fontSize: 11, fontWeight: 700, border: `1px solid ${color}55`,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', animation: 'dot-blink 0.8s infinite alternate' }} />
                    {secsLeft}s left
                  </span>
                ) : <span style={{ fontSize: 12, color: C.textMuted }}>Idle</span>}
              </div>

              <div style={{ fontSize: 11, color: C.textSec }}>
                {result && !result.error ? (
                  <span>
                    <span style={{ color: C.green, fontWeight: 700 }}>{result.injected?.toLocaleString()}</span> injected
                    {result.dropped > 0 && <span style={{ color: C.red }}>, {result.dropped} dropped</span>}
                  </span>
                ) : result?.error ? (
                  <span style={{ color: C.red }}>Error</span>
                ) : <span style={{ color: C.textMuted }}>—</span>}
              </div>

              <button
                onClick={() => triggerSpike(type, count)}
                disabled={!!spiking[type] || count === 0}
                style={{
                  padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  cursor: (spiking[type] || count === 0) ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  border: `2px solid ${active ? color : color + '55'}`,
                  background: active ? bg : '#fff', color,
                  opacity: count === 0 ? 0.3 : spiking[type] ? 0.7 : 1,
                  transition: 'all 0.2s',
                  boxShadow: active ? `0 0 12px ${color}44` : 'none',
                  display: 'flex', alignItems: 'center', gap: 6,
                  animation: active ? 'pulse-btn 1s ease-in-out infinite alternate' : 'none',
                }}
              >
                <Zap size={13} />
                {spiking[type] ? 'Firing...' : 'Spike'}
              </button>
            </div>
          )
        })}

        <div style={{
          padding: '12px 24px', background: '#F7F5F0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        }}>
          <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>
            Total: <strong style={{ color: C.text }}>{totalQueued.toLocaleString()}</strong> requests queued across {EVENT_SPIKE_CONFIG.filter(c => spikeCounts[c.type] > 0).length} event types
          </p>
          <button
            onClick={() => setSpikeCounts(Object.fromEntries(EVENT_SPIKE_CONFIG.map(c => [c.type, 0])))}
            style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${C.border}`,
              background: '#fff', color: C.textSec,
            }}
          >Clear all</button>
        </div>
      </Card>
    </Shell>
  )
}

// ─── Traffic ──────────────────────────────────────────────────────────
function Traffic() {
  const data = useWs()
  const [classifiedHistory, setClassifiedHistory] = useState([])
  const tickRef = useRef(0)

  useEffect(() => {
    if (!data) return
    tickRef.current += 1
    const ct = data.classified_type_per_sec || {}
    setClassifiedHistory(prev => {
      const point = {
        t:       tickRef.current,
        payment: ct.payment || 0,
        order:   ct.order || 0,
        inventory: ct.inventory || 0,
        click:   ct.click || 0,
        log:     ct.log || 0,
      }
      const next = [...prev, point]
      return next.length > 30 ? next.slice(-30) : next
    })
  }, [data])

  if (!data) return <Shell><div style={{ textAlign: 'center', color: C.textMuted, paddingTop: 80 }}>Connecting...</div></Shell>

  const ct             = data.classified_type_per_sec || {}
  const classified     = data.classified_per_sec || {}
  const totalClassified = sumObj(classified)
  const incomingRate   = totalClassified > 0 ? Math.round(totalClassified * 60) : Math.round(data.rate_multiplier * BASE_RATE)
  const processedRate  = sumObj(data.throughput_per_sec)

  const typeRates = [
    { type: 'payment',   label: 'Payment',   rate: ct.payment || 0 },
    { type: 'order',     label: 'Order',     rate: ct.order || 0 },
    { type: 'inventory', label: 'Inventory', rate: ct.inventory || 0 },
    { type: 'click',     label: 'Click',     rate: ct.click || 0 },
    { type: 'log',       label: 'Log',       rate: ct.log || 0 },
  ]

  const donutData = [
    { name: 'Payment',   value: ct.payment || 0,   color: TYPE_COLORS.payment },
    { name: 'Order',     value: ct.order || 0,     color: TYPE_COLORS.order },
    { name: 'Inventory', value: ct.inventory || 0, color: TYPE_COLORS.inventory },
    { name: 'Click',     value: ct.click || 0,     color: TYPE_COLORS.click },
    { name: 'Log',       value: ct.log || 0,       color: TYPE_COLORS.log },
  ].filter(d => d.value > 0)

  return (
    <Shell>
      <PageTitle eyebrow="Observability" title="Traffic analysis"
        desc={`Incoming: ${incomingRate.toLocaleString()}/min · Classified: ${totalClassified}/s`} />

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {typeRates.map(t => (
          <Card style={{ padding: 16 }} key={t.type}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: TYPE_COLORS[t.type], display: 'inline-block' }} />
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted }}>{t.label}</span>
            </div>
            <p style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: '12px 0 0' }}>
              {t.rate}<span style={{ fontSize: 13, color: C.textMuted }}>/s</span>
            </p>
          </Card>
        ))}
      </div>

      <div style={{ marginTop: 24, display: 'grid', gap: 24, gridTemplateColumns: '1.6fr 1fr' }}>
        <Card style={{ padding: 24 }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Incoming traffic by type</h2>
          <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>Stacked area · classified events/sec · last 30 seconds</p>
          <div style={{ marginTop: 16, height: 256 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={classifiedHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
                <XAxis dataKey="t" hide />
                <YAxis width={40} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Area type="monotone" dataKey="payment" stackId="1" stroke={TYPE_COLORS.payment} fill={TYPE_COLORS.payment} fillOpacity={0.7} name="Payment" />
                <Area type="monotone" dataKey="order" stackId="1" stroke={TYPE_COLORS.order} fill={TYPE_COLORS.order} fillOpacity={0.7} name="Order" />
                <Area type="monotone" dataKey="inventory" stackId="1" stroke={TYPE_COLORS.inventory} fill={TYPE_COLORS.inventory} fillOpacity={0.7} name="Inventory" />
                <Area type="monotone" dataKey="click" stackId="1" stroke={TYPE_COLORS.click} fill={TYPE_COLORS.click} fillOpacity={0.7} name="Click" />
                <Area type="monotone" dataKey="log" stackId="1" stroke={TYPE_COLORS.log} fill={TYPE_COLORS.log} fillOpacity={0.7} name="Log" />
                <Legend />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card style={{ padding: 24 }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Classification split</h2>
          <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>Real-time per-type distribution</p>
          <div style={{ marginTop: 8, height: 224 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div style={{ marginTop: 8, borderRadius: 8, background: '#F7F5F0', padding: 14 }}>
            {[
              { label: 'Incoming',  value: `${incomingRate.toLocaleString()}/min` },
              { label: 'Processed', value: `${processedRate}/s` },
              { label: 'Gap',       value: `${Math.max(0, Math.round(incomingRate / 60) - processedRate)}/s`, color: C.orange },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: C.textSec }}>{row.label}</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600, color: row.color || C.text }}>{row.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  )
}

// ─── Pipeline ─────────────────────────────────────────────────────────
const LEVEL_STRATEGIES = {
  0: { tier2: 'process', tier3: 'process', tier4: 'process', drain: true },
  1: { tier2: 'process', tier3: 'batch',   tier4: 'batch',   drain: true },
  2: { tier2: 'batch',   tier3: 'defer',   tier4: 'shed',    drain: false },
  3: { tier2: 'defer',   tier3: 'defer',   tier4: 'shed',    drain: false },
}

function Pipeline() {
  const data = useWs()
  if (!data) return <Shell><div style={{ textAlign: 'center', color: C.textMuted, paddingTop: 80 }}>Connecting...</div></Shell>

  const level      = data.level ?? 0
  const strategy   = LEVEL_STRATEGIES[level]
  const q          = data.queues || {}
  const levelColor = LEVEL_COLORS[level]

  const flowNodes = [
    { label: 'Generator',    depth: null,       sub: `${(sumObj(data.classified_per_sec) > 0 ? Math.round(sumObj(data.classified_per_sec) * 60) : Math.round(data.rate_multiplier * BASE_RATE)).toLocaleString()}/min` },
    { label: 'Input Queue',  depth: q.input||0, sub: 'max 10,000' },
    { label: 'Classifier',   depth: null,       sub: 'Priority tagging' },
  ]

  const tierNodes = [
    { label: 'Tier 1', depth: q.tier1||0, max: '∞',   action: 'process',       color: TIER_COLORS[0], deferred: null },
    { label: 'Tier 2', depth: q.tier2||0, max: '5k',  action: strategy.tier2,  color: TIER_COLORS[1], deferred: q.deferred_tier2||0 },
    { label: 'Tier 3', depth: q.tier3||0, max: '2k',  action: strategy.tier3,  color: TIER_COLORS[2], deferred: q.deferred_tier3||0 },
    { label: 'Tier 4', depth: q.tier4||0, max: '500', action: strategy.tier4,  color: TIER_COLORS[3], deferred: null },
  ]

  const strategyRows = [
    { tier: 'Tier 1 (P0)', types: 'payment, order', action: 'Always process', defer: '—', shed: 'Never' },
    { tier: 'Tier 2 (P1)', types: 'inventory', action: strategy.tier2, defer: strategy.tier2==='defer'?'Active':'Standby', shed: 'Only if deferred full' },
    { tier: 'Tier 3 (P2)', types: 'click',     action: strategy.tier3, defer: strategy.tier3==='defer'?'Active':'Standby', shed: strategy.tier3==='shed'?'Active':'Only if deferred full' },
    { tier: 'Tier 4 (P3)', types: 'log',       action: strategy.tier4, defer: '—', shed: strategy.tier4==='shed'?'Active (sample 5-10%)':'On overflow' },
  ]

  return (
    <Shell>
      <PageTitle eyebrow="Architecture" title="Pipeline flow" desc="Real-time view of the adaptive pipeline architecture and current strategy." />

      {level >= 1 && (
        <div style={{
          marginBottom: 16, padding: '14px 20px', borderRadius: 12,
          background: `linear-gradient(135deg, ${levelColor}12 0%, ${levelColor}06 100%)`,
          border: `1.5px solid ${levelColor}33`,
          display: 'flex', alignItems: 'center', gap: 12,
          animation: level >= 3 ? 'pulse-btn 1.5s ease-in-out infinite' : undefined,
        }}>
          <Shield size={18} color={levelColor} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: levelColor }}>
              {level === 1 && 'Batching tier 3 & 4 to free capacity for critical events'}
              {level === 2 && 'Deferring tier 3, shedding tier 4 — protecting payments & orders'}
              {level === 3 && 'EMERGENCY: Deferring tier 2 & 3, shedding tier 4 — all capacity on P0'}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: C.textSec }}>
              P0 latency: {data.latency_ms?.tier1 != null ? `${data.latency_ms.tier1.toFixed(0)}ms` : '—'}
              {' · Shed: '}{sumObj(data.counters?.shed).toLocaleString()}
              {' · Deferred: '}{sumObj(data.counters?.deferred).toLocaleString()}
            </p>
          </div>
          <Badge variant={level >= 3 ? 'red' : level >= 2 ? 'red' : 'amber'}>{LEVEL_NAMES[level]}</Badge>
        </div>
      )}

      <Card style={{ padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Data flow</h2>
          <div style={{ borderRadius: 20, padding: '5px 14px', fontSize: 13, fontWeight: 700, background: levelColor + '18', color: levelColor }}>
            Level {level} · {LEVEL_NAMES[level]}
          </div>
        </div>

        <div style={{
          position: 'relative',
          padding: '32px',
          background: 'linear-gradient(145deg, #0A0A0A 0%, #171717 100%)',
          borderRadius: 16,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 12px 32px rgba(0,0,0,0.15)',
          overflowX: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
        }}>
          {/* Animated Flow Line Definition */}
          <svg style={{ position: 'absolute', width: 0, height: 0 }}>
            <defs>
              <linearGradient id="flow-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.1)" />
                <stop offset="50%" stopColor={C.accent} />
                <stop offset="100%" stopColor="rgba(255,255,255,0.1)" />
              </linearGradient>
            </defs>
          </svg>

          {flowNodes.map((n, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 24, flexShrink: 0 }}>
              <div style={{
                borderRadius: 12,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '16px 20px',
                textAlign: 'center',
                minWidth: 140,
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                position: 'relative',
                backdropFilter: 'blur(8px)',
              }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: 0, letterSpacing: '0.02em' }}>{n.label}</p>
                {n.depth != null && <p style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 900, color: C.accent, margin: '6px 0 0', textShadow: `0 0 12px ${C.accent}66` }}>{n.depth.toLocaleString()}</p>}
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: '4px 0 0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{n.sub}</p>
              </div>
              {i < flowNodes.length - 1 && (
                <div style={{ position: 'relative', width: 40, height: 2 }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.1)' }} />
                  <div className="flow-line-anim" style={{ position: 'absolute', inset: 0, background: 'url("data:image/svg+xml,%3Csvg width=\'100%25\' height=\'2\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cline x1=\'0\' y1=\'1\' x2=\'100%25\' y2=\'1\' stroke=\'%23E8440A\' stroke-width=\'2\' stroke-dasharray=\'6 6\' /%3E%3C/svg%3E")' }} />
                </div>
              )}
            </div>
          ))}

          <div style={{ position: 'relative', width: 40, height: 2 }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.1)' }} />
            <div className="flow-line-anim" style={{ position: 'absolute', inset: 0, background: 'url("data:image/svg+xml,%3Csvg width=\'100%25\' height=\'2\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cline x1=\'0\' y1=\'1\' x2=\'100%25\' y2=\'1\' stroke=\'%23E8440A\' stroke-width=\'2\' stroke-dasharray=\'6 6\' /%3E%3C/svg%3E")' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
            {tierNodes.map((t, i) => {
              const isDeferring = t.action === 'defer'
              const defMax = i === 1 ? '3k' : i === 2 ? '2k' : null
              const hasDef = t.deferred != null
              const defActive = hasDef && isDeferring
              const draining = hasDef && strategy.drain && t.deferred > 0

              return (
                <div key={i}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                    <div style={{
                      borderRadius: 12,
                      background: t.action === 'shed' ? 'rgba(220,38,38,0.06)' : t.action === 'defer' ? 'rgba(232,68,10,0.06)' : 'rgba(255,255,255,0.03)',
                      border: `1.5px solid ${t.action === 'shed' ? C.red : t.action === 'defer' ? C.accent : t.action === 'batch' ? C.amber : t.color}66`,
                      padding: '12px 16px',
                      minWidth: 180,
                      boxShadow: t.action === 'shed' ? `0 0 20px ${C.red}33` : t.action === 'defer' ? `0 0 20px ${C.accent}33` : `0 4px 16px ${t.color}11`,
                      position: 'relative',
                      overflow: 'hidden',
                      transition: 'all 0.3s ease',
                    }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: t.action === 'shed' ? C.red : t.action === 'defer' ? C.accent : t.color }} />
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: t.color, textShadow: `0 0 8px ${t.color}44` }}>{t.label}</span>
                        <span style={{
                          padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
                          background: t.action === 'process' ? 'rgba(22, 163, 74, 0.15)' : t.action === 'batch' ? 'rgba(245, 180, 0, 0.15)' : t.action === 'defer' ? 'rgba(232, 68, 10, 0.15)' : 'rgba(220, 38, 38, 0.15)',
                          color: t.action === 'process' ? C.green : t.action === 'batch' ? C.amber : t.action === 'defer' ? C.accent : C.red,
                          border: `1px solid ${t.action === 'process' ? C.green : t.action === 'batch' ? C.amber : t.action === 'defer' ? C.accent : C.red}44`
                        }}>{t.action}</span>
                      </div>
                      <p style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: '6px 0 0' }}>
                        {t.depth.toLocaleString()} <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>/ {t.max}</span>
                      </p>
                    </div>
                    <div style={{ position: 'relative', width: 30, height: 2 }}>
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.1)' }} />
                      <div className="flow-line-anim" style={{ position: 'absolute', inset: 0, background: 'url("data:image/svg+xml,%3Csvg width=\'100%25\' height=\'2\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cline x1=\'0\' y1=\'1\' x2=\'100%25\' y2=\'1\' stroke=\'%23E8440A\' stroke-width=\'2\' stroke-dasharray=\'6 6\' /%3E%3C/svg%3E")' }} />
                    </div>
                  </div>

                  {hasDef && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 4 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 180 }}>
                        {/* Vertical overflow arrow */}
                        <div style={{
                          width: 2, height: 16,
                          background: defActive ? C.amber : 'rgba(255,255,255,0.12)',
                          transition: 'background 0.3s',
                        }} />
                        <span style={{
                          fontSize: 10, color: defActive ? C.amber : 'rgba(255,255,255,0.2)',
                          transition: 'color 0.3s', marginBottom: 2,
                        }}>▼ overflow</span>
                        {/* Deferred queue box */}
                        <div style={{
                          borderRadius: 10,
                          background: defActive ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.02)',
                          border: `1.5px dashed ${defActive ? C.amber : 'rgba(255,255,255,0.12)'}`,
                          padding: '8px 14px',
                          width: '100%',
                          boxShadow: defActive ? `0 0 16px ${C.amber}33` : 'none',
                          transition: 'all 0.3s ease',
                          animation: defActive ? 'pulse-btn 2s ease-in-out infinite' : undefined,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: defActive ? C.amber : 'rgba(255,255,255,0.35)', letterSpacing: '0.03em' }}>Deferred</span>
                            {draining && <span style={{
                              padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 800,
                              background: 'rgba(22,163,74,0.15)', color: C.green, border: `1px solid ${C.green}44`,
                              textTransform: 'uppercase',
                            }}>draining</span>}
                          </div>
                          <p style={{
                            fontFamily: 'monospace', fontSize: 13, fontWeight: 700, margin: '4px 0 0',
                            color: defActive ? C.amber : t.deferred > 0 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)',
                          }}>
                            {t.deferred.toLocaleString()} <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>/ {defMax}</span>
                          </p>
                        </div>
                      </div>
                      {/* Horizontal connector from deferred to workers path */}
                      <div style={{ position: 'relative', width: 30, height: 2, alignSelf: 'center', marginTop: 20 }}>
                        <div style={{ position: 'absolute', inset: 0, background: draining ? 'rgba(22,163,74,0.3)' : 'rgba(255,255,255,0.06)' }} />
                        {draining && <div className="flow-line-anim" style={{ position: 'absolute', inset: 0, background: 'url("data:image/svg+xml,%3Csvg width=\'100%25\' height=\'2\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cline x1=\'0\' y1=\'1\' x2=\'100%25\' y2=\'1\' stroke=\'%2316A34A\' stroke-width=\'2\' stroke-dasharray=\'6 6\' /%3E%3C/svg%3E")' }} />}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{
              borderRadius: 16,
              background: `linear-gradient(135deg, ${C.accent}22 0%, ${C.accent}05 100%)`,
              border: `1px solid ${C.accent}66`,
              padding: '24px 20px',
              textAlign: 'center',
              minWidth: 120,
              boxShadow: `0 0 32px ${C.accent}22`,
              backdropFilter: 'blur(8px)',
            }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: C.accent, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Workers</p>
              <p style={{ fontFamily: 'monospace', fontSize: 36, fontWeight: 900, color: data.fault_tolerance?.active_workers < data.fault_tolerance?.total_workers ? '#F59E0B' : 'rgba(255,255,255,0.95)', margin: '8px 0 0', textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
                {data.fault_tolerance ? `${data.fault_tolerance.active_workers}/${data.fault_tolerance.total_workers}` : '8'}
              </p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', margin: '4px 0 0', textTransform: 'uppercase', letterSpacing: '0.02em' }}>aging-aware priority</p>
            </div>
          </div>

          <div style={{ position: 'relative', width: 40, height: 2 }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.1)' }} />
            <div className="flow-line-anim" style={{ position: 'absolute', inset: 0, background: 'url("data:image/svg+xml,%3Csvg width=\'100%25\' height=\'2\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cline x1=\'0\' y1=\'1\' x2=\'100%25\' y2=\'1\' stroke=\'%2316A34A\' stroke-width=\'2\' stroke-dasharray=\'6 6\' /%3E%3C/svg%3E")' }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{
              borderRadius: 12,
              background: 'rgba(22, 163, 74, 0.05)',
              border: '1px solid rgba(22, 163, 74, 0.3)',
              padding: '20px 24px',
              textAlign: 'center',
              minWidth: 140,
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>PostgreSQL</p>
              <p style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 900, color: C.green, margin: '6px 0 0', textShadow: `0 0 12px ${C.green}55` }}>{sumObj(data.counters?.processed).toLocaleString()}</p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: '4px 0 0', textTransform: 'uppercase' }}>committed</p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}` }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Current strategy</h2>
          <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>Driven by escalation level — changes automatically based on Tier 1 pressure</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 600, textAlign: 'left', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Tier', 'Event types', 'Current action', 'Defer', 'Shed'].map(h => (
                  <th key={h} style={{ padding: '12px 20px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {strategyRows.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '12px 20px', fontWeight: 700 }}>{r.tier}</td>
                  <td style={{ padding: '12px 20px', color: C.textSec }}>{r.types}</td>
                  <td style={{ padding: '12px 20px' }}><ActionBadge action={r.action.toLowerCase()} /></td>
                  <td style={{ padding: '12px 20px', color: C.textSec }}>{r.defer}</td>
                  <td style={{ padding: '12px 20px', color: C.textSec }}>{r.shed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 20px', fontSize: 12, color: C.textMuted }}>
          Drain deferred: <strong>{strategy.drain ? 'Yes' : 'No'}</strong> · Workers pull tier 1 first, always
        </div>
      </Card>
    </Shell>
  )
}

// ─── Benchmarks ───────────────────────────────────────────────────────
function Benchmarks() {
  const data = useWs()
  const [latHistory, setLatHistory] = useState([])
  const [tpHistory,  setTpHistory]  = useState([])
  const tickRef = useRef(0)

  useEffect(() => {
    if (!data) return
    tickRef.current += 1
    const t = tickRef.current
    setLatHistory(prev => {
      const point = { t, tier1: data.latency_ms?.tier1??null, tier2: data.latency_ms?.tier2??null, tier3: data.latency_ms?.tier3??null, tier4: data.latency_ms?.tier4??null }
      const next = [...prev, point]
      return next.length > 60 ? next.slice(-60) : next
    })
    setTpHistory(prev => {
      const point = { t, tier1: data.throughput_per_sec?.[1]||0, tier2: data.throughput_per_sec?.[2]||0, tier3: data.throughput_per_sec?.[3]||0, tier4: data.throughput_per_sec?.[4]||0 }
      const next = [...prev, point]
      return next.length > 60 ? next.slice(-60) : next
    })
  }, [data])

  if (!data) return <Shell><div style={{ textAlign: 'center', color: C.textMuted, paddingTop: 80 }}>Connecting...</div></Shell>

  const lat          = data.latency_ms || {}
  const counters     = data.counters   || {}
  const paymentShed  = counters.shed?.payment || 0
  const eventTypes   = ['payment', 'order', 'inventory', 'click', 'log']

  const latColor = (val, tier) => {
    if (val == null) return C.text
    if (tier === 1) return val > 150 ? C.red : val > 80 ? C.orange : C.green
    return val > 300 ? C.red : val > 100 ? C.orange : C.green
  }
  const latCards = [
    { tier: 'Tier 1', label: 'Critical',  value: lat.tier1, color: TIER_COLORS[0], tierNum: 1 },
    { tier: 'Tier 2', label: 'Important', value: lat.tier2, color: TIER_COLORS[1], tierNum: 2 },
    { tier: 'Tier 3', label: 'Normal',    value: lat.tier3, color: TIER_COLORS[2], tierNum: 3 },
    { tier: 'Tier 4', label: 'Low',       value: lat.tier4, color: TIER_COLORS[3], tierNum: 4 },
  ]

  return (
    <Shell>
      <PageTitle eyebrow="Performance" title="Benchmarks" desc="Latency, throughput, and counters — broken down by priority tier." />

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {latCards.map(c => (
          <Card style={{ padding: 20 }} key={c.tier}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.color, display: 'inline-block' }} />
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted }}>{c.tier} · {c.label}</span>
            </div>
            <p style={{ fontSize: 28, fontWeight: 800, color: latColor(c.value, c.tierNum), margin: '12px 0 0', transition: 'color 0.3s' }}>
              {c.value != null ? c.value.toFixed(1) : '—'}<span style={{ fontSize: 13, color: C.textMuted }}>ms</span>
            </p>
            <p style={{ fontSize: 12, color: C.textMuted, margin: '4px 0 0' }}>Avg end-to-end latency</p>
          </Card>
        ))}
      </div>

      <div style={{ marginTop: 24, display: 'grid', gap: 24, gridTemplateColumns: '1fr 1fr' }}>
        <Card style={{ padding: 24 }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Latency over time</h2>
          <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>Per-tier · last 60 seconds</p>
          <div style={{ marginTop: 16, height: 256 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={latHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
                <XAxis dataKey="t" hide />
                <YAxis width={45} tick={{ fontSize: 11 }} unit="ms" />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Line type="monotone" dataKey="tier1" stroke={TIER_COLORS[0]} strokeWidth={2} dot={false} name="Tier 1" connectNulls />
                <Line type="monotone" dataKey="tier2" stroke={TIER_COLORS[1]} strokeWidth={2} dot={false} name="Tier 2" connectNulls />
                <Line type="monotone" dataKey="tier3" stroke={TIER_COLORS[2]} strokeWidth={2} dot={false} name="Tier 3" connectNulls />
                <Line type="monotone" dataKey="tier4" stroke={TIER_COLORS[3]} strokeWidth={2} dot={false} name="Tier 4" connectNulls />
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card style={{ padding: 24 }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Throughput over time</h2>
          <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>Events/sec per tier · last 60 seconds</p>
          <div style={{ marginTop: 16, height: 256 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tpHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
                <XAxis dataKey="t" hide />
                <YAxis width={40} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Area type="monotone" dataKey="tier1" stackId="1" stroke={TIER_COLORS[0]} fill={TIER_COLORS[0]} fillOpacity={0.6} name="Tier 1" />
                <Area type="monotone" dataKey="tier2" stackId="1" stroke={TIER_COLORS[1]} fill={TIER_COLORS[1]} fillOpacity={0.6} name="Tier 2" />
                <Area type="monotone" dataKey="tier3" stackId="1" stroke={TIER_COLORS[2]} fill={TIER_COLORS[2]} fillOpacity={0.6} name="Tier 3" />
                <Area type="monotone" dataKey="tier4" stackId="1" stroke={TIER_COLORS[3]} fill={TIER_COLORS[3]} fillOpacity={0.6} name="Tier 4" />
                <Legend />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 24 }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Counters by event type</h2>
            <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>Cumulative totals since pipeline start</p>
          </div>
          <Badge variant={paymentShed === 0 ? 'green' : 'red'}>
            Payments shed: {paymentShed} {paymentShed === 0 ? '✓ Invariant holds' : '✗ VIOLATION'}
          </Badge>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 600, textAlign: 'left', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Event type', 'Priority', 'Processed', 'Batched', 'Deferred', 'Shed', 'Duplicates'].map((h, i) => (
                  <th key={h} style={{ padding: '12px 20px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, fontWeight: 600, textAlign: i > 1 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {eventTypes.map(t => (
                <tr key={t} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '12px 20px', fontWeight: 700, textTransform: 'capitalize' }}>{t}</td>
                  <td style={{ padding: '12px 20px' }}>
                    <span style={{ background: TYPE_COLORS[t] + '22', color: TYPE_COLORS[t], padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                      P{TYPE_TIER[t] - 1}
                    </span>
                  </td>
                  <td style={{ padding: '12px 20px', fontFamily: 'monospace', textAlign: 'right' }}>{(counters.processed?.[t] || 0).toLocaleString()}</td>
                  <td style={{ padding: '12px 20px', fontFamily: 'monospace', textAlign: 'right' }}>{(counters.batched?.[t]  || 0).toLocaleString()}</td>
                  <td style={{ padding: '12px 20px', fontFamily: 'monospace', textAlign: 'right' }}>{(counters.deferred?.[t] || 0).toLocaleString()}</td>
                  <td style={{
                    padding: '12px 20px', fontFamily: 'monospace', textAlign: 'right',
                    color:      t === 'payment' && (counters.shed?.[t] || 0) > 0 ? C.red  : 'inherit',
                    fontWeight: t === 'payment' && (counters.shed?.[t] || 0) > 0 ? 900   : 'inherit',
                  }}>
                    {(counters.shed?.[t] || 0).toLocaleString()}
                  </td>
                  <td style={{ padding: '12px 20px', fontFamily: 'monospace', textAlign: 'right' }}>
                    {(counters.duplicates?.[t] || 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {data.fault_tolerance && (
        <Card style={{ marginTop: 24 }}>
          <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}` }}>
            <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Fault tolerance</h2>
            <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>
              Workers: {data.fault_tolerance.active_workers}/{data.fault_tolerance.total_workers} &middot;
              Retries: {data.fault_tolerance.retries_total} &middot;
              Idempotent skips: {data.fault_tolerance.idempotent_skips} &middot;
              Dead letters: {data.fault_tolerance.dead_letter_count}
            </p>
          </div>
          {data.fault_tolerance.dead_letter_events.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {['Event ID', 'Type', 'Priority', 'Retries', 'Time'].map(h => (
                      <th key={h} style={{ padding: '12px 20px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.fault_tolerance.dead_letter_events.map((dl, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '12px 20px', fontFamily: 'monospace', fontSize: 11 }}>{dl.id}</td>
                      <td style={{ padding: '12px 20px', fontWeight: 600, textTransform: 'capitalize' }}>{dl.type}</td>
                      <td style={{ padding: '12px 20px' }}><Badge variant="blue">P{dl.priority - 1}</Badge></td>
                      <td style={{ padding: '12px 20px', fontFamily: 'monospace' }}>{dl.retries}</td>
                      <td style={{ padding: '12px 20px', fontFamily: 'monospace', fontSize: 11 }}>{dl.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </Shell>
  )
}

// ─── AI Agents ───────────────────────────────────────────────────────
const DEFAULT_THRESHOLDS = {
  'escalation.1.t1_latency_ms': 80, 'escalation.1.t1_queue': 100, 'escalation.1.lower_queue': 50,
  'escalation.2.t1_latency_ms': 150, 'escalation.2.t1_queue': 500, 'escalation.2.lower_queue': 200,
  'escalation.3.t1_latency_ms': 300, 'escalation.3.t1_queue': 1000, 'escalation.3.lower_queue': 500,
  'deescalation.1.t1_latency_ms': 55, 'deescalation.1.t1_queue': 5, 'deescalation.1.lower_queue': 20,
  'deescalation.2.t1_latency_ms': 60, 'deescalation.2.t1_queue': 5,
  'deescalation.3.t1_latency_ms': 100, 'deescalation.3.t1_queue': 10,
  'deescalation_cooldown': 6.0, 'backpressure_threshold': 8000, 'backpressure_release': 5000,
}

function AIAgents() {
  const data = useWs()
  const [toggling, setToggling] = useState(false)
  const [calling, setCalling] = useState(false)
  const [callResult, setCallResult] = useState(null)
  const [triggering, setTriggering] = useState(false)
  const [triggerResult, setTriggerResult] = useState(null)

  if (!data) return <Shell><div style={{ textAlign: 'center', color: C.textMuted, paddingTop: 80 }}>Connecting...</div></Shell>

  const enabled  = data.agents_enabled || false
  const activity = data.agent_activity || []
  const thresholds = data.current_thresholds || {}

  const toggleAgents = async () => {
    setToggling(true)
    await fetch(enabled ? '/api/agents/disable' : '/api/agents/enable', { method: 'POST' })
    setTimeout(() => setToggling(false), 500)
  }

  const testCall = async () => {
    setCalling(true)
    setCallResult(null)
    try {
      const res = await fetch('/api/alerts/test-call', { method: 'POST' })
      const json = await res.json()
      setCallResult(json.error ? `Error: ${json.error}` : 'Call initiated!')
    } catch (e) {
      setCallResult('Failed to reach server')
    }
    setTimeout(() => setCalling(false), 2000)
  }

  const triggerOptimizer = async () => {
    setTriggering(true)
    setTriggerResult(null)
    try {
      const res = await fetch('/api/agents/trigger', { method: 'POST' })
      const json = await res.json()
      if (json.error) setTriggerResult(`Error: ${json.error}`)
      else if (json.status === 'no_change') setTriggerResult(`No changes needed: ${json.reasoning}`)
      else if (json.status === 'rejected') setTriggerResult(`Rejected: ${json.error}`)
      else setTriggerResult(`Applied! ${Object.keys(json.changes || {}).length} threshold(s) changed. Evaluator will verify.`)
    } catch (e) {
      setTriggerResult('Failed to reach server')
    }
    setTimeout(() => setTriggering(false), 2000)
  }

  const changedKeys = Object.keys(thresholds).filter(k => {
    const def = DEFAULT_THRESHOLDS[k]
    if (def === undefined) return false
    const cur = thresholds[k]
    if (typeof cur === 'number' && typeof def === 'number') return Math.abs(cur - def) > 0.001
    return JSON.stringify(cur) !== JSON.stringify(def)
  })

  const lastOptimizer = activity.find(a => a.agent === 'optimizer')
  const lastEvaluator = activity.find(a => a.agent === 'evaluator')

  return (
    <Shell>
      <PageTitle eyebrow="Intelligence" title="AI Agents"
        desc="LLM-powered optimizer and evaluator that dynamically tune pipeline thresholds."
        action={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={triggerOptimizer} disabled={triggering || !enabled} style={{
              padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: (triggering || !enabled) ? 'not-allowed' : 'pointer', border: 'none', fontFamily: 'inherit',
              background: '#DBEAFE', color: '#1D4ED8',
              opacity: (triggering || !enabled) ? 0.6 : 1,
            }}>
              {triggering ? 'Running...' : 'Trigger AI Optimization'}
            </button>
            <button onClick={testCall} disabled={calling} style={{
              padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: calling ? 'not-allowed' : 'pointer', border: 'none', fontFamily: 'inherit',
              background: '#FEF3C7', color: '#B45309',
              opacity: calling ? 0.6 : 1,
            }}>
              {calling ? 'Calling...' : 'Test Escalation Call'}
            </button>
            <button onClick={toggleAgents} disabled={toggling} style={{
              padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: toggling ? 'not-allowed' : 'pointer', border: 'none', fontFamily: 'inherit',
              background: enabled ? '#FEE2E2' : C.greenLight,
              color: enabled ? '#B91C1C' : '#15803D',
              opacity: toggling ? 0.6 : 1,
            }}>
              <Brain size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              {enabled ? 'Disable Agents' : 'Enable Agents'}
            </button>
          </div>
        }
      />
      {callResult && (
        <div style={{
          marginBottom: 16, padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: callResult.startsWith('Error') ? '#FEE2E2' : C.greenLight,
          color: callResult.startsWith('Error') ? '#B91C1C' : '#15803D',
        }}>{callResult}</div>
      )}
      {triggerResult && (
        <div style={{
          marginBottom: 16, padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: triggerResult.startsWith('Error') || triggerResult.startsWith('Rejected') || triggerResult.startsWith('Failed') ? '#FEE2E2' : triggerResult.startsWith('No changes') ? '#FEF3C7' : C.greenLight,
          color: triggerResult.startsWith('Error') || triggerResult.startsWith('Rejected') || triggerResult.startsWith('Failed') ? '#B91C1C' : triggerResult.startsWith('No changes') ? '#92400E' : '#15803D',
        }}>{triggerResult}</div>
      )}

      {/* Status cards */}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', marginBottom: 24 }}>
        <Card style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: enabled ? C.green : '#999', display: 'inline-block' }} />
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted }}>Status</span>
          </div>
          <p style={{ fontSize: 22, fontWeight: 800, color: enabled ? C.green : C.textMuted, margin: 0 }}>
            {enabled ? 'Active' : 'Disabled'}
          </p>
          <p style={{ fontSize: 12, color: C.textSec, marginTop: 4 }}>
            {enabled ? 'Optimizer runs every 15s' : 'Set GEMINI_API_KEY to activate'}
          </p>
        </Card>

        <Card style={{ padding: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, margin: '0 0 12px' }}>Optimizer</p>
          <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            {lastOptimizer ? lastOptimizer.action : '—'}
          </p>
          <p style={{ fontSize: 12, color: C.textSec, marginTop: 4 }}>
            {lastOptimizer ? `${lastOptimizer.time} · confidence ${lastOptimizer.confidence ?? '—'}` : 'No actions yet'}
          </p>
        </Card>

        <Card style={{ padding: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, margin: '0 0 12px' }}>Evaluator</p>
          <p style={{ fontSize: 18, fontWeight: 700, margin: 0, color: lastEvaluator?.verdict === 'revert' ? C.red : lastEvaluator?.verdict === 'keep' ? C.green : C.text }}>
            {lastEvaluator ? lastEvaluator.verdict || lastEvaluator.action : '—'}
          </p>
          <p style={{ fontSize: 12, color: C.textSec, marginTop: 4 }}>
            {lastEvaluator ? lastEvaluator.time : 'Waiting for optimizer'}
          </p>
        </Card>

        <Card style={{ padding: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, margin: '0 0 12px' }}>Tuned params</p>
          <p style={{ fontSize: 22, fontWeight: 800, color: changedKeys.length > 0 ? C.accent : C.textMuted, margin: 0 }}>
            {changedKeys.length}
          </p>
          <p style={{ fontSize: 12, color: C.textSec, marginTop: 4 }}>
            {changedKeys.length > 0 ? 'Thresholds modified by AI' : 'Using defaults'}
          </p>
        </Card>
      </div>

      {/* Current Thresholds */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}` }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Current thresholds</h2>
          <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>
            <span style={{ color: C.accent, fontWeight: 600 }}>Orange</span> = modified by AI
          </p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 600, textAlign: 'left', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Parameter', 'Current', 'Default', 'Status'].map(h => (
                  <th key={h} style={{ padding: '12px 20px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(DEFAULT_THRESHOLDS).map(([key, def]) => {
                const cur = thresholds[key]
                const changed = changedKeys.includes(key)
                const display = v => typeof v === 'object' ? JSON.stringify(v) : v ?? '—'
                return (
                  <tr key={key} style={{ borderBottom: `1px solid ${C.border}`, background: changed ? C.accentLight : 'transparent' }}>
                    <td style={{ padding: '10px 20px', fontFamily: 'monospace', fontSize: 11 }}>{key}</td>
                    <td style={{ padding: '10px 20px', fontFamily: 'monospace', fontWeight: changed ? 700 : 400, color: changed ? C.accent : C.text }}>{display(cur)}</td>
                    <td style={{ padding: '10px 20px', fontFamily: 'monospace', color: C.textMuted }}>{display(def)}</td>
                    <td style={{ padding: '10px 20px' }}>
                      {changed ? <Badge variant="orange">AI-tuned</Badge> : <Badge variant="green">Default</Badge>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Activity Log */}
      <Card>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}` }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Agent activity log</h2>
          <p style={{ fontSize: 13, color: C.textSec, margin: '4px 0 0' }}>Recent actions from both agents — newest first.</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 800, textAlign: 'left', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Time', 'Agent', 'Action', 'Summary', 'Confidence', 'Verdict'].map(h => (
                  <th key={h} style={{ padding: '12px 20px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activity.map((a, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '12px 20px', fontFamily: 'monospace', fontSize: 11 }}>{a.time}</td>
                  <td style={{ padding: '12px 20px' }}>
                    <Badge variant={a.agent === 'optimizer' ? 'blue' : 'amber'}>{a.agent}</Badge>
                  </td>
                  <td style={{ padding: '12px 20px' }}>
                    <Badge variant={
                      a.action === 'applied' ? 'green' :
                      a.action === 'reverted' ? 'red' :
                      a.action === 'rejected' ? 'red' :
                      a.action === 'approved' ? 'green' :
                      'amber'
                    }>{a.action}</Badge>
                  </td>
                  <td style={{ padding: '12px 20px', color: C.textSec, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.summary}</td>
                  <td style={{ padding: '12px 20px', fontFamily: 'monospace' }}>{a.confidence != null ? a.confidence.toFixed(2) : '—'}</td>
                  <td style={{ padding: '12px 20px' }}>
                    {a.verdict ? <Badge variant={a.verdict === 'keep' ? 'green' : 'red'}>{a.verdict}</Badge> : '—'}
                  </td>
                </tr>
              ))}
              {activity.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '40px 20px', textAlign: 'center', color: C.textMuted }}>
                  {enabled ? 'Agents active — first action in ~15s...' : 'Enable agents to see activity here.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Shell>
  )
}

// ─── Generic placeholder ──────────────────────────────────────────────
function Generic({ title }) {
  return (
    <Shell>
      <PageTitle eyebrow="Control room" title={title} desc="This view is ready for live pipeline metrics." />
      <Card style={{ padding: 40, textAlign: 'center' }}>
        <Server size={38} color={C.accent} style={{ margin: '0 auto', display: 'block' }} />
        <h2 style={{ marginTop: 16, fontSize: 20, fontWeight: 700, margin: '16px 0 0' }}>Connected to AdaptQ pipeline</h2>
        <p style={{ margin: '8px auto 0', maxWidth: 400, fontSize: 14, lineHeight: 1.7, color: C.textSec }}>
          This page will display detailed {title.toLowerCase()} metrics as the pipeline runs. The WebSocket connection is active.
        </p>
      </Card>
    </Shell>
  )
}

// ─── Landing Page ─────────────────────────────────────────────────────
const TILE_PALETTE = [
  '#CC2222', '#6B21A8', '#9B1C1C', '#EA580C',
  '#F59E0B', '#166534', '#1D4ED8', '#E8440A', '#7C3AED',
]

// Decorative colored square grid — inspired by bland.ai
function TileGrid() {
  const tiles = [
    { c: 0, r: 0, col: 0 }, { c: 1, r: 0, col: 1 }, { c: 2, r: 0, col: 8 },
    { c: 0, r: 1, col: 4 }, { c: 1, r: 1, col: 5 }, { c: 3, r: 1, col: 3 },
    { c: 0, r: 2, col: 3 }, { c: 1, r: 2, col: 0 }, { c: 3, r: 2, col: 1 },
    { c: 0, r: 3, col: 6 }, { c: 1, r: 3, col: 4 }, { c: 2, r: 3, col: 3 },
    { c: 3, r: 3, col: 2 }, { c: 4, r: 0, col: 0 }, { c: 4, r: 1, col: 6 },
    { c: 4, r: 2, col: 4 }, { c: 4, r: 3, col: 3 },
  ]
  const SIZE = 60, GAP = 8
  return (
    <div style={{ position: 'relative', width: (5 * SIZE + 4 * GAP), height: (4 * SIZE + 3 * GAP) }}>
      {tiles.map((tile, i) => (
        <div key={i} className="tile" style={{
          position: 'absolute',
          left: tile.c * (SIZE + GAP),
          top:  tile.r * (SIZE + GAP),
          width: SIZE, height: SIZE,
          background: TILE_PALETTE[tile.col],
          borderRadius: 6,
          transition: 'transform 0.25s ease',
          animationDelay: `${i * 0.04}s`,
        }} />
      ))}
    </div>
  )
}


function LandingPage() {
  return (
    <div style={{ fontFamily: "'Inter', ui-sans-serif, sans-serif", background: '#fff', minHeight: '100vh', WebkitFontSmoothing: 'antialiased', overflowX: 'hidden' }}>

      {/* ── Announcement banner ── */}
      <div style={{ background: `linear-gradient(90deg, ${C.accent} 0%, #ff5e1a 100%)`, padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
          AdaptQ — Adaptive event pipeline that never drops a critical event
        </span>
        <Link to="/admin" style={{ color: '#fff', fontSize: 12, fontWeight: 800, textDecoration: 'underline', whiteSpace: 'nowrap', textUnderlineOffset: 2 }}>
          Open Dashboard &rarr;
        </Link>
      </div>

      {/* ── Navbar ── */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 48px', borderBottom: `1px solid ${C.border}88`,
        background: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 4px 24px rgba(0,0,0,0.02)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          {/* Logo */}
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <div style={{ width: 34, height: 34, background: '#0D0D0D', borderRadius: 8, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 14, fontWeight: 900, boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>Q</div>
            <span style={{ fontSize: 18, fontWeight: 900, color: '#0D0D0D', letterSpacing: '-0.04em' }}>AdaptQ</span>
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link className="cta-button-hover" to="/admin" style={{
            background: C.amber, color: '#0D0D0D', padding: '10px 22px',
            borderRadius: 8, fontSize: 14, fontWeight: 800, textDecoration: 'none',
            boxShadow: '0 4px 12px rgba(245, 180, 0, 0.25)', transition: 'transform 0.2s, box-shadow 0.2s',
          }}>Enter Dashboard</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ 
        position: 'relative', maxWidth: 1200, margin: '0 auto', padding: '120px 48px 100px', 
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 48,
      }}>
        {/* Decorative background glows */}
        <div style={{ position: 'absolute', top: '10%', left: '-10%', width: 600, height: 600, background: `radial-gradient(circle, ${C.accent}15 0%, transparent 70%)`, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '10%', right: '-5%', width: 500, height: 500, background: `radial-gradient(circle, ${C.amber}15 0%, transparent 70%)`, pointerEvents: 'none' }} />

        <div style={{ maxWidth: 580, position: 'relative', zIndex: 10 }} className="fade-up">
          {/* Status pill */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            background: 'rgba(255, 243, 240, 0.8)', backdropFilter: 'blur(8px)', border: `1px solid ${C.accent}44`,
            borderRadius: 24, padding: '6px 16px', marginBottom: 32,
            boxShadow: '0 2px 12px rgba(232, 68, 10, 0.08)'
          }}>
            <span className="pulse-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: C.accent, display: 'inline-block' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>Live pipeline · 3,400+ events/min baseline</span>
          </div>

          <h1 style={{ fontSize: 72, fontWeight: 900, color: '#0D0D0D', letterSpacing: '-0.04em', lineHeight: 1.05, margin: 0 }}>
            Zero critical<br />events dropped.<br />
            <span style={{ background: `linear-gradient(90deg, ${C.accent}, ${C.amber})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Ever.</span>
          </h1>
          <p style={{ marginTop: 28, fontSize: 18, color: '#555', lineHeight: 1.7, maxWidth: 480, fontWeight: 400 }}>
            AdaptQ intelligently classifies, routes, and protects your most important revenue-generating events — seamlessly scaling logic when traffic spikes 20&times;.
          </p>
          <div style={{ marginTop: 42, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Link to="/admin" className="primary-btn-hover" style={{ 
              background: '#0D0D0D', color: '#fff', padding: '16px 32px', borderRadius: 10, 
              fontSize: 15, fontWeight: 800, textDecoration: 'none', transition: 'all 0.2s',
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)'
            }}>
              Open Dashboard
            </Link>
            <Link to="/admin/simulation" className="secondary-btn-hover" style={{ 
              background: '#fff', color: '#0D0D0D', padding: '16px 32px', borderRadius: 10, 
              fontSize: 15, fontWeight: 700, textDecoration: 'none', border: `2px solid ${C.border}`,
              transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 8
            }}>
              Try Simulator <ArrowRight size={18} />
            </Link>
          </div>
        </div>
        <div style={{ flexShrink: 0, position: 'relative', zIndex: 10 }}>
          <div style={{ 
            padding: 32, background: 'rgba(255, 255, 255, 0.4)', backdropFilter: 'blur(20px)',
            border: `1px solid ${C.border}`, borderRadius: 24, boxShadow: '0 24px 48px rgba(0,0,0,0.05)' 
          }}>
            <TileGrid />
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <div style={{ background: '#0D0D0D', padding: '64px 48px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.05, backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 32, position: 'relative', zIndex: 5 }}>
          {[
            { value: '3,400+', label: 'Events / minute', sub: 'at baseline load' },
            { value: '0',      label: 'P0 events lost',  sub: 'invariant maintained' },
            { value: '4',      label: 'Escalation tiers', sub: 'adaptive response levels' },
            { value: '8',      label: 'Worker threads',   sub: 'strict priority routing' },
          ].map(s => (
            <div key={s.label} className="stat-card" style={{ padding: '24px', background: 'rgba(255,255,255,0.03)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)' }}>
              <p style={{ fontSize: 48, fontWeight: 900, color: '#fff', margin: 0, letterSpacing: '-0.03em' }}>{s.value}</p>
              <p style={{ fontSize: 15, fontWeight: 700, color: C.amber, margin: '8px 0 0' }}>{s.label}</p>
              <p style={{ fontSize: 13, color: '#888', margin: '6px 0 0' }}>{s.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Use Case Section (NEW) ── */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '100px 48px 60px' }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: C.accent, margin: 0 }}>Built for Scale</p>
          <h2 style={{ fontSize: 42, fontWeight: 900, color: '#0D0D0D', letterSpacing: '-0.03em', margin: '12px 0 0' }}>The E-Commerce Flash Sale</h2>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 64, alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 16px', letterSpacing: '-0.02em' }}>When the spike hits, the pipeline doesn't panic. It does <span style={{ color: C.accent }}>jugaad</span>.</h3>
            <p style={{ fontSize: 16, color: '#555', lineHeight: 1.7, margin: '0 0 24px' }}>
              Imagine an e-commerce platform receiving a mixed event stream: orders, payments, inventory updates, user activity (clicks/views), and application logs.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <li style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: C.greenLight, color: C.green, display: 'grid', placeItems: 'center' }}><Activity size={20} /></div>
                <div><strong style={{ display: 'block', fontSize: 15 }}>Normal Load</strong><span style={{ fontSize: 14, color: '#666' }}>~1,000 events/minute handled comfortably.</span></div>
              </li>
              <li style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#FEE2E2', color: '#DC2626', display: 'grid', placeItems: 'center' }}><Zap size={20} /></div>
                <div><strong style={{ display: 'block', fontSize: 15 }}>Flash Sale Spike</strong><span style={{ fontSize: 14, color: '#666' }}>~20,000 events/minute — a sudden 20&times; surge.</span></div>
              </li>
            </ul>
            <p style={{ fontSize: 16, color: '#555', lineHeight: 1.7, margin: 0, padding: 20, background: C.bg, borderRadius: 12, borderLeft: `4px solid ${C.amber}` }}>
              <strong>The Core Philosophy:</strong> Not all events are equal. A payment failing to process is a business problem. A log line arriving 30 seconds late is fine. AdaptQ recognizes this difference and acts accordingly.
            </p>
          </div>
          
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 24, padding: 40, boxShadow: '0 20px 40px rgba(0,0,0,0.04)' }}>
            <h4 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 20px', color: '#0D0D0D', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Traffic Distribution</h4>
            {[
              { type: 'Payment', share: '4%', tier: 'Tier 1', color: C.red, desc: 'Critical, never dropped' },
              { type: 'Order', share: '9%', tier: 'Tier 1', color: C.red, desc: 'Critical, never dropped' },
              { type: 'Inventory', share: '13%', tier: 'Tier 2', color: C.amber, desc: 'Important, can batch/defer' },
              { type: 'Clicks', share: '28%', tier: 'Tier 3', color: '#6366F1', desc: 'Useful, can defer/shed' },
              { type: 'Logs', share: '46%', tier: 'Tier 4', color: C.green, desc: 'Noise, shed freely under load' },
            ].map(item => (
              <div key={item.type} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 0', borderBottom: item.type !== 'Logs' ? `1px solid ${C.border}66` : 'none' }}>
                <div style={{ width: 50, fontWeight: 800, fontSize: 18, color: item.color }}>{item.share}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 16 }}>{item.type}</span>
                    <Badge variant={item.tier === 'Tier 1' ? 'red' : item.tier === 'Tier 2' ? 'amber' : 'green'}>{item.tier}</Badge>
                  </div>
                  <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 48px 100px' }}>
        <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: C.accent, margin: 0, textAlign: 'center' }}>How it works</p>
        <h2 style={{ fontSize: 44, fontWeight: 900, color: '#0D0D0D', letterSpacing: '-0.03em', margin: '8px 0 56px', textAlign: 'center' }}>Adaptive by design.</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32 }}>
          {[
            { num: '01', title: 'Classify & route', color: C.accent, icon: <Activity size={24}/>, desc: 'Every event is tagged with a priority tier — Payment, Inventory, Click, or Log — and instantly routed to the right queue.' },
            { num: '02', title: 'Adapt under load',  color: C.amber, icon: <SlidersHorizontal size={24}/>, desc: 'When Tier 1 latency rises, the system escalates through 4 levels: Normal → Elevated → Critical → Emergency, shedding lower-priority work.' },
            { num: '03', title: 'Never drop P0',     color: C.green, icon: <Shield size={24}/>, desc: 'Critical events (payments, orders) are guaranteed. The system enforces a hard invariant: zero P0 events shed, regardless of load.' },
          ].map(f => (
            <div key={f.num} className="feature-card" style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 20, padding: 40, transition: 'transform 0.3s, box-shadow 0.3s', cursor: 'default' }}>
              <div style={{ width: 56, height: 56, background: f.color + '18', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24, color: f.color }}>
                {f.icon}
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: '#0D0D0D', margin: '0 0 12px', letterSpacing: '-0.02em' }}>{f.title}</h3>
              <p style={{ fontSize: 15, color: '#666', lineHeight: 1.7, margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ background: `linear-gradient(135deg, ${C.bg} 0%, #fff 100%)`, padding: '100px 48px', textAlign: 'center', borderTop: `1px solid ${C.border}` }}>
        <div style={{ width: 80, height: 80, background: C.amber + '33', borderRadius: '50%', margin: '0 auto 24px', display: 'grid', placeItems: 'center', color: C.amber }}>
          <Gauge size={40} strokeWidth={2.5} />
        </div>
        <h2 style={{ fontSize: 52, fontWeight: 900, color: '#0D0D0D', letterSpacing: '-0.03em', margin: '0 0 16px' }}>
          See it in action.
        </h2>
        <p style={{ fontSize: 18, color: '#666', margin: '0 auto 40px', maxWidth: 500, lineHeight: 1.6 }}>
          Trigger a 10&times; traffic spike and watch the pipeline self-adapt in real time without dropping a single payment.
        </p>
        <Link className="cta-button-hover" to="/admin/simulation" style={{ 
          background: C.amber, color: '#0D0D0D', padding: '18px 48px', 
          borderRadius: 14, fontSize: 16, fontWeight: 800, textDecoration: 'none', display: 'inline-block',
          boxShadow: '0 8px 32px rgba(245, 180, 0, 0.3)', transition: 'all 0.3s'
        }}>
          Launch Simulator
        </Link>
      </section>

      {/* ── Footer ── */}
      <footer style={{ background: '#fff', borderTop: `1px solid ${C.border}`, padding: '48px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, background: '#0D0D0D', borderRadius: 6, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 13, fontWeight: 900 }}>Q</div>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#0D0D0D', letterSpacing: '-0.02em' }}>AdaptQ</span>
          </div>
          <div style={{ display: 'flex', gap: 32 }}>
            {[['Dashboard', '/admin'], ['Simulation', '/admin/simulation'], ['Pipeline', '/admin/pipeline'], ['Benchmarks', '/admin/benchmarks']].map(([label, to]) => (
              <Link key={label} className="nav-link-hover" to={to} style={{ fontSize: 14, color: '#666', fontWeight: 500, textDecoration: 'none', transition: 'color 0.2s' }}>{label}</Link>
            ))}
          </div>
          <p style={{ fontSize: 13, color: '#999', margin: 0, fontWeight: 500 }}>Built for Hackaholics 2026</p>
        </div>
      </footer>
    </div>
  )
}

// ─── Routes ───────────────────────────────────────────────────────────
function App() {
  return (
    <Routes>
      <Route path="/"                   element={<LandingPage />} />
      <Route path="/admin"              element={<Admin />} />
      <Route path="/admin/queues"       element={<QueueMonitor />} />
      <Route path="/admin/events"       element={<EventStream />} />
      <Route path="/admin/decisions"    element={<Decisions />} />
      <Route path="/admin/simulation"   element={<Simulation />} />
      <Route path="/admin/traffic"      element={<Traffic />} />
      <Route path="/admin/pipeline"     element={<Pipeline />} />
      <Route path="/admin/benchmarks"   element={<Benchmarks />} />
      <Route path="/admin/agents" element={<AIAgents />} />
      <Route path="/admin/settings" element={<Generic title="Settings" />} />
    </Routes>
  )
}

export default function Root() {
  return (
    <BrowserRouter>
      <WsProvider>
        <App />
      </WsProvider>
    </BrowserRouter>
  )
}
