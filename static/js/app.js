/* ── State ── */
let calendar;
let chart, monthlyChart, dailyChart, stockOptChart, tickerChart, winRateChart;
let allEntries = [];
let allTrades = [];
let tradeSort = { col: 'date', dir: 'desc' };
let activeYear = 'all';

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
  initCalendar();
  initCharts();
  loadData();
  setupEntryFormListeners();
  setupTradeFormListeners();
  document.getElementById('tradesFilterDate').addEventListener('change', filterTrades);
  fetch('/auth/status').then(r => r.json()).then(s => {
    if (s.username) document.getElementById('navUser').textContent = s.username;
  });
});

/* ── Calendar ── */
function initCalendar() {
  const el = document.getElementById('calendar');
  calendar = new FullCalendar.Calendar(el, {
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: ''
    },
    height: 'auto',
    fixedWeekCount: false,
    dateClick(info) {
      openEntryForDate(info.dateStr);
    },
    eventClick(info) {
      info.jsEvent.preventDefault();
      openEntryForDate(info.event.startStr);
    },
    dayCellDidMount(info) {
      info.el.title = 'Click to add/edit entry';
    }
  });
  calendar.render();
}

/* ── Charts ── */
const chartColors = {
  green: '#00c853', red: '#ff1744', blue: '#448aff', orange: '#ff9100',
  purple: '#b388ff', cyan: '#18ffff', muted: '#7986cb'
};

const defaultScales = {
  x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7986cb', font: { size: 10 } } },
  y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#7986cb', font: { size: 10 }, callback: v => '$' + v.toLocaleString() } }
};

function initCharts() {
  // 1. Cumulative P/L (existing)
  chart = new Chart(document.getElementById('plChart').getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets: [
      { label: 'Total', data: [], borderColor: chartColors.green, backgroundColor: 'rgba(0,200,83,0.08)', fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2 },
      { label: 'Stocks', data: [], borderColor: chartColors.blue, borderDash: [5,3], tension: 0.35, pointRadius: 0, borderWidth: 1.5, fill: false },
      { label: 'Options', data: [], borderColor: chartColors.orange, borderDash: [5,3], tension: 0.35, pointRadius: 0, borderWidth: 1.5, fill: false }
    ]},
    options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { labels: { color: '#7986cb', boxWidth: 12, padding: 15, font: { size: 11 } } },
        tooltip: { backgroundColor: '#162036', borderColor: '#1e3054', borderWidth: 1, titleColor: '#e8eaf6', bodyColor: '#e8eaf6', padding: 10,
          callbacks: { label: ctx => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}` } } },
      scales: { x: { ...defaultScales.x, ticks: { ...defaultScales.x.ticks, maxRotation: 45 } }, y: defaultScales.y } }
  });

  // 2. Monthly P/L bar chart
  monthlyChart = new Chart(document.getElementById('monthlyChart').getContext('2d'), {
    type: 'bar',
    data: { labels: [], datasets: [{ label: 'Monthly P/L', data: [], backgroundColor: [], borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatMoney(ctx.parsed.y) } } },
      scales: defaultScales }
  });

  // 3. Daily P/L bar chart
  dailyChart = new Chart(document.getElementById('dailyChart').getContext('2d'), {
    type: 'bar',
    data: { labels: [], datasets: [{ label: 'Daily P/L', data: [], backgroundColor: [], borderRadius: 2 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatMoney(ctx.parsed.y) } } },
      scales: { x: { ...defaultScales.x, ticks: { ...defaultScales.x.ticks, maxTicksLimit: 20, maxRotation: 45 } }, y: defaultScales.y } }
  });

  // 4. Stocks vs Options doughnut
  stockOptChart = new Chart(document.getElementById('stockOptChart').getContext('2d'), {
    type: 'doughnut',
    data: { labels: ['Stocks', 'Options'], datasets: [{ data: [0, 0], backgroundColor: [chartColors.blue, chartColors.orange], borderWidth: 0, hoverOffset: 8 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { legend: { labels: { color: '#7986cb', padding: 15, font: { size: 12 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatMoney(ctx.parsed)}` } } } }
  });

  // 5. P/L by Ticker horizontal bar
  tickerChart = new Chart(document.getElementById('tickerChart').getContext('2d'), {
    type: 'bar',
    data: { labels: [], datasets: [{ label: 'P/L', data: [], backgroundColor: [], borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatMoney(ctx.parsed.x) } } },
      scales: { x: { ...defaultScales.y }, y: { ticks: { color: '#7986cb', font: { size: 11 } } } } }
  });

  // 6. Rolling Win Rate line
  winRateChart = new Chart(document.getElementById('winRateChart').getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets: [
      { label: 'Win Rate %', data: [], borderColor: chartColors.purple, backgroundColor: 'rgba(179,136,255,0.08)', fill: true, tension: 0.35, pointRadius: 2, borderWidth: 2 },
      { label: '50% line', data: [], borderColor: 'rgba(255,255,255,0.2)', borderDash: [4,4], pointRadius: 0, borderWidth: 1, fill: false }
    ]},
    options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.dataset.label === '50% line' ? '' : ctx.parsed.y.toFixed(1) + '%' } } },
      scales: { x: { ...defaultScales.x, ticks: { ...defaultScales.x.ticks, maxRotation: 45 } },
        y: { ...defaultScales.y, min: 0, max: 100, ticks: { ...defaultScales.y.ticks, callback: v => v + '%' } } } }
  });
}

