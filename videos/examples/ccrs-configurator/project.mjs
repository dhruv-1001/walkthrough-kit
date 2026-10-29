// The CCRS / DIGIT configurator onboarding videos: five videos, recorded in
// three passes (by hand, from spreadsheets, fetched boundaries) on a local
// DIGIT stack that is rewound between passes (lib/stack.mjs).
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CHAINS, SCENES, VIDEOS } from './scenes/index.mjs';
import { localStack } from './lib/stack.mjs';

const SHEETS = {
  boundaries: 'boundaries.xlsx', departments: 'departments-and-designations.xlsx',
  employees: 'employees.xlsx', complaints: 'complaint-categories.xlsx',
};

export default {
  name: 'ccrs-configurator',
  data: 'data/nairobi.json',
  scenes: SCENES,
  passes: CHAINS,
  videos: VIDEOS,
  browser: { locale: 'en-GB', timezoneId: 'Africa/Nairobi' },

  /** Where the uploads will be, and the area counts the captions read out. */
  load(data, { out }) {
    data.sheets = Object.fromEntries(Object.entries(SHEETS).map(([k, f]) => [k, join(out, 'sheets', f)]));
    const areas = JSON.parse(readFileSync(join(data.dir, data.spreadsheets.boundaries), 'utf8'));
    data.spreadsheets.boundaryCount = areas.length;
    // Areas per level, in level order ("1 county · 17 sub-counties · 86 wards" on the page).
    data.spreadsheets.levelCounts = data.spreadsheets.hierarchyLevels.map((level) => ({ level, count: areas.filter((a) => a.level === level).length }));
  },

  /** The "from spreadsheets" pass uploads files built from this same data. */
  prepare(data, { dir, out, python, pass }) {
    const tmp = join(data.dir, `.prepare-${pass?.id ?? 'all'}.json`); // beside the data: its paths are relative to it
    writeFileSync(tmp, JSON.stringify(data));
    const made = spawnSync(python, [join(dir, 'lib', 'make_sheets.py'), tmp, join(out, 'sheets')], { encoding: 'utf8' });
    rmSync(tmp);
    if (made.status !== 0) throw new Error(`building the spreadsheets failed:\n${made.stderr}`);
    if (pass) console.log(`  workspace ${data.account.name} (${data.account.slug}), founder ${data.founder.email}`);
  },

  /**
   * The data a pass signs up with. data.passes[<pass id>] overrides the account
   * and founder and moves every email to its own domain, so passes that can't
   * rewind (a remote stack) each get a workspace of their own; the narration
   * never speaks these, so the voice lines stay the same.
   */
  forPass(data, passId) {
    const o = data.passes?.[passId];
    if (!o) return data;
    const domain = (email) => (o.emailDomain ? email.replace(/@.*/, `@${o.emailDomain}`) : email);
    return {
      ...data,
      account: { ...data.account, ...o.account },
      founder: { ...data.founder, ...o.founder, email: domain(o.founder?.email ?? data.founder.email) },
      employees: data.employees.map((e) => ({ ...e, email: domain(e.email) })),
    };
  },

  /**
   * Only a local stack is rewound (and stopped while the voice model runs). A
   * remote one is only driven through its UI: give each pass its own workspace
   * with data.passes instead.
   */
  stack(data, { base }) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base) ? localStack({ base }) : null;
  },
};
