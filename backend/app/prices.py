"""Finnhub price client with a simple in-memory cache.

Buys and sells execute against a freshly fetched price. A background job
(see main.py) refreshes every held ticker every PRICE_REFRESH_SECONDS so the
portfolio and leaderboard views stay "live" without a call per page load.
The free Finnhub tier allows 60 calls/min, which is plenty for a 10-person
league because we only ever poll the union of tickers people actually hold.
"""

import threading
import time

import httpx

from .config import settings

_cache: dict[str, tuple[float, float]] = {}  # symbol -> (price, unix_ts)
_lock = threading.Lock()
_DEFAULT_MAX_AGE = 15.0  # seconds a cached price is considered fresh enough to trade on

_candle_cache: dict[str, tuple[list, float]] = {}  # symbol -> (candles, unix_ts)
_candle_lock = threading.Lock()
_CANDLE_TTL = 3600.0  # daily history barely changes intraday, so cache for an hour


def _fetch(symbol: str) -> float:
    if not settings.finnhub_api_key:
        raise RuntimeError("FINNHUB_API_KEY is not set (see backend/.env)")
    resp = httpx.get(
        "https://finnhub.io/api/v1/quote",
        params={"symbol": symbol.upper(), "token": settings.finnhub_api_key},
        timeout=10.0,
    )
    resp.raise_for_status()
    data = resp.json()
    price = data.get("c")
    if not price:  # 0 or None -> unknown / invalid symbol
        raise ValueError(f"No quote available for '{symbol.upper()}'")
    return float(price)


def get_price(symbol: str, max_age: float = _DEFAULT_MAX_AGE) -> float:
    """Return a recent price, fetching from Finnhub if the cache is stale."""
    symbol = symbol.upper()
    now = time.time()
    with _lock:
        cached = _cache.get(symbol)
    if cached and now - cached[1] <= max_age:
        return cached[0]
    price = _fetch(symbol)
    with _lock:
        _cache[symbol] = (price, now)
    return price


def cached_price(symbol: str):
    """Return the last known price without hitting the network (or None)."""
    with _lock:
        cached = _cache.get(symbol.upper())
    return cached[0] if cached else None


def search_symbols(query: str, limit: int = 8):
    """Look up tickers by company name or symbol (e.g. 'apple' -> AAPL).

    Uses Finnhub's /search endpoint and cleans the results for a US-stock game:
    drops foreign / exchange-suffixed symbols (those with '.' or ':'), and puts
    exact and prefix matches first so the obvious pick is at the top.
    """
    if not settings.finnhub_api_key:
        raise RuntimeError("FINNHUB_API_KEY is not set (see backend/.env)")
    resp = httpx.get(
        "https://finnhub.io/api/v1/search",
        params={"q": query, "token": settings.finnhub_api_key},
        timeout=10.0,
    )
    resp.raise_for_status()
    raw = resp.json().get("result", [])

    q = query.strip().upper()
    cleaned = []
    for row in raw:
        symbol = (row.get("symbol") or "").upper()
        description = row.get("description") or ""
        if not symbol or not description:
            continue
        if "." in symbol or ":" in symbol:  # skip foreign / suffixed listings
            continue
        cleaned.append({"symbol": symbol, "description": description.title(), "type": row.get("type") or ""})

    def rank(item):
        sym = item["symbol"]
        if sym == q:
            return 0
        if sym.startswith(q):
            return 1
        return 2

    cleaned.sort(key=rank)
    return cleaned[:limit]


def _parse_stooq_csv(text: str) -> list:
    """Parse Stooq's daily CSV (Date,Open,High,Low,Close,Volume) into candle dicts."""
    lines = [ln for ln in text.strip().splitlines() if ln]
    if not lines or not lines[0].lower().startswith("date"):
        return []  # empty, rate-limited, or "N/D" response
    candles = []
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 6:
            continue
        try:
            candles.append({
                "date": parts[0],
                "open": float(parts[1]),
                "high": float(parts[2]),
                "low": float(parts[3]),
                "close": float(parts[4]),
                "volume": float(parts[5]),
            })
        except ValueError:
            continue  # skip header repeats or blank cells
    return candles


def get_candles(symbol: str, days: int = 180) -> list:
    """Return the last `days` trading days of daily OHLCV for a US ticker.

    Finnhub moved historical candles behind its paid tier, so this pulls from
    Stooq's free public CSV (no key needed). Results are cached for an hour.
    """
    symbol = symbol.upper()
    now = time.time()
    with _candle_lock:
        cached = _candle_cache.get(symbol)
    if cached and now - cached[1] <= _CANDLE_TTL:
        return cached[0]

    resp = httpx.get(
        "https://stooq.com/q/d/l/",
        params={"s": f"{symbol.lower()}.us", "i": "d"},
        timeout=15.0,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    resp.raise_for_status()
    candles = _parse_stooq_csv(resp.text)
    if not candles:
        raise ValueError(f"No history available for '{symbol}'")
    candles = candles[-days:]
    with _candle_lock:
        _candle_cache[symbol] = (candles, now)
    return candles


def refresh_symbols(symbols) -> None:
    """Refresh a batch of symbols; used by the background scheduler."""
    for symbol in set(s.upper() for s in symbols):
        try:
            price = _fetch(symbol)
            with _lock:
                _cache[symbol] = (price, time.time())
        except Exception:
            pass  # keep the last known price on a transient failure
