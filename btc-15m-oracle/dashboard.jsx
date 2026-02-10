import { useState, useEffect, useRef } from "react";

// ── Data ──────────────────────────────────────────────────────
function gen(prev) {
  const now = Date.now();
  const btc = (prev?.oracle?.price || 97400) + (Math.random() - 0.48) * 80;
  const open = prev?.open ? [...prev.open] : [];
  const closed = prev?.closed ? [...prev.closed] : [];

  if (open.length < 3 && Math.random() > 0.55) {
    const d = Math.random() > 0.45 ? "UP" : "DOWN";
    const conf = 0.6 + Math.random() * 0.4;
    const ep = 0.4 + Math.random() * 0.2;
    const sz = parseFloat((5 + Math.random() * 20).toFixed(2));
    const exp = new Date(now + 900000 - Math.random() * 600000);
    open.push({ id: `${Date.now()}${d[0]}`, d, conf, ep, sz, btc: btc.toFixed(2), t: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), exp: exp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), expTs: exp.getTime(), uPnl: 0 });
  }

  const still = [];
  for (const p of open) {
    if (now > p.expTs) {
      const w = Math.random() < 0.54;
      closed.unshift({ ...p, win: w, pnl: w ? p.sz * 0.8 : -p.sz, ct: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) });
    } else {
      p.uPnl = p.sz * ((Math.random() - 0.48) * 0.15);
      still.push(p);
    }
  }

  const wins = closed.filter(p => p.win).length, losses = closed.length - wins;
  const rPnl = closed.reduce((s, p) => s + p.pnl, 0);
  const cap = 1000 + rPnl;
  const eq = prev?.eq || [{ t: now - 3600000, v: 1000 }];
  eq.push({ t: now, v: cap + still.reduce((s, p) => s + p.uPnl, 0) });
  if (eq.length > 200) eq.shift();

  const sig = () => ({ d: Math.random() > 0.5 ? "UP" : "DN", s: Math.random() * 0.8 + 0.2 });
  const min = new Date().getMinutes(), sec = new Date().getSeconds();
  const secs = Math.max(0, (((Math.floor(min / 15) + 1) * 15 - min - 1) * 60 + (60 - sec)) % 900 - 60);
  const arbHit = Math.random() > 0.93;

  return {
    open: still, closed: closed.slice(0, 50), eq,
    oracle: { price: btc.toFixed(2), src: 3, spread: (Math.random() * 0.04).toFixed(4) },
    sigs: { mom: sig(), rsi: { ...sig(), val: (30 + Math.random() * 40).toFixed(1) }, macd: sig(), ema: sig() },
    stats: { wins, losses, wr: wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "0.0", pnl: rPnl.toFixed(2), cap: cap.toFixed(2), total: wins + losses },
    risk: { dt: wins + losses, streak: Math.floor(Math.random() * 3) },
    secs, arbHit,
  };
}

// ── Equity Spark ──────────────────────────────────────────────
function Spark({ data, w = 540, h = 70 }) {
  if (!data || data.length < 2) return null;
  const vals = data.map(d => d.v);
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - mn) / rng) * (h - 8) - 4}`).join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  const c = up ? "var(--cyan)" : "var(--red)";
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity=".12" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#eqFill)" />
      <polyline points={pts} fill="none" stroke={c} strokeWidth="1.5" />
    </svg>
  );
}

// ── Signal Dot ────────────────────────────────────────────────
function Sig({ label, d, s, extra }) {
  const up = d === "UP";
  const c = up ? "var(--cyan)" : "var(--red)";
  const pct = Math.round(s * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${up ? "var(--cyan)" : "var(--red)"}40`, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 11, color: "var(--muted)", letterSpacing: ".02em" }}>{label}</span>
      {extra && <span style={{ fontSize: 10, color: "var(--dim)", marginRight: 4 }}>{extra}</span>}
      <span style={{ fontSize: 12, fontWeight: 600, color: c, fontFamily: "var(--mono)", minWidth: 48, textAlign: "right" }}>{d} {pct}%</span>
    </div>
  );
}

