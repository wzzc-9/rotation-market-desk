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
  provider: string;
  fetchedAt: string;
  lastTradingDate: string;
  cached: boolean;
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
let cachedSnapshot: RotationSnapshot | null = null;
let cachedAt = 0;

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

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
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${config.marketCode},day,,,100,qfq`;
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
    candles: rows.slice(-90).map(parseRow),
  };
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
    provider: '腾讯证券公开行情',
    fetchedAt: new Date().toISOString(),
    lastTradingDate: fetched.map(item => item.rawLastDate).sort().at(-1)!,
    cached: false,
  };
  cachedSnapshot = snapshot;
  cachedAt = Date.now();
  return snapshot;
}
