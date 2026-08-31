import Fastify from 'fastify';
import { getAssetRotationCombinations, getAssetRotationSnapshot, getBullPointSnapshot, getDualEtfSnapshot, getMacdConfluenceSnapshot, getMacdKdjSnapshot, getMacdPullbackSnapshot, getMarketHistory, getRotationCombinations, getRotationSnapshot, getVolumeSnapshot, listBullPointSnapshotDates, listMacdKdjSnapshotDates, listMacdPullbackSnapshotDates, listMacdSnapshotDates, listVolumeSnapshotDates, recalculateAssetCombinationPool, recalculateAssetRotationPool, recalculateRotationCombinationPool, recalculateRotationPool, replaceAssetRotationPool, replaceRotationPool, searchEtfs, updateAssetCombinationPool, updateAssetRotationPool, updateDualEtfPool, updateRotationCombinationPool, updateRotationPool, type AssetRotationCombinationDirection, type AssetRotationCombinationSort, type HistoryPeriod } from './market-service.js';
import { closeMysqlStore, initializeMysqlStore, mysqlStoreStats } from './mysql-store.js';

const app = Fastify({ logger: true });
type CombinationQuery = {
  sort?: AssetRotationCombinationSort;
  direction?: AssetRotationCombinationDirection;
  page?: string;
  pageSize?: string;
  size?: string;
  tenYearDrawdown?: string;
  fiveYearDrawdown?: string;
  currentYearDrawdown?: string;
};
const combinationFilters = (query: CombinationQuery) => ({
  size: Number(query.size),
  tenYearDrawdown: Number(query.tenYearDrawdown),
  fiveYearDrawdown: Number(query.fiveYearDrawdown),
  currentYearDrawdown: Number(query.currentYearDrawdown),
});
const allowedCorsOrigins = new Set([
  'https://wzzc-9.github.io',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:4174',
  'http://localhost:4173',
  ...String(process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
]);

app.addHook('onRequest', async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && allowedCorsOrigins.has(origin)) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    reply.header('Vary', 'Origin');
  }
  if (request.method === 'OPTIONS') return reply.code(204).send();
});

app.get('/', async () => ({ status: 'ok', service: 'rotation-market-desk-api' }));

app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString(), database: await mysqlStoreStats() }));

app.get<{ Querystring: { refresh?: string } }>('/api/strategy/rotation', async (request, reply) => {
  try {
    const snapshot = await getRotationSnapshot(request.query.refresh === '1');
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({
      error: 'UPSTREAM_MARKET_DATA_ERROR',
      message: error instanceof Error ? error.message : '行情服务暂时不可用',
    });
  }
});

app.get<{ Querystring: CombinationQuery }>('/api/strategy/rotation/combinations', async (request, reply) => {
  try {
    const sort = ['score', 'ten-year', 'five-year', 'current-year'].includes(request.query.sort ?? '') ? request.query.sort! : 'score';
    const direction = request.query.direction === 'asc' ? 'asc' : 'desc';
    const result = await getRotationCombinations(sort, direction, Number(request.query.page ?? 1), Number(request.query.pageSize ?? 25), combinationFilters(request.query));
    reply.header('Cache-Control', 'no-store');
    return result;
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: 'ROTATION_COMBINATIONS_ERROR', message: error instanceof Error ? error.message : '策略 1 全组合回测数据读取失败' });
  }
});

app.post<{ Body: { code?: string } }>('/api/strategy/rotation/combinations/symbols', async (request, reply) => {
  try {
    const draft = await updateRotationCombinationPool('add', request.body?.code ?? '');
    reply.header('Cache-Control', 'no-store');
    return draft;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'ETF 加入组合池失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ROTATION_COMBINATION_POOL_UPDATE_ERROR', message });
  }
});

