// Video 3, part 2 — Fetch boundaries, all the way: OpenStreetMap's areas for
// the place, levels ticked and named, the areas it can't place reviewed, then
// saved. (Recorded in the "fetch" pass: a workspace takes one set of areas.)
// data.geography.fetchPass: the source and place, the levels kept (by their
// "Level N" number on Map Admin Levels) and what the list then reads.
// Master f10632871: the Boundary source dropdown offers "Official boundaries"
// and "OpenStreetMap" (Overture's OSM-derived divisions, turbopassSuggestions.ts
// sourceOptionLabel); the levels kept must be a contiguous range
// (validateLevelSelection); unnamed areas and areas in no parent are listed on
// "Review Before Creating" and left out (BoundaryImport.tsx osm-review).
import { docsOutro, levelCountWords } from './common.mjs';

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export default {
  id: 'geography-fetch',
  async prepare({ page, base }) {
    if (!page.url().includes('/onboarding/geography')) await page.goto(`${base}/configurator/onboarding/geography`);
    await page.getByRole('heading', { name: 'Geography', exact: true }).first().waitFor();
    await page.getByTestId('preconfigured-card').waitFor();
    await page.waitForLoadState('networkidle').catch(() => {});
  },
  async run({ page, actor, say, settle, outroMark, data }) {
    const f = data.geography.fetchPass;
    const total = f.levelCounts.reduce((sum, l) => sum + l.count, 0);
    await say('# Fetching boundaries from OpenStreetMap');
    await actor.pause(1200);
    await say('If your country has no official set, or it doesn’t match how you work, fetch your areas from a map instead.');
    await actor.hover(page.getByText('Fetch boundaries', { exact: true }).first());
    await actor.pause(900);
    await actor.click(page.getByRole('button', { name: 'Search boundaries' }));
    const source = page.locator('#boundary-source');
    await source.waitFor();
    await actor.pause(600);
    await say('Pick a source: the official boundaries, or OpenStreetMap, a free map of the world that anyone can edit.');
    await actor.choose(source, f.sourceLabel);
    await actor.pause(700);

    await say('Search for your area and pick it. It shows how many areas sit under it.');
    const box = page.getByPlaceholder(/e\.g\., a city/);
    await actor.type(box, f.search, { delay: 110, after: 400 });
    const hit = page.locator('li').filter({ hasText: f.pick }).first();
    await hit.waitFor({ timeout: 30000 });
    await actor.hover(hit);
    await actor.pause(1200);
    await actor.click(hit, { after: 500 });
    await actor.click(page.getByRole('button', { name: 'Search', exact: true }));
    await page.getByText('Map Admin Levels').waitFor({ timeout: 60000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await actor.pause(800);

    // One card per level: "Level N" with its area count and examples, a tick box and, once ticked, a name.
    const levelCard = (n) => page.locator('label').filter({ has: page.getByRole('heading', { name: new RegExp(`^Level ${n}\\b`) }) });
    await say(`OpenStreetMap has ${NUMBER_WORDS[f.levelsFound] ?? f.levelsFound} levels for ${f.search}. Each shows how many areas it holds, with examples.`);
    for (let n = 1; n <= Math.min(3, f.levelsFound); n++) {
      await actor.reveal(levelCard(n));
      await actor.hover(levelCard(n), { at: { x: 200, y: 40 } });
      await actor.pause(900);
    }
    await settle();
    await say('Map data is uneven, so read the examples before you tick a level. The levels you keep must follow on from each other, with no gaps.');
    await actor.pause(600);
    const kept = new Set(f.keep.map((k) => k.level));
    for (let n = f.levelsFound; n >= 1; n--) {
      if (kept.has(n)) continue;
      const box = levelCard(n).getByRole('checkbox');
      if (!(await box.isChecked().catch(() => false))) continue;
      await actor.reveal(box);
      await actor.click(box, { before: 120, after: 250, settle: false });
    }
    await settle();
    await say(`Here we keep the top ${NUMBER_WORDS[f.keep.length] ?? f.keep.length}, and name them ${f.keep.map((k) => k.name).join(', ')}.`);
    for (const k of f.keep) {
      await actor.check(levelCard(k.level).getByRole('checkbox'));
      const name = page.locator(`#level-name-${k.level}`);
      await actor.reveal(name);
      if ((await name.inputValue().catch(() => '')) !== k.name) await actor.type(name, k.name, { delay: 70 });
      else await actor.hover(name, { at: { x: 120, y: 18 } });
      await actor.pause(400);
    }
    await settle();

    await say('Then add them to the list.');
    await actor.click(page.getByRole('button', { name: 'Create Hierarchy & Boundaries' }));
    const item = page.getByTestId('boundary-list-item').first();
    const review = page.getByRole('button', { name: /^Create \d+ Boundaries$/ });
    await item.or(review).first().waitFor({ timeout: 120000 });
    if (f.skipped > 0) {
      await review.waitFor({ timeout: 30000 });
      await say(`${f.skipped} areas can’t be placed inside the level above, so they’re left out. They’re listed first, so you can fix them on the map, or use Excel instead.`);
      await actor.hover(page.getByText(/will be SKIPPED/));
      await actor.pause(1800);
      await actor.click(review, { settle: false });
    } else if (await review.isVisible().catch(() => false)) {
      console.warn('    ! a review screen came up, but data.geography.fetchPass.skipped is 0');
      await actor.click(review, { settle: false });
    }
    await item.waitFor({ timeout: 120000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await actor.pause(600);
    const counts = levelCountWords(f.levelCounts);
    const listed = await item.innerText().catch(() => '');
    if (listed && !listed.includes(counts.listed)) console.warn(`    ! the list reads "${listed.replace(/\s+/g, ' ')}", the caption says ${counts.spoken}`);
    await say(`${total} areas, not saved yet: ${counts.spoken}.`);
    await actor.hover(item, { at: { x: 260, y: 40 } });
    await actor.pause(1500);

    await say('Save and continue, and confirm. After that, the areas and levels can’t be changed.');
    await actor.click(page.getByRole('button', { name: 'Save and continue' }));
    const confirm = page.getByRole('alertdialog');
    await confirm.waitFor();
    await actor.hover(confirm.getByText(/won.t be able to edit or remove/));
    await actor.pause(1200);
    await actor.click(confirm.getByRole('button', { name: 'Save and continue' }));
    await page.waitForURL(/\/onboarding\/departments/, { timeout: 300000 });
    await page.getByRole('heading', { name: 'Departments', exact: true }).first().waitFor();
    await say('Your areas are saved. Departments come next.');
    await actor.pause(800);
    await docsOutro({ page, actor, say, outroMark });
  },
};
