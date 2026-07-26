from contextlib import asynccontextmanager
from datetime import date

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .config import settings
from .database import Base, SessionLocal, engine, get_db
from .models import Holding, Snapshot, Trade, User
from .prices import cached_price, get_price, refresh_symbols, search_symbols
from .schemas import LoginRequest, RegisterRequest, TradeRequest
from .security import create_token, get_current_user, hash_password, verify_password

scheduler = BackgroundScheduler()


# ----------------------------- pricing helpers -----------------------------

def held_symbols(db: Session):
    return [row[0] for row in db.query(Holding.symbol).distinct().all()]


def price_for(holding: Holding) -> float:
    price = cached_price(holding.symbol)
    if price is None:
        try:
            price = get_price(holding.symbol)
        except Exception:
            price = holding.avg_cost  # fall back to book value if the API is unreachable
    return price


def portfolio_payload(user: User) -> dict:
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
    total = user.cash + holdings_value
    profit = total - settings.starting_capital
    return {
        "cash": round(user.cash, 2),
        "holdings_value": round(holdings_value, 2),
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
def portfolio(user: User = Depends(get_current_user)):
    return portfolio_payload(user)


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
        payload = portfolio_payload(user)
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


@app.get("/api/history")
def history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Snapshot).filter_by(user_id=user.id).order_by(Snapshot.date).all()
    return [{"date": s.date.isoformat(), "value": round(s.value, 2)} for s in rows]


@app.get("/")
def root():
    return {"status": "ok", "service": "Stock League API"}
