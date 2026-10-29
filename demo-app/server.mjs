#!/usr/bin/env node
// Brightdesk: a tiny helpdesk app to try the kit on. No dependencies.
//   node demo-app/server.mjs            # http://127.0.0.1:4173  (PORT=... to change)
// Sign in as demo@brightdesk.test / demo1234. Data lives in memory;
// POST /api/reset puts the seed back (the video project rewinds with it).
// LATENCY_MS=800 slows every write down, like a real server.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const LATENCY = Number(process.env.LATENCY_MS || 0);
const USERS = { 'demo@brightdesk.test': { name: 'Sam Rivera', password: 'demo1234' } };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.csv': 'text/csv' };

const day = 86400000;
function seed() {
  const now = Date.now();
  return {
    settings: { team: 'Brightdesk', accent: 'blue' },
    nextId: 106,
    requests: [
      { id: 101, title: 'Invoice shows the wrong VAT rate', category: 'Billing', priority: 'High', status: 'Open', created: now - 2 * day, description: 'October invoice charges 20% instead of 5%.' },
      { id: 102, title: 'Cannot reset my password', category: 'Account', priority: 'Normal', status: 'Open', created: now - 1.5 * day, description: 'The reset email never arrives.' },
      { id: 103, title: 'Export to Excel times out', category: 'Technical', priority: 'Normal', status: 'Resolved', created: now - 5 * day, description: 'Exports over 10,000 rows fail after a minute.' },
      { id: 104, title: 'Add a second admin to our team', category: 'Account', priority: 'Low', status: 'Resolved', created: now - 7 * day, description: '' },
      { id: 105, title: 'Dashboard numbers look stale', category: 'Technical', priority: 'High', status: 'Open', created: now - 0.2 * day, description: 'Counts have not changed since this morning.' },
    ],
  };
}

let db = seed();
const sessions = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function user(req) {
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  return sid ? sessions.get(sid) : null;
}

const clean = (r) => ({
  title: String(r.title || '').trim(),
  category: ['Billing', 'Technical', 'Account', 'Other'].includes(r.category) ? r.category : 'Other',
  priority: ['Low', 'Normal', 'High'].includes(r.priority) ? r.priority : 'Normal',
  description: String(r.description || '').trim(),
});

async function api(req, res, path) {
  const m = req.method;
  if (m !== 'GET' && LATENCY) await sleep(LATENCY);
  if (path === '/api/reset' && m === 'POST') { db = seed(); sessions.clear(); return send(res, 200, { ok: true }); }
  if (path === '/api/health') return send(res, 200, { ok: true });
  if (path === '/api/login' && m === 'POST') {
    const { email, password } = await readJson(req);
    const u = USERS[String(email || '').toLowerCase()];
    if (!u || u.password !== password) return send(res, 401, { error: 'That email and password don’t match.' });
    const sid = randomBytes(16).toString('hex');
    sessions.set(sid, { email: email.toLowerCase(), name: u.name });
    return send(res, 200, { email, name: u.name }, { 'set-cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
  }
  if (path === '/api/settings' && m === 'GET') return send(res, 200, db.settings); // the sign-in page shows the team name
  const me = user(req);
  if (!me) return send(res, 401, { error: 'Sign in first.' });
  if (path === '/api/me') return send(res, 200, me);
  if (path === '/api/logout' && m === 'POST') return send(res, 200, {}, { 'set-cookie': 'sid=; Path=/; Max-Age=0' });
  if (path === '/api/settings' && m === 'PUT') {
    const { team, accent } = await readJson(req);
    if (!String(team || '').trim()) return send(res, 400, { error: 'Give your team a name.' });
    db.settings = { team: String(team).trim(), accent: ['blue', 'green', 'purple', 'orange'].includes(accent) ? accent : 'blue' };
    return send(res, 200, db.settings);
  }
  if (path === '/api/requests' && m === 'GET') return send(res, 200, [...db.requests].sort((a, b) => b.created - a.created));
  if (path === '/api/requests' && m === 'POST') {
    const r = clean(await readJson(req));
    if (!r.title) return send(res, 400, { error: 'A request needs a title.' });
    const row = { id: db.nextId++, ...r, status: 'Open', created: Date.now() };
    db.requests.push(row);
    return send(res, 201, row);
  }
  if (path === '/api/requests/import' && m === 'POST') {
    const { rows = [] } = await readJson(req);
    const ok = rows.map(clean).filter((r) => r.title);
    for (const r of ok) db.requests.push({ id: db.nextId++, ...r, status: 'Open', created: Date.now() });
    return send(res, 200, { created: ok.length });
  }
  const one = /^\/api\/requests\/(\d+)(\/resolve)?$/.exec(path);
  if (one) {
    const row = db.requests.find((r) => r.id === Number(one[1]));
    if (!row) return send(res, 404, { error: 'No such request.' });
    if (one[2] && m === 'POST') { row.status = 'Resolved'; return send(res, 200, row); }
    if (!one[2] && m === 'GET') return send(res, 200, row);
  }
  return send(res, 404, { error: 'Not found.' });
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (path.startsWith('/api/')) return await api(req, res, path);
    // Files from public/; any other path is the app (it routes in the browser).
    const file = normalize(join(PUBLIC, path));
    const target = file.startsWith(PUBLIC) && extname(file) ? file : join(PUBLIC, 'index.html');
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': TYPES[extname(target)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT') { res.writeHead(404); res.end('Not found'); return; }
    send(res, 500, { error: err.message });
  }
}).listen(PORT, HOST, () => console.log(`Brightdesk on http://${HOST}:${PORT}  (sign in: demo@brightdesk.test / demo1234)`));
