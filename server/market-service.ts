import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { flushMysqlWrites, getMysqlCombinationPage, importCombinationFile, isMysqlEnabled, listMysqlObjects, queueMysqlObjectDelete, queueMysqlObjectWrite, readMysqlObject, replaceMysqlObjects, upsertMysqlEtfDailyPrices } from './mysql-store.js';

export type MarketCategory = 'A股宽基' | '海外指数' | '商品' | '债券';
type IndexStrategy = 'rotation' | 'asset-rotation' | 'dual-etf';

type SymbolConfig = {
  marketCode: string;
  code: string;
  name: string;
  category: MarketCategory;
};

export type EtfSearchResult = SymbolConfig;

export type AssetRotationConfig = {
  version: number;
  updatedAt: string;
  symbols: SymbolConfig[];
};

export type AssetRotationBacktest = {
  version: string;
  strategy: IndexStrategy;
  configVersion: number;
  generatedAt: string;
  period: { start: string; end: string };
  symbols: SymbolConfig[];
  annualReturns: Array<{
    year: number;
    returnRate: number;
    maxDrawdown: number;
    trades: number;
    availableAssets: number;
    yearEndHolding: string;
  }>;
  summary: {
    cumulativeReturn: number;
    annualizedReturn: number;
    positiveYears: number;
    worstDrawdown: number;
  };
};

export type AssetRotationCombinationSort = 'score' | 'ten-year' | 'five-year' | 'current-year';
export type AssetRotationCombinationDirection = 'asc' | 'desc';

type AssetRotationCombinationFilters = {
  size?: number;
  tenYearDrawdown?: number;
  fiveYearDrawdown?: number;
  currentYearDrawdown?: number;
  codes?: string[];
};

export type AssetRotationCombination = {
  id: string;
  size: number;
  codes: string[];
  assetClasses: string[];
  tenYearReturn: number;
  fiveYearReturn: number;
  tenYearAnnualizedReturn: number;
  fiveYearAnnualizedReturn: number;
  tenYearMaxDrawdown: number;
  fiveYearMaxDrawdown: number;
  tenYearTrades: number;
  currentYearReturn: number;
  currentYearMaxDrawdown: number;
  currentYearTrades: number;
  currentHolding: string | null;
  tenYearRank: number;
  currentYearRank: number;
  compositeScore: number;
  compositeRank: number;
};

type AssetRotationScoreMetricPopulation = {
  mean: number;
  standardDeviation: number;
};

type AssetRotationScoring = {
  formula: string;
  population: {
    tenYearAnnualizedReturn: AssetRotationScoreMetricPopulation;
    fiveYearAnnualizedReturn: AssetRotationScoreMetricPopulation;
    currentYearReturn: AssetRotationScoreMetricPopulation;
    tenYearDrawdownAbsolute: AssetRotationScoreMetricPopulation;
    fiveYearDrawdownAbsolute: AssetRotationScoreMetricPopulation;
    currentYearDrawdownAbsolute: AssetRotationScoreMetricPopulation;
  };
};

export type AssetRotationCombinations = {
  version: string;
  strategy: 'rotation' | 'asset-rotation';
  generatedAt: string;
  periods: {
    tenYear: { start: string; end: string };
    fiveYear: { start: string; end: string };
    currentYear: { year: number; start: string; end: string };
  };
  universe: Array<{ code: string; name: string; assetClass: string; firstDate: string; lastDate: string }>;
  totalCombinations: number;
  bestTenYearId: string;
  bestCurrentYearId: string;
  scoring: AssetRotationScoring;
  combinations: AssetRotationCombination[];
};

type TencentRow = [string, string, string, string, string, string, ...string[]];

type TencentQuote = {
  name: string;
  price?: number;
  previousClose?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  date?: string;
  timestamp?: string;
};

type Candle = {
  date: string;
  open: number;
  close: number;
  low: number;
  high: number;
  volume: number;
};

export type RankedMarket = {
  code: string;
  name: string;
  category: MarketCategory;
  candles: Candle[];
  price: number;
  previousClose: number;
  change: number;
  ma20: number;
  momentum: number;
  rank: number;
  aboveMa: boolean;
  volumeRatio: number;
  signal: '持有' | '观察' | '规避';
};

export type RotationSnapshot = {
  markets: RankedMarket[];
  poolDraft?: AssetRotationPoolDraft;
  yearPerformance: RotationYearPerformance;
  provider: string;
  fetchedAt: string;
  lastTradingDate: string;
  cached: boolean;
  backtest?: AssetRotationBacktest;
};

export type AssetRotationPoolDraft = {
  dirty: boolean;
  activeVersion: number;
  version: number;
  updatedAt: string;
  symbols: SymbolConfig[];
};

export type RotationTradeNode = {
  date: string;
  action: '买入' | '轮换' | '清仓';
  fromCode: string | null;
  fromName: string | null;
  toCode: string | null;
  toName: string | null;
  reason: string;
  tradeReturn: number | null;
  cumulativeReturn: number;
};

export type RotationEquityPoint = {
  date: string;
  returnRate: number;
};

export type RotationYearPerformance = {
  year: number;
  startDate: string;
  lastTradingDate: string;
  cumulativeReturn: number;
  nodeCount: number;
  currentHolding: string | null;
  currentTradeReturn: number | null;
  equityCurve: RotationEquityPoint[];
  nodes: RotationTradeNode[];
};

export type HistoryPeriod = 'minute' | 'day' | 'week' | 'month';

export type MarketHistory = {
  code: string;
  name: string;
  period: HistoryPeriod;
  date: string;
  previousClose: number;
  candles: Candle[];
  points: Array<{ time: string; price: number; volume: number }>;
  provider: string;
  fetchedAt: string;
  cached: boolean;
};

export type MacdSignal = {
  code: string;
  name: string;
  close: number;
  change: number;
  currentPrice?: number;
  changeSinceSignal?: number;
  dif: number;
  dea: number;
  histogram: number;
  histogramChange: number;
  signal: '金叉共振' | '多头延续';
};

export type MacdSnapshot = {
  signals: MacdSignal[];
  firstCrossCount: number;
  storageDate: string;
  provider: string;
  fetchedAt: string;
  lastTradingDate: string;
  cached: boolean;
  scannedCount: number;
  excludedCount: number;
};

export type MacdPullbackSignal = {
  code: string;
  name: string;
  close: number;
  change: number;
  currentPrice?: number;
  changeSinceSignal?: number;
  ma20: number;
  supportDistance: number;
  pullback: number;
  volumeRatio: number;
  crossDaysAgo: number;
  dif: number;
  dea: number;
  score: number;
  signal: '回踩观察';
};

export type MacdPullbackSnapshot = {
  signals: MacdPullbackSignal[];
  storageDate: string;
  provider: string;
  fetchedAt: string;
  lastTradingDate: string;
  cached: boolean;
  scannedCount: number;
  excludedCount: number;
};

export type MacdKdjSignal = {
  code: string;
  name: string;
  close: number;
  change: number;
  currentPrice?: number;
  changeSinceSignal?: number;
  dif: number;
  dea: number;
  histogram: number;
  k: number;
  d: number;
  j: number;
  kdjCrossDaysAgo: number;
  divergence: boolean;
  score: number;
  signal: '低位双金叉' | '底背离共振';
};

export type MacdKdjSnapshot = {
  signals: MacdKdjSignal[];
  storageDate: string;
  provider: string;
  fetchedAt: string;
  lastTradingDate: string;
  cached: boolean;
  scannedCount: number;
  excludedCount: number;
  lowCrossCount: number;
  divergenceCount: number;
};

export type VolumeSignal = {
  code: string;
  name: string;
  close: number;
  change: number;
  currentPrice?: number;
  changeSinceSignal?: number;
  ma25: number;
  supportDistance: number;
  pullback: number;
  volumeMa5: number;
  volumeMa60: number;
  volumeRatio: number;
  priceCrossDaysAgo: number;
  volumeCrossDaysAgo: number;
  score: number;
  signal: '量价同步突破' | '量能共振支撑' | '缩量回踩蓄力';
};

export type VolumeSnapshot = {
  signals: VolumeSignal[];
  storageDate: string;
  provider: string;
  fetchedAt: string;
  lastTradingDate: string;
  cached: boolean;
  scannedCount: number;
  excludedCount: number;
  breakoutCount: number;
  supportCount: number;
  pullbackCount: number;
};

export type BullPointSignal = {
  code: string;
  name: string;
  close: number;
  change: number;
  currentPrice?: number;
  changeSinceSignal?: number;
  var1: number;
  trendLine: number;
  previousVar1: number;
  previousTrendLine: number;
  crossSpread: number;
  signal: '多点';
};

export type BullPointSnapshot = {
  signals: BullPointSignal[];
  storageDate: string;
  provider: string;
  fetchedAt: string;
  lastTradingDate: string;
  cached: boolean;
  scannedCount: number;
  excludedCount: number;
};

const cacheTtlMs = 30_000;
const execFileAsync = promisify(execFile);
const rotationDirectory = resolve(process.cwd(), 'data', 'rotation');
const rotationHistoryDirectory = resolve(rotationDirectory, 'history');
const rotationConfigPath = resolve(rotationDirectory, 'config.json');
const rotationPendingConfigPath = resolve(rotationDirectory, 'pending-config.json');
const rotationCombinationConfigPath = resolve(rotationDirectory, 'combination-config.json');
const rotationCombinationPendingConfigPath = resolve(rotationDirectory, 'combination-pending-config.json');
const rotationBacktestPath = resolve(rotationDirectory, 'backtest.json');
const rotationCombinationsPath = resolve(rotationDirectory, 'combinations.json');
const rotationYearPerformanceDirectory = resolve(rotationDirectory, 'year-performance');
const assetRotationDirectory = resolve(process.cwd(), 'data', 'asset-rotation');
const assetRotationHistoryDirectory = resolve(assetRotationDirectory, 'history');
const assetRotationConfigPath = resolve(assetRotationDirectory, 'config.json');
const assetRotationPendingConfigPath = resolve(assetRotationDirectory, 'pending-config.json');
const assetCombinationConfigPath = resolve(assetRotationDirectory, 'combination-config.json');
const assetCombinationPendingConfigPath = resolve(assetRotationDirectory, 'combination-pending-config.json');
const assetRotationBacktestPath = resolve(assetRotationDirectory, 'backtest.json');
const assetRotationCombinationsPath = resolve(assetRotationDirectory, 'combinations.json');
const dualEtfDirectory = resolve(process.cwd(), 'data', 'dual-etf');
const dualEtfHistoryDirectory = resolve(dualEtfDirectory, 'history');
const dualEtfConfigPath = resolve(dualEtfDirectory, 'config.json');
const dualEtfBacktestPath = resolve(dualEtfDirectory, 'backtest.json');
const macdSnapshotVersion = 'macd-10-20-7-first-cross-full-v1';
const macdSnapshotDirectory = resolve(process.cwd(), 'data', 'macd-snapshots');
const macdPullbackSnapshotVersion = 'macd-5-34-5-zero-axis-pullback-v1';
const macdPullbackSnapshotDirectory = resolve(process.cwd(), 'data', 'macd-pullback-snapshots');
const macdKdjSnapshotVersion = 'macd-12-26-9-kdj-9-3-3-resonance-v1';
const macdKdjSnapshotDirectory = resolve(process.cwd(), 'data', 'macd-kdj-snapshots');
const volumeSnapshotVersion = 'volume-ma25-volume-ma5-60-three-signals-v2';
const volumeSnapshotDirectory = resolve(process.cwd(), 'data', 'volume-snapshots');
const bullPointSnapshotVersion = 'bull-point-hhv21-hhv6-ma34-ma6-v1';
const bullPointSnapshotDirectory = resolve(process.cwd(), 'data', 'bull-point-snapshots');
const assetRotationYearPerformanceDirectory = resolve(assetRotationDirectory, 'year-performance');
const dualEtfYearPerformanceDirectory = resolve(dualEtfDirectory, 'year-performance');
let cachedSnapshot: RotationSnapshot | null = null;
let cachedAt = 0;
let cachedAssetRotationSnapshot: RotationSnapshot | null = null;
let cachedAssetRotationAt = 0;
let cachedDualEtfSnapshot: RotationSnapshot | null = null;
let cachedDualEtfAt = 0;
let rotationPoolUpdateInFlight = false;
let rotationCombinationPoolUpdateInFlight = false;
let assetRotationPoolUpdateInFlight = false;
let assetCombinationPoolUpdateInFlight = false;
let dualEtfPoolUpdateInFlight = false;
const macdScansInFlight = new Map<string, Promise<MacdSnapshot>>();
const macdPullbackScansInFlight = new Map<string, Promise<MacdPullbackSnapshot>>();
const macdKdjScansInFlight = new Map<string, Promise<MacdKdjSnapshot>>();
const volumeScansInFlight = new Map<string, Promise<VolumeSnapshot>>();
const bullPointScansInFlight = new Map<string, Promise<BullPointSnapshot>>();
const historyCache = new Map<string, { value: MarketHistory; cachedAt: number }>();
const tradingDateCache = new Map<string, string>();

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

function isMarketCategory(value: unknown): value is MarketCategory {
  return value === 'A股宽基' || value === '海外指数' || value === '商品' || value === '债券';
}

function isSymbolConfig(value: unknown): value is SymbolConfig {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SymbolConfig>;
  return typeof item.marketCode === 'string'
    && /^(sh|sz)\d{6}$/.test(item.marketCode)
    && typeof item.code === 'string'
    && /^\d{6}$/.test(item.code)
    && item.marketCode.endsWith(item.code)
    && typeof item.name === 'string'
    && item.name.length > 0
    && isMarketCategory(item.category);
}

function readStoredText(path: string) {
  const stored = readMysqlObject(path);
  if (stored === null) throw new Error(`数据库中缺少业务对象：${relative(process.cwd(), path)}`);
  return stored;
}

function storedFileExists(path: string) {
  return readMysqlObject(path) !== null;
}

function deleteStoredFile(path: string) {
  void queueMysqlObjectDelete(path);
}

function storedJsonNames(directory: string) {
  return [...new Set(listMysqlObjects(directory).map((key) => basename(key)))];
}

const calculationWorkspacePrefix = 'rotation-market-desk-';

function calculationPath(workspaceRoot: string, projectPath: string) {
  const projectRelativePath = relative(process.cwd(), projectPath);
  if (!projectRelativePath || projectRelativePath.startsWith('..') || resolve(process.cwd(), projectRelativePath) !== resolve(projectPath)) {
    throw new Error(`计算文件不在项目目录内：${projectPath}`);
  }
  return resolve(workspaceRoot, projectRelativePath);
}

function createCalculationWorkspace() {
  if (!isMysqlEnabled()) throw new Error('计算任务需要 MySQL');
  const workspaceRoot = mkdtempSync(resolve(tmpdir(), calculationWorkspacePrefix));
  const dataDirectory = resolve(process.cwd(), 'data');
  for (const key of listMysqlObjects(dataDirectory)) {
    const logicalPath = resolve(process.cwd(), key);
    const content = readMysqlObject(logicalPath);
    if (content === null) continue;
    const stagedPath = calculationPath(workspaceRoot, logicalPath);
    mkdirSync(dirname(stagedPath), { recursive: true });
    writeFileSync(stagedPath, content, 'utf8');
  }
  return workspaceRoot;
}

function removeCalculationWorkspace(workspaceRoot: string) {
  const relativeToTemp = relative(tmpdir(), workspaceRoot);
  if (relativeToTemp.startsWith('..') || !basename(workspaceRoot).startsWith(calculationWorkspacePrefix)) {
    throw new Error(`拒绝清理非计算临时目录：${workspaceRoot}`);
  }
  rmSync(workspaceRoot, { recursive: true, force: true });
}

function writeCalculationText(workspaceRoot: string, logicalPath: string, content: string) {
  const stagedPath = calculationPath(workspaceRoot, logicalPath);
  mkdirSync(dirname(stagedPath), { recursive: true });
  writeFileSync(stagedPath, content, 'utf8');
}

