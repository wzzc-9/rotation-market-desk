export type MarketCategory = 'A股宽基' | '海外指数' | '商品';

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
  provider: string;
  fetchedAt: string;
  lastTradingDate: string;
  cached: boolean;
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
