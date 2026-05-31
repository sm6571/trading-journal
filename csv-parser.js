const { parse } = require('csv-parse/sync');

function isOptionSymbol(symbol) {
  if (!symbol) return false;
  symbol = symbol.trim();
  if (symbol.startsWith('-')) return true;
  if (/[A-Z]+\d{6}[CP]\d+/.test(symbol)) return true;
  return false;
}

function isOptionDescription(desc) {
  if (!desc) return false;
  const upper = desc.toUpperCase();
  return upper.includes('CALL') || upper.includes('PUT') ||
         /\d+\s*(C|P)\s*\(/.test(upper) || /\d{2}\/\d{2}\/\d{4}/.test(desc);
}

function cleanSymbol(symbol) {
  if (!symbol) return '';
  return symbol.trim().replace(/^-+/, '');
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  dateStr = dateStr.trim();
  let m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return dateStr;
  m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const year = parseInt(m[3]) > 50 ? '19' + m[3] : '20' + m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

function parseMoney(value) {
  if (!value || typeof value !== 'string') return 0;
  value = value.trim().replace(/[$,]/g, '').replace('(', '-').replace(')', '');
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

function round2(n) { return Math.round(n * 100) / 100; }

function findColumn(headers, ...candidates) {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  for (const candidate of candidates) {
    const idx = lowerHeaders.indexOf(candidate.toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  for (const candidate of candidates) {
    const found = headers.find(h => h.toLowerCase().includes(candidate.toLowerCase()));
    if (found) return found;
  }
  return null;
}

function detectFormat(content) {
  if (/realized\s*gain/i.test(content) || (/cost\s*basis/i.test(content) && /date\s*sold/i.test(content))) {
    return 'fidelity_realized_gl';
  }
  if (/run\s*date/i.test(content) && /action/i.test(content)) {
    return 'fidelity_activity';
  }
  if (/activity\s*date/i.test(content) && /trans\s*code/i.test(content)) {
    return 'robinhood';
  }
  return 'simple';
}

function stripBOM(content) {
  return content.replace(/^\uFEFF/, '');
}

function detectDelimiter(content) {
  const lines = content.split('\n').filter(l => l.trim());
  for (const line of lines.slice(0, 10)) {
    const tabs = (line.match(/\t/g) || []).length;
    const commas = (line.match(/,/g) || []).length;
    if (tabs > 3 && tabs > commas) return '\t';
    if (commas > 3 && commas > tabs) return ',';
  }
  return ',';
}

function findDataStart(lines) {
  const delim = detectDelimiter(lines.join('\n'));
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const cols = lines[i].split(delim).map(c => c.trim());
    if (cols.length >= 4 && cols.some(c => /date|symbol|amount|action/i.test(c))) {
      return i;
    }
  }
  return 0;
}

function parseRecords(content) {
  const lines = content.split('\n');
  const startIdx = findDataStart(lines);
  const csvContent = lines.slice(startIdx).join('\n');
  const delimiter = detectDelimiter(csvContent);
  const records = parse(csvContent, {
    columns: true, skip_empty_lines: true,
    relax_column_count: true, trim: true, delimiter
  });
  return records;
}

/* ── Fidelity Realized Gain/Loss ── */
function parseFidelityRealizedGL(content) {
  const records = parseRecords(content);
  if (records.length === 0) throw new Error('No data found in CSV');
  const headers = Object.keys(records[0]);

  const dateCol = findColumn(headers, 'Date Sold', 'Close Date', 'Sold Date');
  const symbolCol = findColumn(headers, 'Symbol');
  const descCol = findColumn(headers, 'Description', 'Security Description');
  const stGainCol = findColumn(headers, 'Gain/Loss Short Term', 'Short Term Gain/Loss', 'ST Gain/Loss');
  const ltGainCol = findColumn(headers, 'Gain/Loss Long Term', 'Long Term Gain/Loss', 'LT Gain/Loss');
  const gainCol = findColumn(headers, 'Gain/Loss ($)', 'Gain/Loss', 'Total Gain/Loss');

  if (!dateCol) throw new Error('Cannot find "Date Sold" column. Found columns: ' + headers.join(', '));

  const daily = {};
  const tickerDaily = {};

  for (const row of records) {
    const dateStr = parseDate(row[dateCol]);
    if (!dateStr) continue;

    let gl = 0;
    if (stGainCol) gl += parseMoney(row[stGainCol]);
    if (ltGainCol) gl += parseMoney(row[ltGainCol]);
    if (!stGainCol && !ltGainCol && gainCol) gl = parseMoney(row[gainCol]);

    const symbol = row[symbolCol] || '';
    const desc = row[descCol] || '';
    const isOpt = isOptionSymbol(symbol) || isOptionDescription(desc);
    const cleanSym = cleanSymbol(symbol);

    if (!daily[dateStr]) daily[dateStr] = { stock_pl: 0, options_pl: 0 };
    if (isOpt) daily[dateStr].options_pl += gl;
    else daily[dateStr].stock_pl += gl;

    if (cleanSym && gl !== 0) {
      const key = `${dateStr}|${cleanSym}`;
      if (!tickerDaily[key]) {
        tickerDaily[key] = { date: dateStr, symbol: cleanSym, type: isOpt ? 'option' : 'stock', pl: 0, fees: 0, notes: (desc || '').trim() };
      }
      tickerDaily[key].pl += gl;
    }
  }

  return {
    entries: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, stock_pl: round2(d.stock_pl), options_pl: round2(d.options_pl), notes: 'Imported from Fidelity Realized G/L' })),
    trades: Object.values(tickerDaily).map(t => ({ ...t, pl: round2(t.pl), fees: round2(t.fees) }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.symbol.localeCompare(b.symbol))
  };
}

/* ── Fidelity Activity & Orders ── */
function parseFidelityActivity(content) {
  const records = parseRecords(content);
  if (records.length === 0) throw new Error('No data found in CSV');
  const headers = Object.keys(records[0]);

  const dateCol = findColumn(headers, 'Run Date', 'Date', 'Trade Date');
  const actionCol = findColumn(headers, 'Action');
  const symbolCol = findColumn(headers, 'Symbol');
  const descCol = findColumn(headers, 'Security Description', 'Description');
  const commCol = findColumn(headers, 'Commission ($)', 'Commission');
  const feesCol = findColumn(headers, 'Fees ($)', 'Fees');
  const amountCol = findColumn(headers, 'Amount ($)', 'Amount');

  if (!dateCol) throw new Error('Cannot find date column. Found: ' + headers.join(', '));

  const daily = {};
  const tickerDaily = {};

  for (const row of records) {
    const dateStr = parseDate(row[dateCol]);
    if (!dateStr) continue;

    const action = (row[actionCol] || '').toUpperCase();
    if (!action.includes('BOUGHT') && !action.includes('SOLD')) continue;

    const rawSymbol = (row[symbolCol] || '').trim();
    const symbol = cleanSymbol(rawSymbol);
    const desc = (row[descCol] || '').trim();
    const amount = amountCol ? parseMoney(row[amountCol]) : 0;
    const comm = commCol ? Math.abs(parseMoney(row[commCol])) : 0;
    const fee = feesCol ? Math.abs(parseMoney(row[feesCol])) : 0;
    const isOpt = isOptionSymbol(rawSymbol) || isOptionDescription(desc) || isOptionDescription(action);

    if (!symbol) continue;

    // Daily P/L (net of all buy/sell amounts)
    if (!daily[dateStr]) daily[dateStr] = { stock_pl: 0, options_pl: 0 };
    if (isOpt) daily[dateStr].options_pl += amount;
    else daily[dateStr].stock_pl += amount;

    // Per-ticker per-day (net all amounts for same symbol on same day)
    const key = `${dateStr}|${symbol}`;
    if (!tickerDaily[key]) {
      tickerDaily[key] = { date: dateStr, symbol, type: isOpt ? 'option' : 'stock', pl: 0, fees: 0, notes: desc };
    }
    tickerDaily[key].pl += amount;
    tickerDaily[key].fees += comm + fee;
  }

  return {
    entries: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, stock_pl: round2(d.stock_pl), options_pl: round2(d.options_pl), notes: 'Imported from Fidelity Activity' })),
    trades: Object.values(tickerDaily).map(t => ({ ...t, pl: round2(t.pl), fees: round2(t.fees) }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.symbol.localeCompare(b.symbol))
  };
}