function calculationJsonFiles(workspaceRoot: string, logicalDirectory: string) {
  const stagedDirectory = calculationPath(workspaceRoot, logicalDirectory);
  if (!existsSync(stagedDirectory)) return [];
  return readdirSync(stagedDirectory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => resolve(logicalDirectory, name));
}

function calculationArtifacts(workspaceRoot: string, logicalPaths: string[]) {
  return logicalPaths.map((logicalPath) => {
    const stagedPath = calculationPath(workspaceRoot, logicalPath);
    if (!existsSync(stagedPath)) throw new Error(`计算结果缺失：${relative(workspaceRoot, stagedPath)}`);
    return { path: logicalPath, content: readFileSync(stagedPath, 'utf8') };
  });
}

async function syncCalculationArtifacts(workspaceRoot: string, logicalPaths: string[]) {
  await replaceMysqlObjects(calculationArtifacts(workspaceRoot, logicalPaths));
}

function readStrategyConfig(path: string, label: string): AssetRotationConfig {
  const config = JSON.parse(readStoredText(path)) as Partial<AssetRotationConfig>;
  if (!Number.isInteger(config.version) || !Array.isArray(config.symbols) || !config.symbols.every(isSymbolConfig)) {
    throw new Error(`${label}标的池配置无效`);
  }
  if (config.symbols.length < 2 || config.symbols.length > 20) throw new Error(`${label}标的池数量必须为 2—20 只`);
  if (new Set(config.symbols.map((item) => item.code)).size !== config.symbols.length) throw new Error(`${label}标的池存在重复代码`);
  return config as AssetRotationConfig;
}

function readRotationConfig() {
  return readStrategyConfig(rotationConfigPath, '宽基轮动');
}

function readRotationPendingConfig() {
  return storedFileExists(rotationPendingConfigPath)
    ? readStrategyConfig(rotationPendingConfigPath, '宽基轮动待应用')
    : null;
}

function readAssetRotationConfig() {
  return readStrategyConfig(assetRotationConfigPath, '大类资产轮动');
}

function readAssetRotationPendingConfig() {
  return storedFileExists(assetRotationPendingConfigPath)
    ? readStrategyConfig(assetRotationPendingConfigPath, '大类资产轮动待应用')
    : null;
}

function sameSymbolSet(left: Array<{ code: string }>, right: Array<{ code: string }>) {
  return left.map((item) => item.code).sort().join(',') === right.map((item) => item.code).sort().join(',');
}

export function getRotationPoolDraft(): AssetRotationPoolDraft {
  const active = readRotationConfig();
  const pending = readRotationPendingConfig();
  const dirty = Boolean(pending && !sameSymbolSet(active.symbols, pending.symbols));
  const current = dirty ? pending! : active;
  return {
    dirty,
    activeVersion: active.version,
    version: current.version,
    updatedAt: current.updatedAt,
    symbols: current.symbols,
  };
}

function writeRotationPoolDraft(config: AssetRotationConfig) {
  const active = readRotationConfig();
  if (sameSymbolSet(active.symbols, config.symbols)) {
    if (storedFileExists(rotationPendingConfigPath)) deleteStoredFile(rotationPendingConfigPath);
  } else {
    writeStrategyConfig(rotationPendingConfigPath, config);
  }
  return getRotationPoolDraft();
}

function readRotationCombinationConfig() {
  return readStrategyConfig(rotationCombinationConfigPath, '宽基全组合收益排名');
}

function readRotationCombinationPendingConfig() {
  return storedFileExists(rotationCombinationPendingConfigPath)
    ? readStrategyConfig(rotationCombinationPendingConfigPath, '宽基全组合收益排名待应用')
    : null;
}

export function getRotationCombinationPoolDraft(): AssetRotationPoolDraft {
  const active = readRotationCombinationConfig();
  const pending = readRotationCombinationPendingConfig();
  const dirty = Boolean(pending && !sameSymbolSet(active.symbols, pending.symbols));
  const current = dirty ? pending! : active;
  return {
    dirty,
    activeVersion: active.version,
    version: current.version,
    updatedAt: current.updatedAt,
    symbols: current.symbols,
  };
}

function writeRotationCombinationPoolDraft(config: AssetRotationConfig) {
  const active = readRotationCombinationConfig();
  if (sameSymbolSet(active.symbols, config.symbols)) {
    if (storedFileExists(rotationCombinationPendingConfigPath)) deleteStoredFile(rotationCombinationPendingConfigPath);
  } else {
    writeStrategyConfig(rotationCombinationPendingConfigPath, config);
  }
  return getRotationCombinationPoolDraft();
}

export function getAssetRotationPoolDraft(): AssetRotationPoolDraft {
  const active = readAssetRotationConfig();
  const pending = readAssetRotationPendingConfig();
  const dirty = Boolean(pending && !sameSymbolSet(active.symbols, pending.symbols));
  const current = dirty ? pending! : active;
  return {
    dirty,
    activeVersion: active.version,
    version: current.version,
    updatedAt: current.updatedAt,
    symbols: current.symbols,
  };
}

function writeAssetRotationPoolDraft(config: AssetRotationConfig) {
  const active = readAssetRotationConfig();
  if (sameSymbolSet(active.symbols, config.symbols)) {
    if (storedFileExists(assetRotationPendingConfigPath)) deleteStoredFile(assetRotationPendingConfigPath);
  } else {
    writeStrategyConfig(assetRotationPendingConfigPath, config);
  }
  return getAssetRotationPoolDraft();
}

function readAssetCombinationConfig() {
  return readStrategyConfig(assetCombinationConfigPath, '全组合收益排名');
}

function readAssetCombinationPendingConfig() {
  return storedFileExists(assetCombinationPendingConfigPath)
    ? readStrategyConfig(assetCombinationPendingConfigPath, '全组合收益排名待应用')
    : null;
}

export function getAssetCombinationPoolDraft(): AssetRotationPoolDraft {
  const active = readAssetCombinationConfig();
  const pending = readAssetCombinationPendingConfig();
  const dirty = Boolean(pending && !sameSymbolSet(active.symbols, pending.symbols));
  const current = dirty ? pending! : active;
  return {
    dirty,
    activeVersion: active.version,
    version: current.version,
    updatedAt: current.updatedAt,
    symbols: current.symbols,
  };
}

function writeAssetCombinationPoolDraft(config: AssetRotationConfig) {
  const active = readAssetCombinationConfig();
  if (sameSymbolSet(active.symbols, config.symbols)) {
    if (storedFileExists(assetCombinationPendingConfigPath)) deleteStoredFile(assetCombinationPendingConfigPath);
  } else {
    writeStrategyConfig(assetCombinationPendingConfigPath, config);
  }
  return getAssetCombinationPoolDraft();
}

function readDualEtfConfig() {
  return readStrategyConfig(dualEtfConfigPath, '双 ETF 动量轮动');
}

function writeTextAtomic(path: string, content: string) {
  if (!isMysqlEnabled()) throw new Error('MySQL 尚未初始化');
  void queueMysqlObjectWrite(path, content);
}

function strategyConfigText(path: string, config: AssetRotationConfig) {
  const comment = path === rotationConfigPath || path === rotationPendingConfigPath
    ? '页面“宽基 20 日动量轮动”中的“轮动标的池”配置；修改后需重新计算，才会更新行情、近10年回测和2026年交易节点。'
    : path === rotationCombinationConfigPath || path === rotationCombinationPendingConfigPath
      ? '页面“宽基 20 日动量轮动”的“全组合收益排名”中的“组合池”配置；仅这里的 ETF 参与组合枚举和排名计算。'
      : path === assetRotationConfigPath || path === assetRotationPendingConfigPath
    ? '页面“全球大类资产 ETF 轮动”中的“轮动标的池”配置；修改后需重新计算，才会更新行情、近10年回测和2026年交易节点。'
    : path === assetCombinationConfigPath || path === assetCombinationPendingConfigPath
      ? '页面“全组合收益排名”中的“组合池”配置；仅这里的 ETF 参与组合枚举和排名计算。'
      : null;
  return `${JSON.stringify(comment ? { _comment: comment, ...config } : config, null, 2)}\n`;
}

function writeStrategyConfig(path: string, config: AssetRotationConfig) {
  writeTextAtomic(path, strategyConfigText(path, config));
}

function readStrategyBacktest(path: string, strategy: IndexStrategy, config: AssetRotationConfig, label: string): AssetRotationBacktest {
  const backtest = JSON.parse(readStoredText(path)) as AssetRotationBacktest;
  const expectedVersion = strategy === 'asset-rotation'
    ? 'asset-rotation-return20-ma28-weekly-v1'
    : strategy === 'dual-etf'
      ? 'dual-etf-return20-ma20-daily-v1'
      : 'rotation-ma20-daily-v1';
  if (
    backtest.version !== expectedVersion
    || backtest.strategy !== strategy
    || backtest.configVersion !== config.version
    || !Array.isArray(backtest.symbols)
    || backtest.symbols.map((item) => item.code).join(',') !== config.symbols.map((item) => item.code).join(',')
    || !Array.isArray(backtest.annualReturns)
  ) throw new Error(`${label}近 10 年回测与当前标的池不一致，请重新计算`);
  return backtest;
}

function readRotationBacktest(config = readRotationConfig()) {
  return readStrategyBacktest(rotationBacktestPath, 'rotation', config, '宽基轮动');
}

function readAssetRotationBacktest(config = readAssetRotationConfig()) {
  return readStrategyBacktest(assetRotationBacktestPath, 'asset-rotation', config, '大类资产轮动');
}

export async function getRotationCombinations(sort: AssetRotationCombinationSort, direction: AssetRotationCombinationDirection, page: number, pageSize: number, filters: AssetRotationCombinationFilters = {}) {
  const databasePage = await getMysqlCombinationPage('rotation', sort, direction, page, pageSize, filters);
  if (!databasePage) throw new Error('MySQL 中缺少策略 1 组合排名数据');
  return { ...databasePage, poolDraft: getRotationCombinationPoolDraft() };
}

export async function getAssetRotationCombinations(sort: AssetRotationCombinationSort, direction: AssetRotationCombinationDirection, page: number, pageSize: number, filters: AssetRotationCombinationFilters = {}) {
  const databasePage = await getMysqlCombinationPage('asset-rotation', sort, direction, page, pageSize, filters);
  if (!databasePage) throw new Error('MySQL 中缺少策略 2 组合排名数据');
  return { ...databasePage, poolDraft: getAssetCombinationPoolDraft() };
}

function readDualEtfBacktest(config = readDualEtfConfig()) {
  return readStrategyBacktest(dualEtfBacktestPath, 'dual-etf', config, '双 ETF 动量轮动');
}

function writeRotationYearPerformance(
  strategy: IndexStrategy,
  performance: RotationYearPerformance,
  provider: string,
  calculatedAt: string,
) {
  const directory = strategy === 'asset-rotation'
    ? assetRotationYearPerformanceDirectory
    : strategy === 'dual-etf'
      ? dualEtfYearPerformanceDirectory
      : rotationYearPerformanceDirectory;
  const strategyConfig = strategy === 'asset-rotation'
    ? readAssetRotationConfig()
    : strategy === 'dual-etf'
      ? readDualEtfConfig()
      : readRotationConfig();
  const path = resolve(directory, `${performance.year}.json`);
  const record = {
    version: strategy === 'asset-rotation'
      ? 'asset-rotation-year-performance-v5'
      : strategy === 'dual-etf'
        ? 'dual-etf-year-performance-v2'
        : 'rotation-year-performance-v5',
    strategy,
    configVersion: strategyConfig.version,
    symbols: strategyConfig.symbols,
    provider,
    calculatedAt,
    ...performance,
  };
  writeTextAtomic(path, `${JSON.stringify(record, null, 2)}\n`);
}

function readRotationYearPerformance(strategy: IndexStrategy, year: number) {
  const directory = strategy === 'asset-rotation'
    ? assetRotationYearPerformanceDirectory
    : strategy === 'dual-etf'
      ? dualEtfYearPerformanceDirectory
      : rotationYearPerformanceDirectory;
  const path = resolve(directory, `${year}.json`);
  if (!storedFileExists(path)) return null;
  try {
    const record = JSON.parse(readStoredText(path)) as RotationYearPerformance & { strategy?: string; version?: string; configVersion?: number };
    const expectedVersion = strategy === 'asset-rotation'
      ? 'asset-rotation-year-performance-v5'
      : strategy === 'dual-etf'
        ? 'dual-etf-year-performance-v2'
        : 'rotation-year-performance-v5';
    const expectedConfigVersion = strategy === 'asset-rotation'
      ? readAssetRotationConfig().version
      : strategy === 'dual-etf'
        ? readDualEtfConfig().version
        : readRotationConfig().version;
    if (
      record.version !== expectedVersion
      || record.strategy !== strategy
      || record.configVersion !== expectedConfigVersion
      || record.year !== year
      || !Array.isArray(record.nodes)
      || !Array.isArray(record.equityCurve)
      || typeof record.lastTradingDate !== 'string'
      || record.nodeCount !== record.nodes.length
      || record.equityCurve.some((point) => typeof point.date !== 'string' || typeof point.returnRate !== 'number')
      || (record.currentTradeReturn !== null && typeof record.currentTradeReturn !== 'number')
      || record.nodes.some((node) => node.tradeReturn !== null && typeof node.tradeReturn !== 'number')
    ) return null;
    return record;
  } catch {
    return null;
  }
}

type TushareResponse = {
  code: number;
  msg?: string;
  data?: { fields?: string[]; items?: Array<Array<string | number | null>> };
};

type DailyRow = { tsCode: string; tradeDate: string; close: number; previousClose: number; change: number };
type PullbackDailyRow = DailyRow & { open: number; high: number; low: number; volume: number };
type CandidateSignal = Omit<MacdSignal, 'name'> & { tsCode: string };
type PullbackCandidate = Omit<MacdPullbackSignal, 'name'> & { tsCode: string };
type MacdKdjCandidate = Omit<MacdKdjSignal, 'name'> & { tsCode: string };
type VolumeCandidate = Omit<VolumeSignal, 'name'> & { tsCode: string };
type BullPointCandidate = Omit<BullPointSignal, 'name'> & { tsCode: string };

function tushareToken() {
  if (process.env.TUSHARE_TOKEN) return process.env.TUSHARE_TOKEN;
  try {
    const entry = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
      .split(/\r?\n/)
      .find((line) => line.startsWith('TUSHARE_TOKEN='));
    return entry?.slice('TUSHARE_TOKEN='.length).trim();
  } catch {
    return undefined;
  }
}

