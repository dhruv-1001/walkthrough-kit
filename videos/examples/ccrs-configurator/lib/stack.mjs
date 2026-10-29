// The local DIGIT stack (docker compose project "digit"), as the video run
// needs it: a baseline the run can rewind to, so every pass signs up the SAME
// workspace (slug, codes, emails) on a clean slate. localStack() at the bottom
// is what project.mjs hands the recorder.
//
// Rewind = Postgres template databases (egov is ~40 MB, keycloak ~15 MB, so a
// copy takes about a second) + an empty Redis + restarted app containers (they
// cache tenants, keys and sessions in memory). Infra containers keep running.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DATABASES = [
  { container: 'docker-postgres', user: 'egov', db: 'egov' },
  { container: 'keycloak-postgres', user: 'keycloak', db: 'keycloak' },
];
const SNAPSHOT_SUFFIX = '_video_baseline';

// Containers that hold state or watch the stack: left running across a rewind.
const KEEP_RUNNING = new Set([
  'docker-postgres', 'keycloak-postgres', 'digit-redis', 'digit-minio', 'digit-pgbouncer',
  'digit-mcp-postgres', 'openbao', 'digit-openbao', 'mailpit', 'redpanda', 'digit-redpanda',
  'digit-prometheus', 'digit-grafana', 'digit-loki', 'digit-tempo', 'digit-promtail', 'digit-otel-collector',
  'digit-gatus', 'digit-node-exporter', 'digit-postgres-exporter', 'digit-docker-socket-proxy', 'digit-cadvisor',
]);

