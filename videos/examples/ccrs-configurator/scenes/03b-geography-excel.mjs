// Video 3, part 2 — Geography from your own spreadsheet: name the levels,
// download the template, upload the filled file, check it, add the areas to
// the list, save. (Recorded in the "from spreadsheets" pass: a workspace's
// boundaries can be saved once.)
// Master 5dc402e09: "Create Hierarchy" only defines the levels and "Upload N
// Boundaries" only adds the areas to Geography's list (BoundaryImport.tsx
// handleCreateHierarchy / handleUploadBoundaries → onDone); Save and continue
// writes them, after a confirmation (GeographyStep.tsx).
import { docsOutro } from './common.mjs';

export default {
  id: 'geography-excel',
  async prepare({ page, base }) {
    if (!page.url().includes('/onboarding/geography')) await page.goto(`${base}/configurator/onboarding/geography`);
    await page.getByRole('heading', { name: 'Geography', exact: true }).first().waitFor();
    await page.getByText('Upload from Excel', { exact: true }).first().waitFor();
    await page.waitForLoadState('networkidle').catch(() => {});
  },
  async run({ page, actor, say, outroMark, data }) {
    const levels = data.spreadsheets.hierarchyLevels;
    const rows = data.sheets.boundaries;
    const total = data.spreadsheets.boundaryCount;

    await say('# Uploading boundaries from Excel');
    await actor.pause(1200);
    await say('Already have a list of your areas? Bring them in from a spreadsheet.');
    await actor.click(page.getByRole('button', { name: 'Upload a file' }).first());

    await say(`First, name the levels, from the largest area down to the smallest: ${levels.join(', ')}.`);
    // Each level row: a "Level N:" label, its input, and an unlabelled × button.
    const labels = page.locator('span', { hasText: /^Level \d+:$/ });
    await labels.first().waitFor();
    for (let n = Math.min(8, await labels.count()); n > levels.length; n--) {
      await actor.click(labels.nth(n - 1).locator('xpath=following-sibling::button'), { settle: false, after: 300 });
    }
    for (const [i, name] of levels.entries()) await actor.type(labels.nth(i).locator('xpath=following-sibling::input'), name, { delay: 60 });
    await actor.pause(600);
    await say('Create Hierarchy only sets up the levels: nothing is saved until the end.');
    await actor.click(page.getByRole('button', { name: 'Create Hierarchy', exact: true }));

    await page.getByRole('button', { name: 'Download Template' }).first().waitFor({ timeout: 60000 });
    await say('Download the template. It has one sample row for each level.');
    const [download] = await Promise.all([
      page.waitForEvent('download').catch(() => null),
      actor.click(page.getByRole('button', { name: 'Download Template' }).first()),
    ]);
    await download?.cancel().catch(() => {});
    await say('Fill in one row per area: its code, its name, its level, and the code of the area it sits in.');
    await actor.pause(1500);
    await say('Then upload the filled file.');
    await actor.hover(page.getByText(/Drop your filled boundary template here/));
    await page.locator('#boundary-file-upload').setInputFiles(rows);
    const upload = page.getByRole('button', { name: /^Upload \d+ Boundaries$/ });
    await upload.waitFor({ timeout: 60000 });
    await actor.pause(800);

    await say('Every row is checked first. Rows with problems show under Errors, with what to fix.');
    await actor.hover(page.getByRole('tab', { name: /^All/ }).or(page.getByRole('button', { name: /^All \(/ })).first());
    await actor.pause(700);
    await actor.hover(page.getByRole('tab', { name: /^Errors/ }).or(page.getByRole('button', { name: /^Errors \(/ })).first());
    await actor.pause(900);
    await say('Map outlines are optional: add a GeoJSON map file here, or skip it.');
    await actor.hover(page.getByText(/Polygon outlines \(optional\)/));
    await actor.pause(1200);

    await say(`Add the ${total} areas to your list.`);
    await actor.click(upload);
    const item = page.getByTestId('boundary-list-item').first();
    await item.waitFor({ timeout: 120000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await actor.pause(600);
    await say('They’re listed, but not saved yet. Until you save, you can still edit or remove them.');
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
