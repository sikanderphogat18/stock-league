from contextlib import asynccontextmanager
from datetime import date, datetime

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .config import settings
from .database import Base, SessionLocal, engine, get_db
from .models import DerivativePosition, Holding, Snapshot, Trade, User
from .prices import cached_price, get_candles, get_price, refresh_symbols, search_symbols
from .schemas import (
    CloseDerivativeRequest,
    LoginRequest,
    OpenDerivativeRequest,
    RegisterRequest,
    TradeRequest,
)
from .security import create_token, get_current_user, hash_password, verify_password

scheduler = BackgroundScheduler()


# ----------------------------- pricing helpers -----------------------------

def held_symbols(db: Session):
    stock_syms = [row[0] for row in db.query(Holding.symbol).distinct().all()]
    deriv_syms = [row[0] for row in db.query(DerivativePosition.symbol)
                  .filter(DerivativePosition.status == "OPEN").distinct().all()]
    return list(set(stock_syms) | set(deriv_syms))


def price_for(holding: Holding) -> float:
    price = cached_price(holding.symbol)
    if price is None:
        try:
            price = get_price(holding.symbol)
        except Exception:
            price = holding.avg_cost  # fall back to book value if the API is unreachable
    return price


def live_price(symbol: str):
    price = cached_price(symbol)
    if price is None:
        try:
            price = get_price(symbol)
        except Exception:
            price = None
    return price


def gain_fraction(pos: DerivativePosition, price: float) -> float:
    """Directional return of the underlying since entry, from the position's side."""
    if pos.entry_price <= 0:
        return 0.0
    if pos.direction in ("LONG", "CALL"):
        return (price - pos.entry_price) / pos.entry_price
    return (pos.entry_price - price) / pos.entry_price  # SHORT, PUT


def position_value(pos: DerivativePosition, price: float) -> float:
    """Current cash value of an open position. Futures and options both use
    margin * (1 + leverage * gain), floored at 0 (you can't lose more than you
    posted). Futures get force-liquidated at 0; options just decay toward 0."""
    return max(0.0, pos.margin * (1 + pos.leverage * gain_fraction(pos, price)))


def settle_derivatives(db: Session, user: User) -> float:
    """Value all open positions; auto-liquidate any future whose equity hits 0.
    Returns the total current value of the user's open derivatives."""
    total = 0.0
    changed = False
    for pos in user.derivatives:
        if pos.status != "OPEN":
            continue
        price = live_price(pos.symbol)
        if price is None:
            total += pos.margin  # can't value right now; treat as break-even
            continue
        raw = pos.margin * (1 + pos.leverage * gain_fraction(pos, price))
        if pos.kind == "FUTURE" and raw <= 0:
            pos.status = "LIQUIDATED"
            pos.close_price = price
            pos.closed_at = datetime.utcnow()
            pos.realized_pnl = -pos.margin
            changed = True  # value contributed is 0
        else:
            total += max(0.0, raw)
    if changed:
        db.commit()
    return total


def portfolio_payload(user: User, db: Session) -> dict:
    positions = []
    holdings_value = 0.0
    for h in user.holdings:
        price = price_for(h)
        market_value = h.shares * price
        cost_basis = h.shares * h.avg_cost
        holdings_value += market_value
        positions.append({
            "symbol": h.symbol,
            "shares": round(h.shares, 4),
            "avg_cost": round(h.avg_cost, 4),
            "price": round(price, 4),
            "market_value": round(market_value, 2),
            "unrealized_pl": round(market_value - cost_basis, 2),
            "unrealized_pl_pct": round((market_value - cost_basis) / cost_basis * 100, 2) if cost_basis else 0.0,
        })
    positions.sort(key=lambda p: p["market_value"], reverse=True)
    derivatives_value = settle_derivatives(db, user)
    total = user.cash + holdings_value + derivatives_value
    profit = total - settings.starting_capital
    return {
        "cash": round(user.cash, 2),
        "holdings_value": round(holdings_value, 2),
        "derivatives_value": round(derivatives_value, 2),
        "total_value": round(total, 2),
        "starting_capital": settings.starting_capital,
        "profit": round(profit, 2),
        "profit_pct": round(profit / settings.starting_capital * 100, 2),
        "positions": positions,
    }


# ----------------------------- background jobs -----------------------------

def refresh_all_prices():
    db = SessionLocal()
    try:
        symbols = held_symbols(db)
        if symbols:
            refresh_symbols(symbols)
    finally:
        db.close()


def take_snapshots():
    db = SessionLocal()
    try:
        refresh_symbols(held_symbols(db))
        today = date.today()
        for user in db.query(User).all():
            total = user.cash + sum(
                h.shares * (cached_price(h.symbol) or h.avg_cost) for h in user.holdings
            )
            existing = db.query(Snapshot).filter_by(user_id=user.id, date=today).first()
            if existing:
                existing.value = total
            else:
                db.add(Snapshot(user_id=user.id, date=today, value=total))
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    scheduler.add_job(refresh_all_prices, "interval", seconds=settings.price_refresh_seconds, id="refresh")
    scheduler.add_job(take_snapshots, "cron", hour=settings.snapshot_hour_utc, minute=0, id="snapshot")
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Stock League API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------- auth ------------------------------------

