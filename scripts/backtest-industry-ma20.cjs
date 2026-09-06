const fs = require('fs');
const path = require('path');

if (!process.env.ROTATION_CALCULATION_ROOT) throw new Error('缺少 ROTATION_CALCULATION_ROOT，请通过后端计算任务运行');
const projectRoot = path.resolve(process.env.ROTATION_CALCULATION_ROOT);
const strategyDirectory = path.join(projectRoot, 'data', 'industry-ma20');
const historyDirectory = path.join(strategyDirectory, 'history');
const config = JSON.parse(fs.readFileSync(path.join(strategyDirectory, 'config.json'), 'utf8'));
const codes = config.symbols.map((item) => item.code);
const names = Object.fromEntries(config.symbols.map((item) => [item.code, item.name]));
const history = {};
const missingCodes = [];
for (const code of codes) {
  const inputPath = path.join(historyDirectory, `${code}.json`);
  if (!fs.existsSync(inputPath)) {
    missingCodes.push(code);
    continue;
  }
  const record = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (record.code !== code || !Array.isArray(record.rows) || record.rows.length === 0) throw new Error(`${inputPath} 历史行情格式无效`);
  history[code] = record;
}
if (missingCodes.length > 0) throw new Error(`缺少 ETF 历史行情：${missingCodes.join(', ')}`);

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
    if (index >= 20) {
      const ma20 = rows.slice(index - 19, index + 1).reduce((sum, item) => sum + Number(item[2]), 0) / 20;
      const previousMa20 = rows.slice(index - 20, index).reduce((sum, item) => sum + Number(item[2]), 0) / 20;
      const previousClose = Number(rows[index - 1][2]);
      const averageVolume = rows.slice(index - 5, index).reduce((sum, item) => sum + Number(item[5]), 0) / 5;
      indicators.set(date, {
        close,
        ma20,
        momentum: close / Number(rows[index - 20][2]) - 1,
        crossAbove: previousClose <= previousMa20 && close > ma20,
        volumeRatio: averageVolume > 0 ? Number(row[5]) / averageVolume : 0,
      });
    }
  });
  series[code] = { closes, indicators };
}

const dates = [...allDates].sort();
let value = 1;
let position = null;
let previousDate = null;
let peak = 1;
let maxDrawdown = 0;
const years = {};
for (const date of dates) {
  const year = Number(date.slice(0, 4));
  if (year < 2015 || year > 2025) continue;
  years[year] ??= { startValue: value, endValue: value, peak: value, maxDrawdown: 0, trades: 0, lastPosition: null, available: 0 };
  if (position && previousDate) {
    const previousClose = series[position].closes.get(previousDate);
    const currentClose = series[position].closes.get(date);
    if (previousClose && currentClose) value *= currentClose / previousClose;
  }
  peak = Math.max(peak, value);
  maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
  const state = years[year];
  state.endValue = value;
  state.peak = Math.max(state.peak, value);
  state.maxDrawdown = Math.min(state.maxDrawdown, value / state.peak - 1);
  const ranked = codes
    .map((code) => ({ code, ...series[code].indicators.get(date) }))
    .filter((item) => Number.isFinite(item.momentum))
    .sort((left, right) => right.momentum - left.momentum);
  state.available = Math.max(state.available, ranked.length);
  const holding = position ? ranked.find((item) => item.code === position) : null;
  const entry = ranked.find((item) => item.crossAbove && item.volumeRatio >= 1.5);
  const nextPosition = holding && holding.close >= holding.ma20 ? position : entry?.code ?? null;
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
const annualReturns = result.map((item) => ({
  year: item.year,
  returnRate: item.return,
  maxDrawdown: item.maxDrawdown,
  trades: item.trades,
  availableAssets: item.available,
  yearEndHolding: item.yearEndHolding,
}));
const backtestDates = dates.filter((date) => date >= '2016-01-01' && date <= '2025-12-31');
const yearsElapsed = (new Date(`${backtestDates.at(-1)}T00:00:00Z`) - new Date(`${backtestDates[0]}T00:00:00Z`)) / (365.25 * 86400_000);
const backtest = {
  _comment: '页面“行业 ETF 20 日均线”中的“近10年年度收益”数据，包括累计收益、年化收益、年度收益和最大回撤。',
  version: 'industry-ma20-breakout-volume15-daily-v1',
  strategy: 'industry-ma20',
  configVersion: config.version,
  symbols: config.symbols,
  generatedAt: new Date().toISOString(),
  period: { start: backtestDates[0], end: backtestDates.at(-1) },
  annualReturns,
  summary: {
    cumulativeReturn: cumulative * 100,
    annualizedReturn: ((1 + cumulative) ** (1 / yearsElapsed) - 1) * 100,
    positiveYears: annualReturns.filter((item) => item.returnRate > 0).length,
    worstDrawdown: maxDrawdown * 100,
  },
};
const outputPath = path.join(strategyDirectory, 'backtest.json');
const temporaryPath = `${outputPath}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(backtest, null, 2)}\n`, 'utf8');
fs.renameSync(temporaryPath, outputPath);
console.log(JSON.stringify(backtest, null, 2));