app.delete<{ Params: { code: string } }>('/api/strategy/rotation/combinations/symbols/:code', async (request, reply) => {
  try {
    const draft = await updateRotationCombinationPool('remove', request.params.code);
    reply.header('Cache-Control', 'no-store');
    return draft;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'ETF 移出组合池失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ROTATION_COMBINATION_POOL_UPDATE_ERROR', message });
  }
});

app.post<{ Querystring: CombinationQuery }>('/api/strategy/rotation/combinations/recalculate', async (request, reply) => {
  try {
    await recalculateRotationCombinationPool();
    const sort = ['score', 'ten-year', 'five-year', 'current-year'].includes(request.query.sort ?? '') ? request.query.sort! : 'score';
    const direction = request.query.direction === 'asc' ? 'asc' : 'desc';
    const result = await getRotationCombinations(sort, direction, 1, Number(request.query.pageSize ?? 25), combinationFilters(request.query));
    reply.header('Cache-Control', 'no-store');
    return result;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : '策略 1 全组合收益排名重新计算失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ROTATION_COMBINATION_RECALCULATE_ERROR', message });
  }
});

app.get<{ Querystring: { refresh?: string } }>('/api/strategy/asset-rotation', async (request, reply) => {
  try {
    const snapshot = await getAssetRotationSnapshot(request.query.refresh === '1');
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({
      error: 'UPSTREAM_MARKET_DATA_ERROR',
      message: error instanceof Error ? error.message : '大类资产轮动行情暂时不可用',
    });
  }
});

app.get<{ Querystring: CombinationQuery }>('/api/strategy/asset-rotation/combinations', async (request, reply) => {
  try {
    const sort = ['score', 'ten-year', 'five-year', 'current-year'].includes(request.query.sort ?? '') ? request.query.sort! : 'score';
    const direction = request.query.direction === 'asc' ? 'asc' : 'desc';
    const result = await getAssetRotationCombinations(sort, direction, Number(request.query.page ?? 1), Number(request.query.pageSize ?? 25), combinationFilters(request.query));
    reply.header('Cache-Control', 'no-store');
    return result;
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({
      error: 'ASSET_COMBINATIONS_ERROR',
      message: error instanceof Error ? error.message : '策略 2 组合回测数据读取失败',
    });
  }
});

app.post<{ Body: { code?: string } }>('/api/strategy/asset-rotation/combinations/symbols', async (request, reply) => {
  try {
    const draft = await updateAssetCombinationPool('add', request.body?.code ?? '');
    reply.header('Cache-Control', 'no-store');
    return draft;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'ETF 加入组合池失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ASSET_COMBINATION_POOL_UPDATE_ERROR', message });
  }
});

app.delete<{ Params: { code: string } }>('/api/strategy/asset-rotation/combinations/symbols/:code', async (request, reply) => {
  try {
    const draft = await updateAssetCombinationPool('remove', request.params.code);
    reply.header('Cache-Control', 'no-store');
    return draft;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'ETF 移出组合池失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ASSET_COMBINATION_POOL_UPDATE_ERROR', message });
  }
});

app.post<{ Querystring: CombinationQuery }>('/api/strategy/asset-rotation/combinations/recalculate', async (request, reply) => {
  try {
    await recalculateAssetCombinationPool();
    const sort = ['score', 'ten-year', 'five-year', 'current-year'].includes(request.query.sort ?? '') ? request.query.sort! : 'score';
    const direction = request.query.direction === 'asc' ? 'asc' : 'desc';
    const result = await getAssetRotationCombinations(sort, direction, 1, Number(request.query.pageSize ?? 25), combinationFilters(request.query));
    reply.header('Cache-Control', 'no-store');
    return result;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : '全组合收益排名重新计算失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ASSET_COMBINATION_RECALCULATE_ERROR', message });
  }
});

