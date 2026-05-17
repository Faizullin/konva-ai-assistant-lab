import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { apiRoutes } from './api/routes';
import { env } from './env';

const app = new Hono();

app.use('*', cors({ origin: ['http://localhost:5173', 'http://localhost:3000'] }));
app.use('*', logger());

app.get('/health', (c) => c.json({ ok: true }));
app.route('/api', apiRoutes);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[server] http://localhost:${info.port}`);
});
