// Video 3 — Defining your geography: bring in the official boundaries for a
// place (turbopass), check the levels and the map, add them to the list,
// then save them.
// data.geography.source: "preconfigured" (the signup country's official set)
// or "fetch" (Fetch boundaries: official boundaries or OpenStreetMap).
//
// Master 5dc402e09 (#2361): what you choose goes into a list on the Geography
// page and nothing is written until Save and continue, which asks first
// ("Once saved, you won't be able to edit or remove them", GeographyStep.tsx).
// Until then each list item has Edit and Remove (BoundaryList.tsx). After
// saving there is no edit or delete: the console's boundaries resource has
// search + create only (data-provider resourceRegistry.ts), BoundaryEdit has
// every field disabled, and boundary-hierarchies has no edit route (App.tsx).
import { levelCountWords } from './common.mjs';

export default {
  id: 'geography',
  async prepare({ page, base }) {
    if (!page.url().includes('/onboarding/geography')) await page.goto(`${base}/configurator/onboarding/geography`);
    await page.getByRole('heading', { name: 'Geography', exact: true }).first().waitFor();
    await page.getByTestId('preconfigured-card').waitFor();
    await page.waitForLoadState('networkidle').catch(() => {});
  },
  async run({ page, actor, say, settle, data }) {
    const geo = data.geography;
    const total = data.spreadsheets.boundaryCount;
    await say('# Defining your geography');
    await actor.pause(1500);
    await say('Geography is the areas you cover, from the largest down to the smallest.');
    await actor.pause(800);
    await say('Every complaint is placed in one of them, and employees are given the areas they look after.');
    await actor.pause(800);

    await say('There are three ways to bring them in.');
    const card = page.getByTestId('preconfigured-card');
    await actor.hover(card, { at: { x: 150, y: 70 } });
    await say('Preconfigured boundaries: the official areas for your country, here Kenya, with a note on how reliable they are.');
    await actor.hover(card.getByText('Boundaries detected', { exact: false }).first());
    await actor.pause(1200);
    await actor.hover(card.getByTestId('preconfigured-confidence'));
    await actor.pause(900);
    await say('Fetch boundaries looks up official or OpenStreetMap data. Or upload your own list from Excel.');
    await actor.hover(page.getByText('Fetch boundaries', { exact: true }).first());
    await actor.pause(1000);
    await actor.hover(page.getByText('Upload from Excel', { exact: true }).first());
    await actor.pause(1000);
    // Fetch and Excel are scenes of their own (03c, 03b), recorded in passes of their own.
    await say('This video shows all three, starting with the official set.');
    await actor.pause(600);

    let searchBox;
    if (geo.source === 'fetch') {
      await say('We fetch them by searching for our area.');
      await actor.click(page.getByRole('button', { name: 'Search boundaries' }));
      searchBox = page.getByPlaceholder(/e\.g\., a city/);
    } else {
      await actor.click(page.getByRole('button', { name: 'Use these boundaries' }));
      searchBox = page.getByPlaceholder(/e\.g\., a city in/);
    }
    await searchBox.waitFor();
    await actor.pause(800);
    await say('Search for your city or region.');
    await actor.type(searchBox, geo.search, { delay: 110, after: 400 });
    const suggestion = page.locator('li').filter({ hasText: geo.pick }).first();
    await suggestion.waitFor({ timeout: 30000 });
    await say('Pick it from the suggestions. It shows the level and how many areas sit under it.');
    await actor.hover(suggestion);
    await actor.pause(1500);
    await actor.click(suggestion, { after: 500 });
    await actor.click(page.getByRole('button', { name: 'Search', exact: true }));
    await page.getByText('Map Admin Levels').waitFor({ timeout: 60000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await actor.pause(1000);

    await say(`The levels under ${geo.search} are listed, from the official data.`);
    await actor.pause(1500);
    // The data check sits in a collapsed report: open it, show it, close it.
    const report = page.getByTestId('validation-report');
    await say('A report shows how complete the data is, level by level.');
    const summary = report.locator('summary');
    await actor.click(summary, { settle: false, after: 600 });
    const check = page.getByText(/Data check for the selected levels/);
    await actor.reveal(check);
    await actor.hover(check);
    await actor.pause(1800);
    await settle();
    await actor.click(summary, { settle: false, after: 500 });
    await say('The map shows them, so you can check the outline.');
    const map = page.locator('.leaflet-container').first();
    await actor.reveal(map);
    await actor.hover(map, { at: { x: 450, y: 160 } });
    await actor.pause(1500);
    await actor.glide((await map.boundingBox()).x + 600, (await map.boundingBox()).y + 190, 1400);
    await actor.pause(1800);
    await settle();
    await say(`Tick the levels to include and name each one. The names are suggested: ${geo.levels.join(', ')}.`);
    const names = page.getByPlaceholder('e.g., District');
    for (let i = 0; i < Math.min(8, await names.count()); i++) {
      await actor.reveal(names.nth(i));
      await actor.hover(names.nth(i), { at: { x: 120, y: 18 } });
      await actor.pause(500);
    }
    await settle();

    await say('Then add them. Nothing is saved yet: the areas go into a list first.');
    await actor.click(page.getByRole('button', { name: 'Create Hierarchy & Boundaries' }));
    // Areas the data couldn't place get a review screen first.
    const item = page.getByTestId('boundary-list-item').first();
    const review = page.getByRole('button', { name: /^Create \d+ Boundaries$/ });
    await item.or(review).first().waitFor({ timeout: 120000 });
    if (await review.isVisible().catch(() => false)) await actor.click(review, { settle: false });
    await item.waitFor({ timeout: 120000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await actor.pause(600);
    // The caption comes from the data (so --voice-prep knows it); check it against the page,
    // which words it the same way: "1 county · 17 sub-counties · 86 wards".
    const counts = levelCountWords(data.spreadsheets.levelCounts);
    const listed = await item.innerText().catch(() => '');
    if (listed && !listed.includes(counts.listed)) console.warn(`    ! the list reads "${listed.replace(/\s+/g, ' ')}", the caption says ${counts.spoken}`);
    await say(`${total} areas, not saved yet: ${counts.spoken}.`);
    await actor.hover(item, { at: { x: 260, y: 40 } });
    await actor.pause(1500);
    await say('Until you save, you can still edit or remove them.');
    await actor.hover(item.getByRole('button', { name: /^Edit / }));
    await actor.pause(800);
    await actor.hover(item.getByRole('button', { name: /^Remove / }));
    await actor.pause(800);

    await say('Save and continue, and confirm.');
    await actor.click(page.getByRole('button', { name: 'Save and continue' }));
    const confirm = page.getByRole('alertdialog');
    await confirm.waitFor();
    await say('Once saved, the areas and their levels can’t be edited or removed, so check them first.');
    await actor.hover(confirm.getByText(/won.t be able to edit or remove/));
    await actor.pause(1500);
    await actor.click(confirm.getByRole('button', { name: 'Save and continue' }));
    await page.waitForURL(/\/onboarding\/departments/, { timeout: 300000 });
    await page.getByRole('heading', { name: 'Departments', exact: true }).first().waitFor();
    await say('Your areas are saved. Departments come next.');
    await actor.pause(1500);
  },
};
