const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const strategyDirectory = path.join(projectRoot, 'data', 'asset-rotation');
const historyDirectory = path.join(strategyDirectory, 'history');
const config = JSON.parse(fs.readFileSync(path.join(strategyDirectory, 'config.json'), 'utf8'));
const codes = config.symbols.map((item) => item.code);
const history = {};
const missingCodes = [];
for (const code of codes) {
  const inputPath = path.join(historyDirectory, `${code}.json`);
  if (!fs.existsSync(inputPath)) {
    missingCodes.push(code);
    continue;
  }
  const record = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (record.code !== code || !Array.isArray(record.rows) || record.rows.length === 0) {
    throw new Error(`${inputPath} 历史行情格式无效`);
  }
  history[code] = record;
}
if (missingCodes.length > 0) throw new Error(`缺少 ETF 历史行情：${missingCodes.join(', ')}`);
const names = Object.fromEntries(config.symbols.map((item) => [item.code, item.name]));

function run(frequency) {
  const series = {};
  const allDates = new Set();
  for (const code of codes) {
    const rows = history[code].rows;
    const closes = new Map();
    const indicators = new Map();
    rows.forEach((row, index) => {
      const date = row[0];
      const close = Number(row[2]);
      closes.set(date, close);
      allDates.add(date);
      if (index < 27) return;
      const ma28 = rows.slice(index - 27, index + 1).reduce((sum, item) => sum + Number(item[2]), 0) / 28;
      const return20 = index >= 20 ? close / Number(rows[index - 20][2]) - 1 : Number.NaN;
      indicators.set(date, { close, ma28, return20 });
    });
    series[code] = { closes, indicators };
  }
  const dates = [...allDates].filter((date) => date >= '2016-01-01' && date <= '2025-12-31').sort();
  const rebalanceDates = new Set(frequency === 'daily' ? dates : dates.filter((date, index) => {
    const nextDate = dates[index + 1];
    if (!nextDate) return true;
    const current = new Date(`${date}T00:00:00Z`);
    const next = new Date(`${nextDate}T00:00:00Z`);
    return current.getUTCDay() >= next.getUTCDay();
  }));
  let value = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let position = null;
  let previousDate = null;
  let trades = 0;
  const yearStats = {};
  for (const date of dates) {
    const year = Number(date.slice(0, 4));
    yearStats[year] ??= { start: value, end: value, peak: value, maxDrawdown: 0, trades: 0, holding: null, available: 0 };
    if (position && previousDate) {
      const previousClose = series[position].closes.get(previousDate);
      const currentClose = series[position].closes.get(date);
      if (previousClose && currentClose) value *= currentClose / previousClose;
    }
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
    const state = yearStats[year];
    state.end = value;
    state.peak = Math.max(state.peak, value);
    state.maxDrawdown = Math.min(state.maxDrawdown, value / state.peak - 1);
    if (rebalanceDates.has(date)) {
      const ranked = codes
        .map((code) => ({ code, ...series[code].indicators.get(date) }))
        .filter((item) => Number.isFinite(item.return20))
        .sort((left, right) => right.return20 - left.return20);
      state.available = Math.max(state.available, ranked.length);
      const holding = ranked.findIndex((item) => item.code === position);
      let nextPosition = position;
      if (position && (holding < 0 || holding > 1 || ranked[holding].close < ranked[holding].ma28)) nextPosition = null;
      if (!nextPosition && ranked[0]?.close >= ranked[0]?.ma28) nextPosition = ranked[0].code;
      if (nextPosition !== position) {
        trades += 1;
        state.trades += 1;
      }
      position = nextPosition;
    }
    state.holding = position;
    previousDate = date;
  }
  const years = Object.entries(yearStats).map(([year, item]) => ({
    year: Number(year),
    returnRate: (item.end / item.start - 1) * 100,
    maxDrawdown: item.maxDrawdown * 100,
    trades: item.trades,
    availableAssets: item.available,
    yearEndHolding: item.holding ? names[item.holding] : '空仓',
  }));
  const yearsElapsed = (new Date(`${dates.at(-1)}T00:00:00Z`) - new Date(`${dates[0]}T00:00:00Z`)) / (365.25 * 86400_000);
  return { frequency, start: dates[0], end: dates.at(-1), cumulativeReturn: (value - 1) * 100, annualizedReturn: (value ** (1 / yearsElapsed) - 1) * 100, maxDrawdown: maxDrawdown * 100, trades, holding: position ? names[position] : '空仓', years };
}

const comparisons = [run('daily'), run('weekly')];
const selected = comparisons[1];
const backtest = {
  version: 'asset-rotation-return20-ma28-weekly-v1',
  strategy: 'asset-rotation',
  configVersion: config.version,
  symbols: config.symbols,
  generatedAt: new Date().toISOString(),
  period: { start: selected.start, end: selected.end },
  annualReturns: selected.years,
  summary: {
    cumulativeReturn: selected.cumulativeReturn,
    annualizedReturn: selected.annualizedReturn,
    positiveYears: selected.years.filter((item) => item.returnRate > 0).length,
    worstDrawdown: selected.maxDrawdown,
  },
};
const outputPath = path.join(strategyDirectory, 'backtest.json');
const temporaryPath = `${outputPath}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(backtest, null, 2)}\n`, 'utf8');
fs.renameSync(temporaryPath, outputPath);
console.log(JSON.stringify({ backtest, comparisons }, null, 2));
