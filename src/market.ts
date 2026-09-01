export type MarketCategory = 'A股宽基' | '海外指数' | '商品' | '债券';

export type EtfSearchResult = {
  marketCode: string;
  code: string;
  name: string;
  category: MarketCategory;
};

export type RotationBacktestResponse = {
  version: string;
  strategy: 'rotation' | 'asset-rotation' | 'dual-etf';
  configVersion: number;
  generatedAt: string;
  period: { start: string; end: string };
  symbols: EtfSearchResult[];
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

export type AssetRotationBacktestResponse = RotationBacktestResponse;

export type AssetRotationCombination = {
  id: string;
  size: number;
  codes: string[];
  assetClasses: string[];
  tenYearReturn: number;
  earlyFiveYearReturn: number;
  fiveYearReturn: number;
  tenYearAnnualizedReturn: number;
  earlyFiveYearAnnualizedReturn: number;
  fiveYearAnnualizedReturn: number;
  tenYearMaxDrawdown: number;
  earlyFiveYearMaxDrawdown: number;
  fiveYearMaxDrawdown: number;
  rollingTwelveMonthReturnP10: number;
  tenYearTrades: number;
  currentYearReturn: number;
  currentYearMaxDrawdown: number;
  currentYearTrades: number;
  currentHolding: string | null;
  tenYearRank: number;
  currentYearRank: number;
  compositeScore: number;
  compositeRank: number;
  displayRank: number;
};

type AssetRotationScoreMetricPopulation = {
  mean: number;
  standardDeviation: number;
};

export type AssetRotationCombinationsResponse = {
  version: string;
  generatedAt: string;
  periods: {
    tenYear: { start: string; end: string };
    earlyFiveYear?: { start: string; end: string };
    fiveYear: { start: string; end: string };
    currentYear: { year: number; start: string; end: string };
  };
  universe: Array<{ code: string; name: string; assetClass: string; firstDate: string; lastDate: string }>;
  totalCombinations: number;
  allCombinations: number;
  filters: {
    size: number | null;
    tenYearDrawdown: number | null;
    fiveYearDrawdown: number | null;
    currentYearDrawdown: number | null;
    codes: string[];
  };
  scoring: {
    formula: string;
    population: {
      tenYearAnnualizedReturn?: AssetRotationScoreMetricPopulation;
      earlyFiveYearAnnualizedReturn?: AssetRotationScoreMetricPopulation;
      fiveYearAnnualizedReturn: AssetRotationScoreMetricPopulation;
      currentYearReturn: AssetRotationScoreMetricPopulation;
      tenYearDrawdownAbsolute?: AssetRotationScoreMetricPopulation;
      earlyFiveYearDrawdownAbsolute?: AssetRotationScoreMetricPopulation;
      fiveYearDrawdownAbsolute: AssetRotationScoreMetricPopulation;
      currentYearDrawdownAbsolute: AssetRotationScoreMetricPopulation;
      rollingTwelveMonthReturnP10?: AssetRotationScoreMetricPopulation;
    };
  };
  sort: 'score' | 'ten-year' | 'five-year' | 'current-year';
  direction: 'asc' | 'desc';
  page: number;
  pageSize: number;
  totalPages: number;
  best: AssetRotationCombination | null;
  combinations: AssetRotationCombination[];
  poolDraft: AssetRotationPoolDraft;
};

export type Candle = {
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

export type RotationResponse = {
  markets: RankedMarket[];
  poolDraft?: AssetRotationPoolDraft;
  yearPerformance: RotationYearPerformance;
  provider: string;
  fetchedAt: string;
  lastTradingDate: string;
  cached: boolean;
  backtest?: RotationBacktestResponse;
};

export type AssetRotationPoolDraft = {
  dirty: boolean;
  activeVersion: number;
  version: number;
  updatedAt: string;
  symbols: EtfSearchResult[];
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

export type MarketHistoryResponse = {
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

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

export function movingAverage(candles: Candle[], period: number) {
  return candles.map((_, index) => {
    if (index < period - 1) return '-';
    const window = candles.slice(index - period + 1, index + 1);
    return round(window.reduce((sum, candle) => sum + candle.close, 0) / period);
  });
}

export function formatPct(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatVolume(value: number) {
  return `${(value / 10000).toFixed(0)}万`;
}
