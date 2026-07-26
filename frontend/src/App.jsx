import React, { useEffect, useState, useCallback, useRef } from "react";
import { api, getToken, setToken, clearToken } from "./api";

/* ------------------------------ helpers ------------------------------ */
const usd = (n) =>
  n?.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const pct = (n) => `${n >= 0 ? "+" : ""}${n?.toFixed(2)}%`;
const signed = (n) => `${n >= 0 ? "+" : "-"}${usd(Math.abs(n))}`;
const toneClass = (n) => (n > 0 ? "text-gain" : n < 0 ? "text-loss" : "text-gray-400");

/* ------------------------------ auth screen ------------------------------ */
function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", display_name: "", password: "", invite_code: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    setError("");
    setBusy(true);
    try {
      const fn = mode === "login" ? api.login : api.register;
      const { access_token } = await fn(form);
      setToken(access_token);
      onAuthed();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-gold font-mono text-sm tracking-[0.3em]">STOCK LEAGUE</div>
          <h1 className="mt-2 text-2xl font-semibold">Trade. Compete. Flex.</h1>
          <p className="mt-1 text-sm text-gray-500">Everyone starts even. Best return wins.</p>
        </div>
        <div className="bg-panel border border-edge rounded-xl p-6">
          <div className="flex gap-1 mb-5 bg-ink rounded-lg p-1">
            {["login", "register"].map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(""); }}
                className={`flex-1 py-2 rounded-md text-sm capitalize transition ${
                  mode === m ? "bg-edge text-white" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <Field label="Username" value={form.username} onChange={set("username")} />
            {mode === "register" && (
              <>
                <Field label="Display name" value={form.display_name} onChange={set("display_name")} />
                <Field label="Invite code" value={form.invite_code} onChange={set("invite_code")} />
              </>
            )}
            <Field label="Password" type="password" value={form.password} onChange={set("password")}
                   onEnter={submit} />
          </div>

          {error && <p className="mt-3 text-sm text-loss">{error}</p>}

          <button
            onClick={submit}
            disabled={busy}
            className="mt-5 w-full py-2.5 rounded-lg bg-gold text-ink font-semibold hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "…" : mode === "login" ? "Log in" : "Join the league"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, type = "text", value, onChange, onEnter }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-400">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        onKeyDown={(e) => e.key === "Enter" && onEnter && onEnter()}
        className="mt-1 w-full bg-ink border border-edge rounded-lg px-3 py-2 text-sm outline-none focus:border-gold"
      />
    </label>
  );
}

/* ------------------------------ header ------------------------------ */
function Header({ me, total, tab, setTab, onLogout }) {
  return (
    <header className="border-b border-edge">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="text-gold font-mono text-sm tracking-[0.25em]">STOCK LEAGUE</span>
          <nav className="flex gap-1">
            {[["portfolio", "Portfolio"], ["derivatives", "Derivatives"], ["leaderboard", "Leaderboard"]].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-3 py-1.5 rounded-md text-sm ${
                  tab === k ? "bg-panel text-white" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-gray-500">{me?.display_name}</div>
            <div className="font-mono tnum text-sm">{total != null ? usd(total) : "—"}</div>
          </div>
          <button onClick={onLogout} className="text-xs text-gray-500 hover:text-loss">Log out</button>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------ portfolio ------------------------------ */
function SymbolSearch({ value, onChange, onPick, placeholder = "Apple or AAPL", width = "w-64" }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);
  const skip = useRef(false);

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const q = value.trim();
    if (q.length < 1) { setResults([]); setOpen(false); return; }
    const id = setTimeout(async () => {
      try {
        const r = await api.search(q);
        setResults(r); setOpen(r.length > 0); setHighlight(0);
      } catch (_) {}
    }, 250);
    return () => clearTimeout(id);
  }, [value]);

  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function choose(m) {
    skip.current = true;
    onChange(`${m.symbol} · ${m.description}`);
    onPick(m.symbol);
    setResults([]); setOpen(false);
  }

  function onKeyDown(e) {
    if (open && results.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % results.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + results.length) % results.length); return; }
      if (e.key === "Enter") { e.preventDefault(); choose(results[highlight]); return; }
      if (e.key === "Escape") { setOpen(false); return; }
    } else if (e.key === "Enter") {
      onPick(value.trim().split(" ")[0].toUpperCase());
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => results.length && setOpen(true)}
        placeholder={placeholder}
        className={`mt-1 ${width} bg-ink border border-edge rounded-lg px-3 py-2 text-sm outline-none focus:border-gold`}
      />
      {open && (
        <ul className="absolute z-20 mt-1 w-72 max-h-64 overflow-auto bg-panel border border-edge rounded-lg shadow-xl">
          {results.map((r, i) => (
            <li key={r.symbol}
                onMouseDown={(e) => { e.preventDefault(); choose(r); }}
                onMouseEnter={() => setHighlight(i)}
                className={`px-3 py-2 cursor-pointer flex items-center gap-2 ${i === highlight ? "bg-edge" : ""}`}>
              <span className="font-mono font-semibold text-sm w-16 shrink-0">{r.symbol}</span>
              <span className="text-xs text-gray-400 truncate">{r.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }) {
  return (
    <div className="bg-panel border border-edge rounded-xl p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 font-mono tnum text-xl ${tone || "text-white"}`}>{value}</div>
    </div>
  );
}