// ── Position Row ──────────────────────────────────────────────
function PosRow({ p, closed = false }) {
  const up = p.d === "UP";
  const dc = up ? "var(--cyan)" : "var(--red)";
  const pnl = closed ? (p.pnl || 0) : (p.uPnl || 0);
  const pc = pnl >= 0 ? "var(--cyan)" : "var(--red)";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "52px 52px 1fr 50px 58px 56px", alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--line)", fontSize: 11, fontFamily: "var(--mono)" }}>
      <span style={{ color: "var(--dim)" }}>{closed ? p.ct : p.t}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ width: 5, height: 5, borderRadius: 1, background: dc }} />
        <span style={{ color: dc, fontWeight: 600, fontSize: 10 }}>{p.d}</span>
      </div>
      <span style={{ color: "var(--muted)" }}>${p.sz.toFixed(2)} <span style={{ color: "var(--dim)" }}>@</span> {p.ep.toFixed(3)}</span>
      <span style={{ color: "var(--dim)", textAlign: "right" }}>{(p.conf * 100).toFixed(0)}%</span>
      <span style={{ color: pc, textAlign: "right", fontWeight: 600 }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}</span>
      {closed
        ? <span style={{ textAlign: "right", fontWeight: 600, fontSize: 10, color: p.win ? "var(--cyan)" : "var(--red)" }}>{p.win ? "✓ WIN" : "✗ LOSS"}</span>
        : <span style={{ textAlign: "right", fontSize: 9, color: "var(--yellow)" }}>{p.exp}</span>
      }
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────
function Stat({ label, value, sub, color, large }) {
  return (
    <div style={{ padding: large ? "14px 16px" : "10px 12px", background: "var(--card)", borderRadius: 6, border: "1px solid var(--line)" }}>
      <div style={{ fontSize: 9, color: "var(--dim)", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: large ? 6 : 3 }}>{label}</div>
      <div style={{ fontSize: large ? 28 : 20, fontWeight: 700, fontFamily: "var(--mono)", color: color || "var(--text)", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "var(--dim)", marginTop: large ? 6 : 3 }}>{sub}</div>}
    </div>
  );
}