async function callTushare(apiName: string, params: Record<string, string | number>, requestedFields = '') {
  const token = tushareToken();
  if (!token) throw new Error('未配置 TUSHARE_TOKEN，无法扫描全市场 MACD 信号');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch('https://api.tushare.pro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'rotation-market-desk/1.0' },
      body: JSON.stringify({ api_name: apiName, token, params, fields: requestedFields }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Tushare ${apiName} 接口返回 HTTP ${response.status}`);
    const payload = await response.json() as TushareResponse;
    if (payload.code === 0) {
      const fields = payload.data?.fields ?? [];
      return (payload.data?.items ?? []).map((values) => Object.fromEntries(fields.map((field, index) => [field, values[index]])));
    }
    if (attempt === 0 && payload.msg?.includes('频率超限')) {
      await wait(61_000);
      continue;
    }
    throw new Error(payload.msg || `Tushare ${apiName} 请求失败`);
  }
  throw new Error(`Tushare ${apiName} 请求失败`);
}

function dateText(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function normalizeSnapshotDate(value: string | undefined) {
  const date = value ?? dateText(new Date());
  if (!/^\d{8}$/.test(date)) throw new Error('日期必须使用 YYYYMMDD 格式');
  return date;
}

async function latestTradingDateOnOrBefore(date: string) {
  const cached = tradingDateCache.get(date);
  if (cached) return cached;
  const formattedDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
  const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,day,,${formattedDate},10,qfq`, {
    headers: { 'User-Agent': 'Mozilla/5.0 rotation-market-desk/1.0' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`交易日查询接口返回 HTTP ${response.status}`);
  const payload = await response.json() as { data?: Record<string, { qfqday?: TencentRow[]; day?: TencentRow[] }> };
  const block = payload.data?.sh000001;
  const latest = (block?.qfqday ?? block?.day ?? [])
    .map((row) => row[0])
    .filter((value) => value <= formattedDate)
    .sort()
    .at(-1)
    ?.replaceAll('-', '');
  if (!latest) throw new Error(`无法确定 ${date} 之前的最近交易日`);
  tradingDateCache.set(date, latest);
  return latest;
}

function macdSnapshotPath(date: string) {
  return resolve(macdSnapshotDirectory, `${date}.json`);
}

function readMacdSnapshot(date: string): MacdSnapshot | null {
  const path = macdSnapshotPath(date);
  if (!storedFileExists(path)) return null;
  try {
    const snapshot = JSON.parse(readStoredText(path)) as MacdSnapshot & { version?: string };
    if (snapshot.version !== macdSnapshotVersion || !Array.isArray(snapshot.signals) || !snapshot.lastTradingDate) return null;
    return {
      ...snapshot,
      firstCrossCount: snapshot.signals.length,
      storageDate: date,
      cached: true,
    };
  } catch {
    return null;
  }
}

function writeMacdSnapshot(snapshot: MacdSnapshot) {
  const path = macdSnapshotPath(snapshot.storageDate);
  writeTextAtomic(path, `${JSON.stringify({ ...snapshot, version: macdSnapshotVersion, cached: false }, null, 2)}\n`);
}

export function listMacdSnapshotDates() {
  return storedJsonNames(macdSnapshotDirectory)
    .map((file) => /^(\d{8})\.json$/.exec(file)?.[1])
    .filter((date): date is string => Boolean(date))
    .sort((a, b) => b.localeCompare(a));
}

function macdPullbackSnapshotPath(date: string) {
  return resolve(macdPullbackSnapshotDirectory, `${date}.json`);
}

function readMacdPullbackSnapshot(date: string): MacdPullbackSnapshot | null {
  const path = macdPullbackSnapshotPath(date);
  if (!storedFileExists(path)) return null;
  try {
    const snapshot = JSON.parse(readStoredText(path)) as MacdPullbackSnapshot & { version?: string };
    if (snapshot.version !== macdPullbackSnapshotVersion || !Array.isArray(snapshot.signals) || !snapshot.lastTradingDate) return null;
    return { ...snapshot, storageDate: date, cached: true };
  } catch {
    return null;
  }
}

function writeMacdPullbackSnapshot(snapshot: MacdPullbackSnapshot) {
  const path = macdPullbackSnapshotPath(snapshot.storageDate);
  writeTextAtomic(path, `${JSON.stringify({ ...snapshot, version: macdPullbackSnapshotVersion, cached: false }, null, 2)}\n`);
}

export function listMacdPullbackSnapshotDates() {
  return storedJsonNames(macdPullbackSnapshotDirectory)
    .map((file) => /^(\d{8})\.json$/.exec(file)?.[1])
    .filter((date): date is string => Boolean(date))
    .sort((left, right) => right.localeCompare(left));
}

function macdKdjSnapshotPath(date: string) {
  return resolve(macdKdjSnapshotDirectory, `${date}.json`);
}

function readMacdKdjSnapshot(date: string): MacdKdjSnapshot | null {
  const path = macdKdjSnapshotPath(date);
  if (!storedFileExists(path)) return null;
  try {
    const snapshot = JSON.parse(readStoredText(path)) as MacdKdjSnapshot & { version?: string };
    if (snapshot.version !== macdKdjSnapshotVersion || !Array.isArray(snapshot.signals) || !snapshot.lastTradingDate) return null;
    return { ...snapshot, storageDate: date, cached: true };
  } catch {
    return null;
  }
}

function writeMacdKdjSnapshot(snapshot: MacdKdjSnapshot) {
  const path = macdKdjSnapshotPath(snapshot.storageDate);
  writeTextAtomic(path, `${JSON.stringify({ ...snapshot, version: macdKdjSnapshotVersion, cached: false }, null, 2)}\n`);
}

export function listMacdKdjSnapshotDates() {
  return storedJsonNames(macdKdjSnapshotDirectory)
    .map((file) => /^(\d{8})\.json$/.exec(file)?.[1])
    .filter((date): date is string => Boolean(date))
    .sort((left, right) => right.localeCompare(left));
}

function volumeSnapshotPath(date: string) {
  return resolve(volumeSnapshotDirectory, `${date}.json`);
}

function readVolumeSnapshot(date: string): VolumeSnapshot | null {
  const path = volumeSnapshotPath(date);
  if (!storedFileExists(path)) return null;
  try {
    const snapshot = JSON.parse(readStoredText(path)) as VolumeSnapshot & { version?: string };
    if (snapshot.version !== volumeSnapshotVersion || !Array.isArray(snapshot.signals) || !snapshot.lastTradingDate) return null;
    return { ...snapshot, storageDate: date, cached: true };
  } catch {
    return null;
  }
}

function writeVolumeSnapshot(snapshot: VolumeSnapshot) {
  const path = volumeSnapshotPath(snapshot.storageDate);
  writeTextAtomic(path, `${JSON.stringify({ ...snapshot, version: volumeSnapshotVersion, cached: false }, null, 2)}\n`);
}

export function listVolumeSnapshotDates() {
  return storedJsonNames(volumeSnapshotDirectory)
    .map((file) => /^(\d{8})\.json$/.exec(file)?.[1])
    .filter((date): date is string => Boolean(date))
    .sort((left, right) => right.localeCompare(left));
}

function bullPointSnapshotPath(date: string) {
  return resolve(bullPointSnapshotDirectory, `${date}.json`);
}

function readBullPointSnapshot(date: string): BullPointSnapshot | null {
  const path = bullPointSnapshotPath(date);
  if (!storedFileExists(path)) return null;
  try {
    const snapshot = JSON.parse(readStoredText(path)) as BullPointSnapshot & { version?: string };
    if (snapshot.version !== bullPointSnapshotVersion || !Array.isArray(snapshot.signals) || !snapshot.lastTradingDate) return null;
    return { ...snapshot, storageDate: date, cached: true };
  } catch {
    return null;
  }
}

function writeBullPointSnapshot(snapshot: BullPointSnapshot) {
  const path = bullPointSnapshotPath(snapshot.storageDate);
  writeTextAtomic(path, `${JSON.stringify({ ...snapshot, version: bullPointSnapshotVersion, cached: false }, null, 2)}\n`);
}

export function listBullPointSnapshotDates() {
  return storedJsonNames(bullPointSnapshotDirectory)
    .map((file) => /^(\d{8})\.json$/.exec(file)?.[1])
    .filter((date): date is string => Boolean(date))
    .sort((left, right) => right.localeCompare(left));
}

function recentWeekdays(count: number, endDate = new Date()) {
  const dates: string[] = [];
  const cursor = new Date(endDate);
  while (dates.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) dates.push(dateText(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates.reverse();
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function ema(values: number[], period: number) {
  const multiplier = 2 / (period + 1);
  return values.reduce<number[]>((result, value, index) => {
    result.push(index === 0 ? value : value * multiplier + result[index - 1] * (1 - multiplier));
    return result;
  }, []);
}

function simpleMovingAverage(values: number[], period: number) {
  return values.map((_, index) => {
    if (index < period - 1) return Number.NaN;
    return values.slice(index - period + 1, index + 1).reduce((sum, value) => sum + value, 0) / period;
  });
}

function calculateMacd(closes: number[], fastPeriod = 10, slowPeriod = 20, signalPeriod = 7) {
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);
  const dif = fastEma.map((value, index) => value - slowEma[index]);
  const dea = ema(dif, signalPeriod);
  return { dif, dea, histogram: dif.map((value, index) => 2 * (value - dea[index])) };
}

function calculateKdj(rows: PullbackDailyRow[], period = 9) {
  const k: number[] = [];
  const d: number[] = [];
  const j: number[] = [];
  rows.forEach((row, index) => {
    const window = rows.slice(Math.max(0, index - period + 1), index + 1);
    const lowest = Math.min(...window.map((item) => item.low));
    const highest = Math.max(...window.map((item) => item.high));
    const rsv = highest === lowest ? 50 : ((row.close - lowest) / (highest - lowest)) * 100;
    const previousK = k[index - 1] ?? 50;
    const previousD = d[index - 1] ?? 50;
    k.push((2 * previousK + rsv) / 3);
    d.push((2 * previousD + k[index]) / 3);
    j.push(3 * k[index] - 2 * d[index]);
  });
  return { k, d, j };
}

function marketCode(tsCode: string) {
  const [code, exchange] = tsCode.split('.');
  const prefix = exchange === 'SH' ? 'sh' : exchange === 'BJ' ? 'bj' : 'sz';
  return `${prefix}${code}`;
}

async function fetchTencentQuotes(tsCodes: string[]) {
  const quotes = new Map<string, TencentQuote>();
  for (let index = 0; index < tsCodes.length; index += 50) {
    const codes = tsCodes.slice(index, index + 50);
    const response = await fetch(`https://qt.gtimg.cn/q=${codes.map(marketCode).join(',')}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 rotation-market-desk/1.0' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) continue;
    const text = new TextDecoder('gb18030').decode(await response.arrayBuffer());
    for (const quote of text.split(';')) {
      const match = /v_(?:sh|sz|bj)(\d+)="([^"]*)"/.exec(quote);
      if (!match) continue;
      const fields = match[2].split('~');
      const code = fields[2] || match[1];
      const name = fields[1];
      const price = Number(fields[3]);
      const previousClose = Number(fields[4]);
      const open = Number(fields[5]);
      const volume = Number(fields[6]);
      const timestamp = fields[30];
      const high = Number(fields[33]);
      const low = Number(fields[34]);
      const date = /^\d{8}/.test(timestamp) ? `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}` : undefined;
      if (name) {
        quotes.set(code, {
          name,
          price: Number.isFinite(price) && price > 0 ? price : undefined,
          previousClose: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : undefined,
          open: Number.isFinite(open) && open > 0 ? open : undefined,
          high: Number.isFinite(high) && high > 0 ? high : undefined,
          low: Number.isFinite(low) && low > 0 ? low : undefined,
          volume: Number.isFinite(volume) && volume >= 0 ? volume : undefined,
          date,
          timestamp,
        });
      }
    }
  }
  return quotes;
}

async function fetchTencentNames(tsCodes: string[]) {
  const quotes = await fetchTencentQuotes(tsCodes);
  return new Map([...quotes].map(([code, quote]) => [code, quote.name]));
}

async function withCurrentPrices(snapshot: MacdSnapshot) {
  try {
    const tsCodes = snapshot.signals.map((item) => `${item.code}.${item.code.startsWith('6') ? 'SH' : 'SZ'}`);
    const quotes = await fetchTencentQuotes(tsCodes);
    return {
      ...snapshot,
      signals: snapshot.signals.map((signal) => {
        const currentPrice = quotes.get(signal.code)?.price;
        return {
          ...signal,
          currentPrice: currentPrice === undefined ? undefined : round(currentPrice),
          changeSinceSignal: currentPrice === undefined || signal.close <= 0
            ? undefined
            : round(((currentPrice / signal.close) - 1) * 100, 2),
        };
      }),
    };
  } catch {
    return snapshot;
  }
}

async function withCurrentPullbackPrices(snapshot: MacdPullbackSnapshot) {
  try {
    const tsCodes = snapshot.signals.map((item) => `${item.code}.${item.code.startsWith('6') ? 'SH' : 'SZ'}`);
    const quotes = await fetchTencentQuotes(tsCodes);
    return {
      ...snapshot,
      signals: snapshot.signals.map((signal) => {
        const currentPrice = quotes.get(signal.code)?.price;
        return {
          ...signal,
          currentPrice: currentPrice === undefined ? undefined : round(currentPrice),
          changeSinceSignal: currentPrice === undefined || signal.close <= 0
            ? undefined
            : round(((currentPrice / signal.close) - 1) * 100, 2),
        };
      }),
    };
  } catch {
    return snapshot;
  }
}

async function withCurrentMacdKdjPrices(snapshot: MacdKdjSnapshot) {
  try {
    const tsCodes = snapshot.signals.map((item) => `${item.code}.${item.code.startsWith('6') ? 'SH' : 'SZ'}`);
    const quotes = await fetchTencentQuotes(tsCodes);
    return {
      ...snapshot,
      signals: snapshot.signals.map((signal) => {
        const currentPrice = quotes.get(signal.code)?.price;
        return {
          ...signal,
          currentPrice: currentPrice === undefined ? undefined : round(currentPrice),
          changeSinceSignal: currentPrice === undefined || signal.close <= 0
            ? undefined
            : round(((currentPrice / signal.close) - 1) * 100, 2),
        };
      }),
    };
  } catch {
    return snapshot;
  }
}

async function withCurrentVolumePrices(snapshot: VolumeSnapshot) {
  try {
    const tsCodes = snapshot.signals.map((item) => `${item.code}.${item.code.startsWith('6') ? 'SH' : 'SZ'}`);
    const quotes = await fetchTencentQuotes(tsCodes);
    return {
      ...snapshot,
      signals: snapshot.signals.map((signal) => {
        const currentPrice = quotes.get(signal.code)?.price;
        return {
          ...signal,
          currentPrice: currentPrice === undefined ? undefined : round(currentPrice),
          changeSinceSignal: currentPrice === undefined || signal.close <= 0
            ? undefined
            : round(((currentPrice / signal.close) - 1) * 100, 2),
        };
      }),
    };
  } catch {
    return snapshot;
  }
}

async function withCurrentBullPointPrices(snapshot: BullPointSnapshot) {
  try {
    const tsCodes = snapshot.signals.map((item) => `${item.code}.${item.code.startsWith('6') ? 'SH' : 'SZ'}`);
    const quotes = await fetchTencentQuotes(tsCodes);
    return {
      ...snapshot,
      signals: snapshot.signals.map((signal) => {
        const currentPrice = quotes.get(signal.code)?.price;
        return {
          ...signal,
          currentPrice: currentPrice === undefined ? undefined : round(currentPrice),
          changeSinceSignal: currentPrice === undefined || signal.close <= 0
            ? undefined
            : round(((currentPrice / signal.close) - 1) * 100, 2),
        };
      }),
    };
  } catch {
    return snapshot;
  }
}

function parseRow(row: TencentRow): Candle {
  return {
    date: row[0],
    open: Number(row[1]),
    close: Number(row[2]),
    high: Number(row[3]),
    low: Number(row[4]),
    volume: Number(row[5]),
  };
}

async function fetchSymbol(config: SymbolConfig) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${config.marketCode},day,,,320,qfq`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 rotation-market-desk/1.0' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${config.code} 行情接口返回 HTTP ${response.status}`);

  const payload = await response.json() as {
    data?: Record<string, { qfqday?: TencentRow[]; day?: TencentRow[] }>;
  };
  const block = payload.data?.[config.marketCode];
  const rows = block?.qfqday ?? block?.day ?? [];
  if (rows.length < 20) throw new Error(`${config.code} 有效日线不足 20 条`);

  return {
    ...config,
    rawLastDate: rows.at(-1)![0],
    history: rows.map(parseRow),
    candles: rows.slice(-90).map(parseRow),
  };
}

async function fetchFullQfqSymbol(config: SymbolConfig) {
  const endYear = Number(shanghaiClock().date.slice(0, 4));
  const rows = new Map<string, TencentRow>();
  for (let startYear = 2015; startYear <= endYear; startYear += 2) {
    const endRangeYear = Math.min(startYear + 1, endYear);
    const start = `${startYear}-01-01`;
    const end = `${endRangeYear}-12-31`;
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${config.marketCode},day,${start},${end},640,qfq`;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 rotation-market-desk/1.0' },
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) throw new Error(`${config.code} 历史行情接口返回 HTTP ${response.status}`);
        const payload = await response.json() as {
          data?: Record<string, { qfqday?: TencentRow[]; day?: TencentRow[] }>;
        };
        const block = payload.data?.[config.marketCode];
        for (const row of block?.qfqday ?? block?.day ?? []) rows.set(row[0], row);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 400));
      }
    }
    if (lastError) throw lastError;
  }
  const history = [...rows.values()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(parseRow);
  if (history.length < 20) throw new Error(`${config.code} 完整前复权日线不足 20 条`);
  return {
    ...config,
    rawLastDate: history.at(-1)!.date,
    history,
    candles: history.slice(-90),
  };
}

function calculateRotationYearPerformance(markets: Awaited<ReturnType<typeof fetchSymbol>>[]): RotationYearPerformance {
  const names = new Map(markets.map((market) => [market.code, market.name]));
  const closes = new Map(markets.map((market) => [
    market.code,
    new Map(market.history.map((candle) => [candle.date, candle.close])),
  ]));
  const indicators = new Map(markets.map((market) => {
    const byDate = new Map<string, { close: number; ma20: number; momentum: number }>();
    market.history.forEach((candle, index) => {
      if (index < 19) return;
      const ma20 = market.history.slice(index - 19, index + 1)
        .reduce((sum, item) => sum + item.close, 0) / 20;
      byDate.set(candle.date, { close: candle.close, ma20, momentum: candle.close / ma20 - 1 });
    });
    return [market.code, byDate] as const;
  }));
  const dates = [...new Set(markets.flatMap((market) => market.history.map((candle) => candle.date)))].sort();
  const lastTradingDate = dates.at(-1)!;
  const year = Number(lastTradingDate.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearDates = dates.filter((date) => date >= yearStart);

  const positionFor = (date: string) => {
    const leader = markets
      .map((market) => ({ code: market.code, ...indicators.get(market.code)?.get(date) }))
      .filter((item): item is { code: string; close: number; ma20: number; momentum: number } => Number.isFinite(item.momentum))
      .sort((left, right) => right.momentum - left.momentum)[0];
    return leader && leader.close > leader.ma20 ? leader.code : null;
  };

  const previousYearDate = dates.filter((date) => date < yearStart).at(-1) ?? null;
  let previousDate = previousYearDate;
  let position = previousYearDate ? positionFor(previousYearDate) : null;
  let value = 1;
  let operationStartValue = value;
  const equityCurve: RotationEquityPoint[] = [];
  const nodes: RotationTradeNode[] = [];

  for (const date of yearDates) {
    if (position && previousDate) {
      const previousClose = closes.get(position)?.get(previousDate);
      const currentClose = closes.get(position)?.get(date);
      if (previousClose && currentClose) value *= currentClose / previousClose;
    }
    equityCurve.push({ date, returnRate: round((value - 1) * 100, 4) });

    const nextPosition = positionFor(date);
    if (nextPosition !== position) {
      const action = position ? (nextPosition ? '轮换' : '清仓') : '买入';
      nodes.push({
        date,
        action,
        fromCode: position,
        fromName: position ? names.get(position) ?? position : null,
        toCode: nextPosition,
        toName: nextPosition ? names.get(nextPosition) ?? nextPosition : null,
        reason: nextPosition ? `${names.get(nextPosition) ?? nextPosition} 动量排名第 1 且站上 MA20` : '领先标的未站上 MA20，转为空仓',
        tradeReturn: action === '买入' ? null : round((value / operationStartValue - 1) * 100, 2),
        cumulativeReturn: round((value - 1) * 100, 2),
      });
      operationStartValue = value;
    }
    position = nextPosition;
    previousDate = date;
  }

  return {
    year,
    startDate: yearDates[0] ?? lastTradingDate,
    lastTradingDate,
    cumulativeReturn: round((value - 1) * 100, 2),
    nodeCount: nodes.length,
    currentHolding: position ? names.get(position) ?? position : null,
    currentTradeReturn: position ? round((value / operationStartValue - 1) * 100, 2) : null,
    equityCurve,
    nodes,
  };
}

function calculateDualEtfYearPerformance(markets: Awaited<ReturnType<typeof fetchSymbol>>[]): RotationYearPerformance {
  const names = new Map(markets.map((market) => [market.code, market.name]));
  const closes = new Map(markets.map((market) => [
    market.code,
    new Map(market.history.map((candle) => [candle.date, candle.close])),
  ]));
  const indicators = new Map(markets.map((market) => {
    const byDate = new Map<string, { close: number; ma20: number; momentum: number }>();
    market.history.forEach((candle, index) => {
      if (index < 20) return;
      const ma20 = market.history.slice(index - 19, index + 1)
        .reduce((sum, item) => sum + item.close, 0) / 20;
      byDate.set(candle.date, {
        close: candle.close,
        ma20,
        momentum: candle.close / market.history[index - 20].close - 1,
      });
    });
    return [market.code, byDate] as const;
  }));
  const dates = [...new Set(markets.flatMap((market) => market.history.map((candle) => candle.date)))].sort();
  const lastTradingDate = dates.at(-1)!;
  const year = Number(lastTradingDate.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearDates = dates.filter((date) => date >= yearStart);

  const positionFor = (date: string) => {
    const leader = markets
      .map((market) => ({ code: market.code, ...indicators.get(market.code)?.get(date) }))
      .filter((item): item is { code: string; close: number; ma20: number; momentum: number } => Number.isFinite(item.momentum))
      .sort((left, right) => right.momentum - left.momentum)[0];
    return leader && leader.close >= leader.ma20 ? leader.code : null;
  };

  const previousYearDate = dates.filter((date) => date < yearStart).at(-1) ?? null;
  let previousDate = previousYearDate;
  let position = previousYearDate ? positionFor(previousYearDate) : null;
  let value = 1;
  let operationStartValue = value;
  const equityCurve: RotationEquityPoint[] = [];
  const nodes: RotationTradeNode[] = [];

  for (const date of yearDates) {
    if (position && previousDate) {
      const previousClose = closes.get(position)?.get(previousDate);
      const currentClose = closes.get(position)?.get(date);
      if (previousClose && currentClose) value *= currentClose / previousClose;
    }
    equityCurve.push({ date, returnRate: round((value - 1) * 100, 4) });

    const nextPosition = positionFor(date);
    if (nextPosition !== position) {
      const action = position ? (nextPosition ? '轮换' : '清仓') : '买入';
      const fromName = position ? names.get(position) ?? position : null;
      const toName = nextPosition ? names.get(nextPosition) ?? nextPosition : null;
      nodes.push({
        date,
        action,
        fromCode: position,
        fromName,
        toCode: nextPosition,
        toName,
        reason: nextPosition
          ? position
            ? `${toName} 20日涨幅升至第 1 且站上 MA20，轮换持仓`
            : `${toName} 20日涨幅排名第 1 且站上 MA20`
          : '领先 ETF 未站上 MA20，转为空仓',
        tradeReturn: action === '买入' ? null : round((value / operationStartValue - 1) * 100, 2),
        cumulativeReturn: round((value - 1) * 100, 2),
      });
      operationStartValue = value;
    }
    position = nextPosition;
    previousDate = date;
  }

  return {
    year,
    startDate: yearDates[0] ?? lastTradingDate,
    lastTradingDate,
    cumulativeReturn: round((value - 1) * 100, 2),
    nodeCount: nodes.length,
    currentHolding: position ? names.get(position) ?? position : null,
    currentTradeReturn: position ? round((value / operationStartValue - 1) * 100, 2) : null,
    equityCurve,
    nodes,
  };
}

function mergeCurrentQuote<T extends Awaited<ReturnType<typeof fetchSymbol>>>(market: T, quote?: TencentQuote): T & {
  realtimePreviousClose?: number;
  realtimeTimestamp?: string;
} {
  if (!quote?.date || quote.price === undefined || quote.date < market.rawLastDate) {
    return { ...market, realtimePreviousClose: undefined, realtimeTimestamp: undefined };
  }

  const history = [...market.history];
  const previous = history.at(-1)!;
  const sameTradingDate = quote.date === previous.date;
  const open = quote.open ?? (sameTradingDate ? previous.open : quote.previousClose) ?? quote.price;
  const high = quote.high ?? Math.max(open, quote.price);
  const low = quote.low ?? Math.min(open, quote.price);
  const current: Candle = {
    date: quote.date,
    open,
    close: quote.price,
    high: Math.max(high, open, quote.price),
    low: Math.min(low, open, quote.price),
    volume: quote.volume ?? (sameTradingDate ? previous.volume : 0),
  };
  if (sameTradingDate) history[history.length - 1] = current;
  else history.push(current);

  return {
    ...market,
    rawLastDate: quote.date,
    history,
    candles: history.slice(-90),
    realtimePreviousClose: quote.previousClose,
    realtimeTimestamp: quote.timestamp,
  };
}

function shanghaiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minutes: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function isCompletedTradingDay(quoteDate: string, now = new Date()) {
  const shanghai = shanghaiClock(now);
  if (quoteDate < shanghai.date) return true;
  return quoteDate === shanghai.date && shanghai.minutes >= 15 * 60 + 5;
}

function calculateAssetRotationYearPerformance(markets: Awaited<ReturnType<typeof fetchSymbol>>[]): RotationYearPerformance {
  const names = new Map(markets.map((market) => [market.code, market.name]));
  const closes = new Map(markets.map((market) => [
    market.code,
    new Map(market.history.map((candle) => [candle.date, candle.close])),
  ]));
  const indicators = new Map(markets.map((market) => {
    const byDate = new Map<string, { close: number; ma28: number; momentum: number }>();
    market.history.forEach((candle, index) => {
      if (index < 27) return;
      const ma28 = market.history.slice(index - 27, index + 1)
        .reduce((sum, item) => sum + item.close, 0) / 28;
      byDate.set(candle.date, {
        close: candle.close,
        ma28,
        momentum: candle.close / market.history[index - 20].close - 1,
      });
    });
    return [market.code, byDate] as const;
  }));
  const dates = [...new Set(markets.flatMap((market) => market.history.map((candle) => candle.date)))].sort();
  const lastTradingDate = dates.at(-1)!;
  const year = Number(lastTradingDate.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearDates = dates.filter((date) => date >= yearStart);
  const reviewDates = new Set(dates.filter((date, index) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (day === 5) return true;
    const nextDate = dates[index + 1];
    if (!nextDate) return false;
    const currentWeek = new Date(`${date}T00:00:00Z`);
    const nextWeek = new Date(`${nextDate}T00:00:00Z`);
    currentWeek.setUTCDate(currentWeek.getUTCDate() - ((currentWeek.getUTCDay() + 6) % 7));
    nextWeek.setUTCDate(nextWeek.getUTCDate() - ((nextWeek.getUTCDay() + 6) % 7));
    return currentWeek.getTime() !== nextWeek.getTime();
  }));
  const rankingFor = (date: string) => markets
    .map((market) => ({ code: market.code, ...indicators.get(market.code)?.get(date) }))
    .filter((item): item is { code: string; close: number; ma28: number; momentum: number } => Number.isFinite(item.momentum))
    .sort((left, right) => right.momentum - left.momentum);
  const positionFor = (date: string, current: string | null) => {
    const ranked = rankingFor(date);
    if (current) {
      const holdingRank = ranked.findIndex((item) => item.code === current);
      if (holdingRank >= 0 && holdingRank < 2 && ranked[holdingRank].close >= ranked[holdingRank].ma28) return current;
    }
    const leader = ranked[0];
    return leader && leader.close >= leader.ma28 ? leader.code : null;
  };

  let position: string | null = null;
  for (const date of dates) {
    if (date >= yearStart) break;
    if (reviewDates.has(date)) position = positionFor(date, position);
  }

  let previousDate = dates.filter((date) => date < yearStart).at(-1) ?? null;
  let value = 1;
  let operationStartValue = value;
  const equityCurve: RotationEquityPoint[] = [];
  const nodes: RotationTradeNode[] = [];
  for (const date of yearDates) {
    if (position && previousDate) {
      const previousClose = closes.get(position)?.get(previousDate);
      const currentClose = closes.get(position)?.get(date);
      if (previousClose && currentClose) value *= currentClose / previousClose;
    }
    equityCurve.push({ date, returnRate: round((value - 1) * 100, 4) });
    if (reviewDates.has(date)) {
      const nextPosition = positionFor(date, position);
      if (nextPosition !== position) {
        const action = position ? (nextPosition ? '轮换' : '清仓') : '买入';
        const fromName = position ? names.get(position) ?? position : null;
        const toName = nextPosition ? names.get(nextPosition) ?? nextPosition : null;
        nodes.push({
          date,
          action,
          fromCode: position,
          fromName,
          toCode: nextPosition,
          toName,
          reason: nextPosition
            ? position
              ? `${fromName} 跌出涨幅前 2 或跌破 MA28，轮换至排名第 1 的 ${toName}`
              : `${toName} 20日涨幅排名第 1 且站上 MA28`
            : '持仓跌出涨幅前 2 或跌破 MA28，且领先标的不满足入场条件',
          tradeReturn: action === '买入' ? null : round((value / operationStartValue - 1) * 100, 2),
          cumulativeReturn: round((value - 1) * 100, 2),
        });
        operationStartValue = value;
      }
      position = nextPosition;
    }
    previousDate = date;
  }

  return {
    year,
    startDate: yearDates[0] ?? lastTradingDate,
    lastTradingDate,
    cumulativeReturn: round((value - 1) * 100, 2),
    nodeCount: nodes.length,
    currentHolding: position ? names.get(position) ?? position : null,
    currentTradeReturn: position ? round((value / operationStartValue - 1) * 100, 2) : null,
    equityCurve,
    nodes,
  };
}

function getSymbol(code: string) {
  const symbol = [...readRotationConfig().symbols, ...readAssetRotationConfig().symbols, ...readDualEtfConfig().symbols].find((item) => item.code === code);
  if (symbol) return symbol;
  if (/^[03]\d{5}$/.test(code)) return { marketCode: `sz${code}`, code, name: code, category: 'A股宽基' as const };
  if (/^6\d{5}$/.test(code)) return { marketCode: `sh${code}`, code, name: code, category: 'A股宽基' as const };
  throw new Error(`不支持的行情代码：${code}`);
}

function parseMinuteRows(rows: string[]) {
  let previousVolume = 0;
  return rows.map((row) => {
    const [time, priceText, volumeText] = row.trim().split(/\s+/);
    const cumulativeVolume = Number(volumeText);
    const point = {
      time: `${time.slice(0, 2)}:${time.slice(2)}`,
      price: Number(priceText),
      volume: Math.max(0, cumulativeVolume - previousVolume),
    };
    previousVolume = cumulativeVolume;
    return point;
  }).filter((point) => Number.isFinite(point.price) && Number.isFinite(point.volume));
}

async function fetchMinuteHistory(config: SymbolConfig): Promise<MarketHistory> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${config.marketCode}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 rotation-market-desk/1.0' }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`${config.code} 分时接口返回 HTTP ${response.status}`);
  const payload = await response.json() as { data?: Record<string, { data?: { data?: string[]; date?: string }; qt?: Record<string, string[]> }> };
  const block = payload.data?.[config.marketCode];
  const points = parseMinuteRows(block?.data?.data ?? []);
  if (points.length === 0) throw new Error(`${config.code} 暂无有效分时数据`);
  const rawDate = block?.data?.date ?? '';
  return {
    code: config.code,
    name: config.name,
    period: 'minute',
    date: rawDate.length === 8 ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}` : rawDate,
    previousClose: Number(block?.qt?.[config.marketCode]?.[4]) || points[0].price,
    candles: [],
    points,
    provider: '腾讯证券公开行情',
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

async function fetchKlineHistory(config: SymbolConfig, period: Exclude<HistoryPeriod, 'minute'>): Promise<MarketHistory> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${config.marketCode},${period},,,640,qfq`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 rotation-market-desk/1.0' }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`${config.code} ${period} K线接口返回 HTTP ${response.status}`);
  const payload = await response.json() as { data?: Record<string, Record<string, TencentRow[]>> };
  const block = payload.data?.[config.marketCode] ?? {};
  const rows = block[`qfq${period}`] ?? block[period] ?? [];
  const candles = rows.map(parseRow);
  if (candles.length < 20) throw new Error(`${config.code} 有效 ${period} K线不足 20 条`);
  return {
    code: config.code,
    name: config.name,
    period,
    date: candles.at(-1)!.date,
    previousClose: candles.at(-2)?.close ?? candles.at(-1)!.close,
    candles,
    points: [],
    provider: '腾讯证券公开行情',
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

export async function getMarketHistory(code: string, period: HistoryPeriod, forceRefresh = false): Promise<MarketHistory> {
  const cacheKey = `${code}:${period}`;
  const cached = historyCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt < cacheTtlMs) return { ...cached.value, cached: true };
  const config = getSymbol(code);
  const history = period === 'minute' ? await fetchMinuteHistory(config) : await fetchKlineHistory(config, period);
  historyCache.set(cacheKey, { value: history, cachedAt: Date.now() });
  return history;
}

function inferEtfCategory(name: string): MarketCategory {
  if (/黄金|白银|有色|能源|豆粕|商品|原油|化工|煤炭/i.test(name)) return '商品';
  if (/国债|债券|信用债|城投债|可转债|短融|政金债/i.test(name)) return '债券';
  if (/纳指|标普|恒生|中概|港股|日经|德国|法国|东南亚|沙特|海外|QDII/i.test(name)) return '海外指数';
  return 'A股宽基';
}

export async function searchEtfs(query: string): Promise<EtfSearchResult[]> {
  const normalized = query.trim();
  if (normalized.length < 2 || normalized.length > 30) return [];
  const response = await fetch(`https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(normalized)}&t=all`, {
    headers: { 'User-Agent': 'Mozilla/5.0 rotation-market-desk/1.0' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`ETF 搜索接口返回 HTTP ${response.status}`);
  const text = await response.text();
  const rawHint = /v_hint="([\s\S]*)"/.exec(text)?.[1] ?? '';
  const decodedHint = rawHint.replace(/\\u([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));
  const results = decodedHint
    .split('^')
    .map((item) => item.split('~'))
    .filter((fields) => {
      const isShanghaiOrShenzhen = fields[0] === 'sh' || fields[0] === 'sz';
      const isSixDigitCode = /^\d{6}$/.test(fields[1] ?? '');
      const isEtf = (fields[4] ?? '').toUpperCase() === 'ETF' || /ETF/i.test(fields[2] ?? '');
      return isShanghaiOrShenzhen && isSixDigitCode && isEtf;
    })
    .map(([market, code, name]) => ({
      marketCode: `${market}${code}`,
      code,
      name,
      category: inferEtfCategory(name),
    }));
  return [...new Map(results.map((item) => [item.code, item])).values()].slice(0, 12);
}

async function rebuildRotationPool(strategy: IndexStrategy, config: AssetRotationConfig): Promise<RotationSnapshot> {
  const isAsset = strategy === 'asset-rotation';
  const isDual = strategy === 'dual-etf';
  const configPath = isAsset ? assetRotationConfigPath : isDual ? dualEtfConfigPath : rotationConfigPath;
  const backtestPath = isAsset ? assetRotationBacktestPath : isDual ? dualEtfBacktestPath : rotationBacktestPath;
  const historyDirectory = isAsset ? assetRotationHistoryDirectory : isDual ? dualEtfHistoryDirectory : rotationHistoryDirectory;
  const downloadScript = isAsset ? 'download-asset-rotation-history.cjs' : isDual ? 'download-dual-etf-history.cjs' : 'download-history.cjs';
  const backtestScript = isAsset ? 'backtest-asset-rotation.cjs' : isDual ? 'backtest-dual-etf.cjs' : 'backtest.cjs';
  const onlyMissingKey = isAsset ? 'ASSET_ROTATION_ONLY_MISSING' : isDual ? 'DUAL_ETF_ONLY_MISSING' : 'ROTATION_ONLY_MISSING';
  const workspaceRoot = createCalculationWorkspace();
  writeCalculationText(workspaceRoot, configPath, strategyConfigText(configPath, config));
  try {
    await execFileAsync(process.execPath, [resolve(process.cwd(), 'scripts', downloadScript)], {
      cwd: process.cwd(),
      env: { ...process.env, ROTATION_CALCULATION_ROOT: workspaceRoot, [onlyMissingKey]: '1' },
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    await execFileAsync(process.execPath, [resolve(process.cwd(), 'scripts', backtestScript)], {
      cwd: process.cwd(),
      env: { ...process.env, ROTATION_CALCULATION_ROOT: workspaceRoot },
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    await syncCalculationArtifacts(workspaceRoot, [configPath, backtestPath, ...calculationJsonFiles(workspaceRoot, historyDirectory)]);
    if (isAsset) {
      readAssetRotationBacktest(config);
      cachedAssetRotationSnapshot = null;
      cachedAssetRotationAt = 0;
      const snapshot = await getAssetRotationSnapshot(true);
      await flushMysqlWrites();
      return snapshot;
    }
    if (isDual) {
      readDualEtfBacktest(config);
      cachedDualEtfSnapshot = null;
      cachedDualEtfAt = 0;
      const snapshot = await getDualEtfSnapshot(true);
      await flushMysqlWrites();
      return snapshot;
    }
    readRotationBacktest(config);
    cachedSnapshot = null;
    cachedAt = 0;
    const snapshot = await getRotationSnapshot(true);
    await flushMysqlWrites();
    return snapshot;
  } catch (error) {
    if (isAsset) {
      cachedAssetRotationSnapshot = null;
      cachedAssetRotationAt = 0;
    } else if (isDual) {
      cachedDualEtfSnapshot = null;
      cachedDualEtfAt = 0;
    } else {
      cachedSnapshot = null;
      cachedAt = 0;
    }
    await flushMysqlWrites();
    throw new Error(`标的池更新失败，数据库未切换：${error instanceof Error ? error.message : '未知错误'}`);
  } finally {
    removeCalculationWorkspace(workspaceRoot);
  }
}

export type DatabaseCalculationTask =
  | 'rotation-history' | 'rotation-backtest' | 'rotation-optimize'
  | 'asset-history' | 'asset-backtest' | 'asset-optimize'
  | 'dual-history' | 'dual-backtest';

export async function runDatabaseCalculationTask(task: DatabaseCalculationTask) {
  const definitions: Record<DatabaseCalculationTask, {
    script: string;
    timeout: number;
    historyDirectory?: string;
    outputPath?: string;
    combinationStrategy?: 'rotation' | 'asset-rotation';
  }> = {
    'rotation-history': { script: 'download-history.cjs', timeout: 180_000, historyDirectory: rotationHistoryDirectory },
    'rotation-backtest': { script: 'backtest.cjs', timeout: 60_000, outputPath: rotationBacktestPath },
    'rotation-optimize': { script: 'optimize-rotation.cjs', timeout: 900_000, outputPath: rotationCombinationsPath, combinationStrategy: 'rotation' },
    'asset-history': { script: 'download-asset-rotation-history.cjs', timeout: 180_000, historyDirectory: assetRotationHistoryDirectory },
    'asset-backtest': { script: 'backtest-asset-rotation.cjs', timeout: 60_000, outputPath: assetRotationBacktestPath },
    'asset-optimize': { script: 'optimize-asset-rotation.cjs', timeout: 900_000, outputPath: assetRotationCombinationsPath, combinationStrategy: 'asset-rotation' },
    'dual-history': { script: 'download-dual-etf-history.cjs', timeout: 180_000, historyDirectory: dualEtfHistoryDirectory },
    'dual-backtest': { script: 'backtest-dual-etf.cjs', timeout: 60_000, outputPath: dualEtfBacktestPath },
  };
  const definition = definitions[task];
  const workspaceRoot = createCalculationWorkspace();
  try {
    await execFileAsync(process.execPath, [resolve(process.cwd(), 'scripts', definition.script)], {
      cwd: process.cwd(),
      env: { ...process.env, ROTATION_CALCULATION_ROOT: workspaceRoot },
      timeout: definition.timeout,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (definition.combinationStrategy && definition.outputPath) {
      return await importCombinationFile(calculationPath(workspaceRoot, definition.outputPath), definition.combinationStrategy);
    }
    const paths = definition.historyDirectory
      ? calculationJsonFiles(workspaceRoot, definition.historyDirectory)
      : definition.outputPath ? [definition.outputPath] : [];
    await syncCalculationArtifacts(workspaceRoot, paths);
    return { updatedObjects: paths.length };
  } finally {
    removeCalculationWorkspace(workspaceRoot);
  }
}

async function nextRotationConfig(current: AssetRotationConfig, action: 'add' | 'remove', normalizedCode: string) {
  let symbols = [...current.symbols];
  if (action === 'add') {
    if (symbols.some((item) => item.code === normalizedCode)) throw new Error('该 ETF 已在标的池中');
    if (symbols.length >= 20) throw new Error('标的池最多支持 20 只 ETF');
    const candidate = (await searchEtfs(normalizedCode)).find((item) => item.code === normalizedCode);
    if (!candidate) throw new Error('未找到对应的沪深 ETF');
    symbols.push(candidate);
  } else {
    if (!symbols.some((item) => item.code === normalizedCode)) throw new Error('该 ETF 不在标的池中');
    if (symbols.length <= 2) throw new Error('标的池至少保留 2 只 ETF');
    symbols = symbols.filter((item) => item.code !== normalizedCode);
  }
  return { version: current.version + 1, updatedAt: new Date().toISOString(), symbols };
}

async function nextAssetCombinationConfig(current: AssetRotationConfig, action: 'add' | 'remove', normalizedCode: string) {
  let symbols = [...current.symbols];
  if (action === 'add') {
    if (symbols.some((item) => item.code === normalizedCode)) throw new Error('该 ETF 已在组合池中');
    if (symbols.length >= 20) throw new Error('组合池最多支持 20 只 ETF');
    const candidate = (await searchEtfs(normalizedCode)).find((item) => item.code === normalizedCode);
    if (!candidate) throw new Error('未找到对应的沪深 ETF');
    symbols.push(candidate);
  } else {
    if (!symbols.some((item) => item.code === normalizedCode)) throw new Error('该 ETF 不在组合池中');
    if (symbols.length <= 3) throw new Error('组合池至少保留 3 只 ETF');
    symbols = symbols.filter((item) => item.code !== normalizedCode);
  }
  return { version: current.version + 1, updatedAt: new Date().toISOString(), symbols };
}

export async function updateRotationPool(action: 'add' | 'remove', code: string) {
  if (rotationPoolUpdateInFlight) throw new Error('标的池正在更新，请稍后再试');
  const normalizedCode = code.trim();
  if (!/^\d{6}$/.test(normalizedCode)) throw new Error('ETF 代码必须为 6 位数字');
  rotationPoolUpdateInFlight = true;
  try {
    const current = readRotationPendingConfig() ?? readRotationConfig();
    const draft = writeRotationPoolDraft(await nextRotationConfig(current, action, normalizedCode));
    await flushMysqlWrites();
    return draft;
  } finally {
    rotationPoolUpdateInFlight = false;
  }
}

export async function replaceRotationPool(codes: string[]) {
  if (rotationPoolUpdateInFlight) throw new Error('标的池正在更新，请稍后再试');
  const normalizedCodes = [...new Set(codes.map((code) => String(code).trim()))];
  if (normalizedCodes.length < 2 || normalizedCodes.length > 20) throw new Error('轮动标的池需包含 2 至 20 只 ETF');
  if (normalizedCodes.some((code) => !/^\d{6}$/.test(code))) throw new Error('ETF 代码必须为 6 位数字');
  const availableSymbols = new Map(readRotationCombinationConfig().symbols.map((symbol) => [symbol.code, symbol]));
  const symbols = normalizedCodes.map((code) => availableSymbols.get(code));
  if (symbols.some((symbol) => !symbol)) throw new Error('组合中包含已不在组合池内的 ETF，请重新计算全组合排名');
  rotationPoolUpdateInFlight = true;
  try {
    const current = readRotationPendingConfig() ?? readRotationConfig();
    const draft = writeRotationPoolDraft({
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      symbols: symbols as SymbolConfig[],
    });
    await flushMysqlWrites();
    return draft;
  } finally {
    rotationPoolUpdateInFlight = false;
  }
}

export async function recalculateRotationPool() {
  if (rotationPoolUpdateInFlight) throw new Error('标的池正在更新，请稍后再试');
  const pending = readRotationPendingConfig();
  if (!pending || sameSymbolSet(readRotationConfig().symbols, pending.symbols)) throw new Error('当前没有待计算的标的池变更');
  rotationPoolUpdateInFlight = true;
  try {
    const snapshot = await rebuildRotationPool('rotation', pending);
    if (storedFileExists(rotationPendingConfigPath)) deleteStoredFile(rotationPendingConfigPath);
    await flushMysqlWrites();
    return { ...snapshot, poolDraft: getRotationPoolDraft() };
  } finally {
    rotationPoolUpdateInFlight = false;
  }
}

export async function updateRotationCombinationPool(action: 'add' | 'remove', code: string) {
  if (rotationCombinationPoolUpdateInFlight) throw new Error('组合池正在更新，请稍后再试');
  const normalizedCode = code.trim();
  if (!/^\d{6}$/.test(normalizedCode)) throw new Error('ETF 代码必须为 6 位数字');
  rotationCombinationPoolUpdateInFlight = true;
  try {
    const current = readRotationCombinationPendingConfig() ?? readRotationCombinationConfig();
    const draft = writeRotationCombinationPoolDraft(await nextAssetCombinationConfig(current, action, normalizedCode));
    await flushMysqlWrites();
    return draft;
  } finally {
    rotationCombinationPoolUpdateInFlight = false;
  }
}

export async function recalculateRotationCombinationPool() {
  if (rotationCombinationPoolUpdateInFlight) throw new Error('组合池正在更新，请稍后再试');
  const pending = readRotationCombinationPendingConfig();
  if (!pending || sameSymbolSet(readRotationCombinationConfig().symbols, pending.symbols)) throw new Error('当前没有待计算的组合池变更');
  rotationCombinationPoolUpdateInFlight = true;
  const workspaceRoot = createCalculationWorkspace();
  writeCalculationText(workspaceRoot, rotationCombinationConfigPath, strategyConfigText(rotationCombinationConfigPath, pending));
  try {
    await execFileAsync(process.execPath, [resolve(process.cwd(), 'scripts', 'download-history.cjs')], {
      cwd: process.cwd(),
      env: { ...process.env, ROTATION_CALCULATION_ROOT: workspaceRoot, ROTATION_CONFIG_FILE: 'combination-config.json', ROTATION_ONLY_MISSING: '1' },
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    await execFileAsync(process.execPath, [resolve(process.cwd(), 'scripts', 'optimize-rotation.cjs')], {
      cwd: process.cwd(),
      env: { ...process.env, ROTATION_CALCULATION_ROOT: workspaceRoot },
      timeout: 900_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const documents = calculationArtifacts(workspaceRoot, [rotationCombinationConfigPath, ...calculationJsonFiles(workspaceRoot, rotationHistoryDirectory)]);
    await importCombinationFile(calculationPath(workspaceRoot, rotationCombinationsPath), 'rotation', undefined, documents);
    if (storedFileExists(rotationCombinationPendingConfigPath)) deleteStoredFile(rotationCombinationPendingConfigPath);
    await flushMysqlWrites();
    return getRotationCombinationPoolDraft();
  } catch (error) {
    await flushMysqlWrites();
    throw new Error(`组合池更新失败，数据库未切换：${error instanceof Error ? error.message : '未知错误'}`);
  } finally {
    removeCalculationWorkspace(workspaceRoot);
    rotationCombinationPoolUpdateInFlight = false;
  }
}

export async function updateAssetRotationPool(action: 'add' | 'remove', code: string) {
  if (assetRotationPoolUpdateInFlight) throw new Error('标的池正在更新，请稍后再试');
  const normalizedCode = code.trim();
  if (!/^\d{6}$/.test(normalizedCode)) throw new Error('ETF 代码必须为 6 位数字');
  assetRotationPoolUpdateInFlight = true;
  try {
    const current = readAssetRotationPendingConfig() ?? readAssetRotationConfig();
    const draft = writeAssetRotationPoolDraft(await nextRotationConfig(current, action, normalizedCode));
    await flushMysqlWrites();
    return draft;
  } finally {
    assetRotationPoolUpdateInFlight = false;
  }
}

export async function replaceAssetRotationPool(codes: string[]) {
  if (assetRotationPoolUpdateInFlight) throw new Error('标的池正在更新，请稍后再试');
  const normalizedCodes = [...new Set(codes.map((code) => String(code).trim()))];
  if (normalizedCodes.length < 2 || normalizedCodes.length > 20) throw new Error('轮动标的池需包含 2 至 20 只 ETF');
  if (normalizedCodes.some((code) => !/^\d{6}$/.test(code))) throw new Error('ETF 代码必须为 6 位数字');
  const availableSymbols = new Map(readAssetCombinationConfig().symbols.map((symbol) => [symbol.code, symbol]));
  const symbols = normalizedCodes.map((code) => availableSymbols.get(code));
  if (symbols.some((symbol) => !symbol)) throw new Error('组合中包含已不在组合池内的 ETF，请重新计算全组合排名');
  assetRotationPoolUpdateInFlight = true;
  try {
    const current = readAssetRotationPendingConfig() ?? readAssetRotationConfig();
    const draft = writeAssetRotationPoolDraft({
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      symbols: symbols as SymbolConfig[],
    });
    await flushMysqlWrites();
    return draft;
  } finally {
    assetRotationPoolUpdateInFlight = false;
  }
}

export async function recalculateAssetRotationPool() {
  if (assetRotationPoolUpdateInFlight) throw new Error('标的池正在更新，请稍后再试');
  const pending = readAssetRotationPendingConfig();
  if (!pending || sameSymbolSet(readAssetRotationConfig().symbols, pending.symbols)) throw new Error('当前没有待计算的标的池变更');
  assetRotationPoolUpdateInFlight = true;
  try {
    const snapshot = await rebuildRotationPool('asset-rotation', pending);
    if (storedFileExists(assetRotationPendingConfigPath)) deleteStoredFile(assetRotationPendingConfigPath);
    await flushMysqlWrites();
    return { ...snapshot, poolDraft: getAssetRotationPoolDraft() };
  } finally {
    assetRotationPoolUpdateInFlight = false;
  }
}

export async function updateAssetCombinationPool(action: 'add' | 'remove', code: string) {
  if (assetCombinationPoolUpdateInFlight) throw new Error('组合池正在更新，请稍后再试');
  const normalizedCode = code.trim();
  if (!/^\d{6}$/.test(normalizedCode)) throw new Error('ETF 代码必须为 6 位数字');
  assetCombinationPoolUpdateInFlight = true;
  try {
    const current = readAssetCombinationPendingConfig() ?? readAssetCombinationConfig();
    const draft = writeAssetCombinationPoolDraft(await nextAssetCombinationConfig(current, action, normalizedCode));
    await flushMysqlWrites();
    return draft;
  } finally {
    assetCombinationPoolUpdateInFlight = false;
  }
}

export async function recalculateAssetCombinationPool() {
  if (assetCombinationPoolUpdateInFlight) throw new Error('组合池正在更新，请稍后再试');
  const pending = readAssetCombinationPendingConfig();
  if (!pending || sameSymbolSet(readAssetCombinationConfig().symbols, pending.symbols)) throw new Error('当前没有待计算的组合池变更');
  assetCombinationPoolUpdateInFlight = true;
  const workspaceRoot = createCalculationWorkspace();
  writeCalculationText(workspaceRoot, assetCombinationConfigPath, strategyConfigText(assetCombinationConfigPath, pending));
  try {
    await execFileAsync(process.execPath, [resolve(process.cwd(), 'scripts', 'download-asset-rotation-history.cjs')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ROTATION_CALCULATION_ROOT: workspaceRoot,
        ASSET_ROTATION_CONFIG_FILE: 'combination-config.json',
        ASSET_ROTATION_ONLY_MISSING: '1',
      },
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    await execFileAsync(process.execPath, [resolve(process.cwd(), 'scripts', 'optimize-asset-rotation.cjs')], {
      cwd: process.cwd(),
      env: { ...process.env, ROTATION_CALCULATION_ROOT: workspaceRoot },
      timeout: 900_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const documents = calculationArtifacts(workspaceRoot, [assetCombinationConfigPath, ...calculationJsonFiles(workspaceRoot, assetRotationHistoryDirectory)]);
    await importCombinationFile(calculationPath(workspaceRoot, assetRotationCombinationsPath), 'asset-rotation', undefined, documents);
    if (storedFileExists(assetCombinationPendingConfigPath)) deleteStoredFile(assetCombinationPendingConfigPath);
    await flushMysqlWrites();
    return getAssetCombinationPoolDraft();
  } catch (error) {
    await flushMysqlWrites();
    throw new Error(`组合排名计算失败，数据库未切换：${error instanceof Error ? error.message : '未知错误'}`);
  } finally {
    removeCalculationWorkspace(workspaceRoot);
    assetCombinationPoolUpdateInFlight = false;
  }
}

export async function updateDualEtfPool(action: 'add' | 'remove', code: string) {
  if (dualEtfPoolUpdateInFlight) throw new Error('标的池正在更新，请稍后再试');
  const normalizedCode = code.trim();
  if (!/^\d{6}$/.test(normalizedCode)) throw new Error('ETF 代码必须为 6 位数字');
  dualEtfPoolUpdateInFlight = true;
  try {
    return await rebuildRotationPool('dual-etf', await nextRotationConfig(readDualEtfConfig(), action, normalizedCode));
  } finally {
    dualEtfPoolUpdateInFlight = false;
  }
}

export async function getRotationSnapshot(forceRefresh = false): Promise<RotationSnapshot> {
  if (!forceRefresh && cachedSnapshot && Date.now() - cachedAt < cacheTtlMs) {
    return { ...cachedSnapshot, poolDraft: getRotationPoolDraft(), cached: true };
  }

  const config = readRotationConfig();
  const fetched = [];
  for (const symbol of config.symbols) fetched.push(await fetchSymbol(symbol));
  const lastTradingDate = fetched.map((item) => item.rawLastDate).sort().at(-1)!;
  const year = Number(lastTradingDate.slice(0, 4));
  const storedYearPerformance = forceRefresh ? null : readRotationYearPerformance('rotation', year);
  const yearPerformance = storedYearPerformance?.lastTradingDate === lastTradingDate
    ? storedYearPerformance
    : calculateRotationYearPerformance(fetched);

  const calculated = fetched.map((market) => {
    const last = market.candles.at(-1)!;
    const previous = market.candles.at(-2)!;
    const ma20 = market.candles.slice(-20).reduce((sum, candle) => sum + candle.close, 0) / 20;
    const averageVolume = market.candles.slice(-6, -1).reduce((sum, candle) => sum + candle.volume, 0) / 5;
    return {
      code: market.code,
      name: market.name,
      category: market.category,
      candles: market.candles,
      price: round(last.close),
      previousClose: round(previous.close),
      change: ((last.close / previous.close) - 1) * 100,
      ma20: round(ma20),
      momentum: ((last.close / ma20) - 1) * 100,
      aboveMa: last.close > ma20,
      volumeRatio: averageVolume > 0 ? last.volume / averageVolume : 0,
    };
  });

  const markets: RankedMarket[] = calculated
    .sort((a, b) => b.momentum - a.momentum)
    .map((market, index) => ({
      ...market,
      rank: index + 1,
      signal: market.aboveMa ? (index === 0 ? '持有' : '观察') : '规避',
    }));

  const provider = '腾讯证券公开行情';
  const fetchedAt = new Date().toISOString();
  const snapshot: RotationSnapshot = {
    markets,
    poolDraft: getRotationPoolDraft(),
    yearPerformance,
    provider,
    fetchedAt,
    lastTradingDate,
    cached: false,
    backtest: readRotationBacktest(config),
  };
  if (yearPerformance !== storedYearPerformance) writeRotationYearPerformance('rotation', yearPerformance, provider, fetchedAt);
  cachedSnapshot = snapshot;
  cachedAt = Date.now();
  return snapshot;
}

export async function getAssetRotationSnapshot(forceRefresh = false): Promise<RotationSnapshot> {
  if (!forceRefresh && cachedAssetRotationSnapshot && Date.now() - cachedAssetRotationAt < cacheTtlMs) {
    return { ...cachedAssetRotationSnapshot, poolDraft: getAssetRotationPoolDraft(), cached: true };
  }

  const config = readAssetRotationConfig();
  let quotes = new Map<string, TencentQuote>();
  let completedTradingDay = false;
  if (forceRefresh) {
    const quoteCodes = config.symbols.map((symbol) => {
      const exchange = symbol.marketCode.startsWith('sh') ? 'SH' : symbol.marketCode.startsWith('bj') ? 'BJ' : 'SZ';
      return `${symbol.code}.${exchange}`;
    });
    quotes = await fetchTencentQuotes(quoteCodes);
    if (![...quotes.values()].some((quote) => quote.price !== undefined && quote.date !== undefined)) {
      throw new Error('实时行情未返回有效数据，请稍后重试');
    }
    completedTradingDay = [...quotes.values()].some((quote) => quote.date && isCompletedTradingDay(quote.date));
  }
  const fetchedBase = await Promise.all(config.symbols.map((symbol) => (
    completedTradingDay ? fetchFullQfqSymbol(symbol) : fetchSymbol(symbol)
  )));
  const fetched = fetchedBase.map((market) => mergeCurrentQuote(market, quotes.get(market.code)));
  if (completedTradingDay) {
    const completedPrices = fetched.flatMap((market) => market.history.map((candle) => ({
      etfCode: market.code,
      tradeDate: candle.date,
      open: candle.open,
      close: candle.close,
      high: candle.high,
      low: candle.low,
      volume: candle.volume,
    })));
    await upsertMysqlEtfDailyPrices(completedPrices);
  }
  const lastTradingDate = fetched.map((item) => item.rawLastDate).sort().at(-1)!;
  const year = Number(lastTradingDate.slice(0, 4));
  const storedYearPerformance = forceRefresh ? null : readRotationYearPerformance('asset-rotation', year);
  const yearPerformance = storedYearPerformance?.lastTradingDate === lastTradingDate
    ? storedYearPerformance
    : calculateAssetRotationYearPerformance(fetched);
  const currentHoldingCode = fetched.find((market) => market.name === yearPerformance.currentHolding)?.code ?? null;
  const calculated = fetched.map((market) => {
    const last = market.history.at(-1)!;
    const previous = market.history.at(-2)!;
    const previousClose = market.realtimePreviousClose ?? previous.close;
    const ma28 = market.history.slice(-28).reduce((sum, candle) => sum + candle.close, 0) / 28;
    const previous20 = market.history.at(-21)!;
    const averageVolume = market.history.slice(-6, -1).reduce((sum, candle) => sum + candle.volume, 0) / 5;
    return {
      code: market.code,
      name: market.name,
      category: market.category,
      candles: market.candles,
      price: round(last.close),
      previousClose: round(previousClose),
      change: ((last.close / previousClose) - 1) * 100,
      ma20: round(ma28),
      momentum: ((last.close / previous20.close) - 1) * 100,
      aboveMa: last.close >= ma28,
      volumeRatio: averageVolume > 0 ? last.volume / averageVolume : 0,
    };
  });
  const markets: RankedMarket[] = calculated
    .sort((left, right) => right.momentum - left.momentum)
    .map((market, index) => ({
      ...market,
      rank: index + 1,
      signal: market.code === currentHoldingCode ? '持有' : market.aboveMa && index < 2 ? '观察' : '规避',
    }));
  const provider = forceRefresh ? '腾讯证券公开日线 + 实时行情' : '腾讯证券公开行情';
  const fetchedAt = new Date().toISOString();
  const snapshot: RotationSnapshot = {
    markets,
    yearPerformance,
    provider,
    fetchedAt,
    lastTradingDate,
    cached: false,
    backtest: readAssetRotationBacktest(config),
    poolDraft: getAssetRotationPoolDraft(),
  };
  if (yearPerformance !== storedYearPerformance) writeRotationYearPerformance('asset-rotation', yearPerformance, provider, fetchedAt);
  cachedAssetRotationSnapshot = snapshot;
  cachedAssetRotationAt = Date.now();
  return snapshot;
}

export async function getDualEtfSnapshot(forceRefresh = false): Promise<RotationSnapshot> {
  if (!forceRefresh && cachedDualEtfSnapshot && Date.now() - cachedDualEtfAt < cacheTtlMs) {
    return { ...cachedDualEtfSnapshot, cached: true };
  }

  const config = readDualEtfConfig();
  const fetched = [];
  for (const symbol of config.symbols) fetched.push(await fetchSymbol(symbol));
  const lastTradingDate = fetched.map((item) => item.rawLastDate).sort().at(-1)!;
  const year = Number(lastTradingDate.slice(0, 4));
  const storedYearPerformance = forceRefresh ? null : readRotationYearPerformance('dual-etf', year);
  const yearPerformance = storedYearPerformance?.lastTradingDate === lastTradingDate
    ? storedYearPerformance
    : calculateDualEtfYearPerformance(fetched);
  const currentHoldingCode = fetched.find((market) => market.name === yearPerformance.currentHolding)?.code ?? null;
  const calculated = fetched.map((market) => {
    const last = market.history.at(-1)!;
    const previous = market.history.at(-2)!;
    const previous20 = market.history.at(-21)!;
    const ma20 = market.history.slice(-20).reduce((sum, candle) => sum + candle.close, 0) / 20;
    const averageVolume = market.history.slice(-6, -1).reduce((sum, candle) => sum + candle.volume, 0) / 5;
    return {
      code: market.code,
      name: market.name,
      category: market.category,
      candles: market.candles,
      price: round(last.close),
      previousClose: round(previous.close),
      change: ((last.close / previous.close) - 1) * 100,
      ma20: round(ma20),
      momentum: ((last.close / previous20.close) - 1) * 100,
      aboveMa: last.close >= ma20,
      volumeRatio: averageVolume > 0 ? last.volume / averageVolume : 0,
    };
  });
  const markets: RankedMarket[] = calculated
    .sort((left, right) => right.momentum - left.momentum)
    .map((market, index) => ({
      ...market,
      rank: index + 1,
      signal: market.code === currentHoldingCode ? '持有' : market.aboveMa && index === 0 ? '观察' : '规避',
    }));
  const provider = '腾讯证券公开行情';
  const fetchedAt = new Date().toISOString();
  const snapshot: RotationSnapshot = {
    markets,
    yearPerformance,
    provider,
    fetchedAt,
    lastTradingDate,
    cached: false,
    backtest: readDualEtfBacktest(config),
  };
  if (yearPerformance !== storedYearPerformance) writeRotationYearPerformance('dual-etf', yearPerformance, provider, fetchedAt);
  cachedDualEtfSnapshot = snapshot;
  cachedDualEtfAt = Date.now();
  return snapshot;
}

export async function getMacdConfluenceSnapshot(forceRefresh = false, requestedDate?: string): Promise<MacdSnapshot> {
  const today = dateText(new Date());
  const currentTradingDate = await latestTradingDateOnOrBefore(today);
  const storageDate = requestedDate
    ? await latestTradingDateOnOrBefore(normalizeSnapshotDate(requestedDate))
    : currentTradingDate;
  if (!forceRefresh) {
    const stored = readMacdSnapshot(storageDate);
    if (stored) return requestedDate && storageDate !== currentTradingDate ? withCurrentPrices(stored) : stored;
  }
  const runningScan = macdScansInFlight.get(storageDate);
  if (runningScan) {
    const snapshot = await runningScan;
    return requestedDate && storageDate !== currentTradingDate ? withCurrentPrices(snapshot) : snapshot;
  }
  const scan = buildMacdConfluenceSnapshot(storageDate);
  macdScansInFlight.set(storageDate, scan);
  try {
    const snapshot = await scan;
    return requestedDate && storageDate !== currentTradingDate ? withCurrentPrices(snapshot) : snapshot;
  } finally {
    macdScansInFlight.delete(storageDate);
  }
}

async function buildMacdConfluenceSnapshot(storageDate: string): Promise<MacdSnapshot> {
  // Empty daily responses are naturally skipped for weekends and public holidays.
  // 115 weekdays yields at least 100 open-market sessions around public holidays.
  const queryDays = recentWeekdays(115, new Date(`${storageDate.slice(0, 4)}-${storageDate.slice(4, 6)}-${storageDate.slice(6)}T12:00:00`));

  const dailyByCode = new Map<string, DailyRow[]>();
  const availableDays = new Set<string>();
  const excludedByBoard = new Set<string>();
  for (const [index, tradeDate] of queryDays.entries()) {
    if (index > 0 && index % 45 === 0) await wait(61_000);
    const rows = await callTushare('daily', { trade_date: tradeDate }, 'ts_code,trade_date,close,pre_close,pct_chg');
    if (rows.length > 0) availableDays.add(tradeDate);
    for (const row of rows) {
      const tsCode = String(row.ts_code);
      const code = tsCode.split('.')[0];
      if (tsCode.endsWith('.BJ') || code.startsWith('30') || code.startsWith('688') || code.startsWith('689')) {
        excludedByBoard.add(tsCode);
        continue;
      }
      const close = Number(row.close);
      const previousClose = Number(row.pre_close);
      if (!Number.isFinite(close) || !Number.isFinite(previousClose)) continue;
      const series = dailyByCode.get(tsCode) ?? [];
      series.push({
        tsCode,
        tradeDate: String(row.trade_date),
        close,
        previousClose,
        change: Number(row.pct_chg),
      });
      dailyByCode.set(tsCode, series);
    }
  }

  const tradingDays = [...availableDays].sort();
  if (tradingDays.length < 100) throw new Error('Tushare 返回的有效日线不足 100 条，无法计算 MACD（10,20,7）');

  const candidates: CandidateSignal[] = [];
  let scannedCount = 0;
  for (const [tsCode, rows] of dailyByCode) {
    rows.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    if (rows.length < 100) continue;
    scannedCount += 1;
    const closes = rows.map((row) => row.close);
    const { dif, dea, histogram } = calculateMacd(closes);
    const lastIndex = rows.length - 1;
    const previousIndex = lastIndex - 1;
    const goldCross = dif[lastIndex] > dea[lastIndex] && dif[previousIndex] <= dea[previousIndex];
    if (!goldCross) continue;
    candidates.push({
      tsCode,
      code: tsCode.split('.')[0],
      close: round(rows[lastIndex].close),
      change: round(rows[lastIndex].change, 2),
      dif: round(dif[lastIndex], 4),
      dea: round(dea[lastIndex], 4),
      histogram: round(histogram[lastIndex], 4),
      histogramChange: round(histogram[lastIndex] - histogram[previousIndex], 4),
      signal: '金叉共振',
    });
  }

  candidates.sort((a, b) => {
    if (a.signal !== b.signal) return a.signal === '金叉共振' ? -1 : 1;
    return b.histogramChange - a.histogramChange;
  });
  const names = await fetchTencentNames(candidates.map((item) => item.tsCode));
  const namedCandidates = candidates.filter((item) => {
    const name = names.get(item.code);
    return Boolean(name) && !name.toUpperCase().includes('ST');
  });
  const signals: MacdSignal[] = namedCandidates
    .map(({ tsCode: _tsCode, ...item }) => ({ ...item, name: names.get(item.code)! }));
  const snapshot: MacdSnapshot = {
    signals,
    firstCrossCount: signals.length,
    storageDate: tradingDays.at(-1)!,
    provider: 'Tushare 日线 + 腾讯证券公开行情',
    fetchedAt: new Date().toISOString(),
    lastTradingDate: tradingDays.at(-1)!,
    cached: false,
    scannedCount,
    excludedCount: excludedByBoard.size + candidates.length - namedCandidates.length,
  };
  writeMacdSnapshot(snapshot);
  await flushMysqlWrites();
  return snapshot;
}

export async function getMacdPullbackSnapshot(forceRefresh = false, requestedDate?: string): Promise<MacdPullbackSnapshot> {
  const today = dateText(new Date());
  const currentTradingDate = await latestTradingDateOnOrBefore(today);
  const storageDate = requestedDate
    ? await latestTradingDateOnOrBefore(normalizeSnapshotDate(requestedDate))
    : currentTradingDate;
  if (!forceRefresh) {
    const stored = readMacdPullbackSnapshot(storageDate);
    if (stored) return requestedDate && storageDate !== currentTradingDate ? withCurrentPullbackPrices(stored) : stored;
  }
  const runningScan = macdPullbackScansInFlight.get(storageDate);
  if (runningScan) {
    const snapshot = await runningScan;
    return requestedDate && storageDate !== currentTradingDate ? withCurrentPullbackPrices(snapshot) : snapshot;
  }
  const scan = buildMacdPullbackSnapshot(storageDate);
  macdPullbackScansInFlight.set(storageDate, scan);
  try {
    const snapshot = await scan;
    return requestedDate && storageDate !== currentTradingDate ? withCurrentPullbackPrices(snapshot) : snapshot;
  } finally {
    macdPullbackScansInFlight.delete(storageDate);
  }
}

async function buildMacdPullbackSnapshot(storageDate: string): Promise<MacdPullbackSnapshot> {
  const queryDays = recentWeekdays(115, new Date(`${storageDate.slice(0, 4)}-${storageDate.slice(4, 6)}-${storageDate.slice(6)}T12:00:00`));
  const dailyByCode = new Map<string, PullbackDailyRow[]>();
  const availableDays = new Set<string>();
  const excludedByBoard = new Set<string>();

  for (const [index, tradeDate] of queryDays.entries()) {
    if (index > 0 && index % 45 === 0) await wait(61_000);
    const rows = await callTushare('daily', { trade_date: tradeDate }, 'ts_code,trade_date,open,high,low,close,pre_close,pct_chg,vol');
    if (rows.length > 0) availableDays.add(tradeDate);
    for (const row of rows) {
      const tsCode = String(row.ts_code);
      const code = tsCode.split('.')[0];
      if (tsCode.endsWith('.BJ') || code.startsWith('30') || code.startsWith('688') || code.startsWith('689')) {
        excludedByBoard.add(tsCode);
        continue;
      }
      const values = [row.open, row.high, row.low, row.close, row.pre_close, row.vol].map(Number);
      if (values.some((value) => !Number.isFinite(value))) continue;
      const [open, high, low, close, previousClose, volume] = values;
      const series = dailyByCode.get(tsCode) ?? [];
      series.push({
        tsCode,
        tradeDate: String(row.trade_date),
        open,
        high,
        low,
        close,
        previousClose,
        volume,
        change: Number(row.pct_chg),
      });
      dailyByCode.set(tsCode, series);
    }
  }

  const tradingDays = [...availableDays].sort();
  if (tradingDays.length < 100) throw new Error('Tushare 返回的有效日线不足 100 条，无法计算 MACD（5,34,5）');

  const candidates: PullbackCandidate[] = [];
  let scannedCount = 0;
  for (const [tsCode, rows] of dailyByCode) {
    rows.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
    if (rows.length < 100) continue;
    scannedCount += 1;
    const closes = rows.map((row) => row.close);
    const { dif, dea } = calculateMacd(closes, 5, 34, 5);
    const lastIndex = rows.length - 1;
    const last = rows[lastIndex];
    if (dif[lastIndex] <= 0 || dea[lastIndex] <= 0) continue;

    let crossIndex = -1;
    for (let index = lastIndex - 2; index >= Math.max(1, lastIndex - 20); index -= 1) {
      if (dif[index] > dea[index] && dif[index - 1] <= dea[index - 1] && dif[index] > 0 && dea[index] > 0) {
        crossIndex = index;
        break;
      }
    }
    if (crossIndex < 0) continue;

    const ma20 = rows.slice(-20).reduce((sum, row) => sum + row.close, 0) / 20;
    const previousMa20 = rows.slice(-21, -1).reduce((sum, row) => sum + row.close, 0) / 20;
    const recentHigh = Math.max(...rows.slice(crossIndex).map((row) => row.high));
    const averageVolume = rows.slice(-6, -1).reduce((sum, row) => sum + row.volume, 0) / 5;
    const supportDistance = ((last.close / ma20) - 1) * 100;
    const pullback = ((last.close / recentHigh) - 1) * 100;
    const volumeRatio = averageVolume > 0 ? last.volume / averageVolume : Infinity;
    const stableCandle = ((last.close / last.open) - 1) * 100 >= -0.5;
    if (ma20 <= previousMa20
      || supportDistance < -1.5 || supportDistance > 4
      || pullback < -12 || pullback > -1
      || volumeRatio > 0.9
      || last.change < -2.5
      || !stableCandle) continue;

    const crossDaysAgo = lastIndex - crossIndex;
    const score = Math.max(0, 100
      - Math.abs(supportDistance) * 10
      - Math.abs(pullback + 4) * 2
      - volumeRatio * 10
      - crossDaysAgo * 0.3
      + Math.max(0, last.change) * 2);
    candidates.push({
      tsCode,
      code: tsCode.split('.')[0],
      close: round(last.close),
      change: round(last.change, 2),
      ma20: round(ma20),
      supportDistance: round(supportDistance, 2),
      pullback: round(pullback, 2),
      volumeRatio: round(volumeRatio, 2),
      crossDaysAgo,
      dif: round(dif[lastIndex], 4),
      dea: round(dea[lastIndex], 4),
      score: round(score, 1),
      signal: '回踩观察',
    });
  }

  candidates.sort((left, right) => right.score - left.score);
  const names = await fetchTencentNames(candidates.map((item) => item.tsCode));
  const namedCandidates = candidates.filter((item) => {
    const name = names.get(item.code);
    return Boolean(name) && !name.toUpperCase().includes('ST');
  });
  const signals: MacdPullbackSignal[] = namedCandidates.map(({ tsCode: _tsCode, ...item }) => ({
    ...item,
    name: names.get(item.code)!,
  }));
  const snapshot: MacdPullbackSnapshot = {
    signals,
    storageDate: tradingDays.at(-1)!,
    provider: 'Tushare 日线 + 腾讯证券公开行情',
    fetchedAt: new Date().toISOString(),
    lastTradingDate: tradingDays.at(-1)!,
    cached: false,
    scannedCount,
    excludedCount: excludedByBoard.size + candidates.length - namedCandidates.length,
  };
  writeMacdPullbackSnapshot(snapshot);
  await flushMysqlWrites();
  return snapshot;
}

export async function getMacdKdjSnapshot(forceRefresh = false, requestedDate?: string): Promise<MacdKdjSnapshot> {
  const today = dateText(new Date());
  const currentTradingDate = await latestTradingDateOnOrBefore(today);
  const storageDate = requestedDate
    ? await latestTradingDateOnOrBefore(normalizeSnapshotDate(requestedDate))
    : currentTradingDate;
  if (!forceRefresh) {
    const stored = readMacdKdjSnapshot(storageDate);
    if (stored) return requestedDate && storageDate !== currentTradingDate ? withCurrentMacdKdjPrices(stored) : stored;
  }
  const runningScan = macdKdjScansInFlight.get(storageDate);
  if (runningScan) {
    const snapshot = await runningScan;
    return requestedDate && storageDate !== currentTradingDate ? withCurrentMacdKdjPrices(snapshot) : snapshot;
  }
  const scan = buildMacdKdjSnapshot(storageDate);
  macdKdjScansInFlight.set(storageDate, scan);
  try {
    const snapshot = await scan;
    return requestedDate && storageDate !== currentTradingDate ? withCurrentMacdKdjPrices(snapshot) : snapshot;
  } finally {
    macdKdjScansInFlight.delete(storageDate);
  }
}

async function buildMacdKdjSnapshot(storageDate: string): Promise<MacdKdjSnapshot> {
  const queryDays = recentWeekdays(115, new Date(`${storageDate.slice(0, 4)}-${storageDate.slice(4, 6)}-${storageDate.slice(6)}T12:00:00`));
  const dailyByCode = new Map<string, PullbackDailyRow[]>();
  const availableDays = new Set<string>();
  const excludedByBoard = new Set<string>();

  for (const [index, tradeDate] of queryDays.entries()) {
    if (index > 0 && index % 45 === 0) await wait(61_000);
    const rows = await callTushare('daily', { trade_date: tradeDate }, 'ts_code,trade_date,open,high,low,close,pre_close,pct_chg,vol');
    if (rows.length > 0) availableDays.add(tradeDate);
    for (const row of rows) {
      const tsCode = String(row.ts_code);
      const code = tsCode.split('.')[0];
      if (tsCode.endsWith('.BJ') || code.startsWith('30') || code.startsWith('688') || code.startsWith('689')) {
        excludedByBoard.add(tsCode);
        continue;
      }
      const values = [row.open, row.high, row.low, row.close, row.pre_close, row.vol].map(Number);
      if (values.some((value) => !Number.isFinite(value))) continue;
      const [open, high, low, close, previousClose, volume] = values;
      const series = dailyByCode.get(tsCode) ?? [];
      series.push({
        tsCode,
        tradeDate: String(row.trade_date),
        open,
        high,
        low,
        close,
        previousClose,
        volume,
        change: Number(row.pct_chg),
      });
      dailyByCode.set(tsCode, series);
    }
  }

  const tradingDays = [...availableDays].sort();
  if (tradingDays.length < 100) throw new Error('Tushare 返回的有效日线不足 100 条，无法计算 MACD + KDJ');

  const candidates: MacdKdjCandidate[] = [];
  let scannedCount = 0;
  for (const [tsCode, rows] of dailyByCode) {
    rows.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
    if (rows.length < 100) continue;
    scannedCount += 1;
    const closes = rows.map((row) => row.close);
    const { dif, dea, histogram } = calculateMacd(closes, 12, 26, 9);
    const { k, d, j } = calculateKdj(rows, 9);
    const lastIndex = rows.length - 1;
    const last = rows[lastIndex];
    const macdGoldCross = dif[lastIndex] > dea[lastIndex] && dif[lastIndex - 1] <= dea[lastIndex - 1];
    if (!macdGoldCross) continue;

    let kdjCrossIndex = -1;
    for (let index = lastIndex; index >= Math.max(1, lastIndex - 4); index -= 1) {
      if (k[index] > d[index] && k[index - 1] <= d[index - 1] && Math.max(k[index], d[index]) <= 25) {
        kdjCrossIndex = index;
        break;
      }
    }
    if (kdjCrossIndex < 0) continue;

    const firstWave = rows.slice(lastIndex - 40, lastIndex - 20);
    const secondWave = rows.slice(lastIndex - 20, lastIndex);
    const firstHistogram = histogram.slice(lastIndex - 40, lastIndex - 20);
    const secondHistogram = histogram.slice(lastIndex - 20, lastIndex);
    const firstPriceLow = Math.min(...firstWave.map((row) => row.low));
    const secondPriceLow = Math.min(...secondWave.map((row) => row.low));
    const firstHistogramLow = Math.min(...firstHistogram);
    const secondHistogramLow = Math.min(...secondHistogram);
    const divergence = secondPriceLow < firstPriceLow
      && firstHistogramLow < 0
      && secondHistogramLow < 0
      && secondHistogramLow > firstHistogramLow
      && dif[lastIndex] <= 0;
    const kdjCrossDaysAgo = lastIndex - kdjCrossIndex;
    const score = Math.min(100, 72
      + (divergence ? 16 : 0)
      + Math.max(0, 10 - kdjCrossDaysAgo * 2)
      + Math.max(0, (25 - Math.max(k[kdjCrossIndex], d[kdjCrossIndex])) / 5));
    candidates.push({
      tsCode,
      code: tsCode.split('.')[0],
      close: round(last.close),
      change: round(last.change, 2),
      dif: round(dif[lastIndex], 4),
      dea: round(dea[lastIndex], 4),
      histogram: round(histogram[lastIndex], 4),
      k: round(k[lastIndex], 2),
      d: round(d[lastIndex], 2),
      j: round(j[lastIndex], 2),
      kdjCrossDaysAgo,
      divergence,
      score: round(score, 1),
      signal: divergence ? '底背离共振' : '低位双金叉',
    });
  }

  candidates.sort((left, right) => Number(right.divergence) - Number(left.divergence) || right.score - left.score);
  const names = await fetchTencentNames(candidates.map((item) => item.tsCode));
  const namedCandidates = candidates.filter((item) => {
    const name = names.get(item.code);
    return Boolean(name) && !name.toUpperCase().includes('ST');
  });
  const signals: MacdKdjSignal[] = namedCandidates.map(({ tsCode: _tsCode, ...item }) => ({
    ...item,
    name: names.get(item.code)!,
  }));
  const snapshot: MacdKdjSnapshot = {
    signals,
    storageDate: tradingDays.at(-1)!,
    provider: 'Tushare 日线 + 腾讯证券公开行情',
    fetchedAt: new Date().toISOString(),
    lastTradingDate: tradingDays.at(-1)!,
    cached: false,
    scannedCount,
    excludedCount: excludedByBoard.size + candidates.length - namedCandidates.length,
    lowCrossCount: signals.filter((signal) => signal.signal === '低位双金叉').length,
    divergenceCount: signals.filter((signal) => signal.signal === '底背离共振').length,
  };
  writeMacdKdjSnapshot(snapshot);
  await flushMysqlWrites();
  return snapshot;
}

export async function getVolumeSnapshot(forceRefresh = false, requestedDate?: string): Promise<VolumeSnapshot> {
  const today = dateText(new Date());
  const currentTradingDate = await latestTradingDateOnOrBefore(today);
  const storageDate = requestedDate
    ? await latestTradingDateOnOrBefore(normalizeSnapshotDate(requestedDate))
    : currentTradingDate;
  if (!forceRefresh) {
    const stored = readVolumeSnapshot(storageDate);
    if (stored) return requestedDate && storageDate !== currentTradingDate ? withCurrentVolumePrices(stored) : stored;
  }
  const runningScan = volumeScansInFlight.get(storageDate);
  if (runningScan) {
    const snapshot = await runningScan;
    return requestedDate && storageDate !== currentTradingDate ? withCurrentVolumePrices(snapshot) : snapshot;
  }
  const scan = buildVolumeSnapshot(storageDate);
  volumeScansInFlight.set(storageDate, scan);
  try {
    const snapshot = await scan;
    return requestedDate && storageDate !== currentTradingDate ? withCurrentVolumePrices(snapshot) : snapshot;
  } finally {
    volumeScansInFlight.delete(storageDate);
  }
}

async function buildVolumeSnapshot(storageDate: string): Promise<VolumeSnapshot> {
  const queryDays = recentWeekdays(115, new Date(`${storageDate.slice(0, 4)}-${storageDate.slice(4, 6)}-${storageDate.slice(6)}T12:00:00`));
  const dailyByCode = new Map<string, PullbackDailyRow[]>();
  const availableDays = new Set<string>();
  const excludedByBoard = new Set<string>();

  for (const [index, tradeDate] of queryDays.entries()) {
    if (index > 0 && index % 45 === 0) await wait(61_000);
    const rows = await callTushare('daily', { trade_date: tradeDate }, 'ts_code,trade_date,open,high,low,close,pre_close,pct_chg,vol');
    if (rows.length > 0) availableDays.add(tradeDate);
    for (const row of rows) {
      const tsCode = String(row.ts_code);
      const code = tsCode.split('.')[0];
      if (tsCode.endsWith('.BJ') || code.startsWith('30') || code.startsWith('688') || code.startsWith('689')) {
        excludedByBoard.add(tsCode);
        continue;
      }
      const values = [row.open, row.high, row.low, row.close, row.pre_close, row.vol].map(Number);
      if (values.some((value) => !Number.isFinite(value))) continue;
      const [open, high, low, close, previousClose, volume] = values;
      const series = dailyByCode.get(tsCode) ?? [];
      series.push({
        tsCode,
        tradeDate: String(row.trade_date),
        open,
        high,
        low,
        close,
        previousClose,
        volume,
        change: Number(row.pct_chg),
      });
      dailyByCode.set(tsCode, series);
    }
  }

  const tradingDays = [...availableDays].sort();
  if (tradingDays.length < 100) throw new Error('Tushare 返回的有效日线不足 100 条，无法计算量能三信号');
  const lastTradingDate = tradingDays.at(-1)!;
  const candidates: VolumeCandidate[] = [];
  let scannedCount = 0;

  for (const [tsCode, rows] of dailyByCode) {
    rows.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
    if (rows.length < 100) continue;
    scannedCount += 1;
    const lastIndex = rows.length - 1;
    const last = rows[lastIndex];
    if (last.tradeDate !== lastTradingDate || last.volume <= 0) continue;
    const closes = rows.map((row) => row.close);
    const volumes = rows.map((row) => row.volume);
    const ma25 = simpleMovingAverage(closes, 25);
    const volumeMa5 = simpleMovingAverage(volumes, 5);
    const volumeMa60 = simpleMovingAverage(volumes, 60);
    const currentMa25 = ma25[lastIndex];
    const currentVolumeMa5 = volumeMa5[lastIndex];
    const currentVolumeMa60 = volumeMa60[lastIndex];
    if (![currentMa25, currentVolumeMa5, currentVolumeMa60].every(Number.isFinite) || currentVolumeMa60 <= 0) continue;

    let priceCrossIndex = -1;
    let volumeCrossIndex = -1;
    for (let index = lastIndex; index >= Math.max(60, lastIndex - 4); index -= 1) {
      if (priceCrossIndex < 0 && closes[index] > ma25[index] && closes[index - 1] <= ma25[index - 1]) priceCrossIndex = index;
      if (volumeCrossIndex < 0 && volumeMa5[index] > volumeMa60[index] && volumeMa5[index - 1] <= volumeMa60[index - 1]) volumeCrossIndex = index;
    }

    const supportDistance = ((last.close / currentMa25) - 1) * 100;
    const recentHigh = Math.max(...rows.slice(-20).map((row) => row.high));
    const pullback = ((last.close / recentHigh) - 1) * 100;
    const volumeRatio = currentVolumeMa5 / currentVolumeMa60;
    const trendUp = currentMa25 > ma25[lastIndex - 5];
    const touchedSupport = last.low <= currentMa25 * 1.025 && last.close >= currentMa25 * 0.98;
    const stableCandle = last.close >= last.open * 0.98 && last.change >= -3;
    const volumeTurningUp = currentVolumeMa5 > volumeMa5[lastIndex - 1]
      && volumeMa5[lastIndex - 1] <= volumeMa5[lastIndex - 2] * 1.02;
    const volumeContracting = (volumes[lastIndex] < volumes[lastIndex - 1] && volumes[lastIndex - 1] < volumes[lastIndex - 2])
      || (currentVolumeMa5 < volumeMa5[lastIndex - 1] && volumeMa5[lastIndex - 1] < volumeMa5[lastIndex - 2]);
    const synchronousBreakout = priceCrossIndex >= 0
      && volumeCrossIndex >= 0
      && lastIndex - volumeCrossIndex <= 1
      && Math.abs(priceCrossIndex - volumeCrossIndex) <= 1
      && trendUp
      && supportDistance > 0
      && supportDistance <= 10
      && currentVolumeMa5 > currentVolumeMa60
      && currentVolumeMa5 > volumeMa5[lastIndex - 1];
    const resonanceSupport = trendUp
      && touchedSupport
      && stableCandle
      && supportDistance <= 3
      && volumeRatio >= 0.9
      && volumeRatio <= 1.2
      && volumeTurningUp;
    const contractingPullback = trendUp
      && touchedSupport
      && stableCandle
      && supportDistance <= 5
      && pullback >= -15
      && pullback <= -2
      && volumeRatio > 1
      && volumeRatio <= 1.6
      && volumeCrossIndex < 0
      && volumeContracting;
    const signal = synchronousBreakout
      ? '量价同步突破'
      : resonanceSupport
        ? '量能共振支撑'
        : contractingPullback
          ? '缩量回踩蓄力'
          : null;
    if (!signal) continue;

    const priceCrossDaysAgo = priceCrossIndex < 0 ? -1 : lastIndex - priceCrossIndex;
    const volumeCrossDaysAgo = volumeCrossIndex < 0 ? -1 : lastIndex - volumeCrossIndex;
    const baseScore = signal === '量价同步突破' ? 90 : signal === '量能共振支撑' ? 82 : 76;
    const score = Math.min(100, Math.max(0, baseScore
      - Math.abs(supportDistance) * 1.5
      - Math.abs(volumeRatio - 1) * 12
      - Math.max(0, Math.abs(pullback) - 6) * 0.6
      + Math.max(0, last.change) * 0.8));
    candidates.push({
      tsCode,
      code: tsCode.split('.')[0],
      close: round(last.close),
      change: round(last.change, 2),
      ma25: round(currentMa25),
      supportDistance: round(supportDistance, 2),
      pullback: round(pullback, 2),
      volumeMa5: round(currentVolumeMa5, 2),
      volumeMa60: round(currentVolumeMa60, 2),
      volumeRatio: round(volumeRatio, 2),
      priceCrossDaysAgo,
      volumeCrossDaysAgo,
      score: round(score, 1),
      signal,
    });
  }

  const signalOrder: Record<VolumeSignal['signal'], number> = { '量价同步突破': 0, '量能共振支撑': 1, '缩量回踩蓄力': 2 };
  candidates.sort((left, right) => signalOrder[left.signal] - signalOrder[right.signal] || right.score - left.score);
  const names = await fetchTencentNames(candidates.map((item) => item.tsCode));
  const namedCandidates = candidates.filter((item) => {
    const name = names.get(item.code);
    return Boolean(name) && !name.toUpperCase().includes('ST');
  });
  const signals: VolumeSignal[] = namedCandidates.map(({ tsCode: _tsCode, ...item }) => ({
    ...item,
    name: names.get(item.code)!,
  }));
  const snapshot: VolumeSnapshot = {
    signals,
    storageDate: lastTradingDate,
    provider: 'Tushare 日线 + 腾讯证券公开行情',
    fetchedAt: new Date().toISOString(),
    lastTradingDate,
    cached: false,
    scannedCount,
    excludedCount: excludedByBoard.size + candidates.length - namedCandidates.length,
    breakoutCount: signals.filter((signal) => signal.signal === '量价同步突破').length,
    supportCount: signals.filter((signal) => signal.signal === '量能共振支撑').length,
    pullbackCount: signals.filter((signal) => signal.signal === '缩量回踩蓄力').length,
  };
  writeVolumeSnapshot(snapshot);
  await flushMysqlWrites();
  return snapshot;
}

export async function getBullPointSnapshot(forceRefresh = false, requestedDate?: string): Promise<BullPointSnapshot> {
  const today = dateText(new Date());
  const currentTradingDate = await latestTradingDateOnOrBefore(today);
  const storageDate = requestedDate
    ? await latestTradingDateOnOrBefore(normalizeSnapshotDate(requestedDate))
    : currentTradingDate;
  if (!forceRefresh) {
    const stored = readBullPointSnapshot(storageDate);
    if (stored) return requestedDate && storageDate !== currentTradingDate ? withCurrentBullPointPrices(stored) : stored;
  }
  const runningScan = bullPointScansInFlight.get(storageDate);
  if (runningScan) {
    const snapshot = await runningScan;
    return requestedDate && storageDate !== currentTradingDate ? withCurrentBullPointPrices(snapshot) : snapshot;
  }
  const scan = buildBullPointSnapshot(storageDate);
  bullPointScansInFlight.set(storageDate, scan);
  try {
    const snapshot = await scan;
    return requestedDate && storageDate !== currentTradingDate ? withCurrentBullPointPrices(snapshot) : snapshot;
  } finally {
    bullPointScansInFlight.delete(storageDate);
  }
}

async function buildBullPointSnapshot(storageDate: string): Promise<BullPointSnapshot> {
  const queryDays = recentWeekdays(70, new Date(`${storageDate.slice(0, 4)}-${storageDate.slice(4, 6)}-${storageDate.slice(6)}T12:00:00`));
  const dailyByCode = new Map<string, PullbackDailyRow[]>();
  const availableDays = new Set<string>();
  const excludedByBoard = new Set<string>();

  for (const [index, tradeDate] of queryDays.entries()) {
    if (index > 0 && index % 45 === 0) await wait(61_000);
    const rows = await callTushare('daily', { trade_date: tradeDate }, 'ts_code,trade_date,open,high,low,close,pre_close,pct_chg,vol');
    if (rows.length > 0) availableDays.add(tradeDate);
    for (const row of rows) {
      const tsCode = String(row.ts_code);
      const code = tsCode.split('.')[0];
      if (tsCode.endsWith('.BJ') || code.startsWith('30') || code.startsWith('688') || code.startsWith('689')) {
        excludedByBoard.add(tsCode);
        continue;
      }
      const values = [row.open, row.high, row.low, row.close, row.pre_close, row.vol].map(Number);
      if (values.some((value) => !Number.isFinite(value))) continue;
      const [open, high, low, close, previousClose, volume] = values;
      const series = dailyByCode.get(tsCode) ?? [];
      series.push({
        tsCode,
        tradeDate: String(row.trade_date),
        open,
        high,
        low,
        close,
        previousClose,
        volume,
        change: Number(row.pct_chg),
      });
      dailyByCode.set(tsCode, series);
    }
  }

  const tradingDays = [...availableDays].sort();
  if (tradingDays.length < 45) throw new Error('Tushare 返回的有效日线不足 45 条，无法计算多空趋势多点');
  const lastTradingDate = tradingDays.at(-1)!;
  const candidates: BullPointCandidate[] = [];
  let scannedCount = 0;

  for (const [tsCode, rows] of dailyByCode) {
    rows.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
    if (rows.length < 45) continue;
    const lastIndex = rows.length - 1;
    const last = rows[lastIndex];
    if (last.tradeDate !== lastTradingDate) continue;
    scannedCount += 1;

    const var1 = rows.map((row, index) => {
      if (index < 20) return Number.NaN;
      const window = rows.slice(index - 20, index + 1);
      const highest = Math.max(...window.map((item) => item.high));
      const lowest = Math.min(...window.map((item) => item.low));
      const range = highest - lowest;
      return range <= 0 ? Number.NaN : 100 - (90 * (highest - row.close)) / range;
    });
    const rawSix = rows.map((row, index) => {
      if (index < 5) return Number.NaN;
      const window = rows.slice(index - 5, index + 1);
      const highest = Math.max(...window.map((item) => item.high));
      const lowest = Math.min(...window.map((item) => item.low));
      const range = highest - lowest;
      return range <= 0 ? Number.NaN : (100 * (highest - row.close)) / range;
    });
    const var3 = simpleMovingAverage(rawSix, 34).map((value) => 100 - value);
    const trendLine = simpleMovingAverage(var3, 6);
    const values = [var1[lastIndex], trendLine[lastIndex], var1[lastIndex - 1], trendLine[lastIndex - 1]];
    if (!values.every(Number.isFinite)) continue;
    const crossedUp = var1[lastIndex] > trendLine[lastIndex]
      && var1[lastIndex - 1] <= trendLine[lastIndex - 1];
    if (!crossedUp) continue;

    candidates.push({
      tsCode,
      code: tsCode.split('.')[0],
      close: round(last.close),
      change: round(last.change, 2),
      var1: round(var1[lastIndex], 2),
      trendLine: round(trendLine[lastIndex], 2),
      previousVar1: round(var1[lastIndex - 1], 2),
      previousTrendLine: round(trendLine[lastIndex - 1], 2),
      crossSpread: round(var1[lastIndex] - trendLine[lastIndex], 2),
      signal: '多点',
    });
  }

  candidates.sort((left, right) => right.crossSpread - left.crossSpread || right.change - left.change);
  const names = await fetchTencentNames(candidates.map((item) => item.tsCode));
  const namedCandidates = candidates.filter((item) => {
    const name = names.get(item.code);
    return Boolean(name) && !name.toUpperCase().includes('ST');
  });
  const signals: BullPointSignal[] = namedCandidates.map(({ tsCode: _tsCode, ...item }) => ({
    ...item,
    name: names.get(item.code)!,
  }));
  const snapshot: BullPointSnapshot = {
    signals,
    storageDate: lastTradingDate,
    provider: 'Tushare 日线 + 腾讯证券公开行情',
    fetchedAt: new Date().toISOString(),
    lastTradingDate,
    cached: false,
    scannedCount,
    excludedCount: excludedByBoard.size + candidates.length - namedCandidates.length,
  };
  writeBullPointSnapshot(snapshot);
  await flushMysqlWrites();
  return snapshot;
}
