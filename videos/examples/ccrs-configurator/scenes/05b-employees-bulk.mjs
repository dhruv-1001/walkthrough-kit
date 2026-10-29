// Video 4, part 2b — Employees from a staff list spreadsheet.
// Master 5dc402e09: the employee code is optional in the sheet; a blank one
// gets the next free EMP_ code (utils/excelParser.ts parseEmployeeExcel,
// #2456). New employees get a password-setup email (BulkEmployeeImport.tsx).
// (Recorded in the "from spreadsheets" pass.)
import { docsOutro } from './common.mjs';

export default {
  id: 'employees-bulk',
  async prepare({ page, base }) {
    if (!page.url().includes('/onboarding/employees')) await page.goto(`${base}/configurator/onboarding/employees`);
    await page.getByRole('heading', { name: 'Employees', exact: true }).first().waitFor();
    await page.waitForLoadState('networkidle').catch(() => {});
  },
  async run({ page, actor, say, outroMark, data, rec }) {
    const n = data.employees.length;
    await say('# Employees from a staff list');
    await actor.pause(1200);
    await say('With a larger team, upload your staff list instead of adding people one by one.');
    await actor.click(page.getByRole('button', { name: 'Upload a file' }).first());
    await page.getByText('Upload your staff list').waitFor();
    await actor.pause(600);

    const getTemplate = page.getByRole('button', { name: 'Get the template' });
    await getTemplate.waitFor();
    await say('It lists what a staff list can refer to: your departments, designations, roles and areas.');
    await actor.hover(page.getByText(/Available data from DIGIT/));
    await actor.pause(1200);
    await actor.click(getTemplate);
    await page.getByRole('button', { name: 'Download Template' }).waitFor();
    await say('Download the template: one row per person.');
    const [download] = await Promise.all([
      page.waitForEvent('download').catch(() => null),
      actor.click(page.getByRole('button', { name: 'Download Template' })),
    ]);
    await download?.cancel().catch(() => {});
    await say('Fill in each person’s name, mobile number and email, and the codes of their department, designation, roles and areas.');
    await actor.pause(1200);
    await say('Leave the employee code blank to have one assigned.');
    await actor.pause(1000);

    await say('Then upload it.');
    await page.locator('#employee-file-upload').setInputFiles(data.sheets.employees);
    const create = page.getByRole('button', { name: /^Create \d+ Employees?$/ });
    await create.waitFor({ timeout: 60000 });
    await actor.pause(600);
    await say('Each row is checked: the email, the mobile number, and that every department, designation and area exists.');
    await actor.hover(page.getByRole('row').filter({ hasText: data.employees[0].name }).first());
    await actor.pause(1600);

    await say(`Create the ${n} employees, and confirm.`);
    await actor.click(create);
    const confirm = page.getByRole('dialog').filter({ hasText: 'Confirm Employee Creation' });
    await confirm.waitFor();
    await actor.pause(500);
    await actor.click(confirm.getByRole('button', { name: /Create|Confirm/ }).last());
    await rec.cut(async () => {
      await page.getByText('Employees Created Successfully!').waitFor({ timeout: 180000 });
    });
    await say('Each of them gets an email inviting them to set a password and sign in.');
    await actor.hover(page.getByText('Employees Created Successfully!'));
    await actor.pause(1500);

    await actor.click(page.getByRole('button', { name: 'Back to Employees' }));
    await page.locator('tr', { hasText: data.employees[0].email }).first().waitFor({ timeout: 60000 });
    await say('Everyone is listed with the status of their invitation.');
    await actor.hover(page.locator('tr', { hasText: data.employees.at(-1).email }).first());
    await actor.pause(1500);
    await say('Save and continue to set up the complaints people can raise.');
    await actor.click(page.getByRole('button', { name: 'Save and continue' }));
    await page.waitForURL(/\/onboarding\/complaints/, { timeout: 60000 });
    await page.getByRole('heading', { name: 'Complaints Template', exact: true }).first().waitFor();
    await actor.pause(800);
    await docsOutro({ page, actor, say, outroMark });
  },
};
