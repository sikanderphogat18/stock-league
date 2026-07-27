# 🚀 Deploying Stock League

You host everything **once**; your friends just open a link in their browser.
Nothing gets installed on their devices.

- **Database** → Neon (free, permanent Postgres)
- **Backend** → Render (free web service, reads `render.yaml`)
- **Frontend** → Vercel (free static hosting)

Do these in order — each step needs a value from the one before.

---

## 1. Database — Neon  (~2 min)

1. Go to <https://neon.tech> and sign up (logging in with GitHub is fastest).
2. Create a project — any name, pick a region near you.
3. On the dashboard, copy the **connection string** (starts with
   `postgresql://…`). If it offers a "Pooled" string, use that one.
   Keep it handy for step 2.

Neon's free database is permanent (it just sleeps when idle), which is why we
use it instead of Render's own free database (that one is deleted after 30 days).

## 2. Backend — Render

1. Make sure your latest code (including `render.yaml` at the repo root) is
   pushed to GitHub.
2. Go to <https://render.com>, sign up, and connect your GitHub account.
3. **New → Blueprint** → select your `stock-league` repo. Render reads
   `render.yaml` and sets up the web service automatically.
4. It will prompt you for the three secret values:
   - `FINNHUB_API_KEY` → your fresh Finnhub key
   - `LEAGUE_INVITE_CODE` → e.g. `friends2026`
   - `DATABASE_URL` → paste the Neon connection string from step 1
5. Click **Apply** and wait for the build (a few minutes).
6. When it's live, copy the service URL, e.g.
   `https://stock-league-api.onrender.com`. Open it — you should see
   `{"status":"ok","service":"Stock League API"}`.

## 3. Frontend — Vercel

1. Go to <https://vercel.com>, sign up, connect GitHub.
2. **Add New → Project** → import your `stock-league` repo.
3. Set **Root Directory** to `frontend` (framework auto-detects as Vite).
4. Add an **Environment Variable**:
   - `VITE_API_URL` = your Render backend URL from step 2.6
5. **Deploy.** You'll get a URL like `https://stock-league.vercel.app`.

## 4. Play

Share the **Vercel link + invite code** with your 9 friends. Everyone signs up
and starts trading against the same live market. 🎉

---

## Good to know

- **First load can be slow.** Render's free backend sleeps after 15 minutes of
  no traffic; the next visit takes ~1 minute to wake it up, then it's fast.
- **Tightening CORS (optional).** It's set to `*` for simplicity. To restrict
  the API to only your site, set `CORS_ORIGINS` on Render to your Vercel URL.
- **Switching the database later** needs no code change — just update
  `DATABASE_URL`. The app handles `postgres://`, `postgresql://`, and `sqlite://`.
- **Updating the app.** Push to GitHub and both Render and Vercel redeploy
  automatically.