/* ── Data Loading ── */
async function loadData() {
  try {
    const [entriesRes, statsRes, tradesRes] = await Promise.all([
      fetch('/api/entries'),
      fetch('/api/stats'),
      fetch('/api/trades?limit=200')
    ]);
    allEntries = await entriesRes.json();
    const stats = await statsRes.json();
    allTrades = await tradesRes.json();

    buildYearButtons();
    applyYearFilter();
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

function buildYearButtons() {
  const years = new Set();
  allEntries.forEach(e => years.add(e.date.substring(0, 4)));
  allTrades.forEach(t => years.add(t.date.substring(0, 4)));

  const container = document.getElementById('yearFilter');
  // Keep the label and "All Years" button, remove the rest
  const allBtn = container.querySelector('.year-btn');
  container.innerHTML = '';
  container.innerHTML = '<span class="text-muted small me-2">View:</span>';
  const allBtnNew = document.createElement('button');
  allBtnNew.className = 'btn btn-sm year-btn' + (activeYear === 'all' ? ' active' : '');
  allBtnNew.textContent = 'All Years';
  allBtnNew.onclick = () => setYearFilter('all');
  container.appendChild(allBtnNew);

  [...years].sort().reverse().forEach(year => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm year-btn' + (activeYear === year ? ' active' : '');
    btn.textContent = year;
    btn.onclick = () => setYearFilter(year);
    container.appendChild(btn);
  });
}

function setYearFilter(year) {
  activeYear = year;
  document.querySelectorAll('.year-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent === (year === 'all' ? 'All Years' : year));
  });
  applyYearFilter();
}

function filterByYear(items) {
  if (activeYear === 'all') return items;
  return items.filter(e => e.date.startsWith(activeYear));
}

async function applyYearFilter() {
  const entries = filterByYear(allEntries);
  const trades = filterByYear(allTrades);

  // Recompute stats for filtered data if not "all"
  let stats;
  if (activeYear === 'all') {
    stats = await fetch('/api/stats').then(r => r.json());
  } else {
    stats = computeLocalStats(entries, trades);
  }

  updateStats(stats);
  updateCalendar(entries);
  updateTradesTable(trades);

  const loadAllBtn = document.getElementById('loadAllBtn');
  if (allTrades.length >= 200 && activeYear === 'all') {
    loadAllBtn.style.display = 'inline-block';
    loadAllBtn.textContent = `Load All (showing ${allTrades.length})`;
  } else {
    loadAllBtn.style.display = 'none';
  }

  requestAnimationFrame(() => {
    updateChart(entries);
    updateMonthlyChart(entries);
    updateDailyChart(entries);
    updateStockOptChart(stats);
    updateTickerChart(trades);
    updateWinRateChart(entries);
  });
}

