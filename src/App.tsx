import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Filter,
  GitMerge,
  History,
  LayoutDashboard,
  Menu,
  Maximize2,
  Minimize2,
  Plus,
  Replace,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Star,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import type { EChartsCoreOption } from 'echarts/core';
import EChart from './EChart';
import { apiFetch } from './api';
import { annualReturns, assetRotationAnnualReturns, assetRotationVideoBenchmark, dualEtfAnnualReturns, dualEtfVideoBenchmark, type AnnualReturn } from './backtest';
import { formatPct, formatVolume, movingAverage, type AssetRotationCombinationsResponse, type BullPointSnapshot, type EtfSearchResult, type HistoryPeriod, type MacdKdjSnapshot, type MacdPullbackSnapshot, type MacdSnapshot, type MarketHistoryResponse, type RankedMarket, type RotationBacktestResponse, type RotationResponse, type RotationYearPerformance, type VolumeSnapshot } from './market';

type View = 'dashboard' | 'screener' | 'strategy';
type ScreeningStrategyId = 'macd' | 'macd-pullback' | 'macd-kdj' | 'volume-signals' | 'bull-points';
type StrategyId = 'rotation' | 'asset-rotation' | 'dual-etf' | 'intersection' | ScreeningStrategyId;
type StrategyGroupId = 'index' | 'stock';
type Category = '全部' | RankedMarket['category'];
type PoolSymbol = Pick<EtfSearchResult, 'code' | 'name' | 'category'>;

const intersectionStrategyOptions: Array<{ id: ScreeningStrategyId; label: string; detail: string; endpoint: string }> = [
  { id: 'macd', label: 'MACD 金叉共振', detail: '10 / 20 / 7', endpoint: '/api/strategy/macd-confluence' },
  { id: 'macd-pullback', label: 'MACD 零轴回踩', detail: '5 / 34 / 5', endpoint: '/api/strategy/macd-pullback' },
  { id: 'macd-kdj', label: 'MACD + KDJ 共振', detail: '低位双金叉', endpoint: '/api/strategy/macd-kdj' },
  { id: 'volume-signals', label: '量价三信号', detail: 'MA25 · 量均 5 / 60', endpoint: '/api/strategy/volume-signals' },
  { id: 'bull-points', label: '多空趋势多点', detail: 'HHV 21 / 6 · MA 34 / 6', endpoint: '/api/strategy/bull-points' },
];

const menuItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: '行情总览', icon: LayoutDashboard },
  { id: 'screener', label: '条件选股', icon: SlidersHorizontal },
  { id: 'strategy', label: '策略中心', icon: Target },
];

const screenedStockHistoryCache = new Map<string, MarketHistoryResponse>();
const screenedStockHistoryRequests = new Map<string, Promise<MarketHistoryResponse>>();
const stockKlineOpenEvent = 'screened-stock-kline-open';
const etfSearchHistoryStorageKey = 'rotation-desk-etf-search-history-v2';
const etfSearchHistoryLimit = 8;

function readEtfSearchHistory() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(etfSearchHistoryStorageKey) ?? '[]') as unknown;
    return Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === 'string' && item.trim().length >= 2).slice(0, etfSearchHistoryLimit)
      : [];
  } catch {
    return [];
  }
}

function persistEtfSearchHistory(history: string[]) {
  try {
    window.localStorage.setItem(etfSearchHistoryStorageKey, JSON.stringify(history));
  } catch {
    // Search remains available when browser storage is disabled.
  }
}

function formatTradingDate(value: string) {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value);
  return match ? `${match[1]}年${match[2]}月${match[3]}日` : value;
}

function toInputDate(value: string) {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function Sparkline({ market }: { market: RankedMarket }) {
  const values = market.candles.slice(-22).map((candle) => candle.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values
    .map((value, index) => `${(index / (values.length - 1)) * 90 + 3},${31 - ((value - min) / (max - min || 1)) * 25}`)
    .join(' ');
  return (
    <svg className="sparkline" viewBox="0 0 96 34" role="img" aria-label={`${market.name}近期走势`}>
      <polyline points={points} fill="none" stroke={market.change >= 0 ? '#ef5b5b' : '#26a97b'} strokeWidth="2" />
    </svg>
  );
}

function Change({ value }: { value: number }) {
  return <span className={value >= 0 ? 'up' : 'down'}>{formatPct(value)}</span>;
}

function RankBadge({ rank }: { rank: number }) {
  return <span className={`rank rank-${Math.min(rank, 4)}`}>{rank}</span>;
}

function MarketTable({
  rows,
  selectedCode,
  onSelect,
  watchlist,
  onToggleWatch,
}: {
  rows: RankedMarket[];
  selectedCode: string;
  onSelect: (market: RankedMarket) => void;
  watchlist: Set<string>;
  onToggleWatch: (code: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="market-table">
        <thead>
          <tr>
            <th>排名</th>
            <th>标的</th>
            <th>现价</th>
            <th>涨跌幅</th>
            <th>20日动量</th>
            <th>MA20</th>
            <th>量比</th>
            <th>信号</th>
            <th aria-label="自选" />
          </tr>
        </thead>
        <tbody>
          {rows.map((market) => (
            <tr
              key={market.code}
              className={selectedCode === market.code ? 'selected' : ''}
              onClick={() => onSelect(market)}
            >
              <td><RankBadge rank={market.rank} /></td>
              <td>
                <div className="instrument-cell">
                  <strong>{market.name}</strong>
                  <small>{market.code} · {market.category}</small>
                </div>
              </td>
              <td className="number">{market.price.toFixed(3)}</td>
              <td className="number"><Change value={market.change} /></td>
              <td className="number"><Change value={market.momentum} /></td>
              <td className="number">{market.ma20.toFixed(3)}</td>
              <td className="number">{market.volumeRatio.toFixed(2)}</td>
              <td><span className={`signal signal-${market.signal}`}>{market.signal}</span></td>
              <td>
                <button
                  className={`icon-button star-button ${watchlist.has(market.code) ? 'active' : ''}`}
                  title={watchlist.has(market.code) ? '移出自选' : '加入自选'}
                  aria-label={watchlist.has(market.code) ? '移出自选' : '加入自选'}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleWatch(market.code);
                  }}
                >
                  <Star size={15} fill={watchlist.has(market.code) ? 'currentColor' : 'none'} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty-state">没有符合当前条件的标的</div>}
    </div>
  );
}

function DetailChart({ market }: { market: RankedMarket }) {
  const option = useMemo<EChartsCoreOption>(() => ({
    animation: false,
    backgroundColor: 'transparent',
    legend: {
      data: ['K线', 'MA5', 'MA20'],
      right: 12,
      top: 4,
      textStyle: { color: '#6b7885', fontSize: 11 },
      itemWidth: 15,
      itemHeight: 8,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: '#94a0ab' } },
      backgroundColor: '#ffffff',
      borderColor: '#d8e0e7',
      textStyle: { color: '#1c2833', fontSize: 12 },
    },
    grid: [
      { left: 54, right: 20, top: 40, height: '57%' },
      { left: 54, right: 20, top: '76%', height: '13%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: market.candles.map((item) => item.date),
        boundaryGap: true,
        axisLine: { lineStyle: { color: '#d8e0e7' } },
        axisLabel: { color: '#74808c', fontSize: 10, interval: 8 },
        splitLine: { show: false },
      },
      {
        type: 'category',
        gridIndex: 1,
        data: market.candles.map((item) => item.date),
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: '#d8e0e7' } },
        axisTick: { show: false },
      },
    ],
    yAxis: [
      {
        scale: true,
        splitNumber: 4,
        axisLabel: { color: '#74808c', fontSize: 10 },
        splitLine: { lineStyle: { color: '#e8edf1' } },
      },
      {
        scale: true,
        gridIndex: 1,
        axisLabel: { color: '#74808c', fontSize: 10, formatter: (value: number) => `${Math.round(value / 10000)}万` },
        splitLine: { show: false },
      },
    ],
    dataZoom: [{ type: 'inside', start: 24, end: 100, xAxisIndex: [0, 1] }],
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        data: market.candles.map((item) => [item.open, item.close, item.low, item.high]),
        itemStyle: {
          color: '#ef5b5b',
          color0: '#26a97b',
          borderColor: '#ef5b5b',
          borderColor0: '#26a97b',
        },
      },
      {
        name: 'MA5',
        type: 'line',
        data: movingAverage(market.candles, 5),
        symbol: 'none',
        lineStyle: { color: '#e0a84b', width: 1.2 },
      },
      {
        name: 'MA20',
        type: 'line',
        data: movingAverage(market.candles, 20),
        symbol: 'none',
        lineStyle: { color: '#58a6d9', width: 1.3 },
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: market.candles.map((item) => ({
          value: item.volume,
          itemStyle: { color: item.close >= item.open ? 'rgba(239,91,91,.55)' : 'rgba(38,169,123,.55)' },
        })),
      },
    ],
  }), [market]);

  return <EChart option={option} className="main-chart" />;
}

type BullBearMarker = { index: number; date: string; signal: '多' | '空'; price: number };

function calculateBullBearMarkers(candles: MarketHistoryResponse['candles']): BullBearMarker[] {
  const var1 = candles.map((candle, index) => {
    if (index < 20) return Number.NaN;
    const window = candles.slice(index - 20, index + 1);
    const highest = Math.max(...window.map((item) => item.high));
    const lowest = Math.min(...window.map((item) => item.low));
    const range = highest - lowest;
    return range <= 0 ? Number.NaN : 100 - (90 * (highest - candle.close)) / range;
  });
  const rawSix = candles.map((candle, index) => {
    if (index < 5) return Number.NaN;
    const window = candles.slice(index - 5, index + 1);
    const highest = Math.max(...window.map((item) => item.high));
    const lowest = Math.min(...window.map((item) => item.low));
    const range = highest - lowest;
    return range <= 0 ? Number.NaN : (100 * (highest - candle.close)) / range;
  });
  const average = (values: number[], period: number, index: number) => {
    if (index < period - 1) return Number.NaN;
    const window = values.slice(index - period + 1, index + 1);
    return window.every(Number.isFinite) ? window.reduce((sum, value) => sum + value, 0) / period : Number.NaN;
  };
  const var3 = rawSix.map((_, index) => 100 - average(rawSix, 34, index));
  const trendLine = var3.map((_, index) => average(var3, 6, index));
  const markers: BullBearMarker[] = [];
  candles.forEach((candle, index) => {
    if (index < 1 || ![var1[index], trendLine[index], var1[index - 1], trendLine[index - 1]].every(Number.isFinite)) return;
    if (var1[index] > trendLine[index] && var1[index - 1] <= trendLine[index - 1]) {
      markers.push({ index, date: candle.date, signal: '多', price: candle.low * 0.985 });
      return;
    }
    if (trendLine[index] > var1[index] && trendLine[index - 1] <= var1[index - 1]) {
      markers.push({ index, date: candle.date, signal: '空', price: candle.high * 1.015 });
    }
  });
  return markers;
}

function HoverKlineChart({ history }: { history: MarketHistoryResponse }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const ma5 = history.period === 'minute' ? [] : movingAverage(history.candles, 5);
    const ma10 = history.period === 'minute' ? [] : movingAverage(history.candles, 10);
    const ma20 = history.period === 'minute' ? [] : movingAverage(history.candles, 20);
    const bullBearMarkers = history.period === 'minute' ? [] : calculateBullBearMarkers(history.candles);
    const signalByIndex = new Map(bullBearMarkers.map((marker) => [marker.index, marker.signal]));
    const pointCount = history.period === 'minute' ? history.points.length : history.candles.length;
    const visibleCount = history.period === 'day' ? 90 : history.period === 'week' ? 80 : history.period === 'month' ? 72 : pointCount;
    const zoomStart = pointCount > visibleCount ? ((pointCount - visibleCount) / pointCount) * 100 : 0;
    const tooltipFormatter = (value: unknown) => {
      const items = (Array.isArray(value) ? value : [value]) as Array<{ dataIndex?: number }>;
      const index = Number(items[0]?.dataIndex);
      if (!Number.isInteger(index) || index < 0) return '';
      if (history.period === 'minute') {
        const point = history.points[index];
        if (!point) return '';
        const change = history.previousClose > 0 ? ((point.price / history.previousClose) - 1) * 100 : 0;
        const changeColor = change >= 0 ? '#b94b4b' : '#16815f';
        return `<div style="min-width:150px"><strong>${point.time}</strong><br/>价格：${point.price.toFixed(2)}<br/>昨收：${history.previousClose.toFixed(2)}<br/><span style="color:${changeColor}">涨跌幅：${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span></div>`;
      }
      const candle = history.candles[index];
      if (!candle) return '';
      const previousClose = history.candles[index - 1]?.close;
      const change = previousClose && previousClose > 0 ? ((candle.close / previousClose) - 1) * 100 : null;
      const changeColor = (change ?? 0) >= 0 ? '#b94b4b' : '#16815f';
      const changeText = change === null ? '--' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
      const averageText = (average: Array<number | string>, label: string) => {
        const current = average[index];
        return `${label}：${typeof current === 'number' ? current.toFixed(2) : '--'}`;
      };
      const signal = signalByIndex.get(index);
      const signalText = signal ? `<br/><strong style="color:${signal === '多' ? '#c94747' : '#16815f'}">多空趋势：${signal}点</strong>` : '';
      return `<div style="min-width:180px"><strong>${candle.date}</strong><br/><span style="color:${changeColor}">涨跌幅：${changeText}</span><br/>开盘：${candle.open.toFixed(2)}　收盘：${candle.close.toFixed(2)}<br/>最高：${candle.high.toFixed(2)}　最低：${candle.low.toFixed(2)}<br/>${averageText(ma5, 'MA5')}　${averageText(ma10, 'MA10')}<br/>${averageText(ma20, 'MA20')}${signalText}</div>`;
    };
    return {
    animation: false,
    backgroundColor: '#ffffff',
    legend: {
      data: history.period === 'minute' ? ['分时'] : ['K线', 'MA5', 'MA10', 'MA20'],
      top: 8,
      right: 12,
      itemWidth: 14,
      itemHeight: 7,
      textStyle: { color: '#657480', fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: '#9da9b3' } },
      backgroundColor: '#ffffff',
      borderColor: '#d8e0e7',
      textStyle: { color: '#2e3b46', fontSize: 12 },
      formatter: tooltipFormatter,
      confine: true,
    },
    grid: { left: 54, right: 18, top: 38, bottom: 48 },
    xAxis: {
      type: 'category',
      data: history.period === 'minute' ? history.points.map((item) => item.time) : history.candles.map((item) => item.date),
      boundaryGap: true,
      axisLine: { lineStyle: { color: '#d8e0e7' } },
      axisTick: { show: false },
      axisLabel: { color: '#778591', fontSize: 10, hideOverlap: true },
    },
    yAxis: {
      scale: true,
      splitNumber: 4,
      axisLabel: { color: '#778591', fontSize: 10 },
      splitLine: { lineStyle: { color: '#edf1f4' } },
    },
    dataZoom: [
      { type: 'inside', start: zoomStart, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: 'shift', moveOnMouseWheel: false },
      { type: 'slider', start: zoomStart, end: 100, height: 12, bottom: 6, borderColor: '#d7e0e6', backgroundColor: '#f7f9fa', fillerColor: 'rgba(82, 133, 174, .16)', handleSize: 9, showDetail: false },
    ],
    series: history.period === 'minute'
      ? [{ name: '分时', type: 'line', data: history.points.map((item) => item.price), symbol: 'none', smooth: true, lineStyle: { color: '#3f83b5', width: 1.6 }, areaStyle: { color: 'rgba(63, 131, 181, .12)' }, markLine: { symbol: 'none', lineStyle: { color: '#94a2ad', type: 'dashed' }, data: [{ yAxis: history.previousClose }] } }]
      : [
        {
          name: 'K线',
          type: 'candlestick',
          data: history.candles.map((item) => [item.open, item.close, item.low, item.high]),
          itemStyle: { color: '#e25353', color0: '#1b9870', borderColor: '#e25353', borderColor0: '#1b9870' },
          markPoint: {
            silent: true,
            animation: false,
            data: bullBearMarkers.map((marker) => ({
              name: marker.signal,
              value: marker.signal,
              coord: [marker.date, marker.price],
              symbol: 'circle',
              symbolSize: 28,
              symbolOffset: [0, marker.signal === '多' ? 8 : -8],
              itemStyle: { color: marker.signal === '多' ? '#df5353' : '#35a66f', borderColor: '#ffffff', borderWidth: 1.5, shadowBlur: 4, shadowColor: 'rgba(35, 49, 60, .2)' },
              label: { show: true, formatter: marker.signal, color: '#ffffff', fontSize: 12, fontWeight: 700 },
            })),
          },
        },
        { name: 'MA5', type: 'line', data: ma5, symbol: 'none', lineStyle: { color: '#d29b35', width: 1.1 } },
        { name: 'MA10', type: 'line', data: ma10, symbol: 'none', lineStyle: { color: '#4d8dbd', width: 1.1 } },
        { name: 'MA20', type: 'line', data: ma20, symbol: 'none', lineStyle: { color: '#a16ca0', width: 1.2 } },
      ],
    };
  }, [history]);

  return <EChart option={option} className="universe-hover-chart" />;
}

async function loadScreenedStockHistory(code: string, period: HistoryPeriod) {
  const key = `${code}:${period}`;
  const cached = screenedStockHistoryCache.get(key);
  if (cached) return cached;
  const runningRequest = screenedStockHistoryRequests.get(key);
  if (runningRequest) return runningRequest;
  const request = apiFetch(`/api/market/${code}/history?period=${period}`, { cache: 'no-store' })
    .then(async (response) => {
      const payload = await response.json() as MarketHistoryResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || `历史行情返回 HTTP ${response.status}`);
      screenedStockHistoryCache.set(key, payload);
      return payload;
    })
    .finally(() => screenedStockHistoryRequests.delete(key));
  screenedStockHistoryRequests.set(key, request);
  return request;
}

function StockKlineCell({ code, name }: { code: string; name: string }) {
  const triggerId = useRef(`${code}-${Math.random().toString(36).slice(2)}`);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [period, setPeriod] = useState<HistoryPeriod>('day');
  const [loadingPeriod, setLoadingPeriod] = useState<HistoryPeriod | ''>('');
  const [errorState, setErrorState] = useState<{ period: HistoryPeriod; message: string } | null>(null);
  const [historyByPeriod, setHistoryByPeriod] = useState<Partial<Record<HistoryPeriod, MarketHistoryResponse>>>(() => {
    const cached = screenedStockHistoryCache.get(`${code}:day`);
    return cached ? { day: cached } : {};
  });
  const [bounds, setBounds] = useState<CSSProperties>();
  const ensureHistory = (nextPeriod: HistoryPeriod) => {
    const cached = screenedStockHistoryCache.get(`${code}:${nextPeriod}`);
    if (cached) {
      setHistoryByPeriod((current) => ({ ...current, [nextPeriod]: cached }));
      return;
    }
    setLoadingPeriod(nextPeriod);
    setErrorState(null);
    void loadScreenedStockHistory(code, nextPeriod)
      .then((payload) => setHistoryByPeriod((current) => ({ ...current, [nextPeriod]: payload })))
      .catch((reason) => setErrorState({ period: nextPeriod, message: reason instanceof Error ? reason.message : '历史行情加载失败' }))
      .finally(() => setLoadingPeriod((current) => current === nextPeriod ? '' : current));
  };
  const openFor = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const compact = window.innerWidth <= 820;
    const width = Math.min(compact ? 560 : 1120, window.innerWidth - 24);
    const height = Math.min(compact ? 406 : 812, window.innerHeight - 76);
    const rightSide = rect.right + 12;
    const left = rightSide + width <= window.innerWidth - 12
      ? rightSide
      : Math.max(12, rect.left - width - 12);
    const top = Math.max(64, Math.min(rect.top - 36, window.innerHeight - height - 12));
    document.dispatchEvent(new CustomEvent(stockKlineOpenEvent, { detail: triggerId.current }));
    setBounds({ width, height, left, top });
    setOpen(true);
    setExpanded(false);
    setPeriod('day');
    setErrorState(null);
    ensureHistory('day');
  };
  const changePeriod = (nextPeriod: HistoryPeriod) => {
    setPeriod(nextPeriod);
    setErrorState(null);
    ensureHistory(nextPeriod);
  };
  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== triggerId.current) {
        setOpen(false);
        setExpanded(false);
      }
    };
    document.addEventListener(stockKlineOpenEvent, closeOther);
    return () => {
      document.removeEventListener(stockKlineOpenEvent, closeOther);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.stock-kline-popover') || triggerRef.current?.contains(target)) return;
      setExpanded(false);
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeFromOutside);
    return () => document.removeEventListener('pointerdown', closeFromOutside);
  }, [open]);
  const history = historyByPeriod[period];
  const isLoading = loadingPeriod === period;
  const error = errorState?.period === period ? errorState.message : '';
  const periodLabel = period === 'minute' ? '分时线' : `${period === 'day' ? '日' : period === 'week' ? '周' : '月'} K · MA5 / MA10 / MA20`;
  return <button
    ref={triggerRef}
    type="button"
    className="instrument-cell stock-kline-trigger"
    title="点击查看行情"
    aria-label={`${name} ${code}，点击查看行情`}
    onClick={(event) => openFor(event.currentTarget)}
  >
    <strong>{name}</strong><small>{code}</small>
    {open && createPortal(<div className={`stock-kline-popover${expanded ? ' is-expanded' : ''}`} style={expanded ? undefined : bounds} onClick={(event) => event.stopPropagation()}>
      <div className="universe-kline-title"><span>{name} · {code}</span><div className="universe-kline-tools"><span>{periodLabel}</span><button className="icon-button" type="button" title={expanded ? '退出放大' : '放大图表'} aria-label={expanded ? '退出放大' : '放大图表'} onClick={() => setExpanded((current) => !current)}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button><button className="icon-button" type="button" title="关闭图表" aria-label="关闭图表" onClick={() => { setExpanded(false); setOpen(false); }}><X size={15} /></button></div></div>
      <div className="kline-period-tabs" role="tablist" aria-label="K线周期">{([{ id: 'minute', label: '分时' }, { id: 'day', label: '日线' }, { id: 'week', label: '周线' }, { id: 'month', label: '月线' }] as Array<{ id: HistoryPeriod; label: string }>).map((item) => <button key={item.id} type="button" role="tab" aria-selected={period === item.id} className={period === item.id ? 'active' : ''} onClick={() => changePeriod(item.id)}>{item.label}</button>)}</div>
      {history && <HoverKlineChart history={history} />}
      {isLoading && <div className="universe-kline-state"><RefreshCw className="spin-icon" size={18} />正在加载{period === 'minute' ? '分时' : 'K线'}行情</div>}
      {!isLoading && error && <div className="universe-kline-state error"><AlertTriangle size={17} />{error}</div>}
    </div>, document.body)}
  </button>;
}

