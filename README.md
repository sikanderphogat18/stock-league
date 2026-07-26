# 📈 Stock League

A private, virtual stock-trading competition for you and your friends. Everyone
starts with the same amount of fake cash, buys and sells **real stocks at live
prices**, and a leaderboard ranks everyone by total profit.

- **Live prices** from Finnhub (free tier)
- **Same starting capital** for every player (default $100,000)
- **Buy / sell** with cash + share checks, average-cost tracking
- **Portfolio** view with per-position unrealized P&L
- **Leaderboard** ranked by portfolio value / profit
- **Daily snapshots** of everyone's value (for a performance chart later)
- **Invite code** so only your friends can join

Stack: **FastAPI + SQLite** (backend) · **React + Tailwind + Vite** (frontend).

---

## How the 10 of you actually use this

The backend + database is **one shared instance** that everyone connects to.
So **one person** (probably you) hosts the backend, and everyone points their
frontend at it. You do *not* each run your own copy of the database.

Two ways to run it:
1. **Local (for testing):** run backend + frontend on your machine.
2. **Hosted (for the real league):** deploy the backend once, deploy the
   frontend once, share the link. See *Deploying* below.

---

## 1. Get a free Finnhub API key

Sign up at https://finnhub.io/register and copy your API key. The free tier
gives real-time US quotes at 60 calls/min — plenty here, because the app only
ever polls the tickers people actually hold.

## 2. Run the backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env               # then edit .env:
#   FINNHUB_API_KEY  = your key
#   JWT_SECRET       = python -c "import secrets; print(secrets.token_hex(32))"
#   LEAGUE_INVITE_CODE = a code you share only with your 9 friends

uvicorn app.main:app --reload      # runs on http://localhost:8000
```

API docs auto-generated at http://localhost:8000/docs

## 3. Run the frontend

```bash
cd frontend
npm install
cp .env.example .env               # VITE_API_URL defaults to http://localhost:8000
npm run dev                        # runs on http://localhost:5173
```

Open http://localhost:5173, sign up with the invite code, and start trading.

---

## Deploying (so your friends can join from anywhere)

- **Backend** → Render, Railway, or Fly.io. Set the same env vars from `.env`.
  Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
  Note: SQLite resets on some free hosts' redeploys — attach a persistent
  volume, or switch `DATABASE_URL` to a free Postgres (Neon/Supabase) once
  you're ready. SQLAlchemy handles both; only the URL changes.
- **Frontend** → Vercel or Netlify. Set `VITE_API_URL` to your backend's URL,
  and add that frontend URL to the backend's `CORS_ORIGINS`.

Then just share the frontend link + the invite code with your friends.

---

## How it works

- **Prices** (`app/prices.py`): quotes are cached in memory; trades use a fresh
  price, and a background job refreshes held tickers every 60s so views stay
  live without an API call per page load.
- **Trades** (`app/main.py`): buys check cash, sells check share count, and
  average cost is recomputed on each buy.
- **Portfolio value** = cash + Σ(shares × current price).
  **Profit** = total value − starting capital → the leaderboard sort key.
- **Snapshots**: a daily cron records everyone's value so you can add a
  "performance over time" chart (data is exposed at `GET /api/history`).

## API reference

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/register` | Join (needs invite code) |
| POST | `/api/auth/login` | Log in |
| GET | `/api/me` | Current player |
| GET | `/api/quote?symbol=AAPL` | Live price |
| POST | `/api/trade/buy` | Buy `{symbol, shares}` |
| POST | `/api/trade/sell` | Sell `{symbol, shares}` |
| GET | `/api/portfolio` | Your holdings + P&L |
| GET | `/api/trades` | Your trade history |
| GET | `/api/leaderboard` | Everyone, ranked |
| GET | `/api/history` | Your daily value snapshots |

## Ideas to extend

- Performance-over-time chart from `/api/history`
- Company name + logo on quotes (Finnhub `/stock/profile2`)
- Limit orders / short selling / options for degens
- A "trade feed" so everyone sees each other's moves
- Weekly reset or seasons
