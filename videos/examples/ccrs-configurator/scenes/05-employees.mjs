// Video 4, part 2 — Employees: who handles complaints, with roles and areas.
// Master 5dc402e09: Add employee takes ONE department, from a dropdown like
// Edit's (EmployeeDialog.tsx). The code is read-only once saved (EmployeeDialog
// readOnly={editing}; console EmployeeEdit.tsx: Employee Code disabled). In
// Management Studio → Employees: name, mobile, roles, assignments (department,
// designation) and jurisdictions are editable (EmployeeEdit.tsx). Staff sign
// in with their email (EmployeesStep.tsx toast). Finish setup needs a GRO in
// every department a complaint category goes to (complaints/groCoverage.ts).
export default {
  id: 'employees',
  async prepare({ page, base }) {
    if (!page.url().includes('/onboarding/employees')) await page.goto(`${base}/configurator/onboarding/employees`);
    await page.getByRole('heading', { name: 'Employees', exact: true }).first().waitFor();
  },
  async run({ page, actor, say, data }) {
    await say('Employees are the people who assign, work on and resolve complaints.');
    await actor.pause(1000);
    await say('You can add them by hand, one at a time, or all at once from a staff list. This video shows both, by hand first.');
    await actor.hover(page.getByRole('button', { name: 'Start adding' }).first());
    await actor.pause(900);
    await actor.hover(page.getByRole('button', { name: 'Upload a file' }).first());
    await actor.pause(900);

    const dialog = page.getByRole('dialog');
    const exactLabel = (group, text) => group.locator('label').filter({ has: page.getByText(text, { exact: true }) }).getByRole('checkbox');
    // Required fields' labels end in a red asterisk ("Department*" to getByLabel), hence the regex.
    const select = (label, placeholder) => dialog.getByLabel(new RegExp(`^${label}\\b`))
      .or(dialog.getByRole('combobox').filter({ hasText: placeholder })).first();
    for (const [i, emp] of data.employees.entries()) {
      if (await page.locator('tr', { hasText: emp.email }).count()) continue;
      if (i === 0) await actor.click(page.getByRole('button', { name: 'Start adding' }).first());
      else await actor.click(page.getByRole('button', { name: 'Add employee', exact: true }).first());
      await dialog.waitFor();
      const first = i === 0;
      if (i === 1) await say('Add the rest of the team the same way: here, one Complaint Assessor for each department.');
      if (i >= 2) await say(`${emp.name}, ${emp.designation} in ${emp.departments[0]}.`);

      if (first) await say('Each person gets a code, suggested for you. The code can’t be changed once saved.');
      const code = dialog.getByLabel('Employee code');
      if (first) await actor.hover(code);
      if (first) await actor.pause(600);
      if (emp.code && (await code.inputValue()) !== emp.code) await actor.type(code, emp.code, { delay: first ? 55 : 30 });
      if (first) await say('Add their name, mobile number and email.');
      await actor.type(dialog.getByLabel('Full name'), emp.name, { delay: first ? 55 : 30 });
      await actor.type(dialog.getByLabel('Mobile number'), emp.mobile, { delay: first ? 55 : 30 });
      await actor.type(dialog.getByLabel('Email'), emp.email, { delay: first ? 45 : 25 });
      if (first) await say('They’ll sign in to the employee app with this email.');

      if (first) await say('Choose their department and designation.');
      await actor.choose(select('Department', /Choose a department/), emp.departments[0]);
      await actor.choose(select('Designation', /Choose a designation/), emp.designation);

      if (first) await say('Roles decide what they can do. A Complaint Assessor assigns complaints; a Complaint Resolver resolves them.');
      const roles = dialog.getByRole('group', { name: 'System roles' });
      for (const role of emp.roles) await actor.check(exactLabel(roles, role));

      if (first) await say('Jurisdictions are the areas where they can act.');
      const areas = dialog.getByRole('group', { name: 'Jurisdictions' });
      for (const area of emp.jurisdictions) {
        const filter = areas.getByRole('textbox');
        if (await filter.count()) await actor.type(filter, area, { delay: 40, after: 400 });
        await actor.check(exactLabel(areas, area).first());
      }
      await actor.click(dialog.getByRole('button', { name: 'Add employee', exact: true }));
      await dialog.waitFor({ state: 'hidden', timeout: 60000 });
      await page.locator('tr', { hasText: emp.email }).first().waitFor();
      if (first) await say(`${emp.name} is added, and gets an email to set a password.`);
      await actor.pause(600);
    }
    await say('Every department that receives complaints needs at least one Complaint Assessor before setup can finish.');
    await actor.hover(page.locator('tr', { hasText: data.employees.at(-1).email }).first());
    await actor.pause(1500);
    await say('After setup, Management Studio can change a person’s name, mobile number, department, roles and areas, but not their code.');
    await actor.pause(1500);
    await say('Save and continue to set up the complaints people can raise.');
    await actor.click(page.getByRole('button', { name: 'Save and continue' }));
    await page.waitForURL(/\/onboarding\/complaints/, { timeout: 60000 });
    await actor.pause(1200);
  },
};