function AssetPoolEditor({ markets, updating, deferred = false, label = '管理标的池', description = '按名称或 6 位代码搜索沪深 ETF', statusText, action, onAdd }: { markets: PoolSymbol[]; updating: boolean; deferred?: boolean; label?: string; description?: string; statusText?: string; action?: ReactNode; onAdd: (result: EtfSearchResult) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EtfSearchResult[]>([]);
  const [searchHistory, setSearchHistory] = useState(readEtfSearchHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [addingCode, setAddingCode] = useState('');
  const searchControlRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const poolCodes = useMemo(() => new Set(markets.map((market) => market.code)), [markets]);
  const rememberSearch = useCallback((term: string) => {
    const normalized = term.trim();
    if (normalized.length < 2) return;
    setSearchHistory((current) => {
      const next = [normalized, ...current.filter((item) => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase())].slice(0, etfSearchHistoryLimit);
      persistEtfSearchHistory(next);
      return next;
    });
  }, []);
  const forgetSearch = useCallback((term: string) => {
    const normalized = term.trim().toLocaleLowerCase();
    setSearchHistory((current) => {
      const next = current.filter((item) => item.toLocaleLowerCase() !== normalized);
      if (next.length !== current.length) persistEtfSearchHistory(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const closeHistory = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && searchControlRef.current?.contains(target)) return;
      setHistoryOpen(false);
    };
    document.addEventListener('pointerdown', closeHistory);
    return () => document.removeEventListener('pointerdown', closeHistory);
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError('');
      return;
    }
    setSearching(true);
    setSearchError('');
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await apiFetch(`/api/etfs/search?q=${encodeURIComponent(normalized)}`, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json() as { results?: EtfSearchResult[]; message?: string };
        if (!response.ok) throw new Error(payload.message || `ETF 搜索返回 HTTP ${response.status}`);
        const nextResults = Array.isArray(payload.results) ? payload.results : [];
        setResults(nextResults);
        if (nextResults.length > 0) rememberSearch(normalized);
        else forgetSearch(normalized);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setResults([]);
        setSearchError(reason instanceof Error ? reason.message : 'ETF 搜索失败');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [forgetSearch, query, rememberSearch]);

  const useHistoryItem = (term: string) => {
    setQuery(term);
    setHistoryOpen(false);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };
  const removeHistoryItem = (term: string) => {
    setSearchHistory((current) => {
      const next = current.filter((item) => item !== term);
      persistEtfSearchHistory(next);
      return next;
    });
  };
  const clearSearchHistory = () => {
    setSearchHistory([]);
    persistEtfSearchHistory([]);
    setHistoryOpen(false);
  };

  const addResult = async (result: EtfSearchResult) => {
    setAddingCode(result.code);
    try {
      await onAdd(result);
      setQuery('');
      setResults([]);
    } finally {
      setAddingCode('');
    }
  };

  const showResults = query.trim().length >= 2;
  return <div className="asset-pool-editor">
    <div className="etf-search-copy"><strong>{label}</strong><span>{description}</span></div>
    <div className="etf-search-control" ref={searchControlRef}>
      <Search size={16} />
      <input ref={searchInputRef} value={query} disabled={updating} placeholder="例如：黄金ETF / 518880" aria-label="搜索 ETF" onFocus={() => setHistoryOpen(query.trim().length === 0)} onKeyDown={(event) => { if (event.key === 'Escape') setHistoryOpen(false); }} onChange={(event) => { setQuery(event.target.value); setHistoryOpen(event.target.value.trim().length === 0); }} />
      {query && !updating && <button type="button" className="etf-search-clear" title="清空搜索" aria-label="清空搜索" onClick={() => { setQuery(''); setHistoryOpen(true); searchInputRef.current?.focus(); }}><X size={14} /></button>}
      {historyOpen && query.trim().length === 0 && searchHistory.length > 0 && <div className="etf-search-history">
        <div className="etf-search-history-head"><span>最近搜索</span><button type="button" onClick={clearSearchHistory}>清空</button></div>
        <div className="etf-search-history-list">
          {searchHistory.map((term) => <div className="etf-search-history-item" key={term}>
            <button type="button" className="etf-search-history-term" onClick={() => useHistoryItem(term)}><History size={14} /><span>{term}</span></button>
            <button type="button" className="etf-search-history-remove" title={`删除搜索记录 ${term}`} aria-label={`删除搜索记录 ${term}`} onClick={() => removeHistoryItem(term)}><X size={13} /></button>
          </div>)}
        </div>
      </div>}
      {showResults && <div className="etf-search-results">
        {searching && <div className="etf-search-state"><RefreshCw className="spin-icon" size={15} />正在搜索</div>}
        {!searching && searchError && <div className="etf-search-state error"><AlertTriangle size={15} />{searchError}</div>}
        {!searching && !searchError && results.length === 0 && <div className="etf-search-state">未找到沪深 ETF</div>}
        {!searching && !searchError && results.map((result) => {
          const included = poolCodes.has(result.code);
          const adding = addingCode === result.code;
          return <div className="etf-search-result" key={result.code}>
            <div><strong>{result.name}</strong><span>{result.code} · {result.category}</span></div>
            <button type="button" disabled={included || updating || Boolean(addingCode)} onClick={() => void addResult(result).catch(() => undefined)}>
              {adding ? <RefreshCw className="spin-icon" size={14} /> : included ? <Check size={14} /> : <Plus size={14} />}
              {included ? '已加入' : adding ? (deferred ? '暂存中' : '重算中') : '加入'}
            </button>
          </div>;
        })}
      </div>}
    </div>
    {updating && <div className="pool-update-state"><RefreshCw className="spin-icon" size={14} />{statusText ?? (deferred ? '正在保存标的池变更' : '正在补齐历史行情并重算 2016—2025 与今年以来收益')}</div>}
    {action && <div className="pool-editor-action">{action}</div>}
  </div>;
}

function StrategyUniverse({ markets, symbols, trendPeriod = 20, momentumLabel = '20日动量', editor, updating = false, onRemove }: { markets: RankedMarket[]; symbols?: PoolSymbol[]; trendPeriod?: number; momentumLabel?: string; editor?: ReactNode; updating?: boolean; onRemove?: (market: PoolSymbol) => void }) {
  const editable = Boolean(onRemove);
  const marketByCode = useMemo(() => new Map(markets.map((market) => [market.code, market])), [markets]);
  const poolSymbols: PoolSymbol[] = symbols ?? markets;
  const symbolByCode = new Map(poolSymbols.map((symbol) => [symbol.code, symbol]));
  const rows = [
    ...markets.filter((market) => symbolByCode.has(market.code)).map((market) => ({ symbol: symbolByCode.get(market.code)!, market })),
    ...poolSymbols.filter((symbol) => !marketByCode.has(symbol.code)).map((symbol) => ({ symbol, market: undefined })),
  ];
  return (
    <section className="panel universe-panel">
      <div className="panel-title-row">
        <div><span className="eyebrow">ASSET UNIVERSE</span><h3>轮动标的池</h3></div>
        <span className="count-badge">{poolSymbols.length}</span>
      </div>
      {editor}
      <div className="table-scroll">
        <table className={`strategy-universe-table${editable ? ' has-actions' : ''}`}>
          <thead><tr><th>排名</th><th>标的</th><th>类别</th><th>现价</th><th>涨跌幅</th><th>MA{trendPeriod}</th><th>{momentumLabel}</th><th>量比</th><th>趋势</th><th>信号</th>{editable && <th>管理</th>}</tr></thead>
          <tbody>{rows.map(({ symbol, market }) => (
            <tr key={symbol.code} className={market ? undefined : 'pool-pending-row'}>
              <td>{market ? <RankBadge rank={market.rank} /> : <span className="pending-metric">--</span>}</td>
              <td><StockKlineCell name={symbol.name} code={symbol.code} /></td>
              <td>{symbol.category}</td>
              <td className="number">{market ? market.price.toFixed(3) : <span className="pending-metric">--</span>}</td>
              <td className="number">{market ? <Change value={market.change} /> : <span className="pending-metric">--</span>}</td>
              <td className="number">{market ? market.ma20.toFixed(3) : <span className="pending-metric">--</span>}</td>
              <td className="number">{market ? <Change value={market.momentum} /> : <span className="pending-metric">--</span>}</td>
              <td className="number">{market ? market.volumeRatio.toFixed(2) : <span className="pending-metric">--</span>}</td>
              <td>{market ? <span className={market.aboveMa ? 'trend-up' : 'trend-down'}>{market.aboveMa ? `MA${trendPeriod}上方` : `MA${trendPeriod}下方`}</span> : <span className="pending-metric">待计算</span>}</td>
              <td>{market ? <span className={`signal signal-${market.signal}`}>{market.signal}</span> : <span className="signal signal-pending">待计算</span>}</td>
              {editable && <td><button type="button" className="pool-remove-button" disabled={updating || poolSymbols.length <= 2} title={poolSymbols.length <= 2 ? '标的池至少保留 2 只 ETF' : `移除 ${symbol.name}`} aria-label={`从标的池移除 ${symbol.name}`} onClick={() => onRemove?.(symbol)}><Trash2 size={15} /></button></td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function MomentumChart({ markets }: { markets: RankedMarket[] }) {
  const data = [...markets].reverse();
  const option = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 500,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (items: unknown) => {
        const item = (items as Array<{ name: string; value: number }>)[0];
        return `${item.name}<br/>20日动量：${item.value > 0 ? '+' : ''}${item.value.toFixed(2)}%`;
      },
      backgroundColor: '#ffffff',
      borderColor: '#d8e0e7',
      textStyle: { color: '#1c2833' },
    },
    grid: { left: 72, right: 28, top: 14, bottom: 24 },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#74808c', formatter: '{value}%' },
      splitLine: { lineStyle: { color: '#e8edf1' } },
    },
    yAxis: {
      type: 'category',
      data: data.map((market) => market.name),
      axisLabel: { color: '#536270', fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      barWidth: 9,
      data: data.map((market) => ({
        value: Number(market.momentum.toFixed(2)),
        itemStyle: { color: market.momentum >= 0 ? '#d65252' : '#26946f', borderRadius: 1 },
      })),
      markLine: {
        symbol: 'none',
        lineStyle: { color: '#7c8793', type: 'dashed' },
        data: [{ xAxis: 0 }],
        label: { show: false },
      },
    }],
  }), [markets]);
  return <EChart option={option} className="momentum-chart" />;
}

function AnnualReturnChart({ data }: { data: AnnualReturn[] }) {
  const ordered = useMemo(() => [...data].reverse(), [data]);
  const option = useMemo<EChartsCoreOption>(() => ({
    animationDuration: 500,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (items: unknown) => {
        const item = (items as Array<{ name: string; value: number }>)[0];
        return `${item.name}年<br/>策略收益：${item.value > 0 ? '+' : ''}${item.value.toFixed(2)}%`;
      },
      backgroundColor: '#ffffff',
      borderColor: '#d8e0e7',
      textStyle: { color: '#1c2833' },
    },
    grid: { left: 48, right: 14, top: 18, bottom: 34 },
    xAxis: {
      type: 'category',
      data: ordered.map((item) => String(item.year)),
      axisLabel: { color: '#6b7885', fontSize: 13, interval: 0 },
      axisLine: { lineStyle: { color: '#d8e0e7' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#6b7885', fontSize: 13, formatter: '{value}%' },
      splitLine: { lineStyle: { color: '#e8edf1' } },
    },
    series: [{
      type: 'bar',
      barMaxWidth: 28,
      data: ordered.map((item) => ({
        value: item.returnRate,
        itemStyle: { color: item.returnRate >= 0 ? '#d94e4e' : '#168a64', borderRadius: 1 },
      })),
    }],
  }), [ordered]);
  return <EChart option={option} className="annual-return-chart" />;
}

function Dashboard({
  markets,
  selected,
  setSelected,
  watchlist,
  toggleWatch,
}: {
  markets: RankedMarket[];
  selected: RankedMarket;
  setSelected: (market: RankedMarket) => void;
  watchlist: Set<string>;
  toggleWatch: (code: string) => void;
}) {
  const leader = markets[0];
  const breadth = markets.filter((market) => market.aboveMa).length;
  return (
    <>
      <section className="metric-strip">
        <div className="metric">
          <span>策略领先</span>
          <strong>{leader.name}</strong>
          <small><Change value={leader.momentum} /> 距MA20</small>
        </div>
        <div className="metric">
          <span>均线上方</span>
          <strong>{breadth}<i> / 8</i></strong>
          <small>市场宽度 {Math.round((breadth / 8) * 100)}%</small>
        </div>
        <div className="metric">
          <span>今日信号</span>
          <strong className="signal-text">{leader.aboveMa ? `持有 ${leader.name}` : '空仓等待'}</strong>
          <small>{leader.aboveMa ? `${leader.code} 排名第 1 且站上 MA20` : '暂无标的满足入场条件'}</small>
        </div>
        <div className="metric">
          <span>组合状态</span>
          <strong>{leader.aboveMa ? '已入场' : '空仓'}</strong>
          <small>{leader.aboveMa ? '策略仓位 100%' : '等待下一轮信号'}</small>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <div className="instrument-title">
                <h2>{selected.name}</h2>
                <span>{selected.code}</span>
                <span className={`status-dot ${selected.aboveMa ? 'positive' : ''}`}>
                  {selected.aboveMa ? 'MA20上方' : 'MA20下方'}
                </span>
              </div>
              <div className="price-row">
                <strong>{selected.price.toFixed(3)}</strong>
                <Change value={selected.change} />
                <span>动量 <Change value={selected.momentum} /></span>
              </div>
            </div>
            <div className="segmented" aria-label="周期">
              <button className="active">日K</button>
              <button>周K</button>
              <button>月K</button>
            </div>
          </div>
          <DetailChart market={selected} />
        </section>

        <aside className="panel watch-panel">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">MY WATCHLIST</span>
              <h3>我的自选</h3>
            </div>
            <span className="count-badge">{watchlist.size}</span>
          </div>
          <div className="watch-list">
            {markets.filter((market) => watchlist.has(market.code)).map((market) => (
              <button key={market.code} className="watch-row" onClick={() => setSelected(market)}>
                <span>
                  <strong>{market.name}</strong>
                  <small>{market.code}</small>
                </span>
                <Sparkline market={market} />
                <span className="watch-price">
                  <strong>{market.price.toFixed(3)}</strong>
                  <Change value={market.change} />
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel ranking-panel">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">ROTATION UNIVERSE</span>
              <h3>轮动标的排名</h3>
            </div>
            <span className="update-note"><RefreshCw size={12} /> 收盘后更新</span>
          </div>
          <MarketTable
            rows={markets}
            selectedCode={selected.code}
            onSelect={setSelected}
            watchlist={watchlist}
            onToggleWatch={toggleWatch}
          />
        </section>

        <section className="panel momentum-panel">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">MOMENTUM SPREAD</span>
              <h3>20日动量分布</h3>
            </div>
          </div>
          <MomentumChart markets={markets} />
        </section>
      </div>
    </>
  );
}

function Screener({
  markets,
  selected,
  setSelected,
  watchlist,
  toggleWatch,
}: {
  markets: RankedMarket[];
  selected: RankedMarket;
  setSelected: (market: RankedMarket) => void;
  watchlist: Set<string>;
  toggleWatch: (code: string) => void;
}) {
  const [category, setCategory] = useState<Category>('全部');
  const [aboveOnly, setAboveOnly] = useState(true);
  const [minMomentum, setMinMomentum] = useState(0);
  const [minVolumeRatio, setMinVolumeRatio] = useState(0.8);
  const filtered = markets.filter((market) =>
    (category === '全部' || market.category === category)
    && (!aboveOnly || market.aboveMa)
    && market.momentum >= minMomentum
    && market.volumeRatio >= minVolumeRatio,
  );

  return (
    <div className="workspace-view">
      <section className="view-heading">
        <div>
          <span className="eyebrow">SMART SCREENER</span>
          <h1>条件选股</h1>
          <p>在策略标的池内筛选强势品种，结果按 20 日均线动量排序。</p>
        </div>
        <div className="result-count"><strong>{filtered.length}</strong><span>个结果</span></div>
      </section>

      <section className="filter-band">
        <div className="filter-group category-filter">
          <label>资产类别</label>
          <div className="segmented wide">
            {(['全部', 'A股宽基', '海外指数', '商品'] as Category[]).map((item) => (
              <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>
            ))}
          </div>
        </div>
        <div className="filter-group toggle-filter">
          <label htmlFor="above-ma">趋势过滤</label>
          <button id="above-ma" role="switch" aria-checked={aboveOnly} className={`switch ${aboveOnly ? 'on' : ''}`} onClick={() => setAboveOnly(!aboveOnly)}>
            <span />
          </button>
          <strong>仅 MA20 上方</strong>
        </div>
        <div className="filter-group range-filter">
          <label htmlFor="momentum-range">最低动量 <strong>{minMomentum.toFixed(1)}%</strong></label>
          <input id="momentum-range" type="range" min="-5" max="5" step="0.5" value={minMomentum} onChange={(event) => setMinMomentum(Number(event.target.value))} />
        </div>
        <div className="filter-group range-filter">
          <label htmlFor="volume-range">最低量比 <strong>{minVolumeRatio.toFixed(1)}</strong></label>
          <input id="volume-range" type="range" min="0.5" max="1.5" step="0.1" value={minVolumeRatio} onChange={(event) => setMinVolumeRatio(Number(event.target.value))} />
        </div>
      </section>

      <section className="panel screener-results">
        <div className="panel-title-row">
          <div>
            <span className="eyebrow">SCREENING RESULTS</span>
            <h3>筛选结果</h3>
          </div>
          <button className="text-button" onClick={() => { setCategory('全部'); setAboveOnly(true); setMinMomentum(0); setMinVolumeRatio(0.8); }}>
            <RefreshCw size={14} /> 重置条件
          </button>
        </div>
        <MarketTable rows={filtered} selectedCode={selected.code} onSelect={setSelected} watchlist={watchlist} onToggleWatch={toggleWatch} />
      </section>
    </div>
  );
}

function RotationCombinationExplorer({ strategy, rotationPoolCodes, rotationPoolUpdating = false, onReplaceRotationPool }: { strategy: 'rotation' | 'asset-rotation'; rotationPoolCodes: string[]; rotationPoolUpdating?: boolean; onReplaceRotationPool: (codes: string[]) => Promise<void> }) {
  const isAssetRotation = strategy === 'asset-rotation';
  const endpointBase = `/api/strategy/${strategy}/combinations`;
  type CombinationSortKey = 'score' | 'ten-year' | 'current-year';
  type CombinationSort = { key: CombinationSortKey; direction: 'asc' | 'desc' };
  const [sort, setSort] = useState<CombinationSort>({ key: 'score', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [result, setResult] = useState<AssetRotationCombinationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [poolUpdating, setPoolUpdating] = useState(false);
  const [poolCalculating, setPoolCalculating] = useState(false);
  const [poolError, setPoolError] = useState('');
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [replaceNotice, setReplaceNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void apiFetch(`${endpointBase}?sort=${sort.key}&direction=${sort.direction}&page=${page}&pageSize=25`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as AssetRotationCombinationsResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || `组合回测返回 HTTP ${response.status}`);
      setResult(payload);
    }).catch((reason) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : '组合回测数据加载失败');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [endpointBase, page, sort.direction, sort.key]);
  useEffect(() => {
    if (result) setPageInput(String(result.page));
  }, [result]);
  const names = useMemo(() => new Map(result?.universe.map((item) => [item.code, item.name]) ?? []), [result]);
  const first = result?.best;
  const changeSort = (key: CombinationSortKey) => {
    setSort((current) => ({ key, direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc' }));
    setPage(1);
    setPageInput('1');
  };
  const sortableHeader = (key: CombinationSortKey, label: string) => {
    const active = sort.key === key;
    const nextDirection = active && sort.direction === 'desc' ? '正序' : '倒序';
    return <button className={`table-sort-button${active ? ' active' : ''}`} type="button" title={`按${label}${nextDirection}排列`} onClick={() => changeSort(key)}>{label}{!active ? <ArrowUpDown size={13} /> : sort.direction === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}</button>;
  };
  const goToPage = (nextPage: number) => {
    if (!result) return;
    const normalized = Math.min(Math.max(Math.trunc(nextPage) || 1, 1), result.totalPages);
    setPageInput(String(normalized));
    setPage(normalized);
  };
  const submitPage = () => goToPage(Number(pageInput));
  const updatePool = useCallback(async (action: 'add' | 'remove', item: PoolSymbol) => {
    setPoolUpdating(true);
    setPoolError('');
    try {
      const response = await apiFetch(action === 'add' ? `${endpointBase}/symbols` : `${endpointBase}/symbols/${encodeURIComponent(item.code)}`, {
        method: action === 'add' ? 'POST' : 'DELETE',
        headers: action === 'add' ? { 'Content-Type': 'application/json' } : undefined,
        body: action === 'add' ? JSON.stringify({ code: item.code }) : undefined,
      });
      const payload = await response.json() as AssetRotationCombinationsResponse['poolDraft'] & { message?: string };
      if (!response.ok) throw new Error(payload.message || `${action === 'add' ? '加入' : '移出'}组合池失败`);
      if (!Array.isArray(payload.symbols) || payload.symbols.length < 3) throw new Error('组合池变更已保存，但返回的数据不完整');
      setResult((current) => current ? { ...current, poolDraft: payload } : current);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : `${action === 'add' ? '加入' : '移出'}组合池失败`;
      setPoolError(message);
      throw reason;
    } finally {
      setPoolUpdating(false);
    }
  }, [endpointBase]);
  const recalculatePool = useCallback(async () => {
    setPoolCalculating(true);
    setPoolError('');
    try {
      const response = await apiFetch(`${endpointBase}/recalculate?sort=${sort.key}&direction=${sort.direction}&pageSize=25`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload = await response.json() as AssetRotationCombinationsResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || '全组合收益排名重新计算失败');
      if (!Array.isArray(payload.combinations) || !payload.combinations.length || payload.poolDraft?.dirty) throw new Error('重新计算完成，但返回的数据不完整');
      setPage(1);
      setPageInput('1');
      setResult(payload);
    } catch (reason) {
      setPoolError(reason instanceof Error ? reason.message : '全组合收益排名重新计算失败');
    } finally {
      setPoolCalculating(false);
    }
  }, [endpointBase, sort.direction, sort.key]);
  const poolSymbols = result?.poolDraft.symbols ?? [];
  const calculatedCodes = useMemo(() => new Set(result?.universe.map((item) => item.code) ?? []), [result]);
  const activeRotationPoolKey = useMemo(() => [...rotationPoolCodes].sort().join(','), [rotationPoolCodes]);
  const replaceRotationPool = useCallback(async (item: AssetRotationCombinationsResponse['combinations'][number]) => {
    setReplacingId(item.id);
    setReplaceNotice(null);
    try {
      await onReplaceRotationPool(item.codes);
      setReplaceNotice({ type: 'success', message: `已将轮动标的池替换为排名第 ${item.displayRank} 的 ${item.size} 只 ETF，请点击上方“重新计算”后生效。` });
    } catch (reason) {
      setReplaceNotice({ type: 'error', message: reason instanceof Error ? reason.message : '轮动标的池替换失败' });
    } finally {
      setReplacingId(null);
    }
  }, [onReplaceRotationPool]);
  return (
    <section className="panel asset-combination-panel">
      <div className="panel-title-row combination-title-row">
        <div><span className="eyebrow">{isAssetRotation ? 'ASSET COMBINATION REPLAY' : 'INDEX COMBINATION REPLAY'}</span><h3>全组合收益排名</h3></div>
        <div className="combination-toolbar">
          {result && <span>{poolSymbols.length} 只候选{result.poolDraft.dirty ? '（待计算）' : ''} · {result.totalCombinations.toLocaleString()} 个组合</span>}
        </div>
      </div>
      {result && <>
        <AssetPoolEditor
          markets={poolSymbols}
          updating={poolUpdating || poolCalculating}
          deferred
          label="管理组合池"
          description="仅组合池内 ETF 参与排列组合"
          statusText={poolCalculating ? '正在补齐行情并重新计算全组合收益排名' : undefined}
          action={<button type="button" className={`pool-recalculate-button${poolCalculating ? ' is-calculating' : ''}`} disabled={!result.poolDraft.dirty || poolUpdating || poolCalculating} title={result.poolDraft.dirty ? '应用组合池变更并重新计算全组合收益排名' : '当前没有待计算的组合池变更'} onClick={() => void recalculatePool()}><RefreshCw className={poolCalculating ? 'spin-icon' : undefined} size={14} />{poolCalculating ? '正在计算' : '重新计算'}</button>}
          onAdd={(item) => updatePool('add', item)}
        />
        <div className="combination-pool-strip">
          <div className="combination-pool-label"><span>组合池</span><small>{poolSymbols.length} 只</small></div>
          <div className="combination-pool-symbols">
            {poolSymbols.map((symbol) => <div className={`combination-pool-chip${calculatedCodes.has(symbol.code) ? '' : ' is-pending'}`} key={symbol.code}>
              <span><strong>{symbol.name}</strong><small>{symbol.code}</small></span>
              <button type="button" disabled={poolUpdating || poolCalculating || poolSymbols.length <= 3} title={poolSymbols.length <= 3 ? '组合池至少保留 3 只 ETF' : `移出组合池：${symbol.name}`} aria-label={`从组合池移除 ${symbol.name}`} onClick={() => void updatePool('remove', symbol).catch(() => undefined)}><X size={13} /></button>
            </div>)}
          </div>
        </div>
      </>}
      {poolError && <div className="combination-pool-error"><AlertTriangle size={15} /><span>{poolError}</span><button type="button" className="icon-button" title="关闭提示" aria-label="关闭组合池提示" onClick={() => setPoolError('')}><X size={14} /></button></div>}
      {replaceNotice && <div className={`combination-replace-notice ${replaceNotice.type}`}>
        {replaceNotice.type === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />}
        <span>{replaceNotice.message}</span>
        <button type="button" className="icon-button" title="关闭提示" aria-label="关闭替换提示" onClick={() => setReplaceNotice(null)}><X size={14} /></button>
      </div>}
      {error && <div className="combination-state error"><AlertTriangle size={16} />{error}</div>}
      {loading && !result && <div className="combination-state"><RefreshCw className="spin-icon" size={16} />正在读取全部组合回测</div>}
      {result && first && <>
        <div className="combination-leader">
          <div><span>当前第一名</span><strong>{first.codes.map((code) => names.get(code) ?? code).join(' / ')}</strong><small>{first.codes.join(' · ')}</small></div>
          <div><span>{sort.key === 'score' ? '综合得分' : sort.key === 'ten-year' ? '近 10 年累计收益' : `${result.periods.currentYear.year} 年收益`}</span><strong className={sort.key === 'score' ? undefined : (sort.key === 'ten-year' ? first.tenYearReturn : first.currentYearReturn) >= 0 ? 'up' : 'down'}>{sort.key === 'score' ? first.compositeScore.toFixed(4) : formatPct(sort.key === 'ten-year' ? first.tenYearReturn : first.currentYearReturn)}</strong></div>
          <div><span>{sort.key === 'score' ? '近 10 年年化收益' : '同期最大回撤'}</span><strong className={sort.key === 'score' ? (first.tenYearAnnualizedReturn >= 0 ? 'up' : 'down') : 'down'}>{formatPct(sort.key === 'score' ? first.tenYearAnnualizedReturn : sort.key === 'ten-year' ? first.tenYearMaxDrawdown : first.currentYearMaxDrawdown)}</strong></div>
          <div><span>当前持仓</span><strong>{first.currentHolding ? names.get(first.currentHolding) ?? first.currentHolding : '空仓'}</strong></div>
        </div>
        <div className="combination-table-wrap">
          <table className="combination-table">
            <thead><tr><th>排名</th><th>ETF 组合</th><th>资产覆盖</th><th>数量</th><th>{sortableHeader('score', '综合得分')}</th><th>{sortableHeader('ten-year', '近10年收益')}</th><th>年化收益</th><th>10年回撤</th><th>{sortableHeader('current-year', `${result.periods.currentYear.year}收益`)}</th><th>今年回撤</th><th>{isAssetRotation ? '周度交易' : '每日交易'}</th><th>当前持仓</th><th>操作</th></tr></thead>
            <tbody>{result.combinations.map((item) => (
              <tr key={item.id}>
                <td><RankBadge rank={item.displayRank} /></td>
                <td><div className="combination-assets"><strong>{item.codes.map((code) => names.get(code) ?? code).join(' / ')}</strong><small>{item.codes.join(' · ')}</small></div></td>
                <td>{item.assetClasses.join(' · ')}</td>
                <td>{item.size}</td>
                <td className={item.compositeScore >= 0 ? 'up' : 'down'}>{item.compositeScore.toFixed(4)}</td>
                <td><Change value={item.tenYearReturn} /></td>
                <td><Change value={item.tenYearAnnualizedReturn} /></td>
                <td><Change value={item.tenYearMaxDrawdown} /></td>
                <td><Change value={item.currentYearReturn} /></td>
                <td><Change value={item.currentYearMaxDrawdown} /></td>
                <td>{sort.key === 'current-year' ? item.currentYearTrades : item.tenYearTrades}</td>
                <td>{item.currentHolding ? names.get(item.currentHolding) ?? item.currentHolding : '空仓'}</td>
                <td>{(() => {
                  const selected = [...item.codes].sort().join(',') === activeRotationPoolKey;
                  const replacing = replacingId === item.id;
                  return <button type="button" className={`combination-replace-button${selected ? ' is-selected' : ''}`} disabled={rotationPoolUpdating || replacingId !== null || selected} title={selected ? '当前轮动标的池已是这个组合' : '将上方轮动标的池替换为这个组合'} onClick={() => void replaceRotationPool(item)}>{replacing ? <RefreshCw className="spin-icon" size={13} /> : selected ? <Check size={13} /> : <Replace size={13} />}{replacing ? '替换中' : selected ? '已选' : '替换'}</button>;
                })()}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="combination-pagination">
          <span>第 {result.page.toLocaleString()} / {result.totalPages.toLocaleString()} 页</span>
          <button type="button" className="icon-button" title="上一页" aria-label="组合排名上一页" disabled={result.page <= 1 || loading} onClick={() => goToPage(result.page - 1)}><ChevronLeft size={16} /></button>
          <form className="combination-page-jump" onSubmit={(event) => { event.preventDefault(); submitPage(); }}>
            <label htmlFor={`combination-page-${sort.key}-${sort.direction}`}>页码</label>
            <input id={`combination-page-${sort.key}-${sort.direction}`} aria-label="输入组合排名页码" type="text" inputMode="numeric" value={pageInput} disabled={loading} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ''))} />
            <button type="submit" disabled={loading}>跳转</button>
          </form>
          <button type="button" className="icon-button" title="下一页" aria-label="组合排名下一页" disabled={result.page >= result.totalPages || loading} onClick={() => goToPage(result.page + 1)}><ChevronRight size={16} /></button>
        </div>
        <div className="method-note">综合得分 = 50% × 标准化近 10 年年化收益 + 20% × 标准化 {result.periods.currentYear.year} 年收益 − 20% × 标准化近 10 年最大回撤绝对值 − 10% × 标准化 {result.periods.currentYear.year} 年最大回撤绝对值；标准化使用全部组合的总体均值与总体标准差。候选全集取自独立组合池，完整枚举 3—{result.universe.length} 只 ETF 的所有组合，并排除仅含 2 只 ETF 的组合。{isAssetRotation ? '所有组合均使用每周最后一个交易日收盘信号、20 日涨幅排名、MA28 与前 2 名持有规则' : '所有组合均使用每日收盘信号、收盘价相对 MA20 的动量排名与第 1 名持有规则'}，未计手续费、滑点与冲击成本。组合排名属于历史参数搜索，不代表未来收益。</div>
      </>}
    </section>
  );
}

function StrategyCenter({ markets, yearPerformance, strategyBacktest, poolEditor, poolSymbols, poolUpdating = false, onRemoveMarket, onReplaceCombination, variant = 'broad', refreshing = false, onRefresh }: { markets: RankedMarket[]; yearPerformance: RotationYearPerformance; strategyBacktest?: RotationBacktestResponse; poolEditor?: ReactNode; poolSymbols?: PoolSymbol[]; poolUpdating?: boolean; onRemoveMarket?: (market: PoolSymbol) => void; onReplaceCombination?: (codes: string[]) => Promise<void>; variant?: 'broad' | 'asset' | 'dual'; refreshing?: boolean; onRefresh?: () => void }) {
  const isAssetRotation = variant === 'asset';
  const isDualEtf = variant === 'dual';
  const leader = markets[0];
  const second = markets[1];
  const holding = markets.find((market) => market.name === yearPerformance.currentHolding) ?? null;
  const trendPeriod = isAssetRotation ? 28 : 20;
  const poolSize = poolSymbols?.length ?? markets.length;
  const performanceReturns = strategyBacktest?.annualReturns ?? (isAssetRotation ? assetRotationAnnualReturns : isDualEtf ? dualEtfAnnualReturns : annualReturns);
  const [backtestStartYear, setBacktestStartYear] = useState(performanceReturns[0].year);
  const filteredPerformanceReturns = useMemo(
    () => performanceReturns.filter((item) => item.year >= backtestStartYear),
    [backtestStartYear, performanceReturns],
  );
  const latestPerformanceYear = filteredPerformanceReturns.at(-1)?.year ?? backtestStartYear;
  const performanceYearCount = filteredPerformanceReturns.length;
  const performanceRange = performanceYearCount === 1 ? `${backtestStartYear}` : `${backtestStartYear}—${latestPerformanceYear}`;
  const performanceTitle = performanceYearCount === 1 ? `${backtestStartYear} 年度收益` : `近 ${performanceYearCount} 年年度收益`;
  const performanceSummary = useMemo(() => {
    const growth = filteredPerformanceReturns.reduce((value, item) => value * (1 + item.returnRate / 100), 1);
    const years = filteredPerformanceReturns.length;
    const latestYear = filteredPerformanceReturns.at(-1)?.year ?? backtestStartYear;
    const firstYear = performanceReturns[0].year;
    const startTimestamp = Date.UTC(backtestStartYear, 0, isAssetRotation && backtestStartYear === firstYear ? 4 : 1);
    let endTimestamp = Date.UTC(latestYear, 11, 31);
    const latestDate = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(yearPerformance.lastTradingDate);
    if (latestDate && Number(latestDate[1]) === latestYear) {
      endTimestamp = Date.UTC(Number(latestDate[1]), Number(latestDate[2]) - 1, Number(latestDate[3]));
    }
    const elapsedYears = Math.max((endTimestamp - startTimestamp) / (365.25 * 86_400_000), 1 / 365.25);
    return {
      cumulativeReturn: (growth - 1) * 100,
      annualizedReturn: years > 0 ? (growth ** (1 / elapsedYears) - 1) * 100 : 0,
      positiveYears: filteredPerformanceReturns.filter((item) => item.returnRate > 0).length,
      worstDrawdown: years > 0 ? Math.min(...filteredPerformanceReturns.map((item) => item.maxDrawdown)) : 0,
    };
  }, [backtestStartYear, filteredPerformanceReturns, isAssetRotation, performanceReturns, yearPerformance.lastTradingDate]);
  const rules = isAssetRotation ? [
    { title: '计算涨幅', copy: `每周最后一个交易日收盘后计算标的池内 ${poolSize} 只 ETF 的 20 日涨幅并从高到低排名。`, icon: Activity },
    { title: '执行买入', copy: '20 日涨幅排名第 1，且收盘价站上 MA28，两个条件同时满足才买入。', icon: TrendingUp },
    { title: '持续持有', copy: '持仓保持在涨幅前 2 名，同时收盘价不低于 MA28，则继续持有。', icon: Check },
    { title: '卖出避险', copy: '持仓跌出前 2 或跌破 MA28 即卖出切换；全部不满足时保持空仓。', icon: TrendingDown },
  ] : isDualEtf ? [
    { title: '比较强弱', copy: `每日收盘后计算标的池内 ${poolSize} 只 ETF 的近 20 个交易日涨跌幅并排序。`, icon: Activity },
    { title: '执行买入', copy: '只选择 20 日涨幅排名第 1 的 ETF，并要求收盘价不低于 MA20。', icon: TrendingUp },
    { title: '强者恒强', copy: '排名第 1 且保持在 MA20 上方则继续持有，始终跟随当前更强标的。', icon: Check },
    { title: '轮换空仓', copy: '第一名改变时立即轮换；领先 ETF 跌破 MA20 时清仓，全部不满足则保持现金。', icon: TrendingDown },
  ] : [
    { title: '计算动量', copy: '每日收盘后计算：收盘价 ÷ 20日均线 - 1。', icon: Activity },
    { title: '执行买入', copy: `收盘价有效站上 MA20，且动量在标的池内 ${poolSize} 只 ETF 中排名第 1。`, icon: TrendingUp },
    { title: '持续持有', copy: '持仓标的保持在 MA20 上方，同时维持动量排名第 1。', icon: Check },
    { title: '立即卖出', copy: '跌破 MA20，或动量排名滑落至第 2 名及以下，任一触发即清仓。', icon: TrendingDown },
  ];
  return (
    <div className="workspace-view strategy-view">
      <section className="view-heading strategy-heading">
        <div>
          <span className="eyebrow">STRATEGY / {isAssetRotation ? 'GLOBAL ASSET ROTATION' : isDualEtf ? 'DUAL ETF MOMENTUM' : 'ACTIVE'}</span>
          <h1>{isAssetRotation ? '全球大类资产 ETF 轮动' : isDualEtf ? '双 ETF 20 日动量轮动' : '宽基 20 日动量轮动'}</h1>
          <p>{isAssetRotation
            ? `当前 ${poolSize} 只 ETF 周度轮动，可按名称或代码调整标的池，弱市允许空仓。`
            : isDualEtf
              ? `默认跟踪创业板与纳指两条成长主线，当前 ${poolSize} 只 ETF 每日强弱轮动，可调整标的池。`
              : `当前 ${poolSize} 只宽基与跨市场 ETF 每日单标的轮动，可按名称或代码调整标的池。`}</p>
        </div>
        <div className="strategy-heading-actions">
          {onRefresh && <button className={`text-button ${refreshing ? 'is-spinning' : ''}`} type="button" disabled={refreshing} onClick={onRefresh}><RefreshCw size={14} />刷新行情</button>}
          <div className="strategy-state"><span className="live-dot" />策略运行中</div>
        </div>
      </section>

      <section className="strategy-hero">
        <div className="signal-block">
          <span>当前指令</span>
          <strong>{holding ? `持有 ${holding.name}` : '空仓等待'}</strong>
          <p>{holding ? `${holding.code} · 策略仓位 100%` : '当前无有效买入信号'}</p>
        </div>
        <div className="signal-stat">
          <span>{isAssetRotation || isDualEtf ? '领先 20 日涨幅' : '领先动量'}</span>
          <strong className="up">{formatPct(leader.momentum)}</strong>
          <small>高于第二名 {(leader.momentum - second.momentum).toFixed(2)} pct</small>
        </div>
        <div className="signal-stat">
          <span>{isAssetRotation ? '防守均线' : '止盈条件'}</span>
          <strong>{(holding ?? leader).ma20.toFixed(3)}</strong>
          <small>收盘跌破 MA{trendPeriod} 触发卖出</small>
        </div>
        <div className="signal-stat">
          <span>下次检查</span>
          <strong>{isAssetRotation ? '周五 15:00' : '15:00'}</strong>
          <small>{isAssetRotation ? '本周最后一个交易日' : '下一个交易日收盘'}</small>
        </div>
      </section>

      <div className="strategy-layout">
        <section className="panel rules-panel">
          <div className="panel-title-row">
            <div><span className="eyebrow">EXECUTION LOGIC</span><h3>交易规则</h3></div>
          </div>
          <div className="rule-flow">
            {rules.map((rule, index) => {
              const Icon = rule.icon;
              return (
                <div className="rule-step" key={rule.title}>
                  <div className="rule-index">{String(index + 1).padStart(2, '0')}</div>
                  <div className="rule-icon"><Icon size={18} /></div>
                  <div><strong>{rule.title}</strong><p>{rule.copy}</p></div>
                </div>
              );
            })}
          </div>
        </section>

        <StrategyUniverse markets={markets} symbols={poolSymbols} trendPeriod={trendPeriod} momentumLabel={isAssetRotation || isDualEtf ? '20日涨幅' : '20日动量'} editor={poolEditor} updating={poolUpdating} onRemove={onRemoveMarket} />

        <section className="panel year-performance-panel">
          <div className="panel-title-row">
            <div><span className="eyebrow">{yearPerformance.year} YTD EXECUTION</span><h3>{yearPerformance.year} 年交易节点</h3></div>
            <span className="source-note">截至 {formatTradingDate(yearPerformance.lastTradingDate)} · {isAssetRotation ? '周度' : '每日'}收盘信号</span>
          </div>
          <div className="year-performance-summary">
            <div><span>今年以来累计收益</span><strong className={yearPerformance.cumulativeReturn >= 0 ? 'up' : 'down'}>{formatPct(yearPerformance.cumulativeReturn)}</strong></div>
            <div><span>交易节点</span><strong>{yearPerformance.nodeCount}<i> 次</i></strong></div>
            <div><span>当前持仓</span><strong>{yearPerformance.currentHolding ?? '空仓'}</strong></div>
            <div><span>当前持仓单次收益</span><strong className={yearPerformance.currentTradeReturn === null ? undefined : yearPerformance.currentTradeReturn >= 0 ? 'up' : 'down'}>{yearPerformance.currentTradeReturn === null ? '--' : formatPct(yearPerformance.currentTradeReturn)}</strong></div>
          </div>
          <div className="year-trades-wrap">
            <table className="year-trades-table">
              <thead><tr><th>日期</th><th>操作</th><th>调整前</th><th>调整后</th><th>触发条件</th><th>单次收益</th><th>节点累计收益</th></tr></thead>
              <tbody>
                {[...yearPerformance.nodes].reverse().map((node) => (
                  <tr key={`${node.date}-${node.fromCode}-${node.toCode}`}>
                    <td>{node.date}</td>
                    <td><span className={`trade-action ${node.action}`}>{node.action}</span></td>
                    <td>{node.fromName ?? '空仓'}{node.fromCode && <small>{node.fromCode}</small>}</td>
                    <td>{node.toName ?? '空仓'}{node.toCode && <small>{node.toCode}</small>}</td>
                    <td>{node.reason}</td>
                    <td>{node.tradeReturn === null ? <span className="empty-return">--</span> : <Change value={node.tradeReturn} />}</td>
                    <td><Change value={node.cumulativeReturn} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="method-note">收益口径：单次收益统计上一笔持仓建立后至本次轮换或清仓的收益，买入节点显示“--”；上一交易日收盘持仓信号计入下一交易日收益，未计手续费、滑点与冲击成本。</div>
        </section>

        <section className="panel performance-panel">
          <div className="panel-title-row">
            <div className="performance-title-group">
              <div className="performance-toolbar">
                <label htmlFor={`backtest-start-year-${variant}`}>起始年份</label>
                <select id={`backtest-start-year-${variant}`} value={backtestStartYear} onChange={(event) => setBacktestStartYear(Number(event.target.value))}>
                  {performanceReturns.map((item) => <option key={item.year} value={item.year}>{item.year} 年</option>)}
                </select>
              </div>
              <div><span className="eyebrow">{performanceRange} {isAssetRotation ? 'RULE REPLAY' : 'BACKTEST'}</span><h3>{performanceTitle}</h3></div>
            </div>
            <span className="source-note">前复权日线 · {isAssetRotation ? '周度' : '每日'}收盘信号 · 未计费用</span>
          </div>
          <div className="backtest-summary">
            <div><span>{performanceRange} 年累计收益</span><strong className={performanceSummary.cumulativeReturn >= 0 ? 'up' : 'down'}>{formatPct(performanceSummary.cumulativeReturn)}</strong></div>
            <div><span>年化收益</span><strong className={performanceSummary.annualizedReturn >= 0 ? 'up' : 'down'}>{formatPct(performanceSummary.annualizedReturn)}</strong></div>
            <div><span>正收益年份</span><strong>{performanceSummary.positiveYears} / {filteredPerformanceReturns.length}</strong></div>
            <div><span>最大回撤</span><strong className="down">{performanceSummary.worstDrawdown.toFixed(2)}%</strong></div>
          </div>
          {isAssetRotation && <div className="video-benchmark-bar"><strong>视频展示口径</strong><span>累计收益 <b>+{assetRotationVideoBenchmark.cumulativeReturn.toFixed(2)}%</b></span><span>年化 <b>+{assetRotationVideoBenchmark.annualizedReturn.toFixed(2)}%</b></span><span>当前回撤 <b>{assetRotationVideoBenchmark.currentDrawdown.toFixed(2)}%</b></span><span>最大回撤 <b>{assetRotationVideoBenchmark.worstDrawdown.toFixed(2)}%</b></span><span>卡玛 <b>{assetRotationVideoBenchmark.calmarRatio.toFixed(2)}</b></span><span>夏普 <b>{assetRotationVideoBenchmark.sharpeRatio.toFixed(2)}</b></span></div>}
          {isDualEtf && <div className="video-benchmark-bar"><strong>视频展示口径</strong><span>累计收益 <b>+{dualEtfVideoBenchmark.cumulativeReturn.toFixed(2)}%</b></span><span>年化 <b>+{dualEtfVideoBenchmark.annualizedReturn.toFixed(2)}%</b></span><span>当前回撤 <b>{dualEtfVideoBenchmark.currentDrawdown.toFixed(2)}%</b></span><span>最大回撤 <b>{dualEtfVideoBenchmark.worstDrawdown.toFixed(2)}%</b></span><span>卡玛 <b>{dualEtfVideoBenchmark.calmarRatio.toFixed(2)}</b></span><span>夏普 <b>{dualEtfVideoBenchmark.sharpeRatio.toFixed(2)}</b></span></div>}
          <div className="performance-content">
            <AnnualReturnChart data={filteredPerformanceReturns} />
            <div className="performance-table-wrap">
              <table className="performance-table">
                <thead><tr><th>年份</th><th>收益率</th><th>最大回撤</th><th>交易次数</th><th>可用标的</th><th>年末持仓</th></tr></thead>
                <tbody>
                  {[...performanceReturns].reverse().map((item) => (
                    <tr key={item.year}>
                      <td>{item.year}</td>
                      <td><Change value={item.returnRate} /></td>
                      <td className="down">{item.maxDrawdown.toFixed(2)}%</td>
                      <td>{item.trades}</td>
                      <td>{item.availableAssets} / {poolSize}</td>
                      <td>{item.yearEndHolding}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="method-note">
            {isAssetRotation
              ? '本地复算区间：2016-01-04 至 2025-12-31；ETF 上市满 28 个交易日后进入排名，每周最后一个交易日收盘计算信号，持有下一交易周收益。视频与本地复算因行情源、ETF复权和交易费用口径不同，结果会有差异。'
              : isDualEtf
                ? '本地复算区间：2016-01-04 至 2025-12-31；每日比较前复权收盘价的 20 日涨幅，领先 ETF 站上 MA20 才持有。视频区间为 2019-11-20 至 2026-07-24，行情源与执行口径不同，结果不会完全一致。'
                : '数据源：腾讯证券公开前复权日线。ETF 上市满 20 个交易日后才进入排名；T 日收盘计算信号，持有 T+1 日收益。结果未计手续费、滑点与冲击成本。'}
          </div>
        </section>

        {onReplaceCombination && <RotationCombinationExplorer strategy={isAssetRotation ? 'asset-rotation' : 'rotation'} rotationPoolCodes={(poolSymbols ?? markets).map((item) => item.code)} rotationPoolUpdating={poolUpdating} onReplaceRotationPool={onReplaceCombination} />}

        <section className="panel notes-panel">
          <div className="panel-title-row"><div><span className="eyebrow">RISK CONTROL</span><h3>执行约束</h3></div></div>
          <div className="constraint-grid">
            <div><span>调仓频率</span><strong>{isAssetRotation ? '每周' : '每日'}</strong><small>仅使用收盘数据</small></div>
            <div><span>最大持仓</span><strong>1 只</strong><small>等权满仓持有</small></div>
            <div><span>空仓机制</span><strong>启用</strong><small>无标的满足条件</small></div>
            <div><span>信号确认</span><strong>{isAssetRotation ? '周末收盘' : 'T 日收盘'}</strong><small>下一交易时点执行</small></div>
          </div>
          <div className="risk-note">
            <CircleDollarSign size={18} />
            <p>本页面用于策略研究与演示，不构成投资建议。实际交易应计入手续费、滑点、涨跌停与基金申赎限制。</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function PoolRemovalDialog({ market, strategyName, deferred = false, onCancel, onConfirm }: { market: PoolSymbol; strategyName: string; deferred?: boolean; onCancel: () => void; onConfirm: () => void }) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return createPortal(
    <div className="pool-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section className="pool-dialog" role="dialog" aria-modal="true" aria-labelledby="pool-dialog-title" aria-describedby="pool-dialog-description">
        <div className="pool-dialog-header">
          <div className="pool-dialog-icon"><Trash2 size={19} /></div>
          <div><span className="eyebrow">REMOVE ASSET</span><h3 id="pool-dialog-title">移出轮动标的池</h3></div>
          <button type="button" className="icon-button pool-dialog-close" title="关闭" aria-label="关闭移除确认框" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="pool-dialog-body">
          <p id="pool-dialog-description">确认不再让下面这只 ETF 参与{strategyName}排名？</p>
          <div className="pool-dialog-target">
            <div><strong>{market.name}</strong><span>{market.category}</span></div>
            <code>{market.code}</code>
          </div>
          <div className="pool-dialog-rebuild"><RefreshCw size={15} /><span>{deferred ? <>此次移除将先保存为待应用变更，点击标的池右上角的 <strong>重新计算</strong> 后生效。</> : <>移除后将重新计算 <strong>2016—2025</strong> 回测和 <strong>今年以来</strong> 的交易节点与收益。</>}</span></div>
        </div>
        <div className="pool-dialog-actions">
          <button type="button" className="pool-dialog-cancel" onClick={onCancel}>取消</button>
          <button ref={confirmButtonRef} type="button" className="pool-dialog-confirm" onClick={onConfirm}><Trash2 size={15} />确认移除</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function AssetRotationStrategy() {
  const [snapshot, setSnapshot] = useState<RotationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [poolUpdating, setPoolUpdating] = useState(false);
  const [poolCalculating, setPoolCalculating] = useState(false);
  const [poolError, setPoolError] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<PoolSymbol | null>(null);
  const [error, setError] = useState('');
  const didLoad = useRef(false);
  const loadSnapshot = useCallback(async (refresh = false) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/strategy/asset-rotation${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const payload = await response.json() as RotationResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || `大类资产轮动行情返回 HTTP ${response.status}`);
      if (!Array.isArray(payload.markets) || payload.markets.length < 2) throw new Error('大类资产轮动行情数据不完整');
      setSnapshot(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '大类资产轮动行情加载失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    void loadSnapshot();
  }, [loadSnapshot]);
  const updatePool = useCallback(async (action: 'add' | 'remove', item: Pick<RankedMarket, 'code' | 'name'> | EtfSearchResult) => {
    setPoolUpdating(true);
    setPoolError('');
    try {
      const response = await apiFetch(action === 'add' ? '/api/strategy/asset-rotation/symbols' : `/api/strategy/asset-rotation/symbols/${encodeURIComponent(item.code)}`, {
        method: action === 'add' ? 'POST' : 'DELETE',
        headers: action === 'add' ? { 'Content-Type': 'application/json' } : undefined,
        body: action === 'add' ? JSON.stringify({ code: item.code }) : undefined,
      });
      const payload = await response.json() as NonNullable<RotationResponse['poolDraft']> & { message?: string };
      if (!response.ok) throw new Error(payload.message || `${action === 'add' ? '加入' : '移除'} ETF 失败`);
      if (!Array.isArray(payload.symbols) || payload.symbols.length < 2) throw new Error('标的池变更已保存，但返回的数据不完整');
      setSnapshot((current) => current ? { ...current, poolDraft: payload } : current);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : `${action === 'add' ? '加入' : '移除'} ETF 失败`;
      setPoolError(message);
      throw reason;
    } finally {
      setPoolUpdating(false);
    }
  }, []);
  const recalculatePool = useCallback(async () => {
    setPoolCalculating(true);
    setPoolError('');
    try {
      const response = await apiFetch('/api/strategy/asset-rotation/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload = await response.json() as RotationResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || '重新计算失败');
      if (!Array.isArray(payload.markets) || payload.markets.length < 2 || !payload.backtest?.annualReturns?.length || payload.poolDraft?.dirty) throw new Error('重新计算完成，但返回的数据不完整');
      setSnapshot(payload);
    } catch (reason) {
      setPoolError(reason instanceof Error ? reason.message : '重新计算失败');
    } finally {
      setPoolCalculating(false);
    }
  }, []);
  const replacePool = useCallback(async (codes: string[]) => {
    setPoolUpdating(true);
    setPoolError('');
    try {
      const response = await apiFetch('/api/strategy/asset-rotation/symbols', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      });
      const payload = await response.json() as NonNullable<RotationResponse['poolDraft']> & { message?: string };
      if (!response.ok) throw new Error(payload.message || '轮动标的池替换失败');
      if (!Array.isArray(payload.symbols) || payload.symbols.length < 2) throw new Error('标的池替换已保存，但返回的数据不完整');
      setSnapshot((current) => current ? { ...current, poolDraft: payload } : current);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '轮动标的池替换失败';
      setPoolError(message);
      throw reason;
    } finally {
      setPoolUpdating(false);
    }
  }, []);
  const confirmRemoval = useCallback(() => {
    if (!pendingRemoval) return;
    const market = pendingRemoval;
    setPendingRemoval(null);
    void updatePool('remove', market).catch(() => undefined);
  }, [pendingRemoval, updatePool]);
  if (loading && !snapshot) return <section className="data-state"><RefreshCw className="spin-icon" size={24} /><strong>正在计算全球大类资产轮动</strong><span>读取标的池 ETF 前复权日线，计算 20 日涨幅、MA28 与周度持仓。</span></section>;
  if (error && !snapshot) return <section className="data-state error-state"><AlertTriangle size={26} /><strong>大类资产轮动加载失败</strong><span>{error}</span><button className="text-button" onClick={() => void loadSnapshot(true)}><RefreshCw size={15} />重新加载</button></section>;
  return snapshot ? <>
    {error && <div className="data-warning"><AlertTriangle size={17} /><span>刷新失败，继续显示上次成功数据：{error}</span></div>}
    {poolError && <div className="data-warning"><AlertTriangle size={17} /><span>标的池更新失败，原数据保持不变：{poolError}</span><button type="button" className="icon-button" title="关闭提示" aria-label="关闭提示" onClick={() => setPoolError('')}><X size={14} /></button></div>}
    <StrategyCenter
      markets={snapshot.markets}
      yearPerformance={snapshot.yearPerformance}
      strategyBacktest={snapshot.backtest}
      poolEditor={<AssetPoolEditor
        markets={snapshot.poolDraft?.symbols ?? snapshot.markets}
        updating={poolUpdating || poolCalculating}
        deferred
        statusText={poolCalculating ? '正在更新行情、回测与今年交易节点' : undefined}
        action={<button type="button" className={`pool-recalculate-button${poolCalculating ? ' is-calculating' : ''}`} disabled={!snapshot.poolDraft?.dirty || poolUpdating || poolCalculating} title={snapshot.poolDraft?.dirty ? '应用标的池变更并更新行情、回测与今年交易节点' : '当前没有待计算的变更'} onClick={() => void recalculatePool()}><RefreshCw className={poolCalculating ? 'spin-icon' : undefined} size={14} />{poolCalculating ? '正在计算' : '重新计算'}</button>}
        onAdd={(item) => updatePool('add', item)}
      />}
      poolSymbols={snapshot.poolDraft?.symbols}
      poolUpdating={poolUpdating || poolCalculating}
      onRemoveMarket={setPendingRemoval}
      onReplaceCombination={replacePool}
      variant="asset"
      refreshing={loading || poolUpdating || poolCalculating}
      onRefresh={() => void loadSnapshot(true)}
    />
    {pendingRemoval && <PoolRemovalDialog market={pendingRemoval} strategyName="全球大类资产轮动" deferred onCancel={() => setPendingRemoval(null)} onConfirm={confirmRemoval} />}
  </> : null;
}

function DualEtfStrategy() {
  const [snapshot, setSnapshot] = useState<RotationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [poolUpdating, setPoolUpdating] = useState(false);
  const [poolError, setPoolError] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<PoolSymbol | null>(null);
  const [error, setError] = useState('');
  const didLoad = useRef(false);
  const loadSnapshot = useCallback(async (refresh = false) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/strategy/dual-etf${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const payload = await response.json() as RotationResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || `双 ETF 动量轮动行情返回 HTTP ${response.status}`);
      if (!Array.isArray(payload.markets) || payload.markets.length < 2 || !payload.backtest?.annualReturns?.length) throw new Error('双 ETF 动量轮动行情数据不完整');
      setSnapshot(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '双 ETF 动量轮动行情加载失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    void loadSnapshot();
  }, [loadSnapshot]);
  const updatePool = useCallback(async (action: 'add' | 'remove', item: Pick<RankedMarket, 'code' | 'name'> | EtfSearchResult) => {
    setPoolUpdating(true);
    setPoolError('');
    try {
      const response = await apiFetch(action === 'add' ? '/api/strategy/dual-etf/symbols' : `/api/strategy/dual-etf/symbols/${encodeURIComponent(item.code)}`, {
        method: action === 'add' ? 'POST' : 'DELETE',
        headers: action === 'add' ? { 'Content-Type': 'application/json' } : undefined,
        body: action === 'add' ? JSON.stringify({ code: item.code }) : undefined,
      });
      const payload = await response.json() as RotationResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || `${action === 'add' ? '加入' : '移除'} ETF 失败`);
      if (!Array.isArray(payload.markets) || payload.markets.length < 2 || !payload.backtest?.annualReturns?.length) throw new Error('重算完成，但返回的数据不完整');
      setSnapshot(payload);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : `${action === 'add' ? '加入' : '移除'} ETF 失败`;
      setPoolError(message);
      throw reason;
    } finally {
      setPoolUpdating(false);
    }
  }, []);
  const confirmRemoval = useCallback(() => {
    if (!pendingRemoval) return;
    const market = pendingRemoval;
    setPendingRemoval(null);
    void updatePool('remove', market).catch(() => undefined);
  }, [pendingRemoval, updatePool]);
  if (loading && !snapshot) return <section className="data-state"><RefreshCw className="spin-icon" size={24} /><strong>正在计算双 ETF 动量轮动</strong><span>读取标的池前复权日线，计算 20 日涨幅、MA20 与每日持仓。</span></section>;
  if (error && !snapshot) return <section className="data-state error-state"><AlertTriangle size={26} /><strong>双 ETF 动量轮动加载失败</strong><span>{error}</span><button className="text-button" onClick={() => void loadSnapshot(true)}><RefreshCw size={15} />重新加载</button></section>;
  return snapshot ? <>
    {error && <div className="data-warning"><AlertTriangle size={17} /><span>刷新失败，继续显示上次成功数据：{error}</span></div>}
    {poolError && <div className="data-warning"><AlertTriangle size={17} /><span>标的池更新失败，原数据保持不变：{poolError}</span><button type="button" className="icon-button" title="关闭提示" aria-label="关闭提示" onClick={() => setPoolError('')}><X size={14} /></button></div>}
    <StrategyCenter markets={snapshot.markets} yearPerformance={snapshot.yearPerformance} strategyBacktest={snapshot.backtest} poolEditor={<AssetPoolEditor markets={snapshot.markets} updating={poolUpdating} onAdd={(item) => updatePool('add', item)} />} poolUpdating={poolUpdating} onRemoveMarket={setPendingRemoval} variant="dual" refreshing={loading || poolUpdating} onRefresh={() => void loadSnapshot(true)} />
    {pendingRemoval && <PoolRemovalDialog market={pendingRemoval} strategyName="双 ETF 20 日动量轮动" onCancel={() => setPendingRemoval(null)} onConfirm={confirmRemoval} />}
  </> : null;
}

function MacdPullbackTable({ snapshot, historical = false }: { snapshot: MacdPullbackSnapshot; historical?: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<{ key: 'change' | 'changeSinceSignal'; direction: 'asc' | 'desc' } | null>(null);
  const sortedSignals = useMemo(() => {
    if (!sort) return snapshot.signals;
    return [...snapshot.signals].sort((left, right) => {
      const leftValue = left[sort.key];
      const rightValue = right[sort.key];
      if (leftValue === undefined) return rightValue === undefined ? 0 : 1;
      if (rightValue === undefined) return -1;
      return sort.direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [snapshot.signals, sort]);
  const totalPages = Math.max(1, Math.ceil(snapshot.signals.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sortedSignals.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const toggleSort = (key: 'change' | 'changeSinceSignal') => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'desc' };
      if (current.direction === 'desc') return { key, direction: 'asc' };
      return null;
    });
    setPage(1);
  };
  const sortButton = (key: 'change' | 'changeSinceSignal', label: string) => {
    const activeSort = sort?.key === key ? sort : null;
    const nextDirection = !activeSort ? '降序' : activeSort.direction === 'desc' ? '升序' : '原始顺序';
    return <button className={`table-sort-button${activeSort ? ' active' : ''}`} type="button" title={`按${label}${nextDirection}排列`} onClick={() => toggleSort(key)}>{label}{!activeSort ? <ArrowUpDown size={13} /> : activeSort.direction === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}</button>;
  };
  return <>
    <div className="table-scroll"><table className={`macd-pullback-table${historical ? ' is-history' : ''}`}>
      <thead><tr><th>序号</th><th>股票</th><th>{historical ? '当时价格' : '现价'}</th><th>{sortButton('change', historical ? '当日涨幅' : '涨跌幅')}</th>{historical && <><th>当前价格</th><th>{sortButton('changeSinceSignal', '至今涨幅')}</th></>}<th>距 MA20</th><th>高点回撤</th><th>缩量比</th><th>金叉距今</th><th>DIF</th><th>DEA</th><th>评分</th><th>信号</th></tr></thead>
      <tbody>{pageRows.map((item, index) => <tr key={item.code}>
        <td>{String((currentPage - 1) * pageSize + index + 1).padStart(2, '0')}</td>
        <td><StockKlineCell name={item.name} code={item.code} /></td>
        <td>{item.close.toFixed(2)}</td>
        <td><Change value={item.change} /></td>
        {historical && <><td>{item.currentPrice === undefined ? '--' : item.currentPrice.toFixed(2)}</td><td>{item.changeSinceSignal === undefined ? '--' : <Change value={item.changeSinceSignal} />}</td></>}
        <td><Change value={item.supportDistance} /></td>
        <td><Change value={item.pullback} /></td>
        <td>{item.volumeRatio.toFixed(2)}</td>
        <td>{item.crossDaysAgo} 日</td>
        <td>{item.dif.toFixed(4)}</td>
        <td>{item.dea.toFixed(4)}</td>
        <td><strong className="pullback-score">{item.score.toFixed(1)}</strong></td>
        <td><span className="macd-signal pullback">{item.signal}</span></td>
      </tr>)}</tbody>
    </table></div>
    <div className="macd-pagination">
      <span>共 {snapshot.signals.length} 条</span>
      <label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10 条</option><option value={20}>20 条</option><option value={50}>50 条</option></select></label>
      <span>第 {currentPage} / {totalPages} 页</span>
      <button className="icon-button" type="button" title="上一页" aria-label="上一页" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16} /></button>
      <button className="icon-button" type="button" title="下一页" aria-label="下一页" disabled={currentPage === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight size={16} /></button>
    </div>
  </>;
}

function MacdPullbackStrategy() {
  const [snapshot, setSnapshot] = useState<MacdPullbackSnapshot | null>(null);
  const [historySnapshot, setHistorySnapshot] = useState<MacdPullbackSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [storedDates, setStoredDates] = useState<string[]>([]);
  const loadStoredDates = useCallback(async () => {
    try {
      const response = await apiFetch('/api/strategy/macd-pullback/dates', { cache: 'no-store' });
      const payload = await response.json() as { dates?: string[] };
      if (response.ok && Array.isArray(payload.dates)) setStoredDates(payload.dates);
    } catch {
      // The current scan remains usable when the local date list cannot be loaded.
    }
  }, []);
  const loadLatestSignals = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/strategy/macd-pullback', { cache: 'no-store' });
      const payload = await response.json() as MacdPullbackSnapshot & { message?: string };
      if (!response.ok) throw new Error(payload.message || `MACD 零轴回踩扫描返回 HTTP ${response.status}`);
      setSnapshot(payload);
      setSelectedDate((current) => current || toInputDate(payload.storageDate));
      void loadStoredDates();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'MACD 零轴回踩扫描失败');
    } finally {
      setLoading(false);
    }
  }, [loadStoredDates]);
  const loadHistoricalSignals = useCallback(async (date: string) => {
    setSelectedDate(date);
    setHistoryError('');
    if (!date || date.replaceAll('-', '') === snapshot?.storageDate) {
      setHistorySnapshot(null);
      return;
    }
    setHistoryLoading(true);
    setHistorySnapshot(null);
    try {
      const response = await apiFetch(`/api/strategy/macd-pullback?date=${date.replaceAll('-', '')}`, { cache: 'no-store' });
      const payload = await response.json() as MacdPullbackSnapshot & { message?: string };
      if (!response.ok) throw new Error(payload.message || `历史 MACD 零轴回踩结果返回 HTTP ${response.status}`);
      setHistorySnapshot(payload);
      setSelectedDate(toInputDate(payload.storageDate));
      void loadStoredDates();
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : '历史 MACD 零轴回踩结果读取失败');
    } finally {
      setHistoryLoading(false);
    }
  }, [loadStoredDates, snapshot?.storageDate]);
  useEffect(() => { void loadStoredDates(); void loadLatestSignals(); }, [loadLatestSignals, loadStoredDates]);
  const lead = snapshot?.signals[0];
  const historyMovement = historySnapshot?.signals.reduce((counts, signal) => {
    if (signal.changeSinceSignal === undefined) return counts;
    if (signal.changeSinceSignal > 0) counts.up += 1;
    else if (signal.changeSinceSignal < 0) counts.down += 1;
    else counts.flat += 1;
    counts.total += 1;
    return counts;
  }, { up: 0, down: 0, flat: 0, total: 0 });
  const rules = [
    { title: '多空分界看零轴', copy: 'DIF 与 DEA 同在零轴上方才进入右侧交易候选，零轴下方金叉不追。', icon: Activity },
    { title: '水上金叉回调买', copy: '近 20 日出现水上金叉，至少等待 2 日，不在金叉当日追涨。', icon: TrendingUp },
    { title: '回踩支撑', copy: '收盘位于 MA20 的 -1.5% 至 +4%，且 MA20 保持向上。', icon: Target },
    { title: '缩量确认', copy: '当日成交量不高于前 5 日均量的 90%，高点回撤控制在 1% 至 12%。', icon: BarChart3 },
    { title: '底背离与顶背离', copy: '水下底背离仅作反转观察；水上顶背离用于减仓预警，不纳入本次买入筛选。', icon: TrendingDown },
    { title: '水下死叉离场', copy: '零轴下方反弹接近零轴后再度死叉，视为反弹结束的离场信号。', icon: AlertTriangle },
  ];
  return <div className="workspace-view strategy-view">
    <section className="view-heading strategy-heading">
      <div><span className="eyebrow">STRATEGY / MACD ZERO-AXIS PULLBACK</span><h1>MACD 零轴回踩</h1><p>依据视频六条口诀量化，MACD 参数固定为（5，34，5）。</p></div>
      <button className={`text-button macd-refresh ${loading ? 'is-spinning' : ''}`} type="button" disabled={loading} onClick={() => void loadLatestSignals()}><RefreshCw size={14} />读取最新</button>
    </section>

    <section className="macd-date-toolbar" aria-label="MACD 零轴回踩历史记录日期">
      <label>历史日期<input type="date" value={selectedDate} max={snapshot ? toInputDate(snapshot.storageDate) : undefined} disabled={loading || historyLoading} onChange={(event) => { if (event.target.value) void loadHistoricalSignals(event.target.value); }} /></label>
      <div className="macd-date-list">{storedDates.slice(0, 12).map((date) => <button type="button" key={date} disabled={loading || historyLoading} className={toInputDate(date) === selectedDate ? 'active' : ''} onClick={() => void loadHistoricalSignals(toInputDate(date))}>{formatTradingDate(date)}</button>)}</div>
    </section>

    <section className="strategy-hero macd-hero">
      <div className="signal-block"><span>优先观察</span><strong>{lead ? lead.name : loading ? '正在扫描' : '暂无候选'}</strong><p>{lead ? `${lead.code} · 评分 ${lead.score.toFixed(1)}` : '等待零轴上方金叉后的缩量回踩'}</p></div>
      <div className="signal-stat"><span>MACD 参数</span><strong>5 / 34 / 5</strong><small>短周期 / 长周期 / 信号周期</small></div>
      <div className="signal-stat"><span>回踩候选</span><strong>{snapshot?.signals.length ?? '--'}</strong><small>全部量化条件同时满足</small></div>
      <div className="signal-stat"><span>结果交易日</span><strong>{snapshot ? formatTradingDate(snapshot.lastTradingDate) : '--'}</strong><small>{snapshot?.cached ? '本地扫描记录' : '本次计算结果'}</small></div>
    </section>

    <div className="macd-pullback-layout">
      <section className="panel rules-panel">
        <div className="panel-title-row"><div><span className="eyebrow">VIDEO RULES</span><h3>六条 MACD 口诀</h3></div></div>
        <div className="rule-flow pullback-rule-flow">{rules.map((rule, index) => { const Icon = rule.icon; return <div className="rule-step" key={rule.title}><div className="rule-index">{String(index + 1).padStart(2, '0')}</div><div className="rule-icon"><Icon size={18} /></div><div><strong>{rule.title}</strong><p>{rule.copy}</p></div></div>; })}</div>
      </section>
      <section className="panel macd-results-panel">
        <div className="panel-title-row"><div><span className="eyebrow">RIGHT-SIDE CANDIDATES</span><h3>零轴上方缩量回踩候选</h3></div>{snapshot && <span className="source-note">排除板块 / ST 等 {snapshot.excludedCount.toLocaleString()} 只 · 进入计算 {snapshot.scannedCount.toLocaleString()} 只 · 候选 {snapshot.signals.length.toLocaleString()} 只</span>}</div>
        {loading && <div className="macd-state"><RefreshCw className="spin-icon" size={20} />正在读取全市场日线并计算 MACD（5，34，5）</div>}
        {!loading && error && <div className="macd-state error"><AlertTriangle size={19} />{error}</div>}
        {!loading && !error && snapshot && snapshot.signals.length === 0 && <div className="macd-state">当前交易日没有同时满足零轴、回踩、支撑和缩量条件的标的</div>}
        {!loading && !error && snapshot && snapshot.signals.length > 0 && <MacdPullbackTable snapshot={snapshot} />}
      </section>
    </div>
    {(historyLoading || historyError || historySnapshot) && <section className="panel macd-history-panel">
      <div className="panel-title-row">
        <div><span className="eyebrow">HISTORICAL ZERO-AXIS PULLBACK</span><h3>{historySnapshot ? `${formatTradingDate(historySnapshot.lastTradingDate)} 历史回踩候选` : '历史筛选结果'}</h3></div>
        {historyMovement && historyMovement.total > 0 && <div className="history-movement-summary" aria-label="历史回踩候选至今涨跌统计"><span className="up">上涨 <strong>{historyMovement.up}</strong> 只</span><span className="down">下跌 <strong>{historyMovement.down}</strong> 只</span><span>持平 <strong>{historyMovement.flat}</strong> 只</span></div>}
        {historySnapshot && <span className="source-note">排除板块 / ST 等 {historySnapshot.excludedCount.toLocaleString()} 只 · 进入计算 {historySnapshot.scannedCount.toLocaleString()} 只 · 候选 {historySnapshot.signals.length.toLocaleString()} 只</span>}
      </div>
      {historyLoading && <div className="macd-state macd-history-state"><RefreshCw className="spin-icon" size={20} />正在读取或计算截至 {formatTradingDate(selectedDate)} 的历史筛选结果</div>}
      {!historyLoading && historyError && <div className="macd-state macd-history-state error"><AlertTriangle size={19} />{historyError}</div>}
      {!historyLoading && !historyError && historySnapshot && historySnapshot.signals.length === 0 && <div className="macd-state macd-history-state">该交易日没有符合零轴回踩条件的标的</div>}
      {!historyLoading && !historyError && historySnapshot && historySnapshot.signals.length > 0 && <MacdPullbackTable snapshot={historySnapshot} historical />}
    </section>}
    <div className="risk-note macd-risk-note"><CircleDollarSign size={18} /><p>候选仅表示视频规则的量化触发，不构成买入建议。评分用于候选排序，不代表预期收益；执行前仍需核对公告、流动性、仓位和止损。</p></div>
  </div>;
}

function MacdKdjTable({ snapshot, historical = false }: { snapshot: MacdKdjSnapshot; historical?: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<{ key: 'change' | 'changeSinceSignal' | 'score'; direction: 'asc' | 'desc' } | null>(null);
  const sortedSignals = useMemo(() => {
    if (!sort) return snapshot.signals;
    return [...snapshot.signals].sort((left, right) => {
      const leftValue = left[sort.key];
      const rightValue = right[sort.key];
      if (leftValue === undefined) return rightValue === undefined ? 0 : 1;
      if (rightValue === undefined) return -1;
      return sort.direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [snapshot.signals, sort]);
  const totalPages = Math.max(1, Math.ceil(snapshot.signals.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sortedSignals.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const toggleSort = (key: 'change' | 'changeSinceSignal' | 'score') => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'desc' };
      if (current.direction === 'desc') return { key, direction: 'asc' };
      return null;
    });
    setPage(1);
  };
  const sortButton = (key: 'change' | 'changeSinceSignal' | 'score', label: string) => {
    const activeSort = sort?.key === key ? sort : null;
    const nextDirection = !activeSort ? '降序' : activeSort.direction === 'desc' ? '升序' : '原始顺序';
    return <button className={`table-sort-button${activeSort ? ' active' : ''}`} type="button" title={`按${label}${nextDirection}排列`} onClick={() => toggleSort(key)}>{label}{!activeSort ? <ArrowUpDown size={13} /> : activeSort.direction === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}</button>;
  };
  return <>
    <div className="table-scroll"><table className={`macd-kdj-table${historical ? ' is-history' : ''}`}>
      <thead><tr><th>序号</th><th>股票</th><th>{historical ? '当时价格' : '现价'}</th><th>{sortButton('change', historical ? '当日涨幅' : '涨跌幅')}</th>{historical && <><th>当前价格</th><th>{sortButton('changeSinceSignal', '至今涨幅')}</th></>}<th>K</th><th>D</th><th>J</th><th>KDJ 金叉</th><th>DIF</th><th>DEA</th><th>MACD 柱</th><th>{sortButton('score', '评分')}</th><th>信号</th></tr></thead>
      <tbody>{pageRows.map((item, index) => <tr key={item.code}>
        <td>{String((currentPage - 1) * pageSize + index + 1).padStart(2, '0')}</td>
        <td><StockKlineCell name={item.name} code={item.code} /></td>
        <td>{item.close.toFixed(2)}</td>
        <td><Change value={item.change} /></td>
        {historical && <><td>{item.currentPrice === undefined ? '--' : item.currentPrice.toFixed(2)}</td><td>{item.changeSinceSignal === undefined ? '--' : <Change value={item.changeSinceSignal} />}</td></>}
        <td>{item.k.toFixed(2)}</td>
        <td>{item.d.toFixed(2)}</td>
        <td>{item.j.toFixed(2)}</td>
        <td>{item.kdjCrossDaysAgo === 0 ? '当日' : `${item.kdjCrossDaysAgo} 日前`}</td>
        <td>{item.dif.toFixed(4)}</td>
        <td>{item.dea.toFixed(4)}</td>
        <td className={item.histogram >= 0 ? 'up' : 'down'}>{item.histogram.toFixed(4)}</td>
        <td><strong className="pullback-score">{item.score.toFixed(1)}</strong></td>
        <td><span className={`macd-signal ${item.divergence ? 'divergence' : 'kdj'}`}>{item.signal}</span></td>
      </tr>)}</tbody>
    </table></div>
    <div className="macd-pagination">
      <span>共 {snapshot.signals.length} 条</span>
      <label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10 条</option><option value={20}>20 条</option><option value={50}>50 条</option></select></label>
      <span>第 {currentPage} / {totalPages} 页</span>
      <button className="icon-button" type="button" title="上一页" aria-label="上一页" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16} /></button>
      <button className="icon-button" type="button" title="下一页" aria-label="下一页" disabled={currentPage === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight size={16} /></button>
    </div>
  </>;
}

function MacdKdjStrategy() {
  const [snapshot, setSnapshot] = useState<MacdKdjSnapshot | null>(null);
  const [historySnapshot, setHistorySnapshot] = useState<MacdKdjSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [storedDates, setStoredDates] = useState<string[]>([]);
  const loadStoredDates = useCallback(async () => {
    try {
      const response = await apiFetch('/api/strategy/macd-kdj/dates', { cache: 'no-store' });
      const payload = await response.json() as { dates?: string[] };
      if (response.ok && Array.isArray(payload.dates)) setStoredDates(payload.dates);
    } catch {
      // The latest result remains usable if the local date list cannot be loaded.
    }
  }, []);
  const loadLatestSignals = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/strategy/macd-kdj', { cache: 'no-store' });
      const payload = await response.json() as MacdKdjSnapshot & { message?: string };
      if (!response.ok) throw new Error(payload.message || `MACD + KDJ 扫描返回 HTTP ${response.status}`);
      setSnapshot(payload);
      setSelectedDate((current) => current || toInputDate(payload.storageDate));
      void loadStoredDates();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'MACD + KDJ 共振扫描失败');
    } finally {
      setLoading(false);
    }
  }, [loadStoredDates]);
  const loadHistoricalSignals = useCallback(async (date: string) => {
    setSelectedDate(date);
    setHistoryError('');
    if (!date || date.replaceAll('-', '') === snapshot?.storageDate) {
      setHistorySnapshot(null);
      return;
    }
    setHistoryLoading(true);
    setHistorySnapshot(null);
    try {
      const response = await apiFetch(`/api/strategy/macd-kdj?date=${date.replaceAll('-', '')}`, { cache: 'no-store' });
      const payload = await response.json() as MacdKdjSnapshot & { message?: string };
      if (!response.ok) throw new Error(payload.message || `历史 MACD + KDJ 结果返回 HTTP ${response.status}`);
      setHistorySnapshot(payload);
      setSelectedDate(toInputDate(payload.storageDate));
      void loadStoredDates();
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : '历史 MACD + KDJ 结果读取失败');
    } finally {
      setHistoryLoading(false);
    }
  }, [loadStoredDates, snapshot?.storageDate]);
  useEffect(() => { void loadStoredDates(); void loadLatestSignals(); }, [loadLatestSignals, loadStoredDates]);
  const lead = snapshot?.signals[0];
  const historyMovement = historySnapshot?.signals.reduce((counts, signal) => {
    if (signal.changeSinceSignal === undefined) return counts;
    if (signal.changeSinceSignal > 0) counts.up += 1;
    else if (signal.changeSinceSignal < 0) counts.down += 1;
    else counts.flat += 1;
    counts.total += 1;
    return counts;
  }, { up: 0, down: 0, flat: 0, total: 0 });
  const rules = [
    { title: '标准参数', copy: '视频未指定参数，量化采用 MACD（12，26，9）与 KDJ（9，3，3）。', icon: Settings2 },
    { title: 'KDJ 低位先行', copy: 'K 上穿 D 时 K、D 均不高于 25，且距当日不超过 4 个交易日。', icon: TrendingUp },
    { title: 'MACD 金叉确认', copy: '当日 DIF 首次上穿 DEA，与低位 KDJ 金叉形成双指标共振。', icon: Activity },
    { title: '底背离增强', copy: '近 20 日价格低点低于前 20 日，但 MACD 绿柱低点抬高，标记为底背离共振。', icon: Target },
    { title: '信号失效', copy: 'K 再次下穿 D，或 DIF 下穿 DEA，视为共振结束的离场参考。', icon: TrendingDown },
  ];
  return <div className="workspace-view strategy-view">
    <section className="view-heading strategy-heading">
      <div><span className="eyebrow">STRATEGY / MACD + KDJ RESONANCE</span><h1>MACD + KDJ 双金叉</h1><p>依据视频的趋势确认与低位买点逻辑，扫描双指标共振候选。</p></div>
      <button className={`text-button macd-refresh ${loading ? 'is-spinning' : ''}`} type="button" disabled={loading} onClick={() => void loadLatestSignals()}><RefreshCw size={14} />读取最新</button>
    </section>

    <section className="macd-date-toolbar" aria-label="MACD KDJ 共振历史记录日期">
      <label>历史日期<input type="date" value={selectedDate} max={snapshot ? toInputDate(snapshot.storageDate) : undefined} disabled={loading || historyLoading} onChange={(event) => { if (event.target.value) void loadHistoricalSignals(event.target.value); }} /></label>
      <div className="macd-date-list">{storedDates.slice(0, 12).map((date) => <button type="button" key={date} disabled={loading || historyLoading} className={toInputDate(date) === selectedDate ? 'active' : ''} onClick={() => void loadHistoricalSignals(toInputDate(date))}>{formatTradingDate(date)}</button>)}</div>
    </section>

    <section className="strategy-hero macd-hero">
      <div className="signal-block"><span>优先观察</span><strong>{lead ? lead.name : loading ? '正在扫描' : '暂无候选'}</strong><p>{lead ? `${lead.code} · ${lead.signal} · 评分 ${lead.score.toFixed(1)}` : '等待 KDJ 低位金叉与 MACD 趋势确认'}</p></div>
      <div className="signal-stat"><span>指标参数</span><strong>12 / 26 / 9</strong><small>MACD · KDJ 9 / 3 / 3</small></div>
      <div className="signal-stat"><span>共振候选</span><strong>{snapshot?.signals.length ?? '--'}</strong><small>底背离 {snapshot?.divergenceCount ?? '--'} 只</small></div>
      <div className="signal-stat"><span>结果交易日</span><strong>{snapshot ? formatTradingDate(snapshot.lastTradingDate) : '--'}</strong><small>{snapshot?.cached ? '本地扫描记录' : '本次计算结果'}</small></div>
    </section>

    <div className="macd-pullback-layout">
      <section className="panel rules-panel">
        <div className="panel-title-row"><div><span className="eyebrow">VIDEO LOGIC</span><h3>双指标共振规则</h3></div></div>
        <div className="rule-flow kdj-rule-flow">{rules.map((rule, index) => { const Icon = rule.icon; return <div className="rule-step" key={rule.title}><div className="rule-index">{String(index + 1).padStart(2, '0')}</div><div className="rule-icon"><Icon size={18} /></div><div><strong>{rule.title}</strong><p>{rule.copy}</p></div></div>; })}</div>
      </section>
      <section className="panel macd-results-panel">
        <div className="panel-title-row"><div><span className="eyebrow">RESONANCE CANDIDATES</span><h3>MACD + KDJ 共振候选</h3></div>{snapshot && <span className="source-note">排除板块 / ST 等 {snapshot.excludedCount.toLocaleString()} 只 · 进入计算 {snapshot.scannedCount.toLocaleString()} 只 · 候选 {snapshot.signals.length.toLocaleString()} 只</span>}</div>
        {loading && <div className="macd-state"><RefreshCw className="spin-icon" size={20} />正在读取全市场日线并计算 MACD + KDJ</div>}
        {!loading && error && <div className="macd-state error"><AlertTriangle size={19} />{error}</div>}
        {!loading && !error && snapshot && snapshot.signals.length === 0 && <div className="macd-state">当前交易日没有同时满足低位 KDJ 金叉与 MACD 金叉的标的</div>}
        {!loading && !error && snapshot && snapshot.signals.length > 0 && <MacdKdjTable snapshot={snapshot} />}
      </section>
    </div>
    {(historyLoading || historyError || historySnapshot) && <section className="panel macd-history-panel">
      <div className="panel-title-row">
        <div><span className="eyebrow">HISTORICAL MACD + KDJ</span><h3>{historySnapshot ? `${formatTradingDate(historySnapshot.lastTradingDate)} 历史共振候选` : '历史筛选结果'}</h3></div>
        {historyMovement && historyMovement.total > 0 && <div className="history-movement-summary" aria-label="历史共振候选至今涨跌统计"><span className="up">上涨 <strong>{historyMovement.up}</strong> 只</span><span className="down">下跌 <strong>{historyMovement.down}</strong> 只</span><span>持平 <strong>{historyMovement.flat}</strong> 只</span></div>}
        {historySnapshot && <span className="source-note">排除板块 / ST 等 {historySnapshot.excludedCount.toLocaleString()} 只 · 进入计算 {historySnapshot.scannedCount.toLocaleString()} 只 · 候选 {historySnapshot.signals.length.toLocaleString()} 只</span>}
      </div>
      {historyLoading && <div className="macd-state macd-history-state"><RefreshCw className="spin-icon" size={20} />正在读取或计算截至 {formatTradingDate(selectedDate)} 的历史筛选结果</div>}
      {!historyLoading && historyError && <div className="macd-state macd-history-state error"><AlertTriangle size={19} />{historyError}</div>}
      {!historyLoading && !historyError && historySnapshot && historySnapshot.signals.length === 0 && <div className="macd-state macd-history-state">该交易日没有符合 MACD + KDJ 共振条件的标的</div>}
      {!historyLoading && !historyError && historySnapshot && historySnapshot.signals.length > 0 && <MacdKdjTable snapshot={historySnapshot} historical />}
    </section>}
    <div className="risk-note macd-risk-note"><CircleDollarSign size={18} /><p>候选仅表示视频逻辑的量化触发，不构成买入建议。参数与“同一周期”均为明确的工程化口径，执行前仍需核对公告、流动性、仓位与止损。</p></div>
  </div>;
}

type VolumeSortKey = 'change' | 'changeSinceSignal' | 'score' | 'volumeRatio';

function VolumeSignalTable({ snapshot, historical = false }: { snapshot: VolumeSnapshot; historical?: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<{ key: VolumeSortKey; direction: 'asc' | 'desc' } | null>(null);
  const sortedSignals = useMemo(() => {
    if (!sort) return snapshot.signals;
    return [...snapshot.signals].sort((left, right) => {
      const leftValue = left[sort.key];
      const rightValue = right[sort.key];
      if (leftValue === undefined) return rightValue === undefined ? 0 : 1;
      if (rightValue === undefined) return -1;
      return sort.direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [snapshot.signals, sort]);
  const totalPages = Math.max(1, Math.ceil(snapshot.signals.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sortedSignals.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const toggleSort = (key: VolumeSortKey) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'desc' };
      if (current.direction === 'desc') return { key, direction: 'asc' };
      return null;
    });
    setPage(1);
  };
  const sortButton = (key: VolumeSortKey, label: string) => {
    const activeSort = sort?.key === key ? sort : null;
    const nextDirection = !activeSort ? '降序' : activeSort.direction === 'desc' ? '升序' : '原始顺序';
    return <button className={`table-sort-button${activeSort ? ' active' : ''}`} type="button" title={`按${label}${nextDirection}排列`} onClick={() => toggleSort(key)}>{label}{!activeSort ? <ArrowUpDown size={13} /> : activeSort.direction === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}</button>;
  };
  const crossAge = (days: number) => days < 0 ? '--' : days === 0 ? '当日' : `${days} 日前`;
  const signalClass = (signal: VolumeSnapshot['signals'][number]['signal']) => signal === '量价同步突破' ? 'breakout' : signal === '量能共振支撑' ? 'support' : 'pullback';
  return <>
    <div className="table-scroll"><table className={`volume-signal-table${historical ? ' is-history' : ''}`}>
      <thead><tr><th>序号</th><th>股票</th><th>{historical ? '当时价格' : '现价'}</th><th>{sortButton('change', historical ? '当日涨幅' : '涨跌幅')}</th>{historical && <><th>当前价格</th><th>{sortButton('changeSinceSignal', '至今涨幅')}</th></>}<th>MA25</th><th>距 MA25</th><th>高点回撤</th><th>量均 5</th><th>量均 60</th><th>{sortButton('volumeRatio', '量比')}</th><th>价格突破</th><th>量能突破</th><th>{sortButton('score', '评分')}</th><th>信号</th></tr></thead>
      <tbody>{pageRows.map((item, index) => <tr key={item.code}>
        <td>{String((currentPage - 1) * pageSize + index + 1).padStart(2, '0')}</td>
        <td><StockKlineCell name={item.name} code={item.code} /></td>
        <td>{item.close.toFixed(2)}</td>
        <td><Change value={item.change} /></td>
        {historical && <><td>{item.currentPrice === undefined ? '--' : item.currentPrice.toFixed(2)}</td><td>{item.changeSinceSignal === undefined ? '--' : <Change value={item.changeSinceSignal} />}</td></>}
        <td>{item.ma25.toFixed(2)}</td>
        <td><Change value={item.supportDistance} /></td>
        <td><Change value={item.pullback} /></td>
        <td>{formatVolume(item.volumeMa5)}手</td>
        <td>{formatVolume(item.volumeMa60)}手</td>
        <td>{item.volumeRatio.toFixed(2)}</td>
        <td>{crossAge(item.priceCrossDaysAgo)}</td>
        <td>{crossAge(item.volumeCrossDaysAgo)}</td>
        <td><strong className="pullback-score">{item.score.toFixed(1)}</strong></td>
        <td><span className={`volume-signal-badge ${signalClass(item.signal)}`}>{item.signal}</span></td>
      </tr>)}</tbody>
    </table></div>
    <div className="macd-pagination">
      <span>共 {snapshot.signals.length} 条</span>
      <label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10 条</option><option value={20}>20 条</option><option value={50}>50 条</option></select></label>
      <span>第 {currentPage} / {totalPages} 页</span>
      <button className="icon-button" type="button" title="上一页" aria-label="上一页" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16} /></button>
      <button className="icon-button" type="button" title="下一页" aria-label="下一页" disabled={currentPage === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight size={16} /></button>
    </div>
  </>;
}

function VolumeSignalStrategy() {
  const [snapshot, setSnapshot] = useState<VolumeSnapshot | null>(null);
  const [historySnapshot, setHistorySnapshot] = useState<VolumeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [storedDates, setStoredDates] = useState<string[]>([]);
  const loadStoredDates = useCallback(async () => {
    try {
      const response = await apiFetch('/api/strategy/volume-signals/dates', { cache: 'no-store' });
      const payload = await response.json() as { dates?: string[] };
      if (response.ok && Array.isArray(payload.dates)) setStoredDates(payload.dates);
    } catch {
      // The latest result remains usable if the local date list cannot be loaded.
    }
  }, []);
  const loadLatestSignals = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/strategy/volume-signals', { cache: 'no-store' });
      const payload = await response.json() as VolumeSnapshot & { message?: string };
      if (!response.ok) throw new Error(payload.message || `量价三信号扫描返回 HTTP ${response.status}`);
      setSnapshot(payload);
      setSelectedDate((current) => current || toInputDate(payload.storageDate));
      void loadStoredDates();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '量价三信号扫描失败');
    } finally {
      setLoading(false);
    }
  }, [loadStoredDates]);
  const loadHistoricalSignals = useCallback(async (date: string) => {
    setSelectedDate(date);
    setHistoryError('');
    if (!date || date.replaceAll('-', '') === snapshot?.storageDate) {
      setHistorySnapshot(null);
      return;
    }
    setHistoryLoading(true);
    setHistorySnapshot(null);
    try {
      const response = await apiFetch(`/api/strategy/volume-signals?date=${date.replaceAll('-', '')}`, { cache: 'no-store' });
      const payload = await response.json() as VolumeSnapshot & { message?: string };
      if (!response.ok) throw new Error(payload.message || `历史量价三信号结果返回 HTTP ${response.status}`);
      setHistorySnapshot(payload);
      setSelectedDate(toInputDate(payload.storageDate));
      void loadStoredDates();
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : '历史量价三信号结果读取失败');
    } finally {
      setHistoryLoading(false);
    }
  }, [loadStoredDates, snapshot?.storageDate]);
  useEffect(() => { void loadStoredDates(); void loadLatestSignals(); }, [loadLatestSignals, loadStoredDates]);
  const lead = snapshot?.signals[0];
  const historyMovement = historySnapshot?.signals.reduce((counts, signal) => {
    if (signal.changeSinceSignal === undefined) return counts;
    if (signal.changeSinceSignal > 0) counts.up += 1;
    else if (signal.changeSinceSignal < 0) counts.down += 1;
    else counts.flat += 1;
    counts.total += 1;
    return counts;
  }, { up: 0, down: 0, flat: 0, total: 0 });
  const rules = [
    { title: '趋势生命线', copy: '以 25 日均线判断中期趋势，价格站在线上偏多；有效跌破后不再保留支撑信号。', icon: TrendingUp },
    { title: '量价同步突破', copy: '量均 5 在当日或前一日上穿量均 60，并继续向上；价格突破 MA25 与量能突破相隔不超过 1 日。', icon: BarChart3 },
    { title: '量能共振支撑', copy: '价格回踩 MA25 获得支撑，量均 5 接近量均 60 但未破位，并重新拐头向上。', icon: Activity },
    { title: '缩量回踩蓄力', copy: '上涨后回踩 MA25，成交量连续收缩，量均 5 已稳定在量均 60 上方至少 5 日，等待再次放量。', icon: Target },
    { title: '失效参考', copy: '收盘有效跌破 MA25，或量均 5 跌破量均 60 且无法快速修复，视为信号失效。', icon: TrendingDown },
  ];
  return <div className="workspace-view strategy-view">
    <section className="view-heading strategy-heading">
      <div><span className="eyebrow">STRATEGY / PRICE-VOLUME SIGNALS</span><h1>量价三信号</h1><p>依据视频的 25 日趋势线与 5 / 60 日量均线体系，扫描突破、支撑与缩量蓄力机会。</p></div>
      <button className={`text-button macd-refresh ${loading ? 'is-spinning' : ''}`} type="button" disabled={loading} onClick={() => void loadLatestSignals()}><RefreshCw size={14} />读取最新</button>
    </section>

    <section className="macd-date-toolbar" aria-label="量价三信号历史记录日期">
      <label>历史日期<input type="date" value={selectedDate} max={snapshot ? toInputDate(snapshot.storageDate) : undefined} disabled={loading || historyLoading} onChange={(event) => { if (event.target.value) void loadHistoricalSignals(event.target.value); }} /></label>
      <div className="macd-date-list">{storedDates.slice(0, 12).map((date) => <button type="button" key={date} disabled={loading || historyLoading} className={toInputDate(date) === selectedDate ? 'active' : ''} onClick={() => void loadHistoricalSignals(toInputDate(date))}>{formatTradingDate(date)}</button>)}</div>
    </section>

    <section className="strategy-hero macd-hero">
      <div className="signal-block"><span>优先观察</span><strong>{lead ? lead.name : loading ? '正在扫描' : '暂无候选'}</strong><p>{lead ? `${lead.code} · ${lead.signal} · 评分 ${lead.score.toFixed(1)}` : '等待趋势线与量能结构共同确认'}</p></div>
      <div className="signal-stat"><span>核心参数</span><strong>25 / 5 / 60</strong><small>价格 MA25 · 量均 MA5 / MA60</small></div>
      <div className="signal-stat"><span>三类候选</span><strong>{snapshot?.signals.length ?? '--'}</strong><small>突破 {snapshot?.breakoutCount ?? '--'} · 支撑 {snapshot?.supportCount ?? '--'} · 缩量 {snapshot?.pullbackCount ?? '--'}</small></div>
      <div className="signal-stat"><span>结果交易日</span><strong>{snapshot ? formatTradingDate(snapshot.lastTradingDate) : '--'}</strong><small>{snapshot?.cached ? '本地扫描记录' : '本次计算结果'}</small></div>
    </section>

    <div className="macd-pullback-layout">
      <section className="panel rules-panel">
        <div className="panel-title-row"><div><span className="eyebrow">VIDEO LOGIC</span><h3>量价三信号规则</h3></div></div>
        <div className="rule-flow volume-rule-flow">{rules.map((rule, index) => { const Icon = rule.icon; return <div className="rule-step" key={rule.title}><div className="rule-index">{String(index + 1).padStart(2, '0')}</div><div className="rule-icon"><Icon size={18} /></div><div><strong>{rule.title}</strong><p>{rule.copy}</p></div></div>; })}</div>
      </section>
      <section className="panel macd-results-panel">
        <div className="panel-title-row"><div><span className="eyebrow">PRICE-VOLUME CANDIDATES</span><h3>量价结构候选</h3></div>{snapshot && <span className="source-note">排除板块 / ST 等 {snapshot.excludedCount.toLocaleString()} 只 · 进入计算 {snapshot.scannedCount.toLocaleString()} 只 · 候选 {snapshot.signals.length.toLocaleString()} 只</span>}</div>
        {loading && <div className="macd-state"><RefreshCw className="spin-icon" size={20} />正在读取全市场日线并计算 MA25 与量均线 5 / 60</div>}
        {!loading && error && <div className="macd-state error"><AlertTriangle size={19} />{error}</div>}
        {!loading && !error && snapshot && snapshot.signals.length === 0 && <div className="macd-state">当前交易日没有同时满足趋势与量能条件的标的</div>}
        {!loading && !error && snapshot && snapshot.signals.length > 0 && <VolumeSignalTable snapshot={snapshot} />}
      </section>
    </div>
    {(historyLoading || historyError || historySnapshot) && <section className="panel macd-history-panel">
      <div className="panel-title-row">
        <div><span className="eyebrow">HISTORICAL PRICE-VOLUME SIGNALS</span><h3>{historySnapshot ? `${formatTradingDate(historySnapshot.lastTradingDate)} 历史量价候选` : '历史筛选结果'}</h3></div>
        {historyMovement && historyMovement.total > 0 && <div className="history-movement-summary" aria-label="历史量价候选至今涨跌统计"><span className="up">上涨 <strong>{historyMovement.up}</strong> 只</span><span className="down">下跌 <strong>{historyMovement.down}</strong> 只</span><span>持平 <strong>{historyMovement.flat}</strong> 只</span></div>}
        {historySnapshot && <span className="source-note">排除板块 / ST 等 {historySnapshot.excludedCount.toLocaleString()} 只 · 进入计算 {historySnapshot.scannedCount.toLocaleString()} 只 · 候选 {historySnapshot.signals.length.toLocaleString()} 只</span>}
      </div>
      {historyLoading && <div className="macd-state macd-history-state"><RefreshCw className="spin-icon" size={20} />正在读取或计算截至 {formatTradingDate(selectedDate)} 的历史筛选结果</div>}
      {!historyLoading && historyError && <div className="macd-state macd-history-state error"><AlertTriangle size={19} />{historyError}</div>}
      {!historyLoading && !historyError && historySnapshot && historySnapshot.signals.length === 0 && <div className="macd-state macd-history-state">该交易日没有符合量价三信号条件的标的</div>}
      {!historyLoading && !historyError && historySnapshot && historySnapshot.signals.length > 0 && <VolumeSignalTable snapshot={historySnapshot} historical />}
    </section>}
    <div className="risk-note macd-risk-note"><CircleDollarSign size={18} /><p>候选仅表示视频逻辑的量化触发，不构成买入建议。连续缩量、支撑距离与“同一周期”均采用明确的工程化口径，执行前仍需核对公告、流动性、仓位与止损。</p></div>
  </div>;
}

type BullPointSortKey = 'change' | 'changeSinceSignal' | 'var1' | 'crossSpread';

function BullPointTable({ snapshot, historical = false }: { snapshot: BullPointSnapshot; historical?: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<{ key: BullPointSortKey; direction: 'asc' | 'desc' } | null>(null);
  const sortedSignals = useMemo(() => {
    if (!sort) return snapshot.signals;
    return [...snapshot.signals].sort((left, right) => {
      const leftValue = left[sort.key];
      const rightValue = right[sort.key];
      if (leftValue === undefined) return rightValue === undefined ? 0 : 1;
      if (rightValue === undefined) return -1;
      return sort.direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [snapshot.signals, sort]);
  const totalPages = Math.max(1, Math.ceil(snapshot.signals.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sortedSignals.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const toggleSort = (key: BullPointSortKey) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'desc' };
      if (current.direction === 'desc') return { key, direction: 'asc' };
      return null;
    });
    setPage(1);
  };
  const sortButton = (key: BullPointSortKey, label: string) => {
    const activeSort = sort?.key === key ? sort : null;
    const nextDirection = !activeSort ? '降序' : activeSort.direction === 'desc' ? '升序' : '原始顺序';
    return <button className={`table-sort-button${activeSort ? ' active' : ''}`} type="button" title={`按${label}${nextDirection}排列`} onClick={() => toggleSort(key)}>{label}{!activeSort ? <ArrowUpDown size={13} /> : activeSort.direction === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}</button>;
  };
  return <>
    <div className="table-scroll"><table className={`bull-point-table${historical ? ' is-history' : ''}`}>
      <thead><tr><th>序号</th><th>股票</th><th>{historical ? '当时价格' : '现价'}</th><th>{sortButton('change', historical ? '当日涨幅' : '涨跌幅')}</th>{historical && <><th>当前价格</th><th>{sortButton('changeSinceSignal', '至今涨幅')}</th></>}<th>昨日 VAR1</th><th>昨日趋势线</th><th>{sortButton('var1', '当日 VAR1')}</th><th>当日趋势线</th><th>{sortButton('crossSpread', '上穿幅度')}</th><th>信号</th></tr></thead>
      <tbody>{pageRows.map((item, index) => <tr key={item.code}>
        <td>{String((currentPage - 1) * pageSize + index + 1).padStart(2, '0')}</td>
        <td><StockKlineCell name={item.name} code={item.code} /></td>
        <td>{item.close.toFixed(2)}</td>
        <td><Change value={item.change} /></td>
        {historical && <><td>{item.currentPrice === undefined ? '--' : item.currentPrice.toFixed(2)}</td><td>{item.changeSinceSignal === undefined ? '--' : <Change value={item.changeSinceSignal} />}</td></>}
        <td>{item.previousVar1.toFixed(2)}</td>
        <td>{item.previousTrendLine.toFixed(2)}</td>
        <td>{item.var1.toFixed(2)}</td>
        <td>{item.trendLine.toFixed(2)}</td>
        <td className="up">+{item.crossSpread.toFixed(2)}</td>
        <td><span className="bull-point-badge">{item.signal}</span></td>
      </tr>)}</tbody>
    </table></div>
    <div className="macd-pagination">
      <span>共 {snapshot.signals.length} 条</span>
      <label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10 条</option><option value={20}>20 条</option><option value={50}>50 条</option></select></label>
      <span>第 {currentPage} / {totalPages} 页</span>
      <button className="icon-button" type="button" title="上一页" aria-label="上一页" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16} /></button>
      <button className="icon-button" type="button" title="下一页" aria-label="下一页" disabled={currentPage === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight size={16} /></button>
    </div>
  </>;
}

function BullPointStrategy() {
  const [snapshot, setSnapshot] = useState<BullPointSnapshot | null>(null);
  const [historySnapshot, setHistorySnapshot] = useState<BullPointSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [storedDates, setStoredDates] = useState<string[]>([]);
  const loadStoredDates = useCallback(async () => {
    try {
      const response = await apiFetch('/api/strategy/bull-points/dates', { cache: 'no-store' });
      const payload = await response.json() as { dates?: string[] };
      if (response.ok && Array.isArray(payload.dates)) setStoredDates(payload.dates);
    } catch {
      // The latest result remains usable if the local date list cannot be loaded.
    }
  }, []);
  const loadLatestSignals = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/strategy/bull-points', { cache: 'no-store' });
      const payload = await response.json() as BullPointSnapshot & { message?: string };
      if (!response.ok) throw new Error(payload.message || `多空趋势多点扫描返回 HTTP ${response.status}`);
      setSnapshot(payload);
      setSelectedDate((current) => current || toInputDate(payload.storageDate));
      void loadStoredDates();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '多空趋势多点扫描失败');
    } finally {
      setLoading(false);
    }
  }, [loadStoredDates]);
  const loadHistoricalSignals = useCallback(async (date: string) => {
    setSelectedDate(date);
    setHistoryError('');
    if (!date || date.replaceAll('-', '') === snapshot?.storageDate) {
      setHistorySnapshot(null);
      return;
    }
    setHistoryLoading(true);
    setHistorySnapshot(null);
    try {
      const response = await apiFetch(`/api/strategy/bull-points?date=${date.replaceAll('-', '')}`, { cache: 'no-store' });
      const payload = await response.json() as BullPointSnapshot & { message?: string };
      if (!response.ok) throw new Error(payload.message || `历史多点结果返回 HTTP ${response.status}`);
      setHistorySnapshot(payload);
      setSelectedDate(toInputDate(payload.storageDate));
      void loadStoredDates();
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : '历史多点结果读取失败');
    } finally {
      setHistoryLoading(false);
    }
  }, [loadStoredDates, snapshot?.storageDate]);
  useEffect(() => { void loadStoredDates(); void loadLatestSignals(); }, [loadLatestSignals, loadStoredDates]);
  const lead = snapshot?.signals[0];
  const historyMovement = historySnapshot?.signals.reduce((counts, signal) => {
    if (signal.changeSinceSignal === undefined) return counts;
    if (signal.changeSinceSignal > 0) counts.up += 1;
    else if (signal.changeSinceSignal < 0) counts.down += 1;
    else counts.flat += 1;
    counts.total += 1;
    return counts;
  }, { up: 0, down: 0, flat: 0, total: 0 });
  const rules = [
    { title: '21 日强弱线', copy: 'VAR1 用 21 日最高、最低与收盘价定位当前强弱，取值越高表示收盘越接近区间高位。', icon: TrendingUp },
    { title: '6 日摆动值', copy: '先计算收盘价在 6 日高低区间中的回撤比例，再取 34 日简单平均并反向处理。', icon: Activity },
    { title: '趋势线平滑', copy: '对 VAR3 再计算 6 日简单平均，得到与 VAR1 比较的慢速趋势线。', icon: BarChart3 },
    { title: '当日多点', copy: '昨日 VAR1 不高于趋势线，今日 VAR1 上穿趋势线；只保留目标交易日刚刚发生的交叉。', icon: Target },
    { title: '收盘确认', copy: '公式仅使用历史与当日价格，不使用未来数据；当日盘中高低价仍变化，日线信号以收盘后为准。', icon: Check },
  ];
  return <div className="workspace-view strategy-view">
    <section className="view-heading strategy-heading">
      <div><span className="eyebrow">STRATEGY / BULL-BEAR TREND</span><h1>多空趋势 · 多点</h1><p>按公开复刻公式扫描目标交易日 VAR1 上穿趋势线的股票，只展示当天新出现的多点。</p></div>
      <button className={`text-button macd-refresh ${loading ? 'is-spinning' : ''}`} type="button" disabled={loading} onClick={() => void loadLatestSignals()}><RefreshCw size={14} />读取最新</button>
    </section>

    <section className="macd-date-toolbar" aria-label="多空趋势多点历史记录日期">
      <label>历史日期<input type="date" value={selectedDate} max={snapshot ? toInputDate(snapshot.storageDate) : undefined} disabled={loading || historyLoading} onChange={(event) => { if (event.target.value) void loadHistoricalSignals(event.target.value); }} /></label>
      <div className="macd-date-list">{storedDates.slice(0, 12).map((date) => <button type="button" key={date} disabled={loading || historyLoading} className={toInputDate(date) === selectedDate ? 'active' : ''} onClick={() => void loadHistoricalSignals(toInputDate(date))}>{formatTradingDate(date)}</button>)}</div>
    </section>

    <section className="strategy-hero macd-hero">
      <div className="signal-block"><span>上穿幅度领先</span><strong>{lead ? lead.name : loading ? '正在扫描' : '暂无多点'}</strong><p>{lead ? `${lead.code} · VAR1 ${lead.var1.toFixed(2)} / 趋势线 ${lead.trendLine.toFixed(2)}` : '等待 VAR1 从下方向上穿越趋势线'}</p></div>
      <div className="signal-stat"><span>公式参数</span><strong>21 / 6 / 34 / 6</strong><small>区间强弱 · 长短平滑</small></div>
      <div className="signal-stat"><span>当日多点</span><strong>{snapshot?.signals.length ?? '--'}</strong><small>仅统计当日新上穿</small></div>
      <div className="signal-stat"><span>结果交易日</span><strong>{snapshot ? formatTradingDate(snapshot.lastTradingDate) : '--'}</strong><small>{snapshot?.cached ? '本地扫描记录' : '本次计算结果'}</small></div>
    </section>

    <div className="macd-pullback-layout">
      <section className="panel rules-panel">
        <div className="panel-title-row"><div><span className="eyebrow">PUBLIC FORMULA</span><h3>多点计算过程</h3></div></div>
        <div className="rule-flow bull-point-rule-flow">{rules.map((rule, index) => { const Icon = rule.icon; return <div className="rule-step" key={rule.title}><div className="rule-index">{String(index + 1).padStart(2, '0')}</div><div className="rule-icon"><Icon size={18} /></div><div><strong>{rule.title}</strong><p>{rule.copy}</p></div></div>; })}</div>
      </section>
      <section className="panel macd-results-panel">
        <div className="panel-title-row"><div><span className="eyebrow">NEW BULL POINTS</span><h3>当日多点候选</h3></div>{snapshot && <span className="source-note">排除板块 / ST 等 {snapshot.excludedCount.toLocaleString()} 只 · 进入计算 {snapshot.scannedCount.toLocaleString()} 只 · 多点 {snapshot.signals.length.toLocaleString()} 只</span>}</div>
        {loading && <div className="macd-state"><RefreshCw className="spin-icon" size={20} />正在读取全市场日线并计算多空趋势公式</div>}
        {!loading && error && <div className="macd-state error"><AlertTriangle size={19} />{error}</div>}
        {!loading && !error && snapshot && snapshot.signals.length === 0 && <div className="macd-state">当前交易日没有出现 VAR1 上穿趋势线的股票</div>}
        {!loading && !error && snapshot && snapshot.signals.length > 0 && <BullPointTable snapshot={snapshot} />}
      </section>
    </div>
    {(historyLoading || historyError || historySnapshot) && <section className="panel macd-history-panel">
      <div className="panel-title-row">
        <div><span className="eyebrow">HISTORICAL BULL POINTS</span><h3>{historySnapshot ? `${formatTradingDate(historySnapshot.lastTradingDate)} 历史多点` : '历史筛选结果'}</h3></div>
        {historyMovement && historyMovement.total > 0 && <div className="history-movement-summary" aria-label="历史多点至今涨跌统计"><span className="up">上涨 <strong>{historyMovement.up}</strong> 只</span><span className="down">下跌 <strong>{historyMovement.down}</strong> 只</span><span>持平 <strong>{historyMovement.flat}</strong> 只</span></div>}
        {historySnapshot && <span className="source-note">排除板块 / ST 等 {historySnapshot.excludedCount.toLocaleString()} 只 · 进入计算 {historySnapshot.scannedCount.toLocaleString()} 只 · 多点 {historySnapshot.signals.length.toLocaleString()} 只</span>}
      </div>
      {historyLoading && <div className="macd-state macd-history-state"><RefreshCw className="spin-icon" size={20} />正在读取或计算截至 {formatTradingDate(selectedDate)} 的历史多点</div>}
      {!historyLoading && historyError && <div className="macd-state macd-history-state error"><AlertTriangle size={19} />{historyError}</div>}
      {!historyLoading && !historyError && historySnapshot && historySnapshot.signals.length === 0 && <div className="macd-state macd-history-state">该交易日没有出现多点的股票</div>}
      {!historyLoading && !historyError && historySnapshot && historySnapshot.signals.length > 0 && <BullPointTable snapshot={historySnapshot} historical />}
    </section>}
    <div className="risk-note macd-risk-note"><CircleDollarSign size={18} /><p>本策略按公开社区公式复刻，不代表同花顺官方确认的当前源码。多点仅表示价格强弱线当日上穿，不构成买入建议；执行前仍需核对趋势、成交量、公告、仓位与止损。</p></div>
  </div>;
}

function MacdSignalTable({
  snapshot,
  page,
  pageSize,
  historical = false,
  onPageChange,
  onPageSizeChange,
}: {
  snapshot: MacdSnapshot;
  page: number;
  pageSize: number;
  historical?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const [sort, setSort] = useState<{ key: 'change' | 'changeSinceSignal'; direction: 'asc' | 'desc' } | null>(null);
  const sortedSignals = useMemo(() => {
    if (!sort) return snapshot.signals;
    return [...snapshot.signals].sort((left, right) => {
      const leftValue = left[sort.key];
      const rightValue = right[sort.key];
      if (leftValue === undefined) return rightValue === undefined ? 0 : 1;
      if (rightValue === undefined) return -1;
      return sort.direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
    });
  }, [snapshot.signals, sort]);
  const totalPages = Math.max(1, Math.ceil(snapshot.signals.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sortedSignals.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const toggleSort = (key: 'change' | 'changeSinceSignal') => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'desc' };
      if (current.direction === 'desc') return { key, direction: 'asc' };
      return null;
    });
    onPageChange(1);
  };
  const sortButton = (key: 'change' | 'changeSinceSignal', label: string) => {
    const activeSort = sort?.key === key ? sort : null;
    const nextDirection = !activeSort ? '降序' : activeSort.direction === 'desc' ? '升序' : '原始顺序';
    return <button className={`table-sort-button${activeSort ? ' active' : ''}`} type="button" title={`按${label}${nextDirection}排列`} onClick={() => toggleSort(key)}>{label}{!activeSort ? <ArrowUpDown size={13} /> : activeSort.direction === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}</button>;
  };
  return <>
    <div className="table-scroll"><table className={`macd-table${historical ? ' is-history' : ''}`}>
      <thead><tr><th>序号</th><th>股票</th><th>{historical ? '当时价格' : '现价'}</th><th>{sortButton('change', '涨跌幅')}</th>{historical && <><th>当前价格</th><th>{sortButton('changeSinceSignal', '至今涨幅')}</th></>}<th>DIF</th><th>DEA</th><th>MACD 柱</th><th>柱体变化</th><th>信号</th></tr></thead>
      <tbody>{pageRows.map((item, index) => <tr key={item.code}>
        <td>{String((currentPage - 1) * pageSize + index + 1).padStart(2, '0')}</td>
        <td><StockKlineCell name={item.name} code={item.code} /></td>
        <td>{item.close.toFixed(2)}</td>
        <td><Change value={item.change} /></td>
        {historical && <><td>{item.currentPrice === undefined ? '--' : item.currentPrice.toFixed(2)}</td><td>{item.changeSinceSignal === undefined ? '--' : <Change value={item.changeSinceSignal} />}</td></>}
        <td>{item.dif.toFixed(4)}</td>
        <td>{item.dea.toFixed(4)}</td>
        <td className="up">{item.histogram.toFixed(4)}</td>
        <td className="up">+{item.histogramChange.toFixed(4)}</td>
        <td><span className={`macd-signal ${item.signal === '金叉共振' ? 'cross' : ''}`}>{item.signal}</span></td>
      </tr>)}</tbody>
    </table></div>
    <div className="macd-pagination">
      <span>共 {snapshot.signals.length} 条</span>
      <label>每页<select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}><option value={10}>10 条</option><option value={20}>20 条</option><option value={50}>50 条</option><option value={100}>100 条</option></select></label>
      <span>第 {currentPage} / {totalPages} 页</span>
      <button className="icon-button" type="button" title="上一页" aria-label="上一页" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}><ChevronLeft size={16} /></button>
      <button className="icon-button" type="button" title="下一页" aria-label="下一页" disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)}><ChevronRight size={16} /></button>
    </div>
  </>;
}

function MacdSnapshotMeta({ snapshot }: { snapshot: MacdSnapshot }) {
  return <span className="source-note">排除板块 / ST 等 {snapshot.excludedCount.toLocaleString()} 只 · 进入计算 {snapshot.scannedCount.toLocaleString()} 只 · 首次金叉 {snapshot.firstCrossCount.toLocaleString()} 只</span>;
}

function MacdConfluenceStrategy() {
  const [snapshot, setSnapshot] = useState<MacdSnapshot | null>(null);
  const [historySnapshot, setHistorySnapshot] = useState<MacdSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [storedDates, setStoredDates] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const loadStoredDates = useCallback(async () => {
    try {
      const response = await apiFetch('/api/strategy/macd-confluence/dates', { cache: 'no-store' });
      const payload = await response.json() as { dates?: string[] };
      if (response.ok && Array.isArray(payload.dates)) setStoredDates(payload.dates);
    } catch {
      // The scan result remains usable even when the local-date list cannot be loaded.
    }
  }, []);
  const loadLatestSignals = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/strategy/macd-confluence', { cache: 'no-store' });
      const payload = await response.json() as MacdSnapshot & { message?: string };
      if (!response.ok) throw new Error(payload.message || `MACD 扫描返回 HTTP ${response.status}`);
      setSnapshot(payload);
      setSelectedDate((current) => current || toInputDate(payload.storageDate));
      setPage(1);
      void loadStoredDates();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'MACD 扫描失败');
    } finally {
      setLoading(false);
    }
  }, [loadStoredDates]);
  const loadHistoricalSignals = useCallback(async (date: string) => {
    setSelectedDate(date);
    setHistoryError('');
    if (!date || date.replaceAll('-', '') === snapshot?.storageDate) {
      setHistorySnapshot(null);
      setHistoryPage(1);
      return;
    }
    setHistoryLoading(true);
    setHistorySnapshot(null);
    try {
      const response = await apiFetch(`/api/strategy/macd-confluence?date=${date.replaceAll('-', '')}`, { cache: 'no-store' });
      const payload = await response.json() as MacdSnapshot & { message?: string };
      if (!response.ok) throw new Error(payload.message || `历史 MACD 结果返回 HTTP ${response.status}`);
      setHistorySnapshot(payload);
      setSelectedDate(toInputDate(payload.storageDate));
      setHistoryPage(1);
      void loadStoredDates();
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : '历史 MACD 结果读取失败');
    } finally {
      setHistoryLoading(false);
    }
  }, [loadStoredDates, snapshot?.storageDate]);
  useEffect(() => { void loadStoredDates(); void loadLatestSignals(); }, [loadLatestSignals, loadStoredDates]);

  const rules = [
    { title: '扫描范围', copy: '沪深 A 股；排除北交所、创业板（30 开头）、科创板（688 / 689）与名称含 ST 的股票。', icon: Filter },
    { title: '计算参数', copy: 'DIF = EMA(10) - EMA(20)；DEA = DIF 的 7 日 EMA；柱体 = 2 × (DIF - DEA)。', icon: Activity },
    { title: '入选信号', copy: '仅保留当日 DIF 首次上穿 DEA 的金叉信号，收盘后确认。', icon: TrendingUp },
    { title: '离场参考', copy: 'DIF 下穿 DEA，或红柱由正转负时撤销多头观察，收盘后确认。', icon: TrendingDown },
  ];
  const lead = snapshot?.signals[0];
  const historyMovement = historySnapshot?.signals.reduce((counts, signal) => {
    if (signal.changeSinceSignal === undefined) return counts;
    if (signal.changeSinceSignal > 0) counts.up += 1;
    else if (signal.changeSinceSignal < 0) counts.down += 1;
    else counts.flat += 1;
    counts.total += 1;
    return counts;
  }, { up: 0, down: 0, flat: 0, total: 0 });
  return (
    <div className="workspace-view strategy-view">
      <section className="view-heading strategy-heading">
        <div>
          <span className="eyebrow">STRATEGY / MACD CONFLUENCE</span>
          <h1>MACD 金叉共振扫描</h1>
          <p>全市场日线收盘扫描，MACD 参数固定为（10，20，7）。</p>
        </div>
        <button className={`text-button macd-refresh ${loading ? 'is-spinning' : ''}`} type="button" disabled={loading} onClick={() => void loadLatestSignals()}>
          <RefreshCw size={14} />读取最新
        </button>
      </section>

      <section className="macd-date-toolbar" aria-label="MACD 历史记录日期">
        <label>历史日期<input type="date" value={selectedDate} max={snapshot ? toInputDate(snapshot.storageDate) : undefined} disabled={loading || historyLoading} onChange={(event) => { if (event.target.value) void loadHistoricalSignals(event.target.value); }} /></label>
        <div className="macd-date-list">{storedDates.slice(0, 12).map((date) => <button type="button" key={date} disabled={loading || historyLoading} className={toInputDate(date) === selectedDate ? 'active' : ''} onClick={() => void loadHistoricalSignals(toInputDate(date))}>{formatTradingDate(date)}</button>)}</div>
      </section>

      <section className="strategy-hero macd-hero">
        <div className="signal-block">
          <span>最新候选</span>
          <strong>{lead ? lead.name : loading ? '正在扫描' : '暂无候选'}</strong>
          <p>{lead ? `${lead.code} · ${lead.signal}` : '以最新可用交易日的收盘数据为准'}</p>
        </div>
        <div className="signal-stat"><span>MACD 参数</span><strong>10 / 20 / 7</strong><small>快线 / 慢线 / 信号线</small></div>
        <div className="signal-stat"><span>首次金叉</span><strong>{snapshot?.firstCrossCount ?? '--'}</strong><small>已排除板块 / ST 等</small></div>
        <div className="signal-stat"><span>结果交易日</span><strong>{snapshot ? formatTradingDate(snapshot.lastTradingDate) : '--'}</strong><small>{snapshot?.cached ? '最新本地记录' : '本次计算结果'}</small></div>
      </section>

      <div className="macd-layout">
        <section className="panel rules-panel">
          <div className="panel-title-row"><div><span className="eyebrow">EXECUTION LOGIC</span><h3>交易规则</h3></div></div>
          <div className="rule-flow">
            {rules.map((rule, index) => {
              const Icon = rule.icon;
              return <div className="rule-step" key={rule.title}><div className="rule-index">{String(index + 1).padStart(2, '0')}</div><div className="rule-icon"><Icon size={18} /></div><div><strong>{rule.title}</strong><p>{rule.copy}</p></div></div>;
            })}
          </div>
        </section>

        <section className="panel macd-results-panel">
          <div className="panel-title-row">
            <div><span className="eyebrow">LATEST FIRST CROSS</span><h3>最新交易日首次金叉</h3></div>
            {snapshot && <MacdSnapshotMeta snapshot={snapshot} />}
          </div>
          {loading && <div className="macd-state"><RefreshCw className="spin-icon" size={20} />正在读取全市场日线并计算 MACD</div>}
          {!loading && error && <div className="macd-state error"><AlertTriangle size={19} />{error}</div>}
          {!loading && !error && snapshot && snapshot.signals.length === 0 && <div className="macd-state">本交易日没有符合金叉共振条件的标的</div>}
          {!loading && !error && snapshot && snapshot.signals.length > 0 && <MacdSignalTable snapshot={snapshot} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}
        </section>
      </div>
      {(historyLoading || historyError || historySnapshot) && <section className="panel macd-history-panel">
        <div className="panel-title-row">
          <div><span className="eyebrow">HISTORICAL FIRST CROSS</span><h3>{historySnapshot ? `${formatTradingDate(historySnapshot.lastTradingDate)} 历史首次金叉` : '历史筛选结果'}</h3></div>
          {historyMovement && historyMovement.total > 0 && <div className="history-movement-summary" aria-label="历史候选至今涨跌统计"><span className="up">上涨 <strong>{historyMovement.up}</strong> 只</span><span className="down">下跌 <strong>{historyMovement.down}</strong> 只</span><span>持平 <strong>{historyMovement.flat}</strong> 只</span></div>}
          {historySnapshot && <MacdSnapshotMeta snapshot={historySnapshot} />}
        </div>
        {historyLoading && <div className="macd-state macd-history-state"><RefreshCw className="spin-icon" size={20} />正在读取或计算截至 {formatTradingDate(selectedDate)} 的历史筛选结果</div>}
        {!historyLoading && historyError && <div className="macd-state macd-history-state error"><AlertTriangle size={19} />{historyError}</div>}
        {!historyLoading && !historyError && historySnapshot && historySnapshot.signals.length === 0 && <div className="macd-state macd-history-state">该交易日没有符合金叉共振条件的标的</div>}
        {!historyLoading && !historyError && historySnapshot && historySnapshot.signals.length > 0 && <MacdSignalTable snapshot={historySnapshot} page={historyPage} pageSize={historyPageSize} historical onPageChange={setHistoryPage} onPageSizeChange={(value) => { setHistoryPageSize(value); setHistoryPage(1); }} />}
      </section>}
      <div className="risk-note macd-risk-note"><CircleDollarSign size={18} /><p>该策略只提供条件扫描，不构成买卖建议。实际交易还应评估流动性、涨跌停、仓位、止损、手续费和滑点。</p></div>
    </div>
  );
}

