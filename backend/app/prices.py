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


def refresh_symbols(symbols) -> None:
    """Refresh a batch of symbols; used by the background scheduler."""
    for symbol in set(s.upper() for s in symbols):
        try:
            price = _fetch(symbol)
            with _lock:
                _cache[symbol] = (price, time.time())
        except Exception:
            pass  # keep the last known price on a transient failure
