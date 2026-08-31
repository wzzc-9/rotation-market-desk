const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const strategyDirectory = path.join(projectRoot, 'data', 'rotation');
const historyDirectory = path.join(strategyDirectory, 'history');
const configPath = path.join(strategyDirectory, 'combination-config.json');
const outputPath = path.join(strategyDirectory, 'combinations.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const symbols = Array.isArray(config.symbols) ? config.symbols : [];

if (symbols.length < 3) throw new Error('组合池至少需要 3 只 ETF');
if (new Set(symbols.map((symbol) => symbol.code)).size !== symbols.length) throw new Error('组合池包含重复 ETF');

function inferAssetClass(name) {
  if (/黄金/.test(name)) return '黄金';
  if (/国债|债券|短融|信用债|政金债/.test(name)) return '国债';
  if (/恒生|港股|中概/.test(name)) return '港股';
  if (/纳指|标普|道琼|美国/.test(name)) return '美股';
  return 'A股';
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function popcount(value) {
  let count = 0;
  while (value > 0) {
    count += value & 1;
    value >>>= 1;
  }
  return count;
}

const universe = [];
const series = {};
const allDates = new Set();
for (const symbol of symbols) {
  const inputPath = path.join(historyDirectory, `${symbol.code}.json`);
  if (!fs.existsSync(inputPath)) throw new Error(`${symbol.code}.json 缺少历史行情，请先下载`);
  const record = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (record.code !== symbol.code || !Array.isArray(record.rows) || record.rows.length < 20) throw new Error(`${symbol.code}.json 历史行情格式无效`);
  const closes = new Map();
  const indicators = new Map();
  record.rows.forEach((row, index) => {
    const date = row[0];
    const close = Number(row[2]);
    closes.set(date, close);
    allDates.add(date);
    if (index < 19) return;
    const ma20 = record.rows.slice(index - 19, index + 1).reduce((sum, item) => sum + Number(item[2]), 0) / 20;
    indicators.set(date, { close, ma20, momentum: close / ma20 - 1 });
  });
  universe.push({
    code: symbol.code,
    name: symbol.name,
    assetClass: inferAssetClass(symbol.name),
    firstDate: record.rows[0][0],
    lastDate: record.rows.at(-1)[0],
  });
  series[symbol.code] = { closes, indicators };
}

const dates = [...allDates].sort();

function nextPositionFor(codes, date) {
  const leader = codes
    .map((code) => ({ code, ...series[code].indicators.get(date) }))
    .filter((item) => Number.isFinite(item.momentum))
    .sort((left, right) => right.momentum - left.momentum)[0];
  return leader && leader.close > leader.ma20 ? leader.code : null;
}

function simulate(codes, periodDates, initialPosition, previousDate, captureBeforeDate = null) {
  let position = initialPosition;
  let value = 1;
  let capturedValue = 1;
  let capturedPeak = 1;
  let capturedMaxDrawdown = 0;
  let captureStarted = false;
  let peak = 1;
  let maxDrawdown = 0;
  let trades = 0;
  for (const date of periodDates) {
    if (captureBeforeDate && !captureStarted && date >= captureBeforeDate) {
      captureStarted = true;
      capturedValue = value;
      capturedPeak = value;
    }
    if (position && previousDate) {
      const previousClose = series[position].closes.get(previousDate);
      const currentClose = series[position].closes.get(date);
      if (previousClose && currentClose) value *= currentClose / previousClose;
    }
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
    if (captureBeforeDate && date < captureBeforeDate) capturedValue = value;
    if (captureStarted) {
      capturedPeak = Math.max(capturedPeak, value);
      capturedMaxDrawdown = Math.min(capturedMaxDrawdown, value / capturedPeak - 1);
    }
    const nextPosition = nextPositionFor(codes, date);
    if (nextPosition !== position) trades += 1;
    position = nextPosition;
    previousDate = date;
  }
  return { value, capturedValue, capturedMaxDrawdown: capturedMaxDrawdown * 100, cumulativeReturn: (value - 1) * 100, maxDrawdown: maxDrawdown * 100, trades, holding: position };
}

const tenYearDates = dates.filter((date) => date >= '2016-01-01' && date <= '2025-12-31');
const fiveYearStart = '2021-01-01';
const fiveYearDates = tenYearDates.filter((date) => date >= fiveYearStart);
const currentYear = Number(dates.at(-1).slice(0, 4));
const currentYearDates = dates.filter((date) => date >= `${currentYear}-01-01`);
const previousYearDate = dates.filter((date) => date < `${currentYear}-01-01`).at(-1) ?? null;
const yearsElapsed = (new Date(`${tenYearDates.at(-1)}T00:00:00Z`) - new Date(`${tenYearDates[0]}T00:00:00Z`)) / (365.25 * 86400_000);
const fiveYearsElapsed = (new Date(`${fiveYearDates.at(-1)}T00:00:00Z`) - new Date(`${fiveYearDates[0]}T00:00:00Z`)) / (365.25 * 86400_000);
const combinations = [];

for (let mask = 1; mask < 2 ** universe.length; mask += 1) {
  const size = popcount(mask);
  if (size < 3) continue;
  const selected = universe.filter((_, index) => mask & (1 << index));
  const codes = selected.map((item) => item.code);
  const tenYear = simulate(codes, tenYearDates, null, null, fiveYearStart);
  const fiveYearReturn = (tenYear.value / tenYear.capturedValue - 1) * 100;
  const current = simulate(codes, currentYearDates, tenYear.holding, previousYearDate);
  combinations.push({
    id: codes.join('-'),
    size,
    codes,
    assetClasses: [...new Set(selected.map((item) => item.assetClass))],
    tenYearReturn: round(tenYear.cumulativeReturn),
    fiveYearReturn: round(fiveYearReturn),
    tenYearAnnualizedReturn: round(((1 + tenYear.cumulativeReturn / 100) ** (1 / yearsElapsed) - 1) * 100),
    fiveYearAnnualizedReturn: round(((1 + fiveYearReturn / 100) ** (1 / fiveYearsElapsed) - 1) * 100),
    tenYearMaxDrawdown: round(tenYear.maxDrawdown),
    fiveYearMaxDrawdown: round(tenYear.capturedMaxDrawdown),
    tenYearTrades: tenYear.trades,
    currentYearReturn: round(current.cumulativeReturn),
    currentYearMaxDrawdown: round(current.maxDrawdown),
    currentYearTrades: current.trades,
    currentHolding: current.holding,
  });
}

const tenYearOrder = [...combinations].sort((left, right) => right.tenYearReturn - left.tenYearReturn);
const currentYearOrder = [...combinations].sort((left, right) => right.currentYearReturn - left.currentYearReturn);
tenYearOrder.forEach((item, index) => { item.tenYearRank = index + 1; });
currentYearOrder.forEach((item, index) => { item.currentYearRank = index + 1; });

function populationStats(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, standardDeviation: Math.sqrt(variance) || 1 };
}

const scoreMetrics = {
  tenYearAnnualizedReturn: populationStats(combinations.map((item) => item.tenYearAnnualizedReturn)),
  fiveYearAnnualizedReturn: populationStats(combinations.map((item) => item.fiveYearAnnualizedReturn)),
  currentYearReturn: populationStats(combinations.map((item) => item.currentYearReturn)),
  tenYearDrawdownAbsolute: populationStats(combinations.map((item) => Math.abs(item.tenYearMaxDrawdown))),
  fiveYearDrawdownAbsolute: populationStats(combinations.map((item) => Math.abs(item.fiveYearMaxDrawdown))),
  currentYearDrawdownAbsolute: populationStats(combinations.map((item) => Math.abs(item.currentYearMaxDrawdown))),
};
const zScore = (value, stats) => (value - stats.mean) / stats.standardDeviation;
for (const item of combinations) {
  item.compositeScore = round(
    0.3 * zScore(item.tenYearAnnualizedReturn, scoreMetrics.tenYearAnnualizedReturn)
    + 0.25 * zScore(item.fiveYearAnnualizedReturn, scoreMetrics.fiveYearAnnualizedReturn)
    + 0.1 * zScore(item.currentYearReturn, scoreMetrics.currentYearReturn)
    - 0.2 * zScore(Math.abs(item.tenYearMaxDrawdown), scoreMetrics.tenYearDrawdownAbsolute)
    - 0.1 * zScore(Math.abs(item.fiveYearMaxDrawdown), scoreMetrics.fiveYearDrawdownAbsolute)
    - 0.05 * zScore(Math.abs(item.currentYearMaxDrawdown), scoreMetrics.currentYearDrawdownAbsolute),
    6,
  );
}
const compositeOrder = [...combinations].sort((left, right) => right.compositeScore - left.compositeScore);
compositeOrder.forEach((item, index) => { item.compositeRank = index + 1; });

const result = {
  _comment: '页面“宽基 20 日动量轮动”的“全组合收益排名”表格数据，包括每个 ETF 组合的近10年、近5年、2026年收益、回撤、综合得分和排名。',
  version: 'rotation-combinations-daily-v3',
  strategy: 'rotation',
  generatedAt: new Date().toISOString(),
  rule: { frequency: 'daily', momentumPeriod: 20, movingAveragePeriod: 20, minimumPoolSize: 3 },
  periods: {
    tenYear: { start: tenYearDates[0], end: tenYearDates.at(-1) },
    fiveYear: { start: fiveYearDates[0], end: fiveYearDates.at(-1) },
    currentYear: { year: currentYear, start: currentYearDates[0], end: currentYearDates.at(-1) },
  },
  universe,
  totalCombinations: combinations.length,
  bestTenYearId: tenYearOrder[0].id,
  bestCurrentYearId: currentYearOrder[0].id,
  bestCompositeId: compositeOrder[0].id,
  scoring: {
    formula: '0.30*z(tenYearAnnualizedReturn)+0.25*z(fiveYearAnnualizedReturn)+0.10*z(currentYearReturn)-0.20*z(abs(tenYearMaxDrawdown))-0.10*z(abs(fiveYearMaxDrawdown))-0.05*z(abs(currentYearMaxDrawdown))',
    population: scoreMetrics,
  },
  combinations,
};

const replaceableFileErrorCodes = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST', 'ENOTEMPTY']);
const isReplaceableFileError = (error) => error instanceof Error && replaceableFileErrorCodes.has(String(error.code));
const pauseFileOperation = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
let replaced = false;
let lastReplaceError;
for (let attempt = 0; attempt < 8 && !replaced; attempt += 1) {
  try {
    fs.renameSync(temporaryPath, outputPath);
    replaced = true;
  } catch (error) {
    if (!isReplaceableFileError(error)) throw error;
    lastReplaceError = error;
  }
  if (!replaced) {
    try {
      fs.copyFileSync(temporaryPath, outputPath);
      fs.unlinkSync(temporaryPath);
      replaced = true;
    } catch (error) {
      if (!isReplaceableFileError(error)) throw error;
      lastReplaceError = error;
    }
  }
  if (!replaced) pauseFileOperation(Math.min(50 * 2 ** attempt, 500));
}
if (!replaced) throw lastReplaceError;
console.log(JSON.stringify({
  outputPath,
  universeSize: universe.length,
  totalCombinations: combinations.length,
  bestComposite: compositeOrder[0],
  bestTenYear: tenYearOrder[0],
  bestCurrentYear: currentYearOrder[0],
}, null, 2));