type IntersectionSignal = {
  code: string;
  name: string;
  close: number;
  change: number;
  currentPrice?: number;
  changeSinceSignal?: number;
};

type IntersectionSnapshot = {
  signals: IntersectionSignal[];
  storageDate: string;
  lastTradingDate: string;
  message?: string;
};

type IntersectionResult = {
  tradingDate: string;
  selected: ScreeningStrategyId[];
  counts: Array<{ id: ScreeningStrategyId; label: string; count: number }>;
  rows: IntersectionSignal[];
};

function StrategyIntersection({ latestTradingDate }: { latestTradingDate?: string }) {
  const [selectedStrategies, setSelectedStrategies] = useState<Set<ScreeningStrategyId>>(
    () => new Set<ScreeningStrategyId>(['volume-signals', 'bull-points']),
  );
  const [selectedDate, setSelectedDate] = useState(() => toInputDate(latestTradingDate ?? ''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IntersectionResult | null>(null);
  const [sort, setSort] = useState<{ key: 'change' | 'changeSinceSignal'; direction: 'asc' | 'desc' }>({ key: 'change', direction: 'desc' });

  useEffect(() => {
    if (!selectedDate && latestTradingDate) setSelectedDate(toInputDate(latestTradingDate));
  }, [latestTradingDate, selectedDate]);

  const toggleStrategy = (id: ScreeningStrategyId) => {
    setSelectedStrategies((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setResult(null);
    setError('');
  };

  const runIntersection = async () => {
    const selectedOptions = intersectionStrategyOptions.filter((option) => selectedStrategies.has(option.id));
    if (selectedOptions.length < 2 || !selectedDate) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const snapshots = await Promise.all(selectedOptions.map(async (option) => {
        const response = await apiFetch(`${option.endpoint}?date=${selectedDate.replaceAll('-', '')}`, { cache: 'no-store' });
        const payload = await response.json() as IntersectionSnapshot;
        if (!response.ok) throw new Error(`${option.label}：${payload.message || `返回 HTTP ${response.status}`}`);
        if (!Array.isArray(payload.signals)) throw new Error(`${option.label}：筛选结果格式不完整`);
        return { option, snapshot: payload };
      }));
      const tradingDates = new Set(snapshots.map(({ snapshot }) => snapshot.lastTradingDate));
      if (tradingDates.size !== 1) throw new Error('所选策略返回的交易日不一致，请重新选择日期后计算');

      const signalMaps = snapshots.map(({ snapshot }) => new Map(snapshot.signals.map((signal) => [signal.code, signal])));
      const commonCodes = snapshots[0].snapshot.signals
        .map((signal) => signal.code)
        .filter((code) => signalMaps.every((signals) => signals.has(code)));
      const rows = commonCodes.map((code) => {
        const matches = signalMaps.map((signals) => signals.get(code)).filter((signal): signal is IntersectionSignal => Boolean(signal));
        const current = matches.find((signal) => signal.currentPrice !== undefined);
        return {
          ...matches[0],
          currentPrice: current?.currentPrice,
          changeSinceSignal: current?.changeSinceSignal,
        };
      });
      setResult({
        tradingDate: snapshots[0].snapshot.lastTradingDate,
        selected: selectedOptions.map((option) => option.id),
        counts: snapshots.map(({ option, snapshot }) => ({ id: option.id, label: option.label, count: snapshot.signals.length })),
        rows,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '策略交集计算失败');
    } finally {
      setLoading(false);
    }
  };

  const historical = Boolean(result && latestTradingDate && result.tradingDate.replaceAll('-', '') !== latestTradingDate.replaceAll('-', ''));
  const sortedRows = useMemo(() => {
    if (!result) return [];
    return [...result.rows].sort((left, right) => {
      const leftValue = sort.key === 'changeSinceSignal' ? left.changeSinceSignal ?? Number.NEGATIVE_INFINITY : left.change;
      const rightValue = sort.key === 'changeSinceSignal' ? right.changeSinceSignal ?? Number.NEGATIVE_INFINITY : right.change;
      return sort.direction === 'desc' ? rightValue - leftValue : leftValue - rightValue;
    });
  }, [result, sort]);
  const toggleSort = (key: 'change' | 'changeSinceSignal') => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
  }));
  const sortButton = (key: 'change' | 'changeSinceSignal', label: string) => {
    const active = sort.key === key;
    return <button className={`table-sort-button${active ? ' active' : ''}`} type="button" onClick={() => toggleSort(key)}>{label}{!active ? <ArrowUpDown size={13} /> : sort.direction === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}</button>;
  };

  return <div className="strategy-intersection-view">
    <section className="view-heading strategy-heading">
      <div><span className="eyebrow">STRATEGY / INTERSECTION</span><h1>策略交集</h1><p>选择两个或更多选股策略，找出同一交易日被这些策略同时命中的股票。</p></div>
      <button className={`text-button intersection-run ${loading ? 'is-spinning' : ''}`} type="button" disabled={loading || selectedStrategies.size < 2 || !selectedDate} onClick={() => void runIntersection()}><GitMerge size={15} />计算交集</button>
    </section>

    <section className="panel intersection-controls" aria-label="策略交集筛选条件">
      <div className="intersection-control-heading">
        <div><span className="eyebrow">MULTI SELECT</span><h3>选择参与策略</h3></div>
        <span>已选择 {selectedStrategies.size} / {intersectionStrategyOptions.length}</span>
      </div>
      <div className="intersection-strategy-grid">
        {intersectionStrategyOptions.map((option) => <label key={option.id} className={selectedStrategies.has(option.id) ? 'selected' : ''}>
          <input type="checkbox" checked={selectedStrategies.has(option.id)} onChange={() => toggleStrategy(option.id)} />
          <span className="intersection-check" aria-hidden="true">{selectedStrategies.has(option.id) && <Check size={14} />}</span>
          <span><strong>{option.label}</strong><small>{option.detail}</small></span>
        </label>)}
      </div>
      <div className="intersection-date-row">
        <label>目标日期<input type="date" value={selectedDate} max={toInputDate(latestTradingDate ?? '') || undefined} disabled={loading} onChange={(event) => { setSelectedDate(event.target.value); setResult(null); setError(''); }} /></label>
        <span>周末或节假日自动使用上一个交易日</span>
      </div>
    </section>

    <section className="panel intersection-results-panel">
      <div className="panel-title-row">
        <div><span className="eyebrow">COMMON SIGNALS</span><h3>{result ? `${formatTradingDate(result.tradingDate)} 共同命中` : '交集结果'}</h3></div>
        {result && <span className="count-badge">{result.rows.length}</span>}
      </div>
      {result && <div className="intersection-summary">
        {result.counts.map((item) => <span key={item.id}><b>{item.label}</b><strong>{item.count}</strong>只</span>)}
        <span className="intersection-total"><b>最终交集</b><strong>{result.rows.length}</strong>只</span>
      </div>}
      {!loading && !error && !result && <div className="macd-state intersection-empty"><GitMerge size={22} />勾选至少两个策略后计算交集</div>}
      {loading && <div className="macd-state intersection-empty"><RefreshCw className="spin-icon" size={20} />正在读取所选策略在 {formatTradingDate(selectedDate)} 的筛选结果</div>}
      {!loading && error && <div className="macd-state intersection-empty error"><AlertTriangle size={19} />{error}</div>}
      {!loading && !error && result && result.rows.length === 0 && <div className="macd-state intersection-empty">所选策略在该交易日没有共同命中的股票</div>}
      {!loading && !error && result && result.rows.length > 0 && <div className="table-scroll"><table className={`intersection-table${historical ? ' is-history' : ''}`}>
        <thead><tr><th>序号</th><th>股票</th><th>{historical ? '当时价格' : '现价'}</th><th>{sortButton('change', historical ? '当日涨幅' : '涨跌幅')}</th>{historical && <><th>当前价格</th><th>{sortButton('changeSinceSignal', '至今涨幅')}</th></>}<th>共同命中策略</th></tr></thead>
        <tbody>{sortedRows.map((item, index) => <tr key={item.code}><td>{String(index + 1).padStart(2, '0')}</td><td><StockKlineCell name={item.name} code={item.code} /></td><td>{item.close.toFixed(2)}</td><td><Change value={item.change} /></td>{historical && <><td>{item.currentPrice === undefined ? '--' : item.currentPrice.toFixed(2)}</td><td>{item.changeSinceSignal === undefined ? '--' : <Change value={item.changeSinceSignal} />}</td></>}<td><div className="intersection-hit-list">{result.selected.map((id) => <span key={id}>{intersectionStrategyOptions.find((option) => option.id === id)?.label}</span>)}</div></td></tr>)}</tbody>
      </table></div>}
    </section>
    <div className="risk-note macd-risk-note"><CircleDollarSign size={18} /><p>交集只表示多个条件同时满足，不代表胜率会同比提升，也不构成买卖建议。</p></div>
  </div>;
}

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [strategyId, setStrategyId] = useState<StrategyId>('rotation');
  const [markets, setMarkets] = useState<RankedMarket[]>([]);
  const [marketMeta, setMarketMeta] = useState<RotationResponse | null>(null);
  const [selectedCode, setSelectedCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rotationPoolUpdating, setRotationPoolUpdating] = useState(false);
  const [rotationPoolCalculating, setRotationPoolCalculating] = useState(false);
  const [rotationPoolError, setRotationPoolError] = useState('');
  const [pendingRotationRemoval, setPendingRotationRemoval] = useState<PoolSymbol | null>(null);
  const [watchlist, setWatchlist] = useState(new Set(['512100', '518880', '513100']));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedStrategyGroups, setExpandedStrategyGroups] = useState<Set<StrategyGroupId>>(() => new Set(['index', 'stock']));
  const [query, setQuery] = useState('');
  const didLoad = useRef(false);

  const loadMarkets = useCallback(async (forceRefresh = true) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/strategy/rotation${forceRefresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const payload = await response.json() as RotationResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || `行情代理返回 HTTP ${response.status}`);
      if (!Array.isArray(payload.markets) || payload.markets.length < 2 || !payload.backtest?.annualReturns?.length) throw new Error('行情代理返回的数据不完整');
      setMarkets(payload.markets);
      setMarketMeta(payload);
      setSelectedCode((current) => payload.markets.some(item => item.code === current) ? current : payload.markets[0].code);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '真实行情加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const updateRotationPool = useCallback(async (action: 'add' | 'remove', item: Pick<RankedMarket, 'code' | 'name'> | EtfSearchResult) => {
    setRotationPoolUpdating(true);
    setRotationPoolError('');
    try {
      const response = await apiFetch(action === 'add' ? '/api/strategy/rotation/symbols' : `/api/strategy/rotation/symbols/${encodeURIComponent(item.code)}`, {
        method: action === 'add' ? 'POST' : 'DELETE',
        headers: action === 'add' ? { 'Content-Type': 'application/json' } : undefined,
        body: action === 'add' ? JSON.stringify({ code: item.code }) : undefined,
      });
      const payload = await response.json() as NonNullable<RotationResponse['poolDraft']> & { message?: string };
      if (!response.ok) throw new Error(payload.message || `${action === 'add' ? '加入' : '移除'} ETF 失败`);
      if (!Array.isArray(payload.symbols) || payload.symbols.length < 2) throw new Error('标的池变更已保存，但返回的数据不完整');
      setMarketMeta((current) => current ? { ...current, poolDraft: payload } : current);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : `${action === 'add' ? '加入' : '移除'} ETF 失败`;
      setRotationPoolError(message);
      throw reason;
    } finally {
      setRotationPoolUpdating(false);
    }
  }, []);

  const recalculateRotationPool = useCallback(async () => {
    setRotationPoolCalculating(true);
    setRotationPoolError('');
    try {
      const response = await apiFetch('/api/strategy/rotation/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload = await response.json() as RotationResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || '重新计算失败');
      if (!Array.isArray(payload.markets) || payload.markets.length < 2 || !payload.backtest?.annualReturns?.length || payload.poolDraft?.dirty) throw new Error('重新计算完成，但返回的数据不完整');
      setMarkets(payload.markets);
      setMarketMeta(payload);
      setSelectedCode((current) => payload.markets.some((market) => market.code === current) ? current : payload.markets[0].code);
    } catch (reason) {
      setRotationPoolError(reason instanceof Error ? reason.message : '重新计算失败');
    } finally {
      setRotationPoolCalculating(false);
    }
  }, []);

  const replaceRotationPool = useCallback(async (codes: string[]) => {
    setRotationPoolUpdating(true);
    setRotationPoolError('');
    try {
      const response = await apiFetch('/api/strategy/rotation/symbols', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      });
      const payload = await response.json() as NonNullable<RotationResponse['poolDraft']> & { message?: string };
      if (!response.ok) throw new Error(payload.message || '轮动标的池替换失败');
      if (!Array.isArray(payload.symbols) || payload.symbols.length < 2) throw new Error('标的池替换已保存，但返回的数据不完整');
      setMarketMeta((current) => current ? { ...current, poolDraft: payload } : current);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '轮动标的池替换失败';
      setRotationPoolError(message);
      throw reason;
    } finally {
      setRotationPoolUpdating(false);
    }
  }, []);

  const confirmRotationRemoval = useCallback(() => {
    if (!pendingRotationRemoval) return;
    const market = pendingRotationRemoval;
    setPendingRotationRemoval(null);
    void updateRotationPool('remove', market).catch(() => undefined);
  }, [pendingRotationRemoval, updateRotationPool]);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    void loadMarkets(false);
  }, [loadMarkets]);

  const selected = markets.find(market => market.code === selectedCode) ?? markets[0];
  const setSelected = (market: RankedMarket) => setSelectedCode(market.code);

  const searchResults = query.trim()
    ? markets.filter((market) => `${market.name}${market.code}`.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  const toggleWatch = (code: string) => {
    setWatchlist((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  const navigate = (next: View) => {
    setView(next);
    setSidebarOpen(false);
  };

  const openStrategy = (next: StrategyId) => {
    const group: StrategyGroupId = next === 'rotation' || next === 'asset-rotation' || next === 'dual-etf' ? 'index' : 'stock';
    setExpandedStrategyGroups((current) => current.has(group) ? current : new Set(current).add(group));
    setStrategyId(next);
    navigate('strategy');
  };

  const toggleStrategyGroup = (group: StrategyGroupId) => {
    setExpandedStrategyGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="打开菜单">
          {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <div className="brand-mark"><BarChart3 size={20} /></div>
        <div className="brand-name"><strong>轮动看盘台</strong><span>ROTATION DESK</span></div>
        <div className="market-status">
          <span className="live-dot" />
          <b className="date-stamp">{marketMeta ? formatTradingDate(marketMeta.lastTradingDate) : '正在获取行情'}</b>
          <span className="status-separator">·</span>
          <span>{marketMeta ? '收盘数据' : '连接中'}</span>
          {marketMeta && <b>15:00</b>}
        </div>
        <div className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索代码 / 名称" aria-label="搜索代码或名称" />
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((market) => (
                <button key={market.code} onClick={() => { setSelected(market); setView('dashboard'); setQuery(''); }}>
                  <span><strong>{market.name}</strong><small>{market.code}</small></span>
                  <Change value={market.change} />
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="data-badge live-data" title={marketMeta?.provider}>真实行情</span>
        <button
          className={`icon-button ${loading ? 'is-spinning' : ''}`}
          title="重新获取真实行情"
          aria-label="重新获取真实行情"
          disabled={loading}
          onClick={() => void loadMarkets(true)}
        >
          <RefreshCw size={17} />
        </button>
        <button className="icon-button" title="行情提醒" aria-label="行情提醒"><Bell size={17} /></button>
      </header>

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <nav className="primary-nav" aria-label="主要导航">
          <span className="nav-label">工作台</span>
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}>
                <Icon size={17} />{item.label}<ChevronRight size={14} />
              </button>
            );
          })}
        </nav>
        <div className="strategy-menu">
          <div className="strategy-menu-title"><span>策略菜单</span><Settings2 size={14} /></div>
          <section className="strategy-group">
            <button className="strategy-group-toggle" type="button" aria-expanded={expandedStrategyGroups.has('index')} aria-controls="index-strategy-menu" onClick={() => toggleStrategyGroup('index')}>
              <span><BarChart3 size={15} /><strong>指数策略</strong><small>3</small></span>
              <ChevronRight className={expandedStrategyGroups.has('index') ? 'is-open' : ''} size={15} />
            </button>
            <div id="index-strategy-menu" className="strategy-submenu" hidden={!expandedStrategyGroups.has('index')}>
              <button className={view === 'strategy' && strategyId === 'rotation' ? 'strategy-item active' : 'strategy-item'} onClick={() => openStrategy('rotation')}>
                <span className="strategy-icon"><Activity size={16} /></span>
                <span><strong>宽基动量轮动</strong><small>MA20 · 动态标的池</small></span>
                <span className="live-dot" />
              </button>
              <button className={view === 'strategy' && strategyId === 'asset-rotation' ? 'strategy-item active' : 'strategy-item'} onClick={() => openStrategy('asset-rotation')}>
                <span className="strategy-icon"><GitMerge size={16} /></span>
                <span><strong>全球大类资产轮动</strong><small>20日涨幅 · MA28 · 动态标的池</small></span>
                <span className="live-dot" />
              </button>
              <button className={view === 'strategy' && strategyId === 'dual-etf' ? 'strategy-item active' : 'strategy-item'} onClick={() => openStrategy('dual-etf')}>
                <span className="strategy-icon"><ArrowUpDown size={16} /></span>
                <span><strong>双 ETF 动量轮动</strong><small>20日涨幅 · MA20 · 每日轮动</small></span>
                <span className="live-dot" />
              </button>
            </div>
          </section>
          <section className="strategy-group">
            <button className="strategy-group-toggle" type="button" aria-expanded={expandedStrategyGroups.has('stock')} aria-controls="stock-strategy-menu" onClick={() => toggleStrategyGroup('stock')}>
              <span><TrendingUp size={15} /><strong>个股策略</strong><small>6</small></span>
              <ChevronRight className={expandedStrategyGroups.has('stock') ? 'is-open' : ''} size={15} />
            </button>
            <div id="stock-strategy-menu" className="strategy-submenu" hidden={!expandedStrategyGroups.has('stock')}>
              <button className={view === 'strategy' && strategyId === 'intersection' ? 'strategy-item active intersection-entry' : 'strategy-item intersection-entry'} onClick={() => openStrategy('intersection')}>
                <span className="strategy-icon"><GitMerge size={16} /></span>
                <span><strong>策略交集</strong><small>多选策略 · 共同命中</small></span>
                <ChevronRight size={14} />
              </button>
              <button className={view === 'strategy' && strategyId === 'macd' ? 'strategy-item active' : 'strategy-item'} onClick={() => openStrategy('macd')}>
                <span className="strategy-icon"><TrendingUp size={16} /></span>
                <span><strong>MACD 金叉共振</strong><small>10 / 20 / 7 · 全市场</small></span>
                <span className="live-dot" />
              </button>
              <button className={view === 'strategy' && strategyId === 'macd-pullback' ? 'strategy-item active' : 'strategy-item'} onClick={() => openStrategy('macd-pullback')}>
                <span className="strategy-icon"><Target size={16} /></span>
                <span><strong>MACD 零轴回踩</strong><small>5 / 34 / 5 · 右侧交易</small></span>
                <span className="live-dot" />
              </button>
              <button className={view === 'strategy' && strategyId === 'macd-kdj' ? 'strategy-item active' : 'strategy-item'} onClick={() => openStrategy('macd-kdj')}>
                <span className="strategy-icon"><BarChart3 size={16} /></span>
                <span><strong>MACD + KDJ 共振</strong><small>12 / 26 / 9 · 低位双金叉</small></span>
                <span className="live-dot" />
              </button>
              <button className={view === 'strategy' && strategyId === 'volume-signals' ? 'strategy-item active' : 'strategy-item'} onClick={() => openStrategy('volume-signals')}>
                <span className="strategy-icon"><Activity size={16} /></span>
                <span><strong>量价三信号</strong><small>MA25 · 量均 5 / 60</small></span>
                <span className="live-dot" />
              </button>
              <button className={view === 'strategy' && strategyId === 'bull-points' ? 'strategy-item active' : 'strategy-item'} onClick={() => openStrategy('bull-points')}>
                <span className="strategy-icon"><TrendingUp size={16} /></span>
                <span><strong>多空趋势多点</strong><small>HHV 21 / 6 · MA 34 / 6</small></span>
                <span className="live-dot" />
              </button>
            </div>
          </section>
        </div>
        <div className="sidebar-footer">
          <div className="avatar">R</div>
          <span><strong>研究账户</strong><small>真实行情模式</small></span>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="关闭菜单" />}

      <main className="content">
        {error && markets.length > 0 && (
          <div className="data-warning"><AlertTriangle size={17} /><span>刷新失败，继续显示上次成功数据：{error}</span></div>
        )}
        {view === 'strategy' && strategyId === 'rotation' && rotationPoolError && (
          <div className="data-warning"><AlertTriangle size={17} /><span>标的池更新失败，原数据保持不变：{rotationPoolError}</span><button type="button" className="icon-button" title="关闭提示" aria-label="关闭提示" onClick={() => setRotationPoolError('')}><X size={14} /></button></div>
        )}
        {loading && !selected && (
          <section className="data-state"><RefreshCw className="spin-icon" size={24} /><strong>正在获取真实行情</strong><span>代理服务正在读取标的池 ETF 的最新前复权日线并计算动量排名。</span></section>
        )}
        {!loading && error && !selected && (
          <section className="data-state error-state"><AlertTriangle size={26} /><strong>真实行情加载失败</strong><span>{error}</span><button className="text-button" onClick={() => void loadMarkets(true)}><RefreshCw size={15} />重新加载</button></section>
        )}
        {selected && view === 'dashboard' && <Dashboard markets={markets} selected={selected} setSelected={setSelected} watchlist={watchlist} toggleWatch={toggleWatch} />}
        {selected && view === 'screener' && <Screener markets={markets} selected={selected} setSelected={setSelected} watchlist={watchlist} toggleWatch={toggleWatch} />}
        {view === 'strategy' && strategyId === 'rotation' && selected && marketMeta?.yearPerformance && <StrategyCenter
          markets={markets}
          yearPerformance={marketMeta.yearPerformance}
          strategyBacktest={marketMeta.backtest}
          poolEditor={<AssetPoolEditor
            markets={marketMeta.poolDraft?.symbols ?? markets}
            updating={rotationPoolUpdating || rotationPoolCalculating}
            deferred
            statusText={rotationPoolCalculating ? '正在更新行情、回测与今年交易节点' : undefined}
            action={<button type="button" className={`pool-recalculate-button${rotationPoolCalculating ? ' is-calculating' : ''}`} disabled={!marketMeta.poolDraft?.dirty || rotationPoolUpdating || rotationPoolCalculating} title={marketMeta.poolDraft?.dirty ? '应用标的池变更并更新行情、回测与今年交易节点' : '当前没有待计算的变更'} onClick={() => void recalculateRotationPool()}><RefreshCw className={rotationPoolCalculating ? 'spin-icon' : undefined} size={14} />{rotationPoolCalculating ? '正在计算' : '重新计算'}</button>}
            onAdd={(item) => updateRotationPool('add', item)}
          />}
          poolSymbols={marketMeta.poolDraft?.symbols}
          poolUpdating={rotationPoolUpdating || rotationPoolCalculating}
          onRemoveMarket={setPendingRotationRemoval}
          onReplaceCombination={replaceRotationPool}
          refreshing={loading || rotationPoolUpdating || rotationPoolCalculating}
          onRefresh={() => void loadMarkets(true)}
        />}
        {view === 'strategy' && strategyId === 'asset-rotation' && <AssetRotationStrategy />}
        {view === 'strategy' && strategyId === 'dual-etf' && <DualEtfStrategy />}
        {view === 'strategy' && strategyId === 'macd' && <MacdConfluenceStrategy />}
        {view === 'strategy' && strategyId === 'macd-pullback' && <MacdPullbackStrategy />}
        {view === 'strategy' && strategyId === 'macd-kdj' && <MacdKdjStrategy />}
        {view === 'strategy' && strategyId === 'volume-signals' && <VolumeSignalStrategy />}
        {view === 'strategy' && strategyId === 'bull-points' && <BullPointStrategy />}
        {view === 'strategy' && strategyId === 'intersection' && <StrategyIntersection latestTradingDate={marketMeta?.lastTradingDate} />}
      </main>

      {pendingRotationRemoval && <PoolRemovalDialog market={pendingRotationRemoval} strategyName="宽基 20 日动量轮动" deferred onCancel={() => setPendingRotationRemoval(null)} onConfirm={confirmRotationRemoval} />}

      <nav className="mobile-nav" aria-label="移动端导航">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
        })}
      </nav>
    </div>
  );
}
