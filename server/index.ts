import Fastify from 'fastify';
import { getBullPointSnapshot, getMacdConfluenceSnapshot, getMacdKdjSnapshot, getMacdPullbackSnapshot, getMarketHistory, getRotationSnapshot, getVolumeSnapshot, listBullPointSnapshotDates, listMacdKdjSnapshotDates, listMacdPullbackSnapshotDates, listMacdSnapshotDates, listVolumeSnapshotDates, type HistoryPeriod } from './market-service.js';

const app = Fastify({ logger: true });

app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

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
await app.listen({ port, host: '127.0.0.1' });
