const express = require('express');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { getDb, initDatabase } = require('./database');
const { parseCSV } = require('./csv-parser');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// HTTPS enforcement (trust Azure's proxy, redirect HTTP → HTTPS)
app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] === 'http' && process.env.NODE_ENV === 'production') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

// Rate limiting on auth endpoints (5 attempts per 15 min)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === 'production' }
}));
app.use(express.static(path.join(__dirname, 'static')));

// ── Auth helpers ──
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect('/login');
}

const MAX_USERS = 2;

function userCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM users').get().count;
}

// ── Auth routes (public) ──
app.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});

app.post('/auth/register', authLimiter, (req, res) => {
  if (userCount() >= MAX_USERS) return res.status(403).json({ error: `Registration closed — max ${MAX_USERS} accounts allowed` });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username.trim(), hash);
  req.session.userId = result.lastInsertRowid;
  req.session.username = username.trim();
  res.json({ status: 'ok' });
});

app.post('/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username?.trim());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ status: 'ok' });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ status: 'ok' });
});

app.get('/auth/status', (req, res) => {
  res.json({
    authenticated: !!(req.session && req.session.userId),
    username: req.session?.username || null,
    needsSetup: userCount() < MAX_USERS
  });
});

// ── All routes below require auth ──
app.use(requireAuth);

// Serve the dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

// Get all entries (optionally filtered by date range)
app.get('/api/entries', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const { start, end } = req.query;

  let entries;
  if (start && end) {
    entries = db.prepare('SELECT * FROM daily_pl WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date').all(uid, start, end);
  } else {
    entries = db.prepare('SELECT * FROM daily_pl WHERE user_id = ? ORDER BY date').all(uid);
  }

  res.json(entries);
});

// Create or update a daily entry
app.post('/api/entries', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const { date, stock_pl = 0, options_pl = 0, notes = '' } = req.body;

  if (!date) return res.status(400).json({ error: 'Date is required' });

  db.prepare(`
    INSERT INTO daily_pl (date, user_id, stock_pl, options_pl, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(date, user_id) DO UPDATE SET
      stock_pl = excluded.stock_pl,
      options_pl = excluded.options_pl,
      notes = excluded.notes,
      updated_at = datetime('now')
  `).run(date, uid, stock_pl, options_pl, notes);

  res.json({ status: 'ok' });
});

// Delete an entry
app.delete('/api/entries/:date', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM daily_pl WHERE date = ? AND user_id = ?').run(req.params.date, req.session.userId);
  res.json({ status: 'ok' });
});

