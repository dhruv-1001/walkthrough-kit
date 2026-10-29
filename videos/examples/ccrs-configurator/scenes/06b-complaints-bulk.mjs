// Video 5, part 2 — Complaint categories from a spreadsheet, then finish setup.
// (Recorded in the "from spreadsheets" pass.)
import { docsOutro } from './common.mjs';

// Two levels with exactly these codes keep the category editor editable after
// the upload; any other levels turn the step read-only (managed elsewhere).
const LEVELS = ['COMPLAINT_TYPE', 'SUB_TYPE'];

export default {
  id: 'complaints-bulk',
  async prepare({ page, base }) {
    if (!page.url().includes('/onboarding/complaints')) await page.goto(`${base}/configurator/onboarding/complaints`);
    await page.getByRole('heading', { name: 'Complaints Template', exact: true }).first().waitFor();
    await page.waitForLoadState('networkidle').catch(() => {});
  },
  async run({ page, actor, say, outroMark, data }) {
    const nSub = data.complaints.categories.reduce((n, c) => n + c.subcategories.length, 0);
    const nCat = data.complaints.categories.length;
    await say('# Complaint categories from a spreadsheet');
    await actor.pause(1200);
    await say('You can also upload every category and subcategory from one spreadsheet.');
    await actor.click(page.getByRole('button', { name: 'Upload a file' }).first());
    const setup = page.getByTestId('complaint-hierarchy-setup');
    await setup.waitFor();
    await actor.pause(600);

    await say('Keep two levels: the category, and the subcategory under it.');
    // Each level row: a "Level N:" label, its input, and an unlabelled × button.
    const labels = setup.locator('span', { hasText: /^Level \d+:$/ });
    await labels.first().waitFor();
    for (let n = await labels.count(); n > LEVELS.length; n--) {
      await actor.click(labels.nth(n - 1).locator('xpath=following-sibling::button'), { settle: false, after: 300 });
    }
    for (const [i, code] of LEVELS.entries()) await actor.type(labels.nth(i).locator('xpath=following-sibling::input'), code, { delay: 45 });
    await actor.pause(500);
    await actor.click(page.getByTestId('ch-next-template'));

    await say('Download the template. Each row is one subcategory, with its category, the department that handles it, a resolution time and search words.');
    const [download] = await Promise.all([
      page.waitForEvent('download').catch(() => null),
      actor.click(setup.getByRole('button', { name: 'Download Template' })),
    ]);
    await download?.cancel().catch(() => {});
    await actor.pause(1200);
    await say('Fill it in and upload it.');
    await page.locator('#ch-file-upload').setInputFiles(data.sheets.complaints);
    await page.getByTestId('ch-create').waitFor({ timeout: 60000 });
    await say(`It is checked and shown before anything is saved: ${nSub} subcategories in ${nCat} categories.`);
    await actor.hover(setup.getByRole('tab', { name: /^Subcategories/ }).or(setup.getByRole('button', { name: /^Subcategories/ })).first());
    await actor.pause(1500);
    await actor.click(page.getByTestId('ch-create'));
    await page.getByText(data.complaints.categories[0].name, { exact: true }).first().waitFor({ timeout: 120000 });
    await actor.pause(600);

    await say('The categories now appear in the list, and you can edit them just like ones you added by hand.');
    await actor.hover(page.getByText(data.complaints.categories.at(-1).name, { exact: true }).first());
    await actor.pause(1500);
    await say('Finish setup. Your account is ready to take complaints.');
    await actor.click(page.getByRole('button', { name: 'Finish setup' }));
    await page.waitForURL((url) => !url.pathname.endsWith('/onboarding/complaints'), { timeout: 90000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await actor.pause(1500);
    await docsOutro({ page, actor, say, outroMark });
  },
};
