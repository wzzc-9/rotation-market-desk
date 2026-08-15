import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Bookmark,
  Check,
  ChevronRight,
  CircleDollarSign,
  Filter,
  LayoutDashboard,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import type { EChartsCoreOption } from 'echarts/core';
import EChart from './EChart';
import { annualReturns, backtestSummary } from './backtest';
import { formatPct, formatVolume, movingAverage, type RankedMarket, type RotationResponse } from './market';

type View = 'dashboard' | 'screener' | 'strategy';
type Category = '全部' | RankedMarket['category'];

const menuItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: '行情总览', icon: LayoutDashboard },
  { id: 'screener', label: '条件选股', icon: SlidersHorizontal },
  { id: 'strategy', label: '策略中心', icon: Target },
];

const annualReturnsDesc = [...annualReturns].reverse();

function formatTradingDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[1]}年${match[2]}月${match[3]}日` : value;
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

function AnnualReturnChart() {
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
      data: annualReturnsDesc.map((item) => String(item.year)),
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
      data: annualReturnsDesc.map((item) => ({
        value: item.returnRate,
        itemStyle: { color: item.returnRate >= 0 ? '#d94e4e' : '#168a64', borderRadius: 1 },
      })),
    }],
  }), []);
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

function StrategyCenter({ markets }: { markets: RankedMarket[] }) {
  const leader = markets[0];
  const second = markets[1];
  const rules = [
    { title: '计算动量', copy: '每日收盘后计算：收盘价 ÷ 20日均线 - 1。', icon: Activity },
    { title: '执行买入', copy: '收盘价有效站上 MA20，且动量在 8 个标的中排名第 1。', icon: TrendingUp },
    { title: '持续持有', copy: '持仓标的保持在 MA20 上方，同时维持动量排名第 1。', icon: Check },
    { title: '立即卖出', copy: '跌破 MA20，或动量排名滑落至第 2 名及以下，任一触发即清仓。', icon: TrendingDown },
  ];
  return (
    <div className="workspace-view strategy-view">
      <section className="view-heading strategy-heading">
        <div>
          <span className="eyebrow">STRATEGY / ACTIVE</span>
          <h1>宽基 20 日动量轮动</h1>
          <p>八类宽基与跨市场 ETF 每日单标的轮动，弱市允许空仓。</p>
        </div>
        <div className="strategy-state"><span className="live-dot" />策略运行中</div>
      </section>

      <section className="strategy-hero">
        <div className="signal-block">
          <span>当前指令</span>
          <strong>{leader.aboveMa ? `持有 ${leader.name}` : '空仓等待'}</strong>
          <p>{leader.aboveMa ? `${leader.code} · 策略仓位 100%` : '当前无有效买入信号'}</p>
        </div>
        <div className="signal-stat">
          <span>领先动量</span>
          <strong className="up">{formatPct(leader.momentum)}</strong>
          <small>高于第二名 {(leader.momentum - second.momentum).toFixed(2)} pct</small>
        </div>
        <div className="signal-stat">
          <span>止盈条件</span>
          <strong>{leader.ma20.toFixed(3)}</strong>
          <small>收盘跌破 MA20 清仓</small>
        </div>
        <div className="signal-stat">
          <span>下次检查</span>
          <strong>15:00</strong>
          <small>下一个交易日收盘</small>
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

        <aside className="panel universe-panel">
          <div className="panel-title-row">
            <div><span className="eyebrow">ASSET UNIVERSE</span><h3>轮动标的池</h3></div>
            <span className="count-badge">8</span>
          </div>
          <div className="universe-list">
            {markets.map((market) => (
              <div className="universe-row" key={market.code}>
                <RankBadge rank={market.rank} />
                <span><strong>{market.name}</strong><small>{market.code}</small></span>
                <Change value={market.momentum} />
              </div>
            ))}
          </div>
        </aside>

        <section className="panel performance-panel">
          <div className="panel-title-row">
            <div><span className="eyebrow">2016—2025 BACKTEST</span><h3>近 10 年年度收益</h3></div>
            <span className="source-note">前复权日线 · 收盘信号 · 未计费用</span>
          </div>
          <div className="backtest-summary">
            <div><span>累计收益</span><strong className="up">+{backtestSummary.cumulativeReturn.toFixed(2)}%</strong></div>
            <div><span>年化收益</span><strong>+{backtestSummary.annualizedReturn.toFixed(2)}%</strong></div>
            <div><span>正收益年份</span><strong>{backtestSummary.positiveYears} / 10</strong></div>
            <div><span>年度最大回撤</span><strong className="down">{backtestSummary.worstDrawdown.toFixed(2)}%</strong></div>
          </div>
          <div className="performance-content">
            <AnnualReturnChart />
            <div className="performance-table-wrap">
              <table className="performance-table">
                <thead><tr><th>年份</th><th>收益率</th><th>最大回撤</th><th>交易次数</th><th>可用标的</th><th>年末持仓</th></tr></thead>
                <tbody>
                  {annualReturnsDesc.map((item) => (
                    <tr key={item.year}>
                      <td>{item.year}</td>
                      <td><Change value={item.returnRate} /></td>
                      <td className="down">{item.maxDrawdown.toFixed(2)}%</td>
                      <td>{item.trades}</td>
                      <td>{item.availableAssets} / 8</td>
                      <td>{item.yearEndHolding}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="method-note">
            数据源：腾讯证券公开前复权日线。ETF 上市满 20 个交易日后才进入排名；T 日收盘计算信号，持有 T+1 日收益。结果未计手续费、滑点与冲击成本。
          </div>
        </section>

        <section className="panel notes-panel">
          <div className="panel-title-row"><div><span className="eyebrow">RISK CONTROL</span><h3>执行约束</h3></div></div>
          <div className="constraint-grid">
            <div><span>调仓频率</span><strong>每日</strong><small>仅使用收盘数据</small></div>
            <div><span>最大持仓</span><strong>1 只</strong><small>等权满仓持有</small></div>
            <div><span>空仓机制</span><strong>启用</strong><small>无标的满足条件</small></div>
            <div><span>信号确认</span><strong>T 日收盘</strong><small>下一交易时点执行</small></div>
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

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [markets, setMarkets] = useState<RankedMarket[]>([]);
  const [marketMeta, setMarketMeta] = useState<RotationResponse | null>(null);
  const [selectedCode, setSelectedCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [watchlist, setWatchlist] = useState(new Set(['512100', '518880', '513100']));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState('');
  const didLoad = useRef(false);

  const loadMarkets = useCallback(async (forceRefresh = true) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/strategy/rotation${forceRefresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const payload = await response.json() as RotationResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || `行情代理返回 HTTP ${response.status}`);
      if (!Array.isArray(payload.markets) || payload.markets.length !== 8) throw new Error('行情代理返回的数据不完整');
      setMarkets(payload.markets);
      setMarketMeta(payload);
      setSelectedCode((current) => payload.markets.some(item => item.code === current) ? current : payload.markets[0].code);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '真实行情加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    void loadMarkets(true);
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
          <button className={view === 'strategy' ? 'strategy-item active' : 'strategy-item'} onClick={() => navigate('strategy')}>
            <span className="strategy-icon"><Activity size={16} /></span>
            <span><strong>宽基动量轮动</strong><small>MA20 · 8标的</small></span>
            <span className="live-dot" />
          </button>
          <button className="strategy-item muted" disabled>
            <span className="strategy-icon"><Bookmark size={16} /></span>
            <span><strong>新建策略</strong><small>即将开放</small></span>
          </button>
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
        {loading && !selected && (
          <section className="data-state"><RefreshCw className="spin-icon" size={24} /><strong>正在获取真实行情</strong><span>代理服务正在读取 8 个 ETF 的最新前复权日线并计算动量排名。</span></section>
        )}
        {!loading && error && !selected && (
          <section className="data-state error-state"><AlertTriangle size={26} /><strong>真实行情加载失败</strong><span>{error}</span><button className="text-button" onClick={() => void loadMarkets(true)}><RefreshCw size={15} />重新加载</button></section>
        )}
        {selected && view === 'dashboard' && <Dashboard markets={markets} selected={selected} setSelected={setSelected} watchlist={watchlist} toggleWatch={toggleWatch} />}
        {selected && view === 'screener' && <Screener markets={markets} selected={selected} setSelected={setSelected} watchlist={watchlist} toggleWatch={toggleWatch} />}
        {selected && view === 'strategy' && <StrategyCenter markets={markets} />}
      </main>

      <nav className="mobile-nav" aria-label="移动端导航">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
        })}
      </nav>
    </div>
  );
}
