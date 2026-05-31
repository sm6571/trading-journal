# Trading Journal — Project Init

> Reference doc for iterating on this project. Covers architecture, stack, data model, API surface, and deployment.

## Overview

A personal web app for tracking daily trading P/L. Supports manual entry, Fidelity/Robinhood CSV import, and provides a calendar view, cumulative chart, and stats dashboard. Hosted on Azure App Service (Node 22 LTS).

**Live URL:** `https://satyajit-trading-journal-egfsexasgwf6baf5.westus3-01.azurewebsites.net`

---

## Tech Stack

| Layer      | Technology                         |
|------------|------------------------------------|
| Runtime    | Node.js 22 LTS                     |
| Framework  | Express 5.x                        |
| Database   | SQLite via `sql.js` (in-memory, persisted to file) |
| Auth       | `bcryptjs` + `express-session` (cookie-based) |
| File Upload| `multer` (memory storage, 10 MB limit) |
| CSV Parsing| `csv-parse` (sync mode)            |
| Security   | `express-rate-limit` (5 req/15 min on auth), HTTPS redirect |
| Frontend   | Vanilla JS + CSS (no framework)    |
| Hosting    | Azure App Service (Linux, West US 3) |

---

## File Structure

```
trading-journal/
├── app.js              # Express server — routes, middleware, auth
├── database.js         # sql.js wrapper (mimics better-sqlite3 API), schema init
├── csv-parser.js       # CSV import logic (Fidelity, Robinhood, simple formats)
├── package.json        # Dependencies & scripts
├── static/
│   ├── css/style.css   # All styles (~7 KB)
│   └── js/app.js       # Frontend logic — calendar, chart, forms (~34 KB)
├── templates/
│   ├── index.html      # Dashboard SPA shell (~18 KB)
│   └── login.html      # Login/register page (~5 KB)
├── .gitignore          # Excludes node_modules/, *.db files
└── README.md           # User-facing docs
```

---

## Database Schema

SQLite database persisted to `DB_PATH` (default: `./trading_journal.db`).  
The `database.js` wrapper auto-saves to disk every 3 seconds after writes.

### `users`
| Column     | Type    | Notes                    |
|------------|---------|--------------------------|
| id         | INTEGER | PK, autoincrement        |
| username   | TEXT    | Unique, not null         |
| password   | TEXT    | bcrypt hash              |
| created_at | TEXT    | ISO datetime             |

- **Max 2 users** enforced in app code (`MAX_USERS = 2`)

### `daily_pl`
| Column     | Type    | Notes                          |
|------------|---------|--------------------------------|
| date       | TEXT    | YYYY-MM-DD                     |
| user_id    | INTEGER | FK to users                    |
| stock_pl   | REAL    | Stock P/L for the day          |
| options_pl | REAL    | Options P/L for the day        |
| notes      | TEXT    | Free-text notes                |
| created_at | TEXT    | Auto-set                       |
| updated_at | TEXT    | Updated on upsert              |

- **PK:** `(date, user_id)`

### `trades`
| Column     | Type    | Notes                                 |
|------------|---------|---------------------------------------|
| id         | INTEGER | PK, autoincrement                     |
| user_id    | INTEGER | FK to users                           |
| date       | TEXT    | YYYY-MM-DD                            |
| symbol     | TEXT    | Ticker (uppercased)                   |
| type       | TEXT    | `'stock'` or `'option'` (CHECK)       |
| pl         | REAL    | P/L for this trade                    |
| fees       | REAL    | Commission/fees                       |
| notes      | TEXT    | Free-text                             |
| created_at | TEXT    | Auto-set                              |

- **Unique:** `(date, symbol, user_id)` — upserts aggregate P/L per symbol per day

### Indexes
- `idx_trades_date` on `trades(date)`
- `idx_trades_symbol` on `trades(symbol)`
- `idx_trades_user` on `trades(user_id)`
- `idx_daily_user` on `daily_pl(user_id)`

---

## API Routes

All routes below `/api/` require authentication (cookie session).

### Auth (public)

| Method | Path              | Description                    |
|--------|-------------------|--------------------------------|
| GET    | `/login`          | Serve login page               |
| POST   | `/auth/register`  | Create account (rate-limited)  |
| POST   | `/auth/login`     | Login (rate-limited)           |
| POST   | `/auth/logout`    | Destroy session                |
| GET    | `/auth/status`    | Check auth + setup state       |

### Daily P/L

| Method | Path                | Description                              |
|--------|---------------------|------------------------------------------|
| GET    | `/api/entries`      | List entries (optional `?start=&end=`)   |
| POST   | `/api/entries`      | Upsert daily entry `{date, stock_pl, options_pl, notes}` |
| DELETE | `/api/entries/:date`| Delete entry by date                     |