app.get<{ Querystring: { refresh?: string } }>('/api/strategy/dual-etf', async (request, reply) => {
  try {
    const snapshot = await getDualEtfSnapshot(request.query.refresh === '1');
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({
      error: 'UPSTREAM_MARKET_DATA_ERROR',
      message: error instanceof Error ? error.message : '双 ETF 动量轮动行情暂时不可用',
    });
  }
});

app.get<{ Querystring: { q?: string } }>('/api/etfs/search', async (request, reply) => {
  try {
    const results = await searchEtfs(request.query.q ?? '');
    reply.header('Cache-Control', 'no-store');
    return { results };
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({ error: 'ETF_SEARCH_ERROR', message: error instanceof Error ? error.message : 'ETF 搜索暂时不可用' });
  }
});

app.post<{ Body: { code?: string } }>('/api/strategy/rotation/symbols', async (request, reply) => {
  try {
    const draft = await updateRotationPool('add', request.body?.code ?? '');
    reply.header('Cache-Control', 'no-store');
    return draft;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'ETF 加入失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ROTATION_POOL_UPDATE_ERROR', message });
  }
});

app.delete<{ Params: { code: string } }>('/api/strategy/rotation/symbols/:code', async (request, reply) => {
  try {
    const draft = await updateRotationPool('remove', request.params.code);
    reply.header('Cache-Control', 'no-store');
    return draft;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'ETF 移除失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ROTATION_POOL_UPDATE_ERROR', message });
  }
});

app.put<{ Body: { codes?: string[] } }>('/api/strategy/rotation/symbols', async (request, reply) => {
  try {
    const draft = await replaceRotationPool(Array.isArray(request.body?.codes) ? request.body.codes : []);
    reply.header('Cache-Control', 'no-store');
    return draft;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : '轮动标的池替换失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ROTATION_POOL_REPLACE_ERROR', message });
  }
});

app.post('/api/strategy/rotation/recalculate', async (request, reply) => {
  try {
    const snapshot = await recalculateRotationPool();
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : '策略 1 重新计算失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ROTATION_POOL_RECALCULATE_ERROR', message });
  }
});

app.post<{ Body: { code?: string } }>('/api/strategy/asset-rotation/symbols', async (request, reply) => {
  try {
    const snapshot = await updateAssetRotationPool('add', request.body?.code ?? '');
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'ETF 加入失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ASSET_POOL_UPDATE_ERROR', message });
  }
});

app.delete<{ Params: { code: string } }>('/api/strategy/asset-rotation/symbols/:code', async (request, reply) => {
  try {
    const snapshot = await updateAssetRotationPool('remove', request.params.code);
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'ETF 移除失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ASSET_POOL_UPDATE_ERROR', message });
  }
});

app.put<{ Body: { codes?: string[] } }>('/api/strategy/asset-rotation/symbols', async (request, reply) => {
  try {
    const draft = await replaceAssetRotationPool(Array.isArray(request.body?.codes) ? request.body.codes : []);
    reply.header('Cache-Control', 'no-store');
    return draft;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : '轮动标的池替换失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ASSET_POOL_REPLACE_ERROR', message });
  }
});

app.post('/api/strategy/asset-rotation/recalculate', async (request, reply) => {
  try {
    const snapshot = await recalculateAssetRotationPool();
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : '策略 2 重新计算失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'ASSET_POOL_RECALCULATE_ERROR', message });
  }
});

app.post<{ Body: { code?: string } }>('/api/strategy/dual-etf/symbols', async (request, reply) => {
  try {
    const snapshot = await updateDualEtfPool('add', request.body?.code ?? '');
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'ETF 加入失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'DUAL_ETF_POOL_UPDATE_ERROR', message });
  }
});

app.delete<{ Params: { code: string } }>('/api/strategy/dual-etf/symbols/:code', async (request, reply) => {
  try {
    const snapshot = await updateDualEtfPool('remove', request.params.code);
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'ETF 移除失败';
    return reply.code(message.includes('正在更新') ? 409 : 400).send({ error: 'DUAL_ETF_POOL_UPDATE_ERROR', message });
  }
});

