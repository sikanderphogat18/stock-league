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
            {[["portfolio", "Portfolio"], ["leaderboard", "Leaderboard"]].map(([k, label]) => (
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
function StatCard({ label, value, tone }) {
  return (
    <div className="bg-panel border border-edge rounded-xl p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 font-mono tnum text-xl ${tone || "text-white"}`}>{value}</div>
    </div>
  );
}

function TradePanel({ onDone }) {
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

function Holdings({ positions }) {
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
            <tr key={p.symbol} className="border-b border-edge/50 last:border-0">
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

function Portfolio({ data, refresh }) {
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
      <TradePanel onDone={refresh} />
      <Holdings positions={data.positions} />
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
        {tab === "portfolio"
          ? <Portfolio data={portfolio} refresh={loadPortfolio} />
          : <Leaderboard me={me} />}
      </main>
    </div>
  );
}
