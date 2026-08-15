import Fastify from 'fastify';
import { getRotationSnapshot } from './market-service.js';

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

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '127.0.0.1' });