function computeLocalStats(entries, trades) {
  let total_stock_pl = 0, total_options_pl = 0, winning_days = 0, best_day = 0, worst_day = 0;
  entries.forEach(e => {
    const dayPl = e.stock_pl + e.options_pl;
    total_stock_pl += e.stock_pl;
    total_options_pl += e.options_pl;
    if (dayPl > 0) winning_days++;
    if (dayPl > best_day) best_day = dayPl;
    if (dayPl < worst_day) worst_day = dayPl;
  });
  const total_pl = total_stock_pl + total_options_pl;
  const total_days = entries.length;

  let total_trades = trades.length, winning_trades = 0;
  trades.forEach(t => { if (t.pl > 0) winning_trades++; });

  return {
    total_pl: round2(total_pl), total_stock_pl: round2(total_stock_pl), total_options_pl: round2(total_options_pl),
    total_days, winning_days,
    win_rate: total_days > 0 ? round2(winning_days / total_days * 100) : 0,
    best_day: round2(best_day), worst_day: round2(worst_day),
    avg_daily_pl: total_days > 0 ? round2(total_pl / total_days) : 0,
    month_pl: 0, month_days: 0, week_pl: 0,
    total_trades, winning_trades,
    trade_win_rate: total_trades > 0 ? round2(winning_trades / total_trades * 100) : 0,
    trades_total_pl: 0, trades_stock_pl: 0, trades_options_pl: 0,
    best_trade: 0, worst_trade: 0, avg_trade_pl: 0
  };
}

/* ── Stats ── */
function updateStats(s) {
  setPLValue('totalPL', s.total_pl);
  setPLValue('stockPL', s.total_stock_pl);
  setPLValue('optionsPL', s.total_options_pl);
  setPLValue('monthPL', s.month_pl);
  setPLValue('weekPL', s.week_pl);
  setPLValue('bestDay', s.best_day);
  setPLValue('worstDay', s.worst_day);
  setPLValue('avgDay', s.avg_daily_pl);

  // Trade win rate (main stat card)
  const wr = document.getElementById('winRate');
  wr.textContent = s.trade_win_rate + '%';
  wr.className = 'stat-value ' + (s.total_trades === 0 ? 'text-neutral' : s.trade_win_rate >= 50 ? 'text-profit' : 'text-loss');
  const wrSub = document.getElementById('winRateSub');
  wrSub.textContent = s.total_trades > 0 ? `${s.winning_trades}W / ${s.total_trades - s.winning_trades}L` : 'No trades yet';

  // Day win rate (under chart)
  const dwr = document.getElementById('dayWinRate');
  dwr.textContent = s.win_rate + '%';
  dwr.className = 'stat-value-sm ' + (s.total_days === 0 ? 'text-neutral' : s.win_rate >= 50 ? 'text-profit' : 'text-loss');
}

function setPLValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = formatMoney(value);
  el.className = el.className.replace(/text-(profit|loss|neutral)/g, '').trim();
  el.classList.add(value > 0 ? 'text-profit' : value < 0 ? 'text-loss' : 'text-neutral');
}

/* ── Calendar Update ── */
function updateCalendar(entries) {
  calendar.getEvents().forEach(e => e.remove());
  entries.forEach(entry => {
    const total = entry.stock_pl + entry.options_pl;
    calendar.addEvent({
      title: formatMoneyShort(total),
      start: entry.date,
      allDay: true,
      color: total > 0 ? '#00c853' : total < 0 ? '#ff1744' : '#546e7a',
      textColor: '#fff'
    });
  });
}

