// Video 4, part 1 — Departments and designations.
// Master 5dc402e09: a code is locked once saved (MasterDialog.tsx: disabled when
// editing, "A code can't change once it's saved."); until setup is finished
// each row has Edit and Remove (DepartmentsStep.tsx). In Management Studio the
// code stays disabled and a record can be switched off (resources/departments/
// DepartmentEdit.tsx, designations/DesignationEdit.tsx: Active). A rename
// there doesn't rewrite the label the citizen and employee apps show, so the
// videos don't offer renaming after setup.
export default {
  id: 'departments',
  async prepare({ page, base }) {
    if (!page.url().includes('/onboarding/departments')) await page.goto(`${base}/configurator/onboarding/departments`);
    await page.getByRole('heading', { name: 'Departments', exact: true }).first().waitFor();
  },
  async run({ page, actor, say, data }) {
    await say('# Adding departments and employees');
    await actor.pause(1200);
    await say('Departments are the teams that complaints are sent to. Every employee belongs to one.');
    await actor.pause(800);
    await say('You can add them by hand, one at a time, or all at once from a spreadsheet. This video shows both, by hand first.');
    await actor.hover(page.getByRole('button', { name: 'Start adding' }).first());
    await actor.pause(900);
    await actor.hover(page.getByRole('button', { name: 'Upload a file' }).first());
    await actor.pause(900);

    const dialog = page.getByRole('dialog');
    const addDepartment = async (dept, first) => {
      if (first) await actor.click(page.getByRole('button', { name: 'Start adding' }).first());
      else await actor.click(page.getByRole('button', { name: 'Add department', exact: true }));
      await dialog.waitFor();
      await actor.type(dialog.getByLabel('Department name'), dept.name);
      const code = dialog.getByLabel('Department code');
      if ((await code.inputValue()) !== dept.code) await actor.type(code, dept.code, { delay: 40 });
      else await actor.hover(code);
      await actor.pause(500);
      await actor.click(dialog.getByRole('button', { name: 'Add department', exact: true }));
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('cell', { name: dept.name, exact: true }).first().waitFor();
      await actor.pause(500);
    };

    const [firstDept, ...otherDepts] = data.departments;
    await say('Add each department by name. A code is suggested from the name, and it can’t change once saved.');
    await addDepartment(firstDept, true);
    await say(`Then the rest: ${otherDepts.map((d) => d.name).join(', ')}.`);
    for (const dept of otherDepts) await addDepartment(dept, false);
    await actor.pause(800);
    await say('Until setup is finished, you can still rename or remove a department here.');
    await actor.hover(page.getByRole('button', { name: `Edit ${firstDept.name}` }));
    await actor.pause(900);
    await actor.hover(page.getByRole('button', { name: `Remove ${firstDept.name}` }));
    await actor.pause(900);

    await say('Designations are job titles, like Ward Administrator or Engineer.');
    const addDesignation = page.getByRole('button', { name: 'Add designation', exact: true });
    for (const [i, des] of data.designations.entries()) {
      await actor.click(addDesignation);
      await dialog.waitFor();
      await actor.type(dialog.getByLabel('Designation name'), des.name);
      const code = dialog.getByLabel('Designation code');
      if ((await code.inputValue()) !== des.code) await actor.type(code, des.code, { delay: 40 });
      if (des.departments.length) {
        if (i === 1) await say('A designation can be limited to the departments that use it.');
        for (const deptName of des.departments) await actor.check(dialog.getByRole('checkbox', { name: new RegExp(`^${deptName}`) }));
      }
      await actor.click(dialog.getByRole('button', { name: 'Add designation', exact: true }));
      await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('cell', { name: des.name, exact: true }).first().waitFor();
      await actor.pause(400);
    }
    await actor.pause(800);
    await say('After setup, departments and designations can be switched off in Management Studio, but their codes never change.');
    await actor.pause(1000);

    await say('Save and continue to add the people who work in them.');
    await actor.click(page.getByRole('button', { name: 'Save and continue' }));
    await page.waitForURL(/\/onboarding\/employees/, { timeout: 60000 });
    await actor.pause(1200);
  },
};