@app.post("/api/auth/register")
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    if settings.league_invite_code and body.invite_code != settings.league_invite_code:
        raise HTTPException(403, "Invalid invite code")
    username = body.username.strip().lower()
    if not username or not body.password:
        raise HTTPException(400, "Username and password are required")
    if db.query(User).filter_by(username=username).first():
        raise HTTPException(400, "That username is already taken")
    user = User(
        username=username,
        display_name=body.display_name.strip() or username,
        password_hash=hash_password(body.password),
        cash=settings.starting_capital,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"access_token": create_token(user.id), "token_type": "bearer"}


@app.post("/api/auth/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(username=body.username.strip().lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Wrong username or password")
    return {"access_token": create_token(user.id), "token_type": "bearer"}


@app.get("/api/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "username": user.username, "display_name": user.display_name}


# --------------------------------- market ----------------------------------

@app.get("/api/search")
def search(q: str = Query(..., min_length=1), _: User = Depends(get_current_user)):
    try:
        return search_symbols(q)
    except Exception as exc:
        raise HTTPException(400, f"Search failed: {exc}")


@app.get("/api/quote")
def quote(symbol: str = Query(...), _: User = Depends(get_current_user)):
    try:
        price = get_price(symbol)
    except Exception as exc:
        raise HTTPException(400, f"Could not get a price for '{symbol.upper()}': {exc}")
    return {"symbol": symbol.upper(), "price": round(price, 4)}


@app.get("/api/candles")
def candles(symbol: str = Query(...), _: User = Depends(get_current_user)):
    try:
        data = get_candles(symbol)
    except Exception as exc:
        raise HTTPException(400, f"No history for '{symbol.upper()}': {exc}")
    first_close = data[0]["close"]
    last_close = data[-1]["close"]
    return {
        "symbol": symbol.upper(),
        "candles": data,
        "latest": data[-1],
        "period_change": round(last_close - first_close, 2),
        "period_change_pct": round((last_close - first_close) / first_close * 100, 2) if first_close else 0.0,
    }


@app.post("/api/trade/buy")
def buy(body: TradeRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.shares <= 0:
        raise HTTPException(400, "Shares must be a positive number")
    symbol = body.symbol.strip().upper()
    try:
        price = get_price(symbol)
    except Exception as exc:
        raise HTTPException(400, f"Could not get a price for '{symbol}': {exc}")
    cost = body.shares * price
    if cost > user.cash:
        raise HTTPException(400, f"Not enough cash: this costs ${cost:,.2f}, you have ${user.cash:,.2f}")
    user.cash -= cost
    holding = db.query(Holding).filter_by(user_id=user.id, symbol=symbol).first()
    if holding:
        new_total = holding.shares + body.shares
        holding.avg_cost = (holding.shares * holding.avg_cost + cost) / new_total
        holding.shares = new_total
    else:
        db.add(Holding(user_id=user.id, symbol=symbol, shares=body.shares, avg_cost=price))
    db.add(Trade(user_id=user.id, symbol=symbol, side="BUY", shares=body.shares, price=price))
    db.commit()
    return {"ok": True, "symbol": symbol, "shares": body.shares, "price": round(price, 4), "cost": round(cost, 2)}


@app.post("/api/trade/sell")
def sell(body: TradeRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.shares <= 0:
        raise HTTPException(400, "Shares must be a positive number")
    symbol = body.symbol.strip().upper()
    holding = db.query(Holding).filter_by(user_id=user.id, symbol=symbol).first()
    if not holding or holding.shares + 1e-9 < body.shares:
        owned = holding.shares if holding else 0
        raise HTTPException(400, f"You only own {owned} shares of {symbol}")
    try:
        price = get_price(symbol)
    except Exception as exc:
        raise HTTPException(400, f"Could not get a price for '{symbol}': {exc}")
    proceeds = body.shares * price
    user.cash += proceeds
    holding.shares -= body.shares
    if holding.shares <= 1e-9:
        db.delete(holding)
    db.add(Trade(user_id=user.id, symbol=symbol, side="SELL", shares=body.shares, price=price))
    db.commit()
    return {"ok": True, "symbol": symbol, "shares": body.shares, "price": round(price, 4), "proceeds": round(proceeds, 2)}


# ------------------------------- portfolio ---------------------------------

@app.get("/api/portfolio")
def portfolio(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return portfolio_payload(user, db)


@app.get("/api/trades")
def trades(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Trade).filter_by(user_id=user.id).order_by(Trade.created_at.desc()).limit(100).all()
    return [
        {"symbol": t.symbol, "side": t.side, "shares": t.shares, "price": round(t.price, 4),
         "at": t.created_at.isoformat()}
        for t in rows
    ]


@app.get("/api/leaderboard")
def leaderboard(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    board = []
    for user in db.query(User).all():
        payload = portfolio_payload(user, db)
        board.append({
            "display_name": user.display_name,
            "username": user.username,
            "total_value": payload["total_value"],
            "profit": payload["profit"],
            "profit_pct": payload["profit_pct"],
        })
    board.sort(key=lambda row: row["total_value"], reverse=True)
    for rank, row in enumerate(board, start=1):
        row["rank"] = rank
    return board


@app.get("/api/derivatives")
def list_derivatives(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    settle_derivatives(db, user)  # refresh marks and liquidate any busted futures
    open_positions, history = [], []
    for pos in sorted(user.derivatives, key=lambda p: p.opened_at, reverse=True):
        if pos.status == "OPEN":
            price = live_price(pos.symbol)
            value = position_value(pos, price) if price is not None else pos.margin
            open_positions.append({
                "id": pos.id,
                "kind": pos.kind,
                "direction": pos.direction,
                "symbol": pos.symbol,
                "leverage": pos.leverage,
                "entry_price": round(pos.entry_price, 4),
                "price": round(price, 4) if price is not None else None,
                "margin": round(pos.margin, 2),
                "notional": round(pos.margin * pos.leverage, 2),
                "value": round(value, 2),
                "pnl": round(value - pos.margin, 2),
                "pnl_pct": round((value - pos.margin) / pos.margin * 100, 2) if pos.margin else 0.0,
            })
        else:
            history.append({
                "id": pos.id,
                "kind": pos.kind,
                "direction": pos.direction,
                "symbol": pos.symbol,
                "leverage": pos.leverage,
                "margin": round(pos.margin, 2),
                "status": pos.status,
                "realized_pnl": round(pos.realized_pnl or 0.0, 2),
                "closed_at": pos.closed_at.isoformat() if pos.closed_at else None,
            })
    return {"open": open_positions, "history": history[:20]}


@app.post("/api/derivatives/open")
def open_derivative(body: OpenDerivativeRequest, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    kind = body.kind.strip().upper()
    direction = body.direction.strip().upper()
    allowed = {"FUTURE": ("LONG", "SHORT"), "OPTION": ("CALL", "PUT")}
    if kind not in allowed:
        raise HTTPException(400, "kind must be 'future' or 'option'")
    if direction not in allowed[kind]:
        raise HTTPException(400, f"{kind.title()} direction must be one of {allowed[kind]}")
    if not (1 <= body.leverage <= 20):
        raise HTTPException(400, "Leverage must be between 1x and 20x")
    if body.margin <= 0:
        raise HTTPException(400, "Amount must be positive")
    if body.margin > user.cash:
        raise HTTPException(400, f"Not enough cash: need ${body.margin:,.2f}, have ${user.cash:,.2f}")
    symbol = body.symbol.strip().upper()
    try:
        price = get_price(symbol)
    except Exception as exc:
        raise HTTPException(400, f"Could not get a price for '{symbol}': {exc}")
    user.cash -= body.margin
    pos = DerivativePosition(
        user_id=user.id, kind=kind, direction=direction, symbol=symbol,
        leverage=body.leverage, entry_price=price, margin=body.margin,
        status="OPEN", opened_at=datetime.utcnow(),
    )
    db.add(pos)
    db.commit()
    db.refresh(pos)
    return {"ok": True, "id": pos.id, "kind": kind, "direction": direction, "symbol": symbol,
            "entry_price": round(price, 4), "notional": round(body.margin * body.leverage, 2)}


@app.post("/api/derivatives/close")
def close_derivative(body: CloseDerivativeRequest, user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    pos = db.get(DerivativePosition, body.position_id)
    if not pos or pos.user_id != user.id:
        raise HTTPException(404, "Position not found")
    if pos.status != "OPEN":
        raise HTTPException(400, "Position is already closed")
    try:
        price = get_price(pos.symbol)
    except Exception as exc:
        raise HTTPException(400, f"Could not get a price for '{pos.symbol}': {exc}")
    value = position_value(pos, price)
    user.cash += value
    pos.status = "CLOSED"
    pos.close_price = price
    pos.closed_at = datetime.utcnow()
    pos.realized_pnl = value - pos.margin
    db.commit()
    return {"ok": True, "value": round(value, 2), "pnl": round(value - pos.margin, 2)}


@app.get("/api/history")
def history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Snapshot).filter_by(user_id=user.id).order_by(Snapshot.date).all()
    return [{"date": s.date.isoformat(), "value": round(s.value, 2)} for s in rows]


@app.get("/")
def root():
    return {"status": "ok", "service": "Stock League API"}