/* ── Chart Update ── */
function updateChart(entries) {
  if (entries.length === 0) {
    chart.data.labels = [];
    chart.data.datasets.forEach(ds => ds.data = []);
    chart.update();
    return;
  }

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const labels = [];
  const totalData = [];
  const stockData = [];
  const optionsData = [];
  let cumTotal = 0, cumStock = 0, cumOptions = 0;

  sorted.forEach(e => {
    cumTotal += e.stock_pl + e.options_pl;
    cumStock += e.stock_pl;
    cumOptions += e.options_pl;
    labels.push(e.date);
    totalData.push(round2(cumTotal));
    stockData.push(round2(cumStock));
    optionsData.push(round2(cumOptions));
  });

  chart.data.labels = labels;
  chart.data.datasets[0].data = totalData;
  chart.data.datasets[1].data = stockData;
  chart.data.datasets[2].data = optionsData;

  // Color the main line based on final value
  const finalColor = cumTotal >= 0 ? '#00c853' : '#ff1744';
  chart.data.datasets[0].borderColor = finalColor;
  chart.data.datasets[0].backgroundColor = cumTotal >= 0 ? 'rgba(0,200,83,0.08)' : 'rgba(255,23,68,0.08)';

  chart.update();
}

/* ── Monthly P/L Chart ── */
function updateMonthlyChart(entries) {
  const monthly = {};
  entries.forEach(e => {
    const month = e.date.substring(0, 7); // YYYY-MM
    monthly[month] = (monthly[month] || 0) + e.stock_pl + e.options_pl;
  });

  const months = Object.keys(monthly).sort();
  const data = months.map(m => round2(monthly[m]));
  const colors = data.map(v => v >= 0 ? chartColors.green : chartColors.red);
  const labels = months.map(m => {
    const [y, mo] = m.split('-');
    return new Date(y, mo - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
  });

  monthlyChart.data.labels = labels;
  monthlyChart.data.datasets[0].data = data;
  monthlyChart.data.datasets[0].backgroundColor = colors;
  monthlyChart.update();
}

/* ── Daily P/L Bar Chart ── */
function updateDailyChart(entries) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map(e => e.date);
  const data = sorted.map(e => round2(e.stock_pl + e.options_pl));
  const colors = data.map(v => v >= 0 ? chartColors.green : chartColors.red);

  dailyChart.data.labels = labels;
  dailyChart.data.datasets[0].data = data;
  dailyChart.data.datasets[0].backgroundColor = colors;
  dailyChart.update();
}

/* ── Stock vs Options Doughnut ── */
function updateStockOptChart(stats) {
  const stockAbs = Math.abs(stats.total_stock_pl);
  const optAbs = Math.abs(stats.total_options_pl);

  stockOptChart.data.datasets[0].data = [stockAbs, optAbs];

  // Update center text via plugin or just use tooltip
  stockOptChart.update();
}

/* ── P/L by Ticker (Top Winners & Losers) ── */
let tickerExpanded = false;

function updateTickerChart(trades) {
  if (trades.length === 0) {
    tickerChart.data.labels = [];
    tickerChart.data.datasets[0].data = [];
    tickerChart.update();
    document.getElementById('tickerExpandBtn').style.display = 'none';
    return;
  }

  // Aggregate P/L per symbol
  const byTicker = {};
  trades.forEach(t => {
    byTicker[t.symbol] = (byTicker[t.symbol] || 0) + t.pl;
  });

  const sorted = Object.entries(byTicker)
    .map(([sym, pl]) => ({ sym, pl: round2(pl) }))
    .sort((a, b) => b.pl - a.pl);

  const btn = document.getElementById('tickerExpandBtn');
  let combined;

  if (tickerExpanded || sorted.length <= 10) {
    combined = sorted;
    btn.style.display = sorted.length > 10 ? 'inline-block' : 'none';
    btn.textContent = 'Top 10';
  } else {
    const top = sorted.slice(0, 5);
    const bottom = sorted.slice(-5).reverse();
    combined = [...top, ...bottom.filter(b => !top.find(t => t.sym === b.sym))];
    combined.sort((a, b) => b.pl - a.pl);
    btn.style.display = sorted.length > 10 ? 'inline-block' : 'none';
    btn.textContent = `Show All (${sorted.length})`;
  }

  // Adjust chart height for many tickers
  const container = tickerChart.canvas.parentElement;
  container.style.minHeight = combined.length > 10 ? Math.max(250, combined.length * 28) + 'px' : '250px';

  tickerChart.data.labels = combined.map(t => t.sym);
  tickerChart.data.datasets[0].data = combined.map(t => t.pl);
  tickerChart.data.datasets[0].backgroundColor = combined.map(t => t.pl >= 0 ? chartColors.green : chartColors.red);
  tickerChart.update();
}

