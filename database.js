const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'trading_journal.db');

let db;
let SQL;

// Wrapper to match better-sqlite3 API: db.prepare(sql).run/get/all(params)
function wrapDb(rawDb) {
  function saveToFile() {
    const data = rawDb.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }

  // Auto-save every 3 seconds if dirty
  let dirty = false;
  let saveTimer = null;
  function markDirty() {
    dirty = true;
    if (!saveTimer) {
      saveTimer = setTimeout(() => {
        if (dirty) { saveToFile(); dirty = false; }
        saveTimer = null;
      }, 3000);
    }
  }

  return {
    exec(sql) { rawDb.run(sql); markDirty(); },
    prepare(sql) {
      return {
        run(...params) {
          rawDb.run(sql, params);
          markDirty();
          const lastId = rawDb.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0];
          const changes = rawDb.getRowsModified();
          return { lastInsertRowid: lastId, changes };
        },
        get(...params) {
          const stmt = rawDb.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            stmt.free();
            const row = {};
            cols.forEach((c, i) => row[c] = vals[i]);
            return row;
          }
          stmt.free();
          return undefined;
        },
        all(...params) {
          const rows = [];
          const stmt = rawDb.prepare(sql);
          stmt.bind(params);
          while (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row = {};
            cols.forEach((c, i) => row[c] = vals[i]);
            rows.push(row);
          }
          stmt.free();
          return rows;
        }
      };
    },
    transaction(fn) {
      return (...args) => {
        rawDb.run('BEGIN');
        try {
          fn(...args);
          rawDb.run('COMMIT');
          markDirty();
        } catch (e) {
          rawDb.run('ROLLBACK');
          throw e;
        }
      };
    },
    save() { saveToFile(); },
    close() { saveToFile(); rawDb.close(); }
  };
}

async function initDatabase() {
  SQL = await initSqlJs();
  let rawDb;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    rawDb = new SQL.Database(buffer);
  } else {
    rawDb = new SQL.Database();
  }

  db = wrapDb(rawDb);
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_pl (
      date TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      stock_pl REAL DEFAULT 0,
      options_pl REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (date, user_id)
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      symbol TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('stock', 'option')),
      pl REAL NOT NULL,
      fees REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, symbol, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(date);
    CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_daily_user ON daily_pl(user_id);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.save();
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

module.exports = { getDb, initDatabase };