// Import CSV
app.post('/api/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const content = req.file.buffer.toString('utf-8');
    const { entries, trades } = parseCSV(content);
    const uid = req.session.userId;

    if (entries.length === 0 && trades.length === 0) {
      return res.status(400).json({ error: 'No valid entries found in CSV' });
    }

    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO daily_pl (date, user_id, stock_pl, options_pl, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(date, user_id) DO UPDATE SET
        stock_pl = daily_pl.stock_pl + excluded.stock_pl,
        options_pl = daily_pl.options_pl + excluded.options_pl,
        notes = CASE
          WHEN daily_pl.notes = '' OR daily_pl.notes IS NULL THEN excluded.notes
          WHEN excluded.notes = '' OR excluded.notes IS NULL THEN daily_pl.notes
          ELSE daily_pl.notes || '; ' || excluded.notes
        END,
        updated_at = datetime('now')
    `);

    const upsertTrade = db.prepare(`
      INSERT INTO trades (date, user_id, symbol, type, pl, fees, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, symbol, user_id) DO UPDATE SET
        pl = trades.pl + excluded.pl,
        fees = trades.fees + excluded.fees,
        notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE trades.notes END
    `);

    let tradesImported = 0;

    const importAll = db.transaction(() => {
      for (const entry of entries) {
        upsert.run(entry.date, uid, entry.stock_pl, entry.options_pl, entry.notes || '');
      }
      for (const t of trades) {
        upsertTrade.run(t.date, uid, t.symbol, t.type, t.pl, t.fees || 0, t.notes || '');
        tradesImported++;
      }
    });

    importAll();
    res.json({ status: 'ok', count: entries.length, trades_imported: tradesImported });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Preview CSV (parse without saving)
app.post('/api/import/preview', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const content = req.file.buffer.toString('utf-8');
    const { entries, trades } = parseCSV(content);
    res.json({ entries, trades, count: entries.length, trades_count: trades.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Trades API ──

app.get('/api/trades', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const { date, start, end, limit, offset } = req.query;

  let trades;
  if (date) {
    trades = db.prepare('SELECT * FROM trades WHERE user_id = ? AND date = ? ORDER BY symbol').all(uid, date);
  } else if (start && end) {
    trades = db.prepare('SELECT * FROM trades WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, symbol').all(uid, start, end);
  } else {
    const lim = Math.min(parseInt(limit) || 200, 1000);
    const off = parseInt(offset) || 0;
    trades = db.prepare('SELECT * FROM trades WHERE user_id = ? ORDER BY date DESC, symbol LIMIT ? OFFSET ?').all(uid, lim, off);
  }

  res.json(trades);
});

app.post('/api/trades', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const { date, symbol, type, pl, fees = 0, notes = '' } = req.body;

  if (!date || !symbol || !type || pl == null) {
    return res.status(400).json({ error: 'Date, symbol, type, and P/L are required' });
  }

  const result = db.prepare(`
    INSERT INTO trades (date, user_id, symbol, type, pl, fees, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, symbol, user_id) DO UPDATE SET
      pl = excluded.pl, fees = excluded.fees, notes = excluded.notes
  `).run(date, uid, symbol.toUpperCase().trim(), type, pl, fees, notes);

  res.json({ status: 'ok', id: result.lastInsertRowid });
});

app.put('/api/trades/:id', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  const { date, symbol, type, pl, fees = 0, notes = '' } = req.body;

  db.prepare('UPDATE trades SET date=?, symbol=?, type=?, pl=?, fees=?, notes=? WHERE id=? AND user_id=?')
    .run(date, symbol.toUpperCase().trim(), type, pl, fees, notes, req.params.id, uid);

  res.json({ status: 'ok' });
});

app.delete('/api/trades/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM trades WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ status: 'ok' });
});

// Clear all data for current user
app.delete('/api/clear', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;
  db.prepare('DELETE FROM daily_pl WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM trades WHERE user_id = ?').run(uid);
  res.json({ status: 'ok' });
});

// Get summary statistics
app.get('/api/stats', (req, res) => {
  const db = getDb();
  const uid = req.session.userId;

  const stats = db.prepare(`
    SELECT
      COALESCE(SUM(stock_pl + options_pl), 0) as total_pl,
      COALESCE(SUM(stock_pl), 0) as total_stock_pl,
      COALESCE(SUM(options_pl), 0) as total_options_pl,
      COUNT(*) as total_days,
      COALESCE(SUM(CASE WHEN stock_pl + options_pl > 0 THEN 1 ELSE 0 END), 0) as winning_days,
      COALESCE(MAX(stock_pl + options_pl), 0) as best_day,
      COALESCE(MIN(stock_pl + options_pl), 0) as worst_day,
      COALESCE(AVG(stock_pl + options_pl), 0) as avg_daily_pl
    FROM daily_pl WHERE user_id = ?
  `).get(uid);

  const monthStats = db.prepare(`
    SELECT
      COALESCE(SUM(stock_pl + options_pl), 0) as month_pl,
      COUNT(*) as month_days
    FROM daily_pl
    WHERE user_id = ? AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')
  `).get(uid);

  const weekStats = db.prepare(`
    SELECT
      COALESCE(SUM(stock_pl + options_pl), 0) as week_pl
    FROM daily_pl
    WHERE user_id = ? AND date >= date('now', 'weekday 1', '-7 days')
      AND date <= date('now')
  `).get(uid);

  const tradeStats = db.prepare(`
    SELECT
      COUNT(*) as total_trades,
      COALESCE(SUM(CASE WHEN pl > 0 THEN 1 ELSE 0 END), 0) as winning_trades,
      COALESCE(SUM(pl), 0) as trades_total_pl,
      COALESCE(SUM(CASE WHEN type = 'stock' THEN pl ELSE 0 END), 0) as trades_stock_pl,
      COALESCE(SUM(CASE WHEN type = 'option' THEN pl ELSE 0 END), 0) as trades_options_pl,
      COALESCE(MAX(pl), 0) as best_trade,
      COALESCE(MIN(pl), 0) as worst_trade,
      COALESCE(AVG(pl), 0) as avg_trade_pl
    FROM trades WHERE user_id = ?
  `).get(uid);

  const totalDays = stats.total_days || 0;
  const winningDays = stats.winning_days || 0;

  res.json({
    total_pl: Math.round(stats.total_pl * 100) / 100,
    total_stock_pl: Math.round(stats.total_stock_pl * 100) / 100,
    total_options_pl: Math.round(stats.total_options_pl * 100) / 100,
    total_days: totalDays,
    winning_days: winningDays,
    win_rate: totalDays > 0 ? Math.round(winningDays / totalDays * 1000) / 10 : 0,
    best_day: Math.round(stats.best_day * 100) / 100,
    worst_day: Math.round(stats.worst_day * 100) / 100,
    avg_daily_pl: Math.round(stats.avg_daily_pl * 100) / 100,
    month_pl: Math.round(monthStats.month_pl * 100) / 100,
    month_days: monthStats.month_days || 0,
    week_pl: Math.round(weekStats.week_pl * 100) / 100,
    // Trade stats
    total_trades: tradeStats.total_trades || 0,
    winning_trades: tradeStats.winning_trades || 0,
    trade_win_rate: tradeStats.total_trades > 0
      ? Math.round(tradeStats.winning_trades / tradeStats.total_trades * 1000) / 10 : 0,
    trades_total_pl: Math.round(tradeStats.trades_total_pl * 100) / 100,
    trades_stock_pl: Math.round(tradeStats.trades_stock_pl * 100) / 100,
    trades_options_pl: Math.round(tradeStats.trades_options_pl * 100) / 100,
    best_trade: Math.round(tradeStats.best_trade * 100) / 100,
    worst_trade: Math.round(tradeStats.worst_trade * 100) / 100,
    avg_trade_pl: Math.round(tradeStats.avg_trade_pl * 100) / 100,
  });
});

const PORT = process.env.PORT || 5000;

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  Trading Journal running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
