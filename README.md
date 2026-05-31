# Trading Journal

A local web app for tracking your daily trading P/L with a calendar view, cumulative chart, and Fidelity CSV import.

## Quick Start

```bash
cd trading-journal
npm install
npm start
```

Then open **http://localhost:5000** in your browser.

## Features

- **Calendar View** — See daily P/L at a glance (green = profit, red = loss). Click any date to add/edit.
- **Cumulative P/L Chart** — Line chart showing total, stocks-only, and options-only cumulative P/L.
- **Stats Dashboard** — Total P/L, stock vs options breakdown, win rate, best/worst day, weekly/monthly totals.
- **Manual Entry** — Quick form to enter daily stock and options P/L.
- **CSV Import** — Import from Fidelity or a simple CSV format.

## Importing from Fidelity

### Option 1: Realized Gain/Loss (Recommended)
1. Log into Fidelity → **Accounts** → **Tax Forms & Information**
2. Click **Realized Gain/Loss**
3. Select date range → **Download** as CSV
4. In the app, click **Import CSV** → select the file → **Preview** → **Import**

### Option 2: Activity & Orders
1. Fidelity → **Accounts** → **Activity & Orders**
2. Click **History** → set date range → **Download**
3. Import the CSV (note: this gives cash flow, not exact P/L)

### Option 3: Simple CSV
Create a CSV with these columns:
```csv
Date,Stock P/L,Options P/L,Notes
05/29/2026,150.50,-45.25,AAPL calls expired
05/28/2026,-75.00,220.00,SPY puts printed
```

## Data

All data is stored locally in `trading_journal.db` (SQLite). No cloud, no accounts, your data stays on your machine.
