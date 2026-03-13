// Express server for the Emergent World simulation
import express from 'express';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { runTick } from './src/tick-engine.js';

const app = express();
const PORT = 3000;
const WORLD_DIR = join(process.cwd(), 'world');

let autoTickInterval = null;
let nextTickTime = null;
const TICK_INTERVAL = 15 * 60 * 1000; // 15 minutes

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return null; }
}

// Serve static files
app.use(express.static('public'));

// API: Full world state
app.get('/api/state', (req, res) => {
  const clock = readJSON(join(WORLD_DIR, 'clock.json')) || { tick: 0 };

  const regions = {};
  const regDir = join(WORLD_DIR, 'regions');
  if (existsSync(regDir)) {
    for (const f of readdirSync(regDir)) {
      const r = readJSON(join(regDir, f));
      if (r) regions[r.id] = r;
    }
  }

  const citizens = [];
  const citDir = join(WORLD_DIR, 'citizens');
  if (existsSync(citDir)) {
    for (const f of readdirSync(citDir)) {
      const c = readJSON(join(citDir, f));
      if (c) citizens.push(c);
    }
  }

  res.json({ clock, regions, citizens });
});

// Alias
app.get('/api/world', (req, res, next) => {
  req.url = '/api/state';
  app.handle(req, res, next);
});

// API: All citizens
app.get('/api/citizens', (req, res) => {
  const citDir = join(WORLD_DIR, 'citizens');
  if (!existsSync(citDir)) return res.json([]);
  const citizens = readdirSync(citDir).map(f => readJSON(join(citDir, f))).filter(Boolean);
  res.json(citizens);
});

// API: History for specific tick
app.get('/api/history/:tick', (req, res) => {
  const path = join(WORLD_DIR, 'history', `tick-${req.params.tick}.json`);
  const data = readJSON(path);
  if (!data) return res.status(404).json({error:'not found'});
  res.json(data);
});

// API: All history
app.get('/api/history', (req, res) => {
  const histDir = join(WORLD_DIR, 'history');
  if (!existsSync(histDir)) return res.json([]);
  const files = readdirSync(histDir).sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)?.[0] || 0);
    const numB = parseInt(b.match(/\d+/)?.[0] || 0);
    return numA - numB;
  });
  const history = files.map(f => readJSON(join(histDir, f))).filter(Boolean);
  res.json(history);
});

// API: Single citizen
app.get('/api/citizen/:id', (req, res) => {
  const path = join(WORLD_DIR, 'citizens', `${req.params.id}.json`);
  const citizen = readJSON(path);
  if (!citizen) return res.status(404).json({ error: 'not found' });
  res.json(citizen);
});

// API: Thoughts (behind the scenes)
app.get('/api/thoughts', (req, res) => {
  const tick = req.query.tick;
  const thoughtsDir = join(WORLD_DIR, 'thoughts');
  if (!existsSync(thoughtsDir)) return res.json({});

  if (tick) {
    const data = readJSON(join(thoughtsDir, `tick-${tick}.json`));
    return res.json(data || {});
  }

  // Latest tick thoughts
  const files = readdirSync(thoughtsDir).sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)?.[0] || 0);
    const numB = parseInt(b.match(/\d+/)?.[0] || 0);
    return numB - numA;
  });
  if (files.length === 0) return res.json({});
  const latest = readJSON(join(thoughtsDir, files[0]));
  res.json(latest || {});
});

// API: Available thought ticks
app.get('/api/thoughts/ticks', (req, res) => {
  const thoughtsDir = join(WORLD_DIR, 'thoughts');
  if (!existsSync(thoughtsDir)) return res.json([]);
  const ticks = readdirSync(thoughtsDir)
    .map(f => parseInt(f.match(/\d+/)?.[0] || 0))
    .sort((a, b) => b - a);
  res.json(ticks);
});

// API: Manual tick
let tickRunning = false;
app.post('/api/tick', async (req, res) => {
  if (tickRunning) return res.status(409).json({ error: 'tick already running' });
  tickRunning = true;
  try {
    const result = await runTick();
    res.json(result);
  } catch (err) {
    console.error('Tick error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    tickRunning = false;
  }
});

// API: Start auto-ticking
app.post('/api/start', (req, res) => {
  if (autoTickInterval) return res.json({ status: 'already running' });
  nextTickTime = Date.now() + TICK_INTERVAL;
  autoTickInterval = setInterval(async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      await runTick();
    } catch (err) {
      console.error('Auto-tick error:', err);
    } finally {
      tickRunning = false;
      nextTickTime = Date.now() + TICK_INTERVAL;
    }
  }, TICK_INTERVAL);
  console.log('Auto-ticking started (every 15 min)');
  res.json({ status: 'started', interval_ms: TICK_INTERVAL });
});

// API: Stop auto-ticking
app.post('/api/stop', (req, res) => {
  if (autoTickInterval) {
    clearInterval(autoTickInterval);
    autoTickInterval = null;
    nextTickTime = null;
  }
  res.json({ status: 'stopped' });
});

// API: Status
app.get('/api/status', (req, res) => {
  const clock = readJSON(join(WORLD_DIR, 'clock.json')) || { tick: 0 };
  res.json({
    running: !!autoTickInterval,
    tick: clock.tick,
    season: clock.season,
    year: clock.year,
    tick_running: tickRunning,
    next_tick: nextTickTime ? new Date(nextTickTime).toISOString() : null,
    next_tick_in_seconds: nextTickTime ? Math.max(0, Math.round((nextTickTime - Date.now()) / 1000)) : null,
  });
});

app.listen(PORT, () => {
  console.log(`Emergent World server → http://localhost:${PORT}`);
  console.log(`  POST /api/tick     — run one tick`);
  console.log(`  POST /api/start    — start auto-ticking (15 min)`);
  console.log(`  GET  /api/state    — world state`);
  console.log(`  GET  /api/thoughts — latest LLM reasoning`);
});
