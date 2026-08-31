const fs = require('fs');
const path = require('path');

if (!process.env.ROTATION_CALCULATION_ROOT) throw new Error('缺少 ROTATION_CALCULATION_ROOT，请通过后端计算任务运行');
const projectRoot = path.resolve(process.env.ROTATION_CALCULATION_ROOT);
const strategyDirectory = path.join(projectRoot, 'data', 'dual-etf');
const historyDirectory = path.join(strategyDirectory, 'history');
const config = JSON.parse(fs.readFileSync(path.join(strategyDirectory, 'config.json'), 'utf8'));
const codes = config.symbols.map((item) => item.code);
const names = Object.fromEntries(config.symbols.map((item) => [item.code, item.name]));
const series = {};
const allDates = new Set();

for (const code of codes) {
  const inputPath = path.join(historyDirectory, `${code}.json`);
  if (!fs.existsSync(inputPath)) throw new Error(`缺少 ETF 历史行情：${code}`);
  const record = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (record.code !== code || !Array.isArray(record.rows) || record.rows.length === 0) throw new Error(`${inputPath} 历史行情格式无效`);
  const closes = new Map();
  const indicators = new Map();
  record.rows.forEach((row, index) => {
    const date = row[0];
    const close = Number(row[2]);
    closes.set(date, close);
    allDates.add(date);
    if (index < 20) return;
    const ma20 = record.rows.slice(index - 19, index + 1).reduce((sum, item) => sum + Number(item[2]), 0) / 20;
    indicators.set(date, { close, ma20, return20: close / Number(record.rows[index - 20][2]) - 1 });
  });
  series[code] = { closes, indicators };
}

const dates = [...allDates].sort();
const signalFor = (date) => {
  const leader = codes
    .map((code) => ({ code, ...series[code].indicators.get(date) }))
    .filter((item) => Number.isFinite(item.return20))
    .sort((left, right) => right.return20 - left.return20)[0];
  return leader && leader.close >= leader.ma20 ? leader.code : null;
};

let position = null;
let previousDate = null;
let value = 1;
let overallPeak = 1;
let overallDrawdown = 0;
const years = {};
for (const date of dates) {
  if (date > '2025-12-31') break;
  if (date < '2016-01-01') {
    position = signalFor(date);
    previousDate = date;
    continue;
  }
  const year = Number(date.slice(0, 4));
  years[year] ??= { startValue: value, endValue: value, peak: value, maxDrawdown: 0, trades: 0, holding: null, available: 0 };
  if (position && previousDate) {
    const previousClose = series[position].closes.get(previousDate);
    const currentClose = series[position].closes.get(date);
    if (previousClose && currentClose) value *= currentClose / previousClose;
  }
  overallPeak = Math.max(overallPeak, value);
  overallDrawdown = Math.min(overallDrawdown, value / overallPeak - 1);
  const state = years[year];
  state.endValue = value;
  state.peak = Math.max(state.peak, value);
  state.maxDrawdown = Math.min(state.maxDrawdown, value / state.peak - 1);
  state.available = Math.max(state.available, codes.filter((code) => series[code].indicators.has(date)).length);
  const nextPosition = signalFor(date);
  if (nextPosition !== position) state.trades += 1;
  position = nextPosition;
  state.holding = position;
  previousDate = date;
}

const annualReturns = Object.entries(years).map(([year, item]) => ({
  year: Number(year),
  returnRate: (item.endValue / item.startValue - 1) * 100,
  maxDrawdown: item.maxDrawdown * 100,
  trades: item.trades,
  availableAssets: item.available,
  yearEndHolding: item.holding ? names[item.holding] : '空仓',
}));
const backtestDates = dates.filter((date) => date >= '2016-01-01' && date <= '2025-12-31');
const cumulativeReturn = (value - 1) * 100;
const backtest = {
  version: 'dual-etf-return20-ma20-daily-v1',
  strategy: 'dual-etf',
  configVersion: config.version,
  symbols: config.symbols,
  generatedAt: new Date().toISOString(),
  period: { start: backtestDates[0], end: backtestDates.at(-1) },
  annualReturns,
  summary: {
    cumulativeReturn,
    annualizedReturn: ((1 + cumulativeReturn / 100) ** (1 / annualReturns.length) - 1) * 100,
    positiveYears: annualReturns.filter((item) => item.returnRate > 0).length,
    worstDrawdown: overallDrawdown * 100,
  },
};
const outputPath = path.join(strategyDirectory, 'backtest.json');
const temporaryPath = `${outputPath}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(backtest, null, 2)}\n`, 'utf8');
fs.renameSync(temporaryPath, outputPath);
console.log(JSON.stringify(backtest, null, 2));
