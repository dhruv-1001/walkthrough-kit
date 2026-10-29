// Video 4, part 1b — Departments and designations from one spreadsheet.
// (Recorded in the "from spreadsheets" pass.)
import { docsOutro } from './common.mjs';

export default {
  id: 'departments-bulk',
  async prepare({ page, base }) {
    if (!page.url().includes('/onboarding/departments')) await page.goto(`${base}/configurator/onboarding/departments`);
    await page.getByRole('heading', { name: 'Departments', exact: true }).first().waitFor();
    await page.waitForLoadState('networkidle').catch(() => {});
  },
  async run({ page, actor, say, outroMark, data }) {
    const nDept = data.departments.length;
    const nDesig = data.designations.length;
    await say('# Departments from a spreadsheet');
    await actor.pause(1200);
    await say('You can also bring in all your departments and designations at once, from one spreadsheet.');
    await actor.click(page.getByRole('button', { name: 'Upload a file' }).first());
    await page.getByText('Upload your departments and designations').waitFor();
    await actor.pause(600);

    await say('Download the template. It has a sheet for departments and one for designations.');
    const [download] = await Promise.all([
      page.waitForEvent('download').catch(() => null),
      actor.click(page.getByRole('button', { name: 'Download template' })),
    ]);
    await download?.cancel().catch(() => {});
    await say('Give each a code and a name. A designation can list the departments that use it.');
    await actor.pause(1500);

    await say('Choose the filled file.');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      actor.click(page.getByRole('button', { name: 'Choose a file' })),
    ]);
    await chooser.setFiles(data.sheets.departments);
    await page.getByRole('button', { name: 'Bring them in' }).waitFor();
    await say(`The file is checked first: ${nDept} departments and ${nDesig} designations, and any problems are listed by row.`);
    await actor.hover(page.getByText(/has \d+ departments? and \d+ designations?/));
    await actor.pause(1500);
    await say('Bring them in.');
    await actor.click(page.getByRole('button', { name: 'Bring them in' }));
    await page.getByRole('cell', { name: data.departments[0].name, exact: true }).first().waitFor({ timeout: 60000 });
    await actor.pause(600);

    await say('They are listed just as if you had added them by hand, and you can still edit or remove any of them.');
    await actor.hover(page.getByRole('cell', { name: data.departments.at(-1).name, exact: true }).first());
    await actor.pause(1500);
    await say('Save and continue to add the people who work in them.');
    await actor.click(page.getByRole('button', { name: 'Save and continue' }));
    await page.waitForURL(/\/onboarding\/employees/, { timeout: 60000 });
    await page.getByRole('heading', { name: 'Employees', exact: true }).first().waitFor();
    await actor.pause(800);
    await docsOutro({ page, actor, say, outroMark });
  },
};
