import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type MarketCategory = 'A股宽基' | '海外指数' | '商品';

type SymbolConfig = {
  marketCode: string;
  code: string;
  name: string;
  category: MarketCategory;
};

type TencentRow = [string, string, string, string, string, string, ...string[]];

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
  yearPerformance: RotationYearPerformance;
  provider: string;
  fetchedAt: string;
  lastTradingDate: string;
  cached: boolean;
};

export type RotationTradeNode = {
  date: string;
  action: '买入' | '轮换' | '清仓';
  fromCode: string | null;
  fromName: string | null;
  toCode: string | null;
  toName: string | null;
  reason: string;
  cumulativeReturn: number;
};

export type RotationYearPerformance = {
  year: number;
  startDate: string;
  lastTradingDate: string;
  cumulativeReturn: number;
  nodeCount: number;
  currentHolding: string | null;
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

const symbols: SymbolConfig[] = [
  { marketCode: 'sh512100', code: '512100', name: '中证1000', category: 'A股宽基' },
  { marketCode: 'sz159949', code: '159949', name: '创业板50', category: 'A股宽基' },
  { marketCode: 'sh518880', code: '518880', name: '黄金ETF', category: '商品' },
  { marketCode: 'sh513100', code: '513100', name: '纳指ETF', category: '海外指数' },
  { marketCode: 'sz159920', code: '159920', name: '恒生ETF', category: '海外指数' },
  { marketCode: 'sz159628', code: '159628', name: '国证2000', category: 'A股宽基' },
  { marketCode: 'sh510300', code: '510300', name: '沪深300', category: 'A股宽基' },
  { marketCode: 'sh588120', code: '588120', name: '科创100', category: 'A股宽基' },
];

const cacheTtlMs = 30_000;
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
let cachedSnapshot: RotationSnapshot | null = null;
let cachedAt = 0;
const macdScansInFlight = new Map<string, Promise<MacdSnapshot>>();
const macdPullbackScansInFlight = new Map<string, Promise<MacdPullbackSnapshot>>();
const macdKdjScansInFlight = new Map<string, Promise<MacdKdjSnapshot>>();
const volumeScansInFlight = new Map<string, Promise<VolumeSnapshot>>();
const bullPointScansInFlight = new Map<string, Promise<BullPointSnapshot>>();
const historyCache = new Map<string, { value: MarketHistory; cachedAt: number }>();
const tradingDateCache = new Map<string, string>();

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

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
  if (!existsSync(path)) return null;
  try {
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as MacdSnapshot & { version?: string };
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
  mkdirSync(macdSnapshotDirectory, { recursive: true });
  const path = macdSnapshotPath(snapshot.storageDate);
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ ...snapshot, version: macdSnapshotVersion, cached: false }, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, path);
}

export function listMacdSnapshotDates() {
  if (!existsSync(macdSnapshotDirectory)) return [];
  return readdirSync(macdSnapshotDirectory)
    .map((file) => /^(\d{8})\.json$/.exec(file)?.[1])
    .filter((date): date is string => Boolean(date))
    .sort((a, b) => b.localeCompare(a));
}

function macdPullbackSnapshotPath(date: string) {
  return resolve(macdPullbackSnapshotDirectory, `${date}.json`);
}

function readMacdPullbackSnapshot(date: string): MacdPullbackSnapshot | null {
  const path = macdPullbackSnapshotPath(date);
  if (!existsSync(path)) return null;
  try {
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as MacdPullbackSnapshot & { version?: string };
    if (snapshot.version !== macdPullbackSnapshotVersion || !Array.isArray(snapshot.signals) || !snapshot.lastTradingDate) return null;
    return { ...snapshot, storageDate: date, cached: true };
  } catch {
    return null;
  }
}

function writeMacdPullbackSnapshot(snapshot: MacdPullbackSnapshot) {
  mkdirSync(macdPullbackSnapshotDirectory, { recursive: true });
  const path = macdPullbackSnapshotPath(snapshot.storageDate);
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ ...snapshot, version: macdPullbackSnapshotVersion, cached: false }, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, path);
}

export function listMacdPullbackSnapshotDates() {
  if (!existsSync(macdPullbackSnapshotDirectory)) return [];
  return readdirSync(macdPullbackSnapshotDirectory)
    .map((file) => /^(\d{8})\.json$/.exec(file)?.[1])
    .filter((date): date is string => Boolean(date))
    .sort((left, right) => right.localeCompare(left));
}

function macdKdjSnapshotPath(date: string) {
  return resolve(macdKdjSnapshotDirectory, `${date}.json`);
}

