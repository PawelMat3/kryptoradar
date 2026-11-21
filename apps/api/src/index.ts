import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { config } from './config.js';
import { migrate } from './db/pool.js';
import { routes } from './routes.js';
import { recoverInterrupted, startScheduler } from './pipeline/run.js';

const app = Fastify({ logger: { level: 'info' }, bodyLimit: 1024 * 1024 });

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  if (err instanceof ZodError) return reply.code(400).send({ error: 'Niepoprawne dane wejściowe', issues: err.issues });
  app.log.error(err);
  return reply.code(err.statusCode ?? 500).send({ error: err.message });
});

await app.register(cors, { origin: process.env.CORS_ORIGIN?.split(',') ?? false });
await app.register(routes);

await migrate();
await recoverInterrupted();
startScheduler();
await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`Krypto Radar API ${config.version}, live: ${config.liveEnabled}`);
