const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const getToken = () => localStorage.getItem("token");
export const setToken = (t) => localStorage.setItem("token", t);
export const clearToken = () => localStorage.removeItem("token");

async function req(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const t = getToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch (_) {}
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  register: (d) => req("/api/auth/register", { method: "POST", body: d, auth: false }),
  login: (d) => req("/api/auth/login", { method: "POST", body: d, auth: false }),
  me: () => req("/api/me"),
  search: (q) => req(`/api/search?q=${encodeURIComponent(q)}`),
  quote: (symbol) => req(`/api/quote?symbol=${encodeURIComponent(symbol)}`),
  candles: (symbol) => req(`/api/candles?symbol=${encodeURIComponent(symbol)}`),
  buy: (symbol, shares) => req("/api/trade/buy", { method: "POST", body: { symbol, shares } }),
  sell: (symbol, shares) => req("/api/trade/sell", { method: "POST", body: { symbol, shares } }),
  portfolio: () => req("/api/portfolio"),
  trades: () => req("/api/trades"),
  leaderboard: () => req("/api/leaderboard"),
  derivatives: () => req("/api/derivatives"),
  openDerivative: (d) => req("/api/derivatives/open", { method: "POST", body: d }),
  closeDerivative: (id) => req("/api/derivatives/close", { method: "POST", body: { position_id: id } }),
};