// ── Toggle Pill ───────────────────────────────────────────────
function Toggle({ label, on, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, border: `1px solid ${on ? "var(--cyan)" : "var(--line)"}`,
      background: on ? "rgba(0,240,255,0.06)" : "transparent", cursor: "pointer", transition: "all .2s",
    }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: on ? "var(--cyan)" : "var(--dim)", transition: "all .2s", boxShadow: on ? "0 0 6px var(--cyan)" : "none" }} />
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: on ? "var(--cyan)" : "var(--dim)", letterSpacing: ".04em" }}>{label}</span>
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────
export default function Dashboard() {
  const [d, setD] = useState(() => gen(null));
  const [tick, setTick] = useState(0);
  const [on, setOn] = useState(true);
  const [tab, setTab] = useState("open");
  const [arb, setArb] = useState(true);
  const [hedge, setHedge] = useState(false);

  useEffect(() => {
    if (!on) return;
    const iv = setInterval(() => { setD(p => gen(p)); setTick(t => t + 1); }, 3000);
    return () => clearInterval(iv);
  }, [on]);

  const pnlC = parseFloat(d.stats.pnl) >= 0 ? "var(--cyan)" : "var(--red)";
  const uPnl = d.open.reduce((s, p) => s + p.uPnl, 0);
  const tm = `${Math.floor(d.secs / 60)}:${String(d.secs % 60).padStart(2, "0")}`;
  const tmC = d.secs < 60 ? "var(--red)" : d.secs < 240 ? "var(--yellow)" : "var(--cyan)";

  return (
    <div style={{
      "--cyan": "#00f0ff", "--red": "#ff3366", "--yellow": "#ffcc00", "--text": "#e8ecf0",
      "--muted": "#8a94a0", "--dim": "#3a4250", "--line": "rgba(255,255,255,0.04)",
      "--card": "rgba(255,255,255,0.02)", "--bg": "#0a0c10", "--mono": "'JetBrains Mono', 'Fira Code', monospace",
      "--sans": "'Outfit', 'Sora', sans-serif",
      fontFamily: "var(--sans)", background: "var(--bg)", color: "var(--text)", minHeight: "100vh", padding: "20px 24px", maxWidth: 1200, margin: "0 auto",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1a1e28; border-radius: 2px; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: ".01em", color: "var(--text)" }}>
              BTC-15M<span style={{ color: "var(--dim)", fontWeight: 400 }}> / </span><span style={{ color: "var(--muted)", fontWeight: 400 }}>Oracle</span>
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, background: on ? "rgba(0,240,255,0.08)" : "rgba(255,51,102,0.08)", border: `1px solid ${on ? "rgba(0,240,255,0.2)" : "rgba(255,51,102,0.2)"}` }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: on ? "var(--cyan)" : "var(--red)", boxShadow: `0 0 6px ${on ? "var(--cyan)" : "var(--red)"}` }} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 9, fontWeight: 600, color: on ? "var(--cyan)" : "var(--red)", letterSpacing: ".06em" }}>{on ? "LIVE" : "OFF"}</span>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--dim)" }}>Polymarket · BTC 15-min · Cycle {tick}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Toggle label="ARB" on={arb} onClick={() => setArb(!arb)} />
          <Toggle label="HEDGE" on={hedge} onClick={() => setHedge(!hedge)} />

          {/* Timer */}
          <div style={{ padding: "6px 14px", borderRadius: 6, background: "var(--card)", border: "1px solid var(--line)", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 700, color: tmC, letterSpacing: ".02em" }}>{tm}</div>
            <div style={{ fontSize: 8, color: "var(--dim)", letterSpacing: ".08em" }}>NEXT ENTRY</div>
          </div>

          <button onClick={() => setOn(!on)} style={{
            padding: "8px 16px", borderRadius: 6, border: `1px solid ${on ? "rgba(255,51,102,0.25)" : "rgba(0,240,255,0.25)"}`,
            background: on ? "rgba(255,51,102,0.05)" : "rgba(0,240,255,0.05)", cursor: "pointer",
            fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600, color: on ? "var(--red)" : "var(--cyan)", letterSpacing: ".03em",
          }}>{on ? "STOP" : "START"}</button>
        </div>
      </div>

      {/* ── BTC Price + Arb Alert ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 26, fontWeight: 700 }}>${parseFloat(d.oracle.price).toLocaleString()}</span>
            <span style={{ fontSize: 10, color: "var(--dim)" }}>BTC/USD · {d.oracle.src}/3 oracles · {d.oracle.spread}% spread</span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {["BIN", "GCO", "CAP"].map(s => (
              <span key={s} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 10, background: "rgba(0,240,255,0.05)", border: "1px solid rgba(0,240,255,0.1)", color: "var(--cyan)", fontFamily: "var(--mono)", letterSpacing: ".04em" }}>{s}</span>
            ))}
          </div>
        </div>
        {arb && d.arbHit && (
          <div style={{ padding: "10px 14px", borderRadius: 6, background: "rgba(255,204,0,0.04)", border: "1px solid rgba(255,204,0,0.15)", display: "flex", alignItems: "center", gap: 8, minWidth: 180 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--yellow)", boxShadow: "0 0 8px var(--yellow)" }} />
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--yellow)", fontFamily: "var(--mono)" }}>ARB FOUND</div>
              <div style={{ fontSize: 9, color: "var(--dim)" }}>Edge ~2.3% · both sides</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Stats ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        <Stat label="Bankroll" value={`$${parseFloat(d.stats.cap).toLocaleString()}`} sub="available balance" large />
        <Stat label="Win Rate" value={`${d.stats.wr}%`} sub={`${d.stats.wins}W · ${d.stats.losses}L`} color={parseFloat(d.stats.wr) >= 50 ? "var(--cyan)" : "var(--red)"} />
        <Stat label="Realized" value={`$${d.stats.pnl}`} sub={`${d.stats.total} trades`} color={pnlC} />
        <Stat label="Unrealized" value={`$${uPnl.toFixed(2)}`} sub={`${d.open.length} open`} color={uPnl >= 0 ? "var(--cyan)" : "var(--red)"} />
        <Stat label="Daily Risk" value={`${d.risk.dt}/20`} sub={`streak: ${d.risk.streak}`} color="var(--yellow)" />
      </div>

      {/* ── Main Grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 250px", gap: 10 }}>

        {/* Left */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Equity */}
          <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: "var(--dim)", letterSpacing: ".04em", fontWeight: 500 }}>EQUITY</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: parseFloat(d.stats.pnl) >= 0 ? "var(--cyan)" : "var(--red)" }}>
                {parseFloat(d.stats.pnl) >= 0 ? "+" : ""}{d.stats.pnl}
              </span>
            </div>
            <Spark data={d.eq} />
          </div>

          {/* Positions */}
          <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6, padding: "12px 14px", flex: 1 }}>
            <div style={{ display: "flex", gap: 0, marginBottom: 10 }}>
              {[{ id: "open", l: `Open (${d.open.length})` }, { id: "closed", l: `Closed (${d.closed.length})` }].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  padding: "5px 14px", border: "none", background: "none", cursor: "pointer",
                  fontFamily: "var(--sans)", fontSize: 11, fontWeight: 500,
                  color: tab === t.id ? "var(--text)" : "var(--dim)",
                  borderBottom: `2px solid ${tab === t.id ? "var(--cyan)" : "transparent"}`,
                  transition: "all .15s",
                }}>{t.l}</button>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "52px 52px 1fr 50px 58px 56px", fontSize: 9, color: "var(--dim)", padding: "0 0 6px", borderBottom: "1px solid var(--line)", letterSpacing: ".04em" }}>
              <span>TIME</span><span>DIR</span><span>SIZE</span><span style={{ textAlign: "right" }}>CONF</span><span style={{ textAlign: "right" }}>P&L</span><span style={{ textAlign: "right" }}>{tab === "closed" ? "RESULT" : "EXPIRY"}</span>
            </div>
            <div style={{ maxHeight: 260, overflowY: "auto" }}>
              {tab === "open"
                ? (d.open.length === 0
                  ? <div style={{ padding: 28, textAlign: "center", color: "var(--dim)", fontSize: 11 }}>Waiting for entry window...</div>
                  : d.open.map(p => <PosRow key={p.id} p={p} closed={false} />))
                : (d.closed.length === 0
                  ? <div style={{ padding: 28, textAlign: "center", color: "var(--dim)", fontSize: 11 }}>No history yet</div>
                  : d.closed.map((p, i) => <PosRow key={i} p={p} closed={true} />))
              }
            </div>
          </div>
        </div>

        {/* Right */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Signals */}
          <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--dim)", letterSpacing: ".04em", fontWeight: 500, marginBottom: 6 }}>SIGNALS</div>
            <Sig label="Momentum" d={d.sigs.mom.d} s={d.sigs.mom.s} />
            <Sig label="RSI" d={d.sigs.rsi.d} s={d.sigs.rsi.s} extra={d.sigs.rsi.val} />
            <Sig label="MACD" d={d.sigs.macd.d} s={d.sigs.macd.s} />
            <Sig label="EMA Cross" d={d.sigs.ema.d} s={d.sigs.ema.s} />
          </div>

          {/* Modules status */}
          <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--dim)", letterSpacing: ".04em", fontWeight: 500, marginBottom: 8 }}>ENGINES</div>
            {[
              { n: "Directional", on: true, c: "var(--cyan)" },
              { n: "Arbitrage", on: arb, c: "var(--yellow)" },
              { n: "Hedge", on: hedge, c: "var(--cyan)" },
            ].map(m => (
              <div key={m.n} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: m.on ? m.c : "var(--dim)", boxShadow: m.on ? `0 0 6px ${m.c === "var(--yellow)" ? "#ffcc00" : "#00f0ff"}40` : "none", transition: "all .2s" }} />
                <span style={{ flex: 1, fontSize: 11, color: m.on ? "var(--muted)" : "var(--dim)" }}>{m.n}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: m.on ? m.c : "var(--dim)" }}>{m.on ? "ON" : "OFF"}</span>
              </div>
            ))}
          </div>

          {/* Config */}
          <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--dim)", letterSpacing: ".04em", fontWeight: 500, marginBottom: 6 }}>CONFIG</div>
            {[
              ["Market", "BTC 15m"],
              ["Order", "Market (FOK)"],
              ["Confidence", "≥ 60%"],
              ["Max Trade", "$25"],
              ["Kelly", "0.25×"],
              ["Daily Cap", "20"],
              ["Loss Limit", "15%"],
              ["Arb Thresh", "0.98"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 10 }}>
                <span style={{ color: "var(--dim)" }}>{k}</span>
                <span style={{ fontFamily: "var(--mono)", color: "var(--muted)" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, textAlign: "center", fontSize: 9, color: "var(--dim)", opacity: 0.5, letterSpacing: ".04em" }}>
        BTC-15M-ORACLE v2.0 · py-clob-client · entries :59 / :14 / :29 / :44
      </div>
    </div>
  );
}
