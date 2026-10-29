// Brightdesk (../../../demo-app): three short how-to videos.
// Start the app first:  node demo-app/server.mjs   (from the kit's root)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import signIn from './scenes/01-sign-in.mjs';
import newRequest from './scenes/02-new-request.mjs';
import importCsv from './scenes/02b-import.mjs';
import settings from './scenes/03-settings.mjs';

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export default {
  name: 'demo',
  data: 'data.json',
  scenes: [signIn, newRequest, importCsv, settings],
  // Both passes sign in; each starts from a freshly seeded app.
  passes: [
    { id: 'by-hand', scenes: ['sign-in', 'new-request', 'settings'] },
    { id: 'from-csv', scenes: ['sign-in', 'import'] },
  ],
  videos: [
    { number: 1, id: 'getting-started', slug: '01-getting-started', scenes: ['sign-in'] },
    { number: 2, id: 'requests', slug: '02-raising-requests', scenes: ['new-request', 'import'] },
    { number: 3, id: 'settings', slug: '03-your-teams-look', scenes: ['settings'] },
  ],

  /** Counts the import captions read out, worked out from the rows (the dry run needs them too). */
  load(data, { out }) {
    const rows = data.import.rows;
    data.import.ready = rows.filter((r) => r.title).length;
    data.import.errors = rows.length - data.import.ready;
    data.import.path = join(out, data.import.file);
  },

  /** The CSV the import scene uploads, built from the same data. */
  prepare(data) {
    const cols = ['title', 'category', 'priority', 'description'];
    const lines = [cols.join(','), ...data.import.rows.map((r) => cols.map((c) => csvCell(r[c] ?? '')).join(','))];
    writeFileSync(data.import.path, `${lines.join('\n')}\n`);
  },

  /** Rewind = the app's own reset endpoint (a real app might restore a database snapshot here). */
  stack(data, { base }) {
    const health = () => fetch(`${base}/api/health`).then((r) => r.ok, () => false);
    return {
      async ensureUp() {
        if (!(await health())) throw new Error(`Brightdesk isn't answering at ${base}. Start it: node demo-app/server.mjs`);
      },
      async restore() {
        const res = await fetch(`${base}/api/reset`, { method: 'POST' });
        if (!res.ok) throw new Error(`reset failed: ${res.status}`);
      },
    };
  },
};
