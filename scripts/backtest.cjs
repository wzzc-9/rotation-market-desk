const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const history = JSON.parse(fs.readFileSync(path.join(projectRoot, 'data', 'history-consolidated.json'), 'utf8'));
const codes = Object.keys(history);
const names = Object.fromEntries(codes.map(code => [code, history[code].name]));
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
    if (index >= 19) {
      const ma20 = rows.slice(index - 19, index + 1).reduce((sum, item) => sum + Number(item[2]), 0) / 20;
      indicators.set(date, { close, ma20, momentum: close / ma20 - 1 });
    }
  });
  series[code] = { closes, indicators };
}

const dates = [...allDates].sort();
let value = 1;
let position = null;
let previousDate = null;
const years = {};

for (const date of dates) {
  const year = Number(date.slice(0, 4));
  if (year < 2015 || year > 2025) continue;
  years[year] ??= {
    startValue: value,
    endValue: value,
    peak: value,
    maxDrawdown: 0,
    trades: 0,
    lastPosition: null,
    available: 0,
  };

  if (position && previousDate) {
    const previousClose = series[position].closes.get(previousDate);
    const currentClose = series[position].closes.get(date);
    if (previousClose && currentClose) value *= currentClose / previousClose;
  }

  const state = years[year];
  state.endValue = value;
  state.peak = Math.max(state.peak, value);
  state.maxDrawdown = Math.min(state.maxDrawdown, value / state.peak - 1);

  const ranked = codes
    .map(code => ({ code, ...series[code].indicators.get(date) }))
    .filter(item => Number.isFinite(item.momentum))
    .sort((a, b) => b.momentum - a.momentum);
  state.available = Math.max(state.available, ranked.length);
  const leader = ranked[0];
  const nextPosition = leader && leader.close > leader.ma20 ? leader.code : null;
  if (nextPosition !== position) state.trades += 1;
  position = nextPosition;
  state.lastPosition = position;
  previousDate = date;
}

const result = Object.entries(years)
  .filter(([year]) => Number(year) >= 2016)
  .map(([year, item]) => ({
    year: Number(year),
    return: (item.endValue / item.startValue - 1) * 100,
    maxDrawdown: item.maxDrawdown * 100,
    trades: item.trades,
    available: item.available,
    yearEndHolding: item.lastPosition ? names[item.lastPosition] : '空仓',
    endValue: item.endValue,
  }));

const cumulative = (result.at(-1).endValue / result[0].endValue) * (1 + result[0].return / 100) - 1;
console.log(JSON.stringify({ result, cumulative: cumulative * 100 }, null, 2));