/* ── Robinhood ── */
function parseRobinhood(content) {
  const records = parseRecords(content);
  if (records.length === 0) throw new Error('No data found in CSV');
  const headers = Object.keys(records[0]);

  const dateCol = findColumn(headers, 'Activity Date', 'Date');
  const symbolCol = findColumn(headers, 'Instrument', 'Symbol');
  const descCol = findColumn(headers, 'Description');
  const codeCol = findColumn(headers, 'Trans Code', 'Transaction Code');
  const amountCol = findColumn(headers, 'Amount');

  if (!dateCol) throw new Error('Cannot find date column. Found: ' + headers.join(', '));

  const daily = {};
  const tickerDaily = {};

  for (const row of records) {
    const dateStr = parseDate(row[dateCol]);
    if (!dateStr) continue;

    const code = (row[codeCol] || '').toUpperCase().trim();
    // Only count trade transactions
    const isTrade = ['BUY', 'SELL', 'BTO', 'STC', 'BTC', 'STO'].includes(code);
    if (!isTrade) continue;

    const symbol = (row[symbolCol] || '').trim();
    const desc = (row[descCol] || '').trim();
    const amount = amountCol ? parseMoney(row[amountCol]) : 0;

    if (!symbol) continue;

    // BTO/STC/BTC/STO = options, Buy/Sell = stocks
    const isOpt = ['BTO', 'STC', 'BTC', 'STO'].includes(code) || isOptionDescription(desc);

    // Daily P/L (net all buy/sell amounts)
    if (!daily[dateStr]) daily[dateStr] = { stock_pl: 0, options_pl: 0 };
    if (isOpt) daily[dateStr].options_pl += amount;
    else daily[dateStr].stock_pl += amount;

    // Per-ticker per-day
    const key = `${dateStr}|${symbol}`;
    if (!tickerDaily[key]) {
      tickerDaily[key] = { date: dateStr, symbol, type: isOpt ? 'option' : 'stock', pl: 0, fees: 0, notes: desc };
    }
    tickerDaily[key].pl += amount;
  }

  return {
    entries: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, stock_pl: round2(d.stock_pl), options_pl: round2(d.options_pl), notes: 'Imported from Robinhood' })),
    trades: Object.values(tickerDaily).map(t => ({ ...t, pl: round2(t.pl), fees: round2(t.fees) }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.symbol.localeCompare(b.symbol))
  };
}

