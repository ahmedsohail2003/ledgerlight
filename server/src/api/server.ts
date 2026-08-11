import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getPool, getRoPool } from '../db/pool.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8080);
const app = createApp({ pool: getPool(), roPool: getRoPool() });

// Serve the built SPA when web/dist exists (single-URL demo). API routes are
// registered first, so this only catches non-API GETs.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/auth') && req.accepts('html')) {
      return res.sendFile(path.join(webDist, 'index.html'));
    }
    return next();
  });
  console.log(`serving web UI from ${webDist}`);
}

app.listen(port, () => {
  console.log(`ledgerlight api listening on :${port}`);
});