function TradePanel({ onDone, onSymbol }) {
  const [query, setQuery] = useState("");     // what's typed in the box (name or ticker)
  const [symbol, setSymbol] = useState("");   // the confirmed ticker to trade
  const [shares, setShares] = useState("");
  const [quote, setQuote] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);
  const skipNextSearch = useRef(false);       // don't re-search right after picking a result

  // debounced company/ticker search as the user types
  useEffect(() => {
    if (skipNextSearch.current) { skipNextSearch.current = false; return; }
    const q = query.trim();
    if (q.length < 1) { setResults([]); setOpen(false); return; }
    const id = setTimeout(async () => {
      try {
        const r = await api.search(q);
        setResults(r);
        setOpen(r.length > 0);
        setHighlight(0);
      } catch (_) { /* ignore transient search errors */ }
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  // close the dropdown when clicking outside
  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function pick(match) {
    skipNextSearch.current = true;
    setQuery(`${match.symbol} · ${match.description}`);
    setSymbol(match.symbol);
    setResults([]); setOpen(false); setMsg(null);
    onSymbol && onSymbol(match.symbol);
    try {
      setQuote(await api.quote(match.symbol));
    } catch (e) {
      setMsg({ type: "err", text: e.message });
    }
  }

  // typing a ticker directly and pressing Enter (no dropdown selection)
  async function lookupTyped() {
    const s = query.trim().split(" ")[0].toUpperCase();
    if (!s) return;
    setSymbol(s); setOpen(false); setMsg(null);
    onSymbol && onSymbol(s);
    try {
      setQuote(await api.quote(s));
    } catch (e) {
      setMsg({ type: "err", text: e.message }); setQuote(null);
    }
  }

  function onKeyDown(e) {
    if (open && results.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % results.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + results.length) % results.length); return; }
      if (e.key === "Enter") { e.preventDefault(); pick(results[highlight]); return; }
      if (e.key === "Escape") { setOpen(false); return; }
    } else if (e.key === "Enter") {
      lookupTyped();
    }
  }

  async function trade(side) {
    setMsg(null); setBusy(true);
    try {
      if (!symbol) throw new Error("Pick a stock first");
      const n = parseFloat(shares);
      if (!n || n <= 0) throw new Error("Enter a share amount");
      const r = side === "buy" ? await api.buy(symbol, n) : await api.sell(symbol, n);
      const verb = side === "buy" ? "Bought" : "Sold";
      const amt = side === "buy" ? r.cost : r.proceeds;
      setMsg({ type: "ok", text: `${verb} ${n} ${r.symbol} @ ${usd(r.price)} — ${usd(amt)}` });
      setShares("");
      onDone();
    } catch (e) {
      setMsg({ type: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-panel border border-edge rounded-xl p-4">
      <div className="text-sm font-medium mb-3">Trade</div>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="relative" ref={boxRef}>
          <span className="text-xs text-gray-500">Company or ticker</span>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSymbol(""); setQuote(null); }}
            onKeyDown={onKeyDown}
            onFocus={() => results.length && setOpen(true)}
            placeholder="Apple or AAPL"
            className="mt-1 w-64 bg-ink border border-edge rounded-lg px-3 py-2 text-sm outline-none focus:border-gold"
          />
          {open && (
            <ul className="absolute z-20 mt-1 w-72 max-h-64 overflow-auto bg-panel border border-edge rounded-lg shadow-xl">
              {results.map((r, i) => (
                <li
                  key={r.symbol}
                  onMouseDown={(e) => { e.preventDefault(); pick(r); }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`px-3 py-2 cursor-pointer flex items-center gap-2 ${
                    i === highlight ? "bg-edge" : ""
                  }`}
                >
                  <span className="font-mono font-semibold text-sm w-16 shrink-0">{r.symbol}</span>
                  <span className="text-xs text-gray-400 truncate">{r.description}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button onClick={lookupTyped} className="px-3 py-2 rounded-lg border border-edge text-sm hover:border-gold">
          Get price
        </button>
        {quote && (
          <div className="font-mono tnum text-sm text-gray-300 pb-2">
            {quote.symbol} <span className="text-white">{usd(quote.price)}</span>
          </div>
        )}
        <div className="flex-1" />
        <div>
          <span className="text-xs text-gray-500">Shares</span>
          <input
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="0"
            className="mt-1 w-24 bg-ink border border-edge rounded-lg px-3 py-2 text-sm font-mono tnum outline-none focus:border-gold"
          />
        </div>
        <button onClick={() => trade("buy")} disabled={busy}
                className="px-4 py-2 rounded-lg bg-gain/15 text-gain border border-gain/40 text-sm font-medium hover:bg-gain/25 disabled:opacity-50">
          Buy
        </button>
        <button onClick={() => trade("sell")} disabled={busy}
                className="px-4 py-2 rounded-lg bg-loss/15 text-loss border border-loss/40 text-sm font-medium hover:bg-loss/25 disabled:opacity-50">
          Sell
        </button>
      </div>
      {msg && (
        <p className={`mt-3 text-sm ${msg.type === "ok" ? "text-gain" : "text-loss"}`}>{msg.text}</p>
      )}
    </div>
  );
}

function Holdings({ positions, onSelect }) {
  if (!positions?.length) {
    return (
      <div className="bg-panel border border-edge rounded-xl p-8 text-center text-gray-500 text-sm">
        No positions yet. Look up a ticker above and make your first trade.
      </div>
    );
  }
  return (
    <div className="bg-panel border border-edge rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-edge">
            <th className="px-4 py-3 font-medium">Ticker</th>
            <th className="px-4 py-3 font-medium text-right">Shares</th>
            <th className="px-4 py-3 font-medium text-right">Avg cost</th>
            <th className="px-4 py-3 font-medium text-right">Price</th>
            <th className="px-4 py-3 font-medium text-right">Value</th>
            <th className="px-4 py-3 font-medium text-right">Unrealized P&amp;L</th>
          </tr>
        </thead>
        <tbody className="font-mono tnum">
          {positions.map((p) => (
            <tr key={p.symbol}
                onClick={() => onSelect && onSelect(p.symbol)}
                className="border-b border-edge/50 last:border-0 cursor-pointer hover:bg-edge/40">
              <td className="px-4 py-3 font-semibold font-sans">{p.symbol}</td>
              <td className="px-4 py-3 text-right text-gray-300">{p.shares}</td>
              <td className="px-4 py-3 text-right text-gray-400">{usd(p.avg_cost)}</td>
              <td className="px-4 py-3 text-right">{usd(p.price)}</td>
              <td className="px-4 py-3 text-right">{usd(p.market_value)}</td>
              <td className={`px-4 py-3 text-right ${toneClass(p.unrealized_pl)}`}>
                {signed(p.unrealized_pl)} <span className="text-xs">({pct(p.unrealized_pl_pct)})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockChart({ symbol }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  useEffect(() => {
    if (!symbol) return;
    let active = true;
    setLoading(true); setError(""); setData(null); setHover(null);
    api.candles(symbol)
      .then((d) => { if (active) setData(d); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [symbol]);

  if (!symbol) return null;

  // chart geometry (viewBox units)
  const W = 760, H = 340;
  const mL = 6, mR = 54, mT = 8, mB = 22;
  const priceH = 210, gap = 16, volH = 62;
  const priceTop = mT, priceBot = priceTop + priceH;
  const volTop = priceBot + gap, volBot = volTop + volH;
  const plotW = W - mL - mR;

  let body = null;
  if (data?.candles?.length) {
    const c = data.candles;
    const n = c.length;
    const lows = Math.min(...c.map((d) => d.low));
    const highs = Math.max(...c.map((d) => d.high));
    const maxVol = Math.max(...c.map((d) => d.volume)) || 1;
    const pad = (highs - lows) * 0.05 || 1;
    const pMin = lows - pad, pMax = highs + pad;
    const stepX = plotW / n;
    const cw = Math.max(1, stepX * 0.6);
    const yP = (v) => priceBot - ((v - pMin) / (pMax - pMin)) * priceH;
    const yV = (v) => volBot - (v / maxVol) * volH;
    const xC = (i) => mL + (i + 0.5) * stepX;

    const shown = hover != null ? c[hover] : c[c.length - 1];
    const up = "#22c55e", down = "#ef4444", grid = "#1f2937", axis = "#6b7280";

    const gridVals = [pMax, (pMax + pMin) / 2, pMin];
    const dateIdx = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];

    body = (
      <>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2 text-sm">
          <span className="font-semibold">{data.symbol}</span>
          <span className="font-mono tnum text-gray-300">
            O <span className="text-white">{shown.open.toFixed(2)}</span>{"  "}
            H <span className="text-white">{shown.high.toFixed(2)}</span>{"  "}
            L <span className="text-white">{shown.low.toFixed(2)}</span>{"  "}
            C <span className="text-white">{shown.close.toFixed(2)}</span>{"  "}
            Vol <span className="text-white">{(shown.volume / 1e6).toFixed(1)}M</span>
          </span>
          <span className={`font-mono tnum text-xs ${toneClass(data.period_change)}`}>
            {data.period_change >= 0 ? "+" : ""}{data.period_change} ({pct(data.period_change_pct)}) · {n}d
          </span>
          <span className="text-xs text-gray-500 ml-auto">{shown.date}</span>
        </div>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full select-none"
          onMouseMove={(e) => {
            const rect = svgRef.current.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * W;
            const i = Math.round((x - mL) / stepX - 0.5);
            if (i >= 0 && i < n) setHover(i);
          }}
          onMouseLeave={() => setHover(null)}
        >
          {gridVals.map((v, k) => (
            <g key={k}>
              <line x1={mL} x2={W - mR} y1={yP(v)} y2={yP(v)} stroke={grid} strokeWidth="1" />
              <text x={W - mR + 4} y={yP(v) + 3} fill={axis} fontSize="10" fontFamily="monospace">
                {v.toFixed(1)}
              </text>
            </g>
          ))}
          {c.map((d, i) => {
            const color = d.close >= d.open ? up : down;
            const yHi = yP(d.high), yLo = yP(d.low);
            const yO = yP(d.open), yCl = yP(d.close);
            const top = Math.min(yO, yCl);
            const hgt = Math.max(1, Math.abs(yCl - yO));
            return (
              <g key={i}>
                <line x1={xC(i)} x2={xC(i)} y1={yHi} y2={yLo} stroke={color} strokeWidth="1" />
                <rect x={xC(i) - cw / 2} y={top} width={cw} height={hgt} fill={color} />
                <rect x={xC(i) - cw / 2} y={yV(d.volume)} width={cw} height={volBot - yV(d.volume)}
                      fill={color} opacity="0.4" />
              </g>
            );
          })}
          {hover != null && (
            <line x1={xC(hover)} x2={xC(hover)} y1={priceTop} y2={volBot}
                  stroke="#eab308" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
          )}
          {dateIdx.map((i) => (
            <text key={i} x={xC(i)} y={H - 6} fill={axis} fontSize="10" fontFamily="monospace"
                  textAnchor="middle">
              {c[i].date.slice(5)}
            </text>
          ))}
        </svg>
      </>
    );
  }

  return (
    <div className="bg-panel border border-edge rounded-xl p-4">
      {loading && <div className="text-gray-500 text-sm py-8 text-center">Loading {symbol} history…</div>}
      {error && !loading && (
        <div className="text-gray-500 text-sm py-8 text-center">
          Couldn't load history for {symbol} — {error}
        </div>
      )}
      {body}
    </div>
  );
}

function Portfolio({ data, refresh }) {
  const [chartSymbol, setChartSymbol] = useState(null);
  if (!data) return <div className="text-gray-500 text-sm">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total value" value={usd(data.total_value)} />
        <StatCard label="Cash" value={usd(data.cash)} />
        <StatCard label="Invested" value={usd(data.holdings_value)} />
        <StatCard label="Total P&L" value={`${signed(data.profit)} (${pct(data.profit_pct)})`}
                  tone={toneClass(data.profit)} />
      </div>
      <TradePanel onDone={refresh} onSymbol={setChartSymbol} />
      <StockChart symbol={chartSymbol} />
      <Holdings positions={data.positions} onSelect={setChartSymbol} />
    </div>
  );
}

/* ------------------------------ derivatives ------------------------------ */
function Derivatives({ refresh }) {
  const [data, setData] = useState(null);
  const [kind, setKind] = useState("FUTURE");
  const [direction, setDirection] = useState("LONG");
  const [query, setQuery] = useState("");
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState(null);
  const [leverage, setLeverage] = useState(5);
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.derivatives().then(setData).catch(() => {}), []);
  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const dirs = kind === "FUTURE" ? ["LONG", "SHORT"] : ["CALL", "PUT"];
  useEffect(() => { setDirection(kind === "FUTURE" ? "LONG" : "CALL"); }, [kind]);

  async function pickSymbol(s) {
    setSymbol(s); setPrice(null);
    try { setPrice((await api.quote(s)).price); } catch (_) {}
  }

  async function openPosition() {
    setMsg(null); setBusy(true);
    try {
      if (!symbol) throw new Error("Pick a stock first");
      const m = parseFloat(amount);
      if (!m || m <= 0) throw new Error("Enter an amount");
      await api.openDerivative({ kind: kind.toLowerCase(), direction: direction.toLowerCase(), symbol, leverage, margin: m });
      const noun = kind === "OPTION" ? "option" : "future";
      setMsg({ type: "ok", text: `Opened ${leverage}× ${direction} ${noun} on ${symbol}` });
      setAmount("");
      load(); refresh && refresh();
    } catch (e) {
      setMsg({ type: "err", text: e.message });
    } finally { setBusy(false); }
  }

  async function closePosition(id) {
    try {
      const r = await api.closeDerivative(id);
      setMsg({ type: "ok", text: `Closed — realized ${signed(r.pnl)}` });
      load(); refresh && refresh();
    } catch (e) {
      setMsg({ type: "err", text: e.message });
    }
  }

  const amountLabel = kind === "OPTION" ? "Premium" : "Margin";
  const notional = (parseFloat(amount) || 0) * leverage;

  return (
    <div className="space-y-4">
      <div className="bg-panel border border-edge rounded-xl p-4 text-xs text-gray-400 leading-relaxed">
        <span className="text-gray-200 font-medium">Leverage zone.</span>{" "}
        <span className="text-gain">Futures</span> multiply your gains and losses — if the move goes far enough against you,
        the position is <span className="text-loss">liquidated</span> and your margin is gone.{" "}
        <span className="text-gold">Options</span> cost a premium you can never lose more than, with big leveraged upside if you're right.
      </div>

      {/* open a position */}
      <div className="bg-panel border border-edge rounded-xl p-4">
        <div className="flex gap-1 mb-4 bg-ink rounded-lg p-1 w-max">
          {["FUTURE", "OPTION"].map((k) => (
            <button key={k} onClick={() => setKind(k)}
              className={`px-4 py-1.5 rounded-md text-sm ${kind === k ? "bg-edge text-white" : "text-gray-400 hover:text-gray-200"}`}>
              {k === "FUTURE" ? "Futures" : "Options"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <span className="text-xs text-gray-500">Direction</span>
            <div className="mt-1 flex gap-1">
              {dirs.map((d) => {
                const bullish = (d === "LONG" || d === "CALL");
                const on = direction === d;
                const onClass = bullish
                  ? "bg-gain/15 text-gain border-gain/40"
                  : "bg-loss/15 text-loss border-loss/40";
                return (
                  <button key={d} onClick={() => setDirection(d)}
                    className={`px-3 py-2 rounded-lg text-sm border ${
                      on ? onClass : "border-edge text-gray-400 hover:border-gray-500"
                    }`}>
                    {d[0] + d.slice(1).toLowerCase()}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="text-xs text-gray-500">Underlying</span>
            <SymbolSearch value={query} onChange={setQuery} onPick={pickSymbol} width="w-56" />
          </div>

          {price != null && (
            <div className="font-mono tnum text-sm text-gray-300 pb-2">{symbol} <span className="text-white">{usd(price)}</span></div>
          )}

          <div>
            <span className="text-xs text-gray-500">Leverage</span>
            <select value={leverage} onChange={(e) => setLeverage(Number(e.target.value))}
              className="mt-1 block bg-ink border border-edge rounded-lg px-3 py-2 text-sm outline-none focus:border-gold">
              {[2, 3, 5, 10, 20].map((l) => <option key={l} value={l}>{l}×</option>)}
            </select>
          </div>

          <div>
            <span className="text-xs text-gray-500">{amountLabel} ($)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000"
              className="mt-1 w-28 bg-ink border border-edge rounded-lg px-3 py-2 text-sm font-mono tnum outline-none focus:border-gold" />
          </div>

          <button onClick={openPosition} disabled={busy}
            className="px-5 py-2 rounded-lg bg-gold text-ink text-sm font-semibold hover:brightness-110 disabled:opacity-50">
            Open
          </button>
        </div>

        {notional > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            Controls <span className="font-mono text-gray-300">{usd(notional)}</span> of exposure
            {amountLabel === "Premium" ? " · max loss is your premium" : ` · liquidates if ${symbol || "it"} moves ~${(100 / leverage).toFixed(1)}% against you`}
          </p>
        )}
        {msg && <p className={`mt-3 text-sm ${msg.type === "ok" ? "text-gain" : "text-loss"}`}>{msg.text}</p>}
      </div>

      {/* open positions */}
      {data?.open?.length > 0 && (
        <div className="bg-panel border border-edge rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-edge">
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium text-right">Entry</th>
                <th className="px-4 py-3 font-medium text-right">Price</th>
                <th className="px-4 py-3 font-medium text-right">{"Margin/Prem."}</th>
                <th className="px-4 py-3 font-medium text-right">Value</th>
                <th className="px-4 py-3 font-medium text-right">P&amp;L</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="font-mono tnum">
              {data.open.map((p) => {
                const dirTone = (p.direction === "LONG" || p.direction === "CALL") ? "text-gain" : "text-loss";
                const danger = p.kind === "FUTURE" && p.value <= p.margin * 0.25;
                return (
                  <tr key={p.id} className="border-b border-edge/50 last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-sans font-semibold">{p.symbol}</span>{" "}
                      <span className={`text-xs ${dirTone}`}>{p.leverage}× {p.direction}</span>{" "}
                      <span className="text-xs text-gray-500">{p.kind === "OPTION" ? "opt" : "fut"}</span>
                      {danger && <span className="ml-2 text-xs text-loss">⚠ near liquidation</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400">{usd(p.entry_price)}</td>
                    <td className="px-4 py-3 text-right">{p.price != null ? usd(p.price) : "—"}</td>
                    <td className="px-4 py-3 text-right text-gray-400">{usd(p.margin)}</td>
                    <td className="px-4 py-3 text-right">{usd(p.value)}</td>
                    <td className={`px-4 py-3 text-right ${toneClass(p.pnl)}`}>
                      {signed(p.pnl)} <span className="text-xs">({pct(p.pnl_pct)})</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => closePosition(p.id)}
                        className="px-3 py-1 rounded-md border border-edge text-xs hover:border-gold">Close</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* closed / liquidated history */}
      {data?.history?.length > 0 && (
        <div className="bg-panel border border-edge rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-2">History</div>
          <ul className="space-y-1 text-sm font-mono tnum">
            {data.history.map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <span className="font-sans">{h.symbol} {h.leverage}× {h.direction.toLowerCase()}</span>
                <span className={`text-xs ${h.status === "LIQUIDATED" ? "text-loss" : "text-gray-500"}`}>{h.status.toLowerCase()}</span>
                <span className={`ml-auto ${toneClass(h.realized_pnl)}`}>{signed(h.realized_pnl)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ leaderboard ------------------------------ */
function Leaderboard({ me }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let active = true;
    const load = () => api.leaderboard().then((r) => active && setRows(r)).catch(() => {});
    load();
    const id = setInterval(load, 20000);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (!rows) return <div className="text-gray-500 text-sm">Loading…</div>;
  const medal = ["🥇", "🥈", "🥉"];

  return (
    <div className="bg-panel border border-edge rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-edge">
            <th className="px-4 py-3 font-medium w-16">Rank</th>
            <th className="px-4 py-3 font-medium">Player</th>
            <th className="px-4 py-3 font-medium text-right">Portfolio value</th>
            <th className="px-4 py-3 font-medium text-right">Profit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isMe = me && r.username === me.username;
            return (
              <tr key={r.username}
                  className={`border-b border-edge/50 last:border-0 ${isMe ? "bg-gold/5" : ""}`}>
                <td className="px-4 py-3 font-mono">{medal[r.rank - 1] || r.rank}</td>
                <td className="px-4 py-3">
                  <span className={isMe ? "text-gold font-medium" : ""}>{r.display_name}</span>
                  {isMe && <span className="ml-2 text-xs text-gray-500">you</span>}
                </td>
                <td className="px-4 py-3 text-right font-mono tnum">{usd(r.total_value)}</td>
                <td className={`px-4 py-3 text-right font-mono tnum ${toneClass(r.profit)}`}>
                  {signed(r.profit)} <span className="text-xs">({pct(r.profit_pct)})</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ root ------------------------------ */
export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState("portfolio");
  const [portfolio, setPortfolio] = useState(null);

  const loadPortfolio = useCallback(() => {
    api.portfolio().then(setPortfolio).catch(() => {});
  }, []);

  const logout = () => { clearToken(); setAuthed(false); setMe(null); setPortfolio(null); };

  useEffect(() => {
    if (!authed) return;
    api.me().then(setMe).catch(logout);
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    loadPortfolio();
    const id = setInterval(loadPortfolio, 15000); // live-ish refresh
    return () => clearInterval(id);
  }, [authed, loadPortfolio]);

  if (!authed) return <AuthScreen onAuthed={() => setAuthed(true)} />;

  return (
    <div className="min-h-screen">
      <Header me={me} total={portfolio?.total_value} tab={tab} setTab={setTab} onLogout={logout} />
      <main className="max-w-5xl mx-auto px-4 py-6">
        {tab === "portfolio" && <Portfolio data={portfolio} refresh={loadPortfolio} />}
        {tab === "derivatives" && <Derivatives refresh={loadPortfolio} />}
        {tab === "leaderboard" && <Leaderboard me={me} />}
      </main>
    </div>
  );
}