### Trades

| Method | Path             | Description                                  |
|--------|------------------|----------------------------------------------|
| GET    | `/api/trades`    | List trades (`?date=`, `?start=&end=`, `?limit=&offset=`) |
| POST   | `/api/trades`    | Upsert trade `{date, symbol, type, pl, fees, notes}` |
| PUT    | `/api/trades/:id`| Update trade by ID                           |
| DELETE | `/api/trades/:id`| Delete trade by ID                           |

### Import

| Method | Path                  | Description                         |
|--------|-----------------------|-------------------------------------|
| POST   | `/api/import`         | Import CSV (multipart file upload)  |
| POST   | `/api/import/preview` | Preview parsed CSV without saving   |

### Other

| Method | Path          | Description                      |
|--------|---------------|----------------------------------|
| GET    | `/api/stats`  | Aggregated stats (total, weekly, monthly, trade-level) |
| DELETE | `/api/clear`  | Delete all data for current user |

---

## CSV Import Formats

Auto-detected in `csv-parser.js` via `detectFormat()`:

| Format                  | Detection Heuristic                             | Key Columns                        |
|-------------------------|--------------------------------------------------|------------------------------------|
| `fidelity_realized_gl`  | Contains "realized gain" or "cost basis"+"date sold" | Date Sold, Symbol, ST/LT Gain/Loss |
| `fidelity_activity`     | Contains "run date" + "action"                   | Run Date, Action, Symbol, Amount   |
| `robinhood`             | Contains "activity date" + "trans code"          | Activity Date, Trans Code, Amount  |
| `simple`                | Fallback                                         | Date, Stock P/L, Options P/L      |

- Handles BOM stripping, tab/comma delimiter detection, header row auto-detection
- Parses money values with `$`, `,`, `()` negative notation
- Option detection via OCC symbol patterns and description keywords

---

## Environment Variables

| Variable           | Required | Default                  | Description                |
|--------------------|----------|--------------------------|----------------------------|
| `PORT`             | No       | `5000`                   | Server listen port         |
| `NODE_ENV`         | No       | —                        | Set `production` for HTTPS redirect + secure cookies |
| `SESSION_SECRET`   | Yes (prod)| Random 32-byte hex     | Express session secret     |
| `DB_PATH`          | No       | `./trading_journal.db`   | Path to SQLite file        |

---

## Azure Deployment

| Setting              | Value                                      |
|----------------------|--------------------------------------------|
| Resource Group       | `trading-journal`                          |
| App Service          | `satyajit-trading-journal`                 |
| App Service Plan     | `ASP-tradingjournal-96a3`                  |
| Region               | West US 3                                  |
| Runtime              | Node 22 LTS (Linux)                        |
| SCM                  | Kudu (no CI/CD pipeline configured)        |
| Subscription         | Satyajit Personal (`cb762779-...`)         |

The DB file lives at `/home/trading_journal.db` on the App Service filesystem (persistent across restarts but not across scale-out — single instance only).

---

## Architecture Notes

- **sql.js wrapper** (`database.js`): The app uses `sql.js` (SQLite compiled to WASM) instead of native `better-sqlite3`. The wrapper mimics the `better-sqlite3` API (`prepare().run/get/all`, `transaction()`). Writes are buffered and flushed to disk every 3 seconds via a dirty flag + timer.
- **SPA-like frontend**: `index.html` is a single template that handles all views (calendar, chart, trades, import) via vanilla JS tab switching. No build step.
- **No ORM**: All SQL is hand-written with parameterized queries.
- **Auth**: Simple username/password with bcrypt. Session stored in memory (lost on restart). Max 2 accounts.
- **Rate limiting**: Auth endpoints limited to 5 attempts per 15-minute window.

---

## Known Limitations / Improvement Ideas

- [ ] **Session store is in-memory** — sessions lost on app restart. Consider `connect-redis` or `connect-sqlite3`.
- [ ] **No CI/CD pipeline** — deploy manually or set up GitHub Actions → Azure.
- [ ] **sql.js 3-second write delay** — data could be lost on crash. Could flush on every write or use native SQLite.
- [ ] **Max 2 users hardcoded** — make configurable via env var.
- [ ] **No password reset / email** — username-only auth.
- [ ] **No CSRF protection** — consider `csurf` or `csrf-csrf` middleware.
- [ ] **Single instance only** — SQLite on local disk doesn't support horizontal scaling.
- [ ] **No test suite** — add unit tests for CSV parser and integration tests for API.
- [ ] **Frontend is a single 34 KB file** — could benefit from component extraction.