function toggleTickerExpand() {
  tickerExpanded = !tickerExpanded;
  updateTickerChart(allTrades);
}

/* ── Rolling Win Rate Chart ── */
function updateWinRateChart(entries) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) {
    winRateChart.data.labels = [];
    winRateChart.data.datasets[0].data = [];
    winRateChart.data.datasets[1].data = [];
    winRateChart.update();
    return;
  }

  const maxWindow = 10;
  const labels = [];
  const data = [];

  for (let i = 0; i < sorted.length; i++) {
    const windowSize = Math.min(maxWindow, i + 1);
    const slice = sorted.slice(i - windowSize + 1, i + 1);
    const wins = slice.filter(e => (e.stock_pl + e.options_pl) > 0).length;
    labels.push(sorted[i].date);
    data.push(round2(wins / windowSize * 100));
  }

  winRateChart.data.labels = labels;
  winRateChart.data.datasets[0].data = data;
  winRateChart.data.datasets[1].data = labels.map(() => 50);
  winRateChart.update();
}

/* ── Entry Modal ── */
function setupEntryFormListeners() {
  const stockInput = document.getElementById('stockPLInput');
  const optionsInput = document.getElementById('optionsPLInput');
  const updateTotal = () => {
    const s = parseFloat(stockInput.value) || 0;
    const o = parseFloat(optionsInput.value) || 0;
    const totalEl = document.getElementById('entryTotalPL');
    const total = s + o;
    totalEl.textContent = formatMoney(total);
    totalEl.className = total > 0 ? 'text-profit' : total < 0 ? 'text-loss' : 'text-neutral';
  };
  stockInput.addEventListener('input', updateTotal);
  optionsInput.addEventListener('input', updateTotal);
}

function openNewEntry() {
  document.getElementById('entryDate').value = todayStr();
  document.getElementById('stockPLInput').value = '';
  document.getElementById('optionsPLInput').value = '';
  document.getElementById('notesInput').value = '';
  document.getElementById('entryModalLabel').textContent = 'Add Entry';
  document.getElementById('deleteBtn').style.display = 'none';
  document.getElementById('entryTotalPL').textContent = '$0.00';
  document.getElementById('entryTotalPL').className = 'text-neutral';
  const modal = new bootstrap.Modal(document.getElementById('entryModal'));
  modal.show();
}

function openEntryForDate(dateStr) {
  document.getElementById('entryDate').value = dateStr;
  const existing = allEntries.find(e => e.date === dateStr);

  if (existing) {
    document.getElementById('entryModalLabel').textContent = 'Edit Entry — ' + formatDateDisplay(dateStr);
    document.getElementById('stockPLInput').value = existing.stock_pl || '';
    document.getElementById('optionsPLInput').value = existing.options_pl || '';
    document.getElementById('notesInput').value = existing.notes || '';
    document.getElementById('deleteBtn').style.display = 'inline-block';
    const total = existing.stock_pl + existing.options_pl;
    const totalEl = document.getElementById('entryTotalPL');
    totalEl.textContent = formatMoney(total);
    totalEl.className = total > 0 ? 'text-profit' : total < 0 ? 'text-loss' : 'text-neutral';
  } else {
    document.getElementById('entryModalLabel').textContent = 'Add Entry — ' + formatDateDisplay(dateStr);
    document.getElementById('stockPLInput').value = '';
    document.getElementById('optionsPLInput').value = '';
    document.getElementById('notesInput').value = '';
    document.getElementById('deleteBtn').style.display = 'none';
    document.getElementById('entryTotalPL').textContent = '$0.00';
    document.getElementById('entryTotalPL').className = 'text-neutral';
  }

  const modal = new bootstrap.Modal(document.getElementById('entryModal'));
  modal.show();
}

