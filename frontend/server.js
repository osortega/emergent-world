import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Manual proxy to simulation server
app.use('/api', (req, res) => {
  const options = {
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api' + req.url,
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:3000' },
  };
  const proxy = http.request(options, proxyRes => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxy.on('error', () => res.status(502).json({error:'simulation server unavailable'}));
  req.pipe(proxy);
});

// No cache for HTML
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  next();
});

app.use(express.static(join(__dirname, 'public')));
app.listen(4000, () => console.log('Isometric viewer on http://localhost:4000'));