app.get<{ Querystring: { refresh?: string; date?: string } }>('/api/strategy/macd-confluence', async (request, reply) => {
  try {
    const snapshot = await getMacdConfluenceSnapshot(request.query.refresh === '1', request.query.date);
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'MACD 行情扫描暂时不可用';
    return reply.code(message.startsWith('本地快照不存在') ? 404 : 502).send({
      error: 'UPSTREAM_MARKET_DATA_ERROR',
      message,
    });
  }
});

app.get('/api/strategy/macd-confluence/dates', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return { dates: listMacdSnapshotDates() };
});

app.get<{ Querystring: { refresh?: string; date?: string } }>('/api/strategy/macd-pullback', async (request, reply) => {
  try {
    const snapshot = await getMacdPullbackSnapshot(request.query.refresh === '1', request.query.date);
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'MACD 零轴回踩扫描暂时不可用';
    return reply.code(message.startsWith('本地快照不存在') ? 404 : 502).send({
      error: 'UPSTREAM_MARKET_DATA_ERROR',
      message,
    });
  }
});

app.get('/api/strategy/macd-pullback/dates', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return { dates: listMacdPullbackSnapshotDates() };
});

app.get<{ Querystring: { refresh?: string; date?: string } }>('/api/strategy/macd-kdj', async (request, reply) => {
  try {
    const snapshot = await getMacdKdjSnapshot(request.query.refresh === '1', request.query.date);
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'MACD + KDJ 共振扫描暂时不可用';
    return reply.code(message.startsWith('本地快照不存在') ? 404 : 502).send({
      error: 'UPSTREAM_MARKET_DATA_ERROR',
      message,
    });
  }
});

app.get('/api/strategy/macd-kdj/dates', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return { dates: listMacdKdjSnapshotDates() };
});

app.get<{ Querystring: { refresh?: string; date?: string } }>('/api/strategy/volume-signals', async (request, reply) => {
  try {
    const snapshot = await getVolumeSnapshot(request.query.refresh === '1', request.query.date);
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({
      error: 'UPSTREAM_MARKET_DATA_ERROR',
      message: error instanceof Error ? error.message : '量能三信号扫描暂时不可用',
    });
  }
});

app.get('/api/strategy/volume-signals/dates', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return { dates: listVolumeSnapshotDates() };
});

app.get<{ Querystring: { refresh?: string; date?: string } }>('/api/strategy/bull-points', async (request, reply) => {
  try {
    const snapshot = await getBullPointSnapshot(request.query.refresh === '1', request.query.date);
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({
      error: 'UPSTREAM_MARKET_DATA_ERROR',
      message: error instanceof Error ? error.message : '多空趋势多点扫描暂时不可用',
    });
  }
});

app.get('/api/strategy/bull-points/dates', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return { dates: listBullPointSnapshotDates() };
});

app.get<{ Params: { code: string }; Querystring: { period?: HistoryPeriod; refresh?: string } }>('/api/market/:code/history', async (request, reply) => {
  const period = request.query.period ?? 'day';
  if (!['minute', 'day', 'week', 'month'].includes(period)) {
    return reply.code(400).send({ error: 'INVALID_PERIOD', message: '周期必须是 minute、day、week 或 month' });
  }
  try {
    const history = await getMarketHistory(request.params.code, period, request.query.refresh === '1');
    reply.header('Cache-Control', 'no-store');
    return history;
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({
      error: 'UPSTREAM_MARKET_DATA_ERROR',
      message: error instanceof Error ? error.message : '历史行情服务暂时不可用',
    });
  }
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const databaseEnabled = await initializeMysqlStore();
app.log.info({ databaseEnabled }, databaseEnabled ? 'MySQL persistence enabled' : 'MySQL persistence disabled; using JSON fallback');
app.addHook('onClose', async () => closeMysqlStore());
await app.listen({ port, host });