// Start order after a rewind. Several services read MDMS, the enc-service or
// egov-user once at startup and exit (or sit unhealthy) if they aren't up yet,
// and none of them has a restart policy. Started all at once, enc-service and
// workflow die on MDMS, egov-user goes unhealthy on enc-service, and HRMS dies
// on egov-user. Anything not matched goes in the last wave.
const WAVES = [
  /mdms|accesscontrol|localization|idgen|filestore|persister|keycloak|boundary|bndry|url-shortening|audit/,
  /enc-service|workflow-v2/,
  /egov-user|user-proxy|workflow-proxy/,
  /./,
];

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function psql({ container, user }, sql, db = 'postgres') {
  return sh('docker', ['exec', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', db, '-Atc', sql]);
}

export function hasSnapshot() {
  return DATABASES.every((d) => psql(d, `select count(*) from pg_database where datname='${d.db}${SNAPSHOT_SUFFIX}'`) === '1');
}

/** Copy each database to <db>_video_baseline. Briefly disconnects the services. */
export function snapshot({ force = false } = {}) {
  for (const d of DATABASES) {
    const snap = `${d.db}${SNAPSHOT_SUFFIX}`;
    const exists = psql(d, `select count(*) from pg_database where datname='${snap}'`) === '1';
    if (exists && !force) continue;
    if (exists) {
      psql(d, `alter database ${snap} with allow_connections true`);
      psql(d, `drop database ${snap} with (force)`); // DROP DATABASE can't share a command with anything
    }
    psql(d, `alter database ${d.db} with allow_connections false`);
    try {
      psql(d, `select pg_terminate_backend(pid) from pg_stat_activity where datname='${d.db}' and pid<>pg_backend_pid()`);
      psql(d, `create database ${snap} template ${d.db}`);
      psql(d, `alter database ${snap} with allow_connections false`);
    } finally {
      psql(d, `alter database ${d.db} with allow_connections true`);
    }
    console.log(`  snapshot ${d.container}:${d.db} -> ${snap}`);
  }
}

// What stop() stopped, so a later run can bring exactly that back.
const STOPPED = new URL('../out/.stack-stopped.json', import.meta.url);
let configuratorUrl = 'http://localhost/configurator/';

export function lastStopped() {
  return existsSync(STOPPED) ? JSON.parse(readFileSync(STOPPED, 'utf8')) : null;
}

// Not part of the compose project, but the Geography step needs it.
const EXTRA = ['turbopass-search'];

function appContainers() {
  return sh('docker', ['ps', '-a', '--filter', 'label=com.docker.compose.project=digit', '--format', '{{.Names}}'])
    .split('\n').filter(Boolean).filter((n) => !KEEP_RUNNING.has(n));
}

function runningNames() {
  return new Set(sh('docker', ['ps', '--format', '{{.Names}}']).split('\n').filter(Boolean));
}

export function isUp() {
  return runningNames().has('docker-postgres');
}

/**
 * Stop the whole stack (to free memory for the voice model). Returns the
 * containers that were running, which start() brings back.
 */
export function stop() {
  const running = runningNames();
  const ours = [
    ...sh('docker', ['ps', '--filter', 'label=com.docker.compose.project=digit', '--format', '{{.Names}}']).split('\n').filter(Boolean),
    ...EXTRA.filter((n) => running.has(n)),
  ];
  const apps = ours.filter((n) => !KEEP_RUNNING.has(n));
  const infra = ours.filter((n) => KEEP_RUNNING.has(n));
  console.log(`  stopping the stack (${ours.length} containers) to free memory`);
  if (apps.length) sh('docker', ['stop', '-t', '20', ...apps], { timeout: 300000 });
  if (infra.length) sh('docker', ['stop', '-t', '20', ...infra], { timeout: 300000 });
  mkdirSync(new URL('.', STOPPED), { recursive: true });
  writeFileSync(STOPPED, JSON.stringify(ours));
  return ours;
}

/** Start what stop() stopped: databases and infra first, then (unless `appsLater`) the apps in waves. */
export async function start(names, { appsLater = false } = {}) {
  const infra = names.filter((n) => KEEP_RUNNING.has(n));
  if (infra.length) {
    sh('docker', ['start', ...infra], { timeout: 300000 });
    await waitHealthy(infra);
    console.log(`  infra: ${infra.length} up`);
  }
  if (!appsLater) await startInWaves(names.filter((n) => !KEEP_RUNNING.has(n)));
}

async function startInWaves(names) {
  let remaining = names;
  for (const [i, pattern] of WAVES.entries()) {
    const wave = remaining.filter((n) => pattern.test(n));
    remaining = remaining.filter((n) => !wave.includes(n));
    if (!wave.length) continue;
    sh('docker', ['start', ...wave], { timeout: 300000 });
    await waitHealthy(wave);
    console.log(`  wave ${i + 1}: ${wave.length} healthy`);
  }
  // Kong can keep a restarted upstream's old address for a moment.
  await waitHttp(configuratorUrl, 200, 120000);
  await sleep(10000);
  console.log('  stack healthy');
}

/**
 * Rewind every database to its snapshot, empty Redis, restart the app
 * containers. `apps` = the app containers to start (default: the running ones;
 * after stop() + start(..., { appsLater: true }) pass the stopped list).
 */
export async function restore({ apps } = {}) {
  if (!hasSnapshot()) throw new Error('No baseline snapshot. Run: node record.mjs --project examples/ccrs-configurator --snapshot (on a stack nobody has signed up on yet).');
  const running = runningNames();
  const toStart = apps ? apps.filter((n) => !KEEP_RUNNING.has(n)) : appContainers().filter((n) => running.has(n));
  const toStop = toStart.filter((n) => running.has(n));
  console.log(`  stopping ${toStop.length} app containers`);
  if (toStop.length) sh('docker', ['stop', '-t', '20', ...toStop], { timeout: 180000 });
  for (const d of DATABASES) {
    const snap = `${d.db}${SNAPSHOT_SUFFIX}`;
    psql(d, `drop database if exists ${d.db} with (force)`);
    psql(d, `create database ${d.db} owner ${d.user} template ${snap}`);
    console.log(`  restored ${d.container}:${d.db}`);
  }
  sh('docker', ['exec', 'digit-redis', 'redis-cli', 'FLUSHALL']);
  console.log('  redis flushed; starting app containers in waves');
  await startInWaves(toStart);
}

/**
 * Wait until every container is running and healthy (or has no healthcheck).
 * One that exits, or stays unhealthy for 45s, is restarted, at most 4 times:
 * the startup races above heal once their dependency is up.
 */
export async function waitHealthy(names, { timeoutMs = 600000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const restarts = Object.fromEntries(names.map((n) => [n, 0]));
  const unhealthySince = {};
  let pending = names;
  while (Date.now() < deadline) {
    const rows = sh('docker', ['inspect', '--format', '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', ...names])
      .split('\n').map((l) => l.trim().replace(/^\//, '').split(' '));
    pending = [];
    for (const [name, status, health] of rows) {
      if (status === 'running' && (health === 'healthy' || health === 'none')) { delete unhealthySince[name]; continue; }
      pending.push(`${name}(${status}/${health})`);
      const stuck = status === 'running' && health === 'unhealthy' && Date.now() - (unhealthySince[name] ??= Date.now()) > 45000;
      if ((status === 'exited' || stuck) && restarts[name] < 4) {
        restarts[name]++;
        delete unhealthySince[name];
        console.log(`  ${status === 'exited' ? 'starting' : 'restarting'} ${name} again (${restarts[name]})`);
        sh('docker', [status === 'exited' ? 'start' : 'restart', name], { timeout: 120000 });
      }
    }
    if (!pending.length) return;
    await sleep(5000);
  }
  throw new Error(`containers not healthy after restore: ${pending.join(', ')}`);
}

export async function waitHttp(url, status = 200, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status === status) return;
    } catch {}
    await sleep(3000);
  }
  throw new Error(`${url} did not answer ${status}`);
}

/**
 * The recorder's view of the stack (see the kit's lib/project.mjs): stopped
 * while new narration is voiced (the model needs ~2 GB), brought back after,
 * and rewound before each pass. A stack stopped for the voice comes back with
 * its infra only when a rewind follows: the rewind starts the apps in waves.
 */
export function localStack({ base }) {
  configuratorUrl = `${base}/configurator/`;
  let stopped = null;
  return {
    snapshot,
    async beforeVoice() {
      if (isUp()) stopped = stop();
    },
    async afterVoice({ restoring }) {
      if (stopped) await start(stopped, { appsLater: restoring });
    },
    async ensureUp({ restoring }) {
      if (isUp()) return;
      stopped ??= lastStopped();
      if (!stopped) throw new Error('The stack is down and there is no record of what was running: deploy it first.');
      console.log('Starting the stack');
      await start(stopped, { appsLater: restoring });
    },
    async restore() {
      await restore(stopped ? { apps: stopped } : {});
      stopped = null;
    },
  };
}