async function saveEntry() {
  const data = {
    date: document.getElementById('entryDate').value,
    stock_pl: parseFloat(document.getElementById('stockPLInput').value) || 0,
    options_pl: parseFloat(document.getElementById('optionsPLInput').value) || 0,
    notes: document.getElementById('notesInput').value.trim()
  };

  if (!data.date) { alert('Please select a date'); return; }

  try {
    await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    bootstrap.Modal.getInstance(document.getElementById('entryModal')).hide();
    loadData();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
}

async function deleteEntry() {
  const date = document.getElementById('entryDate').value;
  if (!confirm(`Delete entry for ${formatDateDisplay(date)}?`)) return;

  try {
    await fetch('/api/entries/' + date, { method: 'DELETE' });
    bootstrap.Modal.getInstance(document.getElementById('entryModal')).hide();
    loadData();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

/* ── CSV Import ── */
async function previewCSV() {
  const fileInput = document.getElementById('csvFile');
  if (!fileInput.files.length) { alert('Please select a CSV file'); return; }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  const previewBtn = document.getElementById('previewBtn');
  previewBtn.disabled = true;
  previewBtn.textContent = 'Parsing...';

  try {
    const res = await fetch('/api/import/preview', { method: 'POST', body: formData });
    const result = await res.json();

    if (!res.ok) {
      showImportError(result.error);
      return;
    }

    hideImportError();
    document.getElementById('previewCount').textContent = result.count;
    document.getElementById('previewTradeCount').textContent = result.trades_count || 0;
    const tbody = document.getElementById('previewBody');
    tbody.innerHTML = '';

    result.entries.forEach(e => {
      const total = e.stock_pl + e.options_pl;
      const cls = total > 0 ? 'text-profit' : total < 0 ? 'text-loss' : '';
      tbody.innerHTML += `<tr>
        <td>${formatDateDisplay(e.date)}</td>
        <td class="${e.stock_pl > 0 ? 'text-profit' : e.stock_pl < 0 ? 'text-loss' : ''}">${formatMoney(e.stock_pl)}</td>
        <td class="${e.options_pl > 0 ? 'text-profit' : e.options_pl < 0 ? 'text-loss' : ''}">${formatMoney(e.options_pl)}</td>
        <td class="${cls}"><strong>${formatMoney(total)}</strong></td>
        <td class="text-muted">${e.notes || ''}</td>
      </tr>`;
    });

    // Show trade preview if trades were extracted
    const tradePreviewArea = document.getElementById('tradePreviewArea');
    if (result.trades && result.trades.length > 0) {
      tradePreviewArea.style.display = 'block';
      const tradeTbody = document.getElementById('tradePreviewBody');
      tradeTbody.innerHTML = '';
      result.trades.forEach(t => {
        const plClass = t.pl > 0 ? 'text-profit' : t.pl < 0 ? 'text-loss' : '';
        const typeBadge = t.type === 'option'
          ? '<span class="badge bg-warning text-dark">OPT</span>'
          : '<span class="badge bg-info text-dark">STK</span>';
        tradeTbody.innerHTML += `<tr>
          <td>${formatDateDisplay(t.date)}</td>
          <td><strong>${t.symbol}</strong></td>
          <td>${typeBadge}</td>
          <td class="${plClass}"><strong>${formatMoney(t.pl)}</strong></td>
        </tr>`;
      });
    } else {
      tradePreviewArea.style.display = 'none';
    }

    document.getElementById('previewArea').style.display = 'block';
  } catch (err) {
    showImportError(err.message);
  } finally {
    previewBtn.disabled = false;
    previewBtn.textContent = 'Preview';
  }
}

async function importCSV() {
  const fileInput = document.getElementById('csvFile');
  if (!fileInput.files.length) { alert('Please select a CSV file'); return; }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  const importBtn = document.getElementById('importBtn');
  importBtn.disabled = true;
  importBtn.textContent = 'Importing...';

  try {
    const res = await fetch('/api/import', { method: 'POST', body: formData });
    const result = await res.json();

    if (!res.ok) {
      showImportError(result.error);
      return;
    }

    hideImportError();
    let msg = `Imported ${result.count} daily entries`;
    if (result.trades_imported > 0) msg += ` and ${result.trades_imported} individual trades`;
    if (result.trades_skipped > 0) msg += ` (${result.trades_skipped} duplicate trades skipped)`;
    alert(msg + '!');
    bootstrap.Modal.getInstance(document.getElementById('importModal')).hide();
    document.getElementById('previewArea').style.display = 'none';
    document.getElementById('tradePreviewArea').style.display = 'none';
    fileInput.value = '';
    loadData();
  } catch (err) {
    showImportError(err.message);
  } finally {
    importBtn.disabled = false;
    importBtn.textContent = 'Import';
  }
}

function showImportError(msg) {
  const el = document.getElementById('importError');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideImportError() {
  document.getElementById('importError').style.display = 'none';
}

/* ── Helpers ── */
function formatMoney(value) {
  if (value == null || isNaN(value)) return '$0.00';
  const sign = value > 0 ? '+' : '';
  return sign + '$' + Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatMoneyShort(value) {
  if (Math.abs(value) >= 1000) {
    const sign = value > 0 ? '+' : '-';
    return sign + '$' + (Math.abs(value) / 1000).toFixed(1) + 'k';
  }
  return formatMoney(value);
}

function formatDateDisplay(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

async function clearAllData() {
  const input = document.getElementById('clearConfirmInput');
  if (input.value.trim() !== 'DELETE') {
    alert('Please type DELETE to confirm');
    return;
  }
  try {
    await fetch('/api/clear', { method: 'DELETE' });
    bootstrap.Modal.getInstance(document.getElementById('clearDataModal')).hide();
    input.value = '';
    loadData();
  } catch (err) {
    alert('Failed to clear data: ' + err.message);
  }
}

/* ── Trades Table ── */
function sortTrades(trades) {
  const { col, dir } = tradeSort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...trades].sort((a, b) => {
    let va = a[col], vb = b[col];
    if (col === 'pl' || col === 'fees') return (va - vb) * mult;
    if (typeof va === 'string') return va.localeCompare(vb) * mult;
    return (va - vb) * mult;
  });
}

function sortIndicator(col) {
  if (tradeSort.col !== col) return '';
  return tradeSort.dir === 'asc' ? ' ▲' : ' ▼';
}

function toggleSort(col) {
  if (tradeSort.col === col) {
    tradeSort.dir = tradeSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    tradeSort.col = col;
    tradeSort.dir = col === 'pl' ? 'desc' : 'asc';
  }
  const dateFilter = document.getElementById('tradesFilterDate').value;
  const displayed = dateFilter ? allTrades.filter(t => t.date === dateFilter) : allTrades;
  updateTradesTable(displayed);
}

function updateTradesTable(trades) {
  const tbody = document.getElementById('tradesBody');
  const noTrades = document.getElementById('noTrades');
  const table = document.getElementById('tradesTable');
  const badge = document.getElementById('tradeCount');

  badge.textContent = trades.length;

  if (trades.length === 0) {
    table.style.display = 'none';
    noTrades.style.display = 'block';
    return;
  }

  table.style.display = 'table';
  noTrades.style.display = 'none';

  // Update header sort indicators
  document.getElementById('thDate').innerHTML = 'Date' + sortIndicator('date');
  document.getElementById('thSymbol').innerHTML = 'Symbol' + sortIndicator('symbol');
  document.getElementById('thType').innerHTML = 'Type' + sortIndicator('type');
  document.getElementById('thPL').innerHTML = 'P/L' + sortIndicator('pl');

  const sorted = sortTrades(trades);
  const fragment = document.createDocumentFragment();

  sorted.forEach(t => {
    const tr = document.createElement('tr');
    const plClass = t.pl > 0 ? 'text-profit' : t.pl < 0 ? 'text-loss' : '';
    const typeLabel = t.type === 'option' ? '<span class="badge bg-warning text-dark">OPT</span>' : '<span class="badge bg-info text-dark">STK</span>';
    tr.innerHTML = `<td>${formatDateDisplay(t.date)}</td><td><strong>${t.symbol}</strong></td><td>${typeLabel}</td><td class="${plClass}"><strong>${formatMoney(t.pl)}</strong></td><td><button class="btn btn-outline-light btn-sm py-0 px-1" onclick="openEditTrade(${t.id})" title="Edit">✏️</button></td>`;
    fragment.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(fragment);
}

function filterTrades() {
  const dateVal = document.getElementById('tradesFilterDate').value;
  if (dateVal) {
    const filtered = allTrades.filter(t => t.date === dateVal);
    updateTradesTable(filtered);
  } else {
    updateTradesTable(allTrades);
  }
}

function clearTradeFilter() {
  document.getElementById('tradesFilterDate').value = '';
  updateTradesTable(allTrades);
}

async function loadAllTrades() {
  const btn = document.getElementById('loadAllBtn');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  try {
    const res = await fetch('/api/trades?limit=10000');
    allTrades = await res.json();
    updateTradesTable(allTrades);
    updateTickerChart(allTrades);
    btn.style.display = 'none';
  } catch (err) {
    alert('Failed to load trades: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ── Trade Form ── */
function setupTradeFormListeners() {
  // No live preview needed - user enters P/L directly
}

function openNewTrade() {
  document.getElementById('tradeId').value = '';
  document.getElementById('tradeDate').value = todayStr();
  document.getElementById('tradeSymbol').value = '';
  document.getElementById('tradeType').value = 'stock';
  document.getElementById('tradePLInput').value = '';
  document.getElementById('tradeNotes').value = '';
  document.getElementById('tradeModalLabel').textContent = 'Add Trade';
  document.getElementById('tradeDeleteBtn').style.display = 'none';

  const modal = new bootstrap.Modal(document.getElementById('tradeModal'));
  modal.show();
}

function openEditTrade(id) {
  const trade = allTrades.find(t => t.id === id);
  if (!trade) return;

  document.getElementById('tradeId').value = trade.id;
  document.getElementById('tradeDate').value = trade.date;
  document.getElementById('tradeSymbol').value = trade.symbol;
  document.getElementById('tradeType').value = trade.type;
  document.getElementById('tradePLInput').value = trade.pl;
  document.getElementById('tradeNotes').value = trade.notes || '';
  document.getElementById('tradeModalLabel').textContent = 'Edit Trade — ' + trade.symbol;
  document.getElementById('tradeDeleteBtn').style.display = 'inline-block';

  const modal = new bootstrap.Modal(document.getElementById('tradeModal'));
  modal.show();
}

async function saveTrade() {
  const id = document.getElementById('tradeId').value;

  const data = {
    date: document.getElementById('tradeDate').value,
    symbol: document.getElementById('tradeSymbol').value.trim(),
    type: document.getElementById('tradeType').value,
    pl: parseFloat(document.getElementById('tradePLInput').value) || 0,
    notes: document.getElementById('tradeNotes').value.trim()
  };

  if (!data.date || !data.symbol) {
    alert('Please fill in Date and Symbol');
    return;
  }

  try {
    const url = id ? `/api/trades/${id}` : '/api/trades';
    const method = id ? 'PUT' : 'POST';
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    bootstrap.Modal.getInstance(document.getElementById('tradeModal')).hide();
    loadData();
  } catch (err) {
    alert('Failed to save trade: ' + err.message);
  }
}

async function deleteTrade() {
  const id = document.getElementById('tradeId').value;
  if (!id) return;
  if (!confirm('Delete this trade?')) return;

  try {
    await fetch(`/api/trades/${id}`, { method: 'DELETE' });
    bootstrap.Modal.getInstance(document.getElementById('tradeModal')).hide();
    loadData();
  } catch (err) {
    alert('Failed to delete trade: ' + err.message);
  }
}