/* ── Simple CSV ── */
function parseSimpleCSV(content) {
  const delimiter = detectDelimiter(content);
  const records = parse(content, {
    columns: true, skip_empty_lines: true,
    relax_column_count: true, trim: true, delimiter
  });
  if (records.length === 0) throw new Error('No data found in CSV');
  const headers = Object.keys(records[0]);

  const dateCol = findColumn(headers, 'Date', 'Trading Date', 'Trade Date');
  const stockCol = findColumn(headers, 'Stock P/L', 'stock_pl', 'Stock PL', 'Stocks', 'Stock');
  const optionsCol = findColumn(headers, 'Options P/L', 'options_pl', 'Options PL', 'Options', 'Option');
  const notesCol = findColumn(headers, 'Notes', 'Note', 'Comments');
  const plCol = findColumn(headers, 'P/L', 'PL', 'Profit/Loss', 'Total P/L', 'Total');

  if (!dateCol) throw new Error('Cannot find Date column. Found: ' + headers.join(', '));

  const entries = [];
  for (const row of records) {
    const dateStr = parseDate(row[dateCol]);
    if (!dateStr) continue;
    let stock_pl = stockCol ? parseMoney(row[stockCol]) : 0;
    let options_pl = optionsCol ? parseMoney(row[optionsCol]) : 0;
    if (!stockCol && !optionsCol && plCol) stock_pl = parseMoney(row[plCol]);
    entries.push({
      date: dateStr,
      stock_pl: round2(stock_pl),
      options_pl: round2(options_pl),
      notes: notesCol ? (row[notesCol] || '').trim() : ''
    });
  }

  return { entries, trades: [] };
}

function parseCSV(content) {
  content = stripBOM(content);
  const format = detectFormat(content);
  switch (format) {
    case 'fidelity_realized_gl': return parseFidelityRealizedGL(content);
    case 'fidelity_activity': return parseFidelityActivity(content);
    case 'robinhood': return parseRobinhood(content);
    default: return parseSimpleCSV(content);
  }
}

module.exports = { parseCSV, detectFormat };