function readMacdKdjSnapshot(date: string): MacdKdjSnapshot | null {
  const path = macdKdjSnapshotPath(date);
  if (!existsSync(path)) return null;
  try {
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as MacdKdjSnapshot & { version?: string };
    if (snapshot.version !== macdKdjSnapshotVersion || !Array.isArray(snapshot.signals) || !snapshot.lastTradingDate) return null;
    return { ...snapshot, storageDate: date, cached: true };
  } catch {
    return null;
  }
}

function writeMacdKdjSnapshot(snapshot: MacdKdjSnapshot) {
  mkdirSync(macdKdjSnapshotDirectory, { recursive: true });
  const path = macdKdjSnapshotPath(snapshot.storageDate);
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ ...snapshot, version: macdKdjSnapshotVersion, cached: false }, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, path);
}

export function listMacdKdjSnapshotDates() {
  if (!existsSync(macdKdjSnapshotDirectory)) return [];
  return readdirSync(macdKdjSnapshotDirectory)
    .map((file) => /^(\d{8})\.json$/.exec(file)?.[1])
    .filter((date): date is string => Boolean(date))
    .sort((left, right) => right.localeCompare(left));
}

function volumeSnapshotPath(date: string) {
  return resolve(volumeSnapshotDirectory, `${date}.json`);
}

function readVolumeSnapshot(date: string): VolumeSnapshot | null {
  const path = volumeSnapshotPath(date);
  if (!existsSync(path)) return null;
  try {
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as VolumeSnapshot & { version?: string };
    if (snapshot.version !== volumeSnapshotVersion || !Array.isArray(snapshot.signals) || !snapshot.lastTradingDate) return null;
    return { ...snapshot, storageDate: date, cached: true };
  } catch {
    return null;
  }
}

function writeVolumeSnapshot(snapshot: VolumeSnapshot) {
  mkdirSync(volumeSnapshotDirectory, { recursive: true });
  const path = volumeSnapshotPath(snapshot.storageDate);
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ ...snapshot, version: volumeSnapshotVersion, cached: false }, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, path);
}

export function listVolumeSnapshotDates() {
  if (!existsSync(volumeSnapshotDirectory)) return [];
  return readdirSync(volumeSnapshotDirectory)
    .map((file) => /^(\d{8})\.json$/.exec(file)?.[1])
    .filter((date): date is string => Boolean(date))
    .sort((left, right) => right.localeCompare(left));
}

function bullPointSnapshotPath(date: string) {
  return resolve(bullPointSnapshotDirectory, `${date}.json`);
}

function readBullPointSnapshot(date: string): BullPointSnapshot | null {
  const path = bullPointSnapshotPath(date);
  if (!existsSync(path)) return null;
  try {
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as BullPointSnapshot & { version?: string };
    if (snapshot.version !== bullPointSnapshotVersion || !Array.isArray(snapshot.signals) || !snapshot.lastTradingDate) return null;
    return { ...snapshot, storageDate: date, cached: true };
  } catch {
    return null;
  }
}

function writeBullPointSnapshot(snapshot: BullPointSnapshot) {
  mkdirSync(bullPointSnapshotDirectory, { recursive: true });
  const path = bullPointSnapshotPath(snapshot.storageDate);
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ ...snapshot, version: bullPointSnapshotVersion, cached: false }, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, path);
}

export function listBullPointSnapshotDates() {
  if (!existsSync(bullPointSnapshotDirectory)) return [];
  return readdirSync(bullPointSnapshotDirectory)
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
  const quotes = new Map<string, { name: string; price?: number }>();
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
      if (name) quotes.set(code, { name, price: Number.isFinite(price) && price > 0 ? price : undefined });
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
  const nodes: RotationTradeNode[] = [];

  for (const date of yearDates) {
    if (position && previousDate) {
      const previousClose = closes.get(position)?.get(previousDate);
      const currentClose = closes.get(position)?.get(date);
      if (previousClose && currentClose) value *= currentClose / previousClose;
    }

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
        cumulativeReturn: round((value - 1) * 100, 2),
      });
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
    nodes,
  };
}

function getSymbol(code: string) {
  const symbol = symbols.find((item) => item.code === code);
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

export async function getRotationSnapshot(forceRefresh = false): Promise<RotationSnapshot> {
  if (!forceRefresh && cachedSnapshot && Date.now() - cachedAt < cacheTtlMs) {
    return { ...cachedSnapshot, cached: true };
  }

  const fetched = [];
  for (const symbol of symbols) fetched.push(await fetchSymbol(symbol));

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

  const snapshot: RotationSnapshot = {
    markets,
    yearPerformance: calculateRotationYearPerformance(fetched),
    provider: '腾讯证券公开行情',
    fetchedAt: new Date().toISOString(),
    lastTradingDate: fetched.map(item => item.rawLastDate).sort().at(-1)!,
    cached: false,
  };
  cachedSnapshot = snapshot;
  cachedAt = Date.now();
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
  return snapshot;
}
