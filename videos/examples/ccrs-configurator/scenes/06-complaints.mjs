// Video 5 — Complaints Template: categories, subcategories, routing, resolution
// time; finish setup and land in Management Studio.
// Master 5dc402e09: categories typed in are a draft until Finish setup saves
// them, and each has Edit and Remove until then (ComplaintsStep.tsx save() on
// Finish, the list's Edit/Remove). Finish setup goes to /manage, the "DIGIT
// Management Studio" dashboard with its Workspace links card
// (admin/DigitDashboard.tsx, admin/WorkspaceLinksCard.tsx). Under Complaint
// Categories a subcategory's department, resolution time ("SLA (hours)") and
// Active can be changed, and new ones added (resources/complaint-types/
// ComplaintTypeEdit.tsx, ComplaintTypeCreate.tsx).
export default {
  id: 'complaints',
  async prepare({ page, base }) {
    if (!page.url().includes('/onboarding/complaints')) await page.goto(`${base}/configurator/onboarding/complaints`);
    await page.getByRole('heading', { name: 'Complaints Template', exact: true }).first().waitFor();
  },
  async run({ page, actor, say, data }) {
    await say('# Complaints template');
    await actor.pause(1200);
    await say('This is what citizens can report: broad categories, each with its own subcategories.');
    await actor.pause(800);
    await say('You can add them by hand, one at a time, or all at once from a spreadsheet. This video shows both, by hand first.');
    await actor.hover(page.getByRole('button', { name: 'Start adding' }).first());
    await actor.pause(900);
    await actor.hover(page.getByRole('button', { name: 'Upload a file' }).first());
    await actor.pause(900);

    const dialog = page.getByRole('dialog');
    for (const [i, cat] of data.complaints.categories.entries()) {
      const first = i === 0;
      if (i === 1) await say('Add every category citizens should be able to choose from.');
      if (i >= 2) await say(`${cat.name}, handled by ${cat.department}.`);
      if (first) await actor.click(page.getByRole('button', { name: 'Start adding' }).first());
      else await actor.click(page.getByRole('button', { name: 'Add complaint category', exact: true }));
      await dialog.waitFor();
      if (first) await say('Name the category, the way a citizen would say it.');
      // Labels of required fields end in a red asterisk (its text counts for getByLabel), so no exact match.
      await actor.type(dialog.getByLabel(/^Name\b/), cat.name, { delay: first ? 55 : 35 });
      if (first) await say('Choose the department that handles it. That is where these complaints are sent.');
      await actor.choose(dialog.getByLabel('Handled by'), cat.department);
      if (first) await say('List its subcategories, one per line.');
      const subtypes = dialog.getByLabel(/Subcategories/);
      await actor.click(subtypes, { after: 100 });
      for (const [j, line] of cat.subcategories.entries()) {
        await subtypes.pressSequentially(line, { delay: actor.speed ? (first ? 45 : 28) * actor.speed : 0 });
        if (j < cat.subcategories.length - 1) await subtypes.press('Enter');
      }
      await actor.pause(300);
      if (first) {
        await say('Resolution time is how long a complaint has before it shows as overdue.');
        await actor.hover(dialog.getByLabel('Resolution time'));
        await actor.pause(900);
      }
      await actor.click(dialog.getByRole('button', { name: 'Add category', exact: true }));
      await dialog.waitFor({ state: 'hidden' });
      if (first) {
        await say('Each category shows who handles it, how fast it should be resolved, and its subcategories.');
        await actor.hover(page.getByText(cat.name, { exact: true }).first());
        await actor.pause(1500);
      }
      await actor.pause(500);
    }
    await actor.pause(800);
    await say('The default resolution time applies to every category without its own.');
    await actor.reveal(page.getByText('Default resolution time'));
    await actor.pause(1600);
    await say('Nothing here is saved until you finish, so you can still edit or remove any category.');
    const firstName = data.complaints.categories[0].name;
    await actor.hover(page.getByRole('button', { name: `Edit ${firstName}` }));
    await actor.pause(800);
    await actor.hover(page.getByRole('button', { name: `Remove ${firstName}` }));
    await actor.pause(800);

    await say('Finish setup. Your account is ready to take complaints.');
    await actor.click(page.getByRole('button', { name: 'Finish setup' }));
    await page.waitForURL((url) => !url.pathname.endsWith('/onboarding/complaints'), { timeout: 90000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await actor.pause(1200);
    await say('Setup is done. From now on, you make changes here, in Management Studio.');
    await actor.hover(page.getByRole('heading', { name: /Management Studio/ }).or(page.getByText('Management Mode')).first(), { at: { x: 140, y: 18 } });
    await actor.pause(1800);
    // Lines are said whatever the page shows (the dry run must see them); only the pointing is conditional.
    await say('Workspace links: the employee app, where your staff work on complaints, and the citizen app, to share with the public.');
    const links = page.getByText('Workspace links', { exact: true });
    if (await links.isVisible().catch(() => false)) await actor.hover(links, { at: { x: 70, y: 12 } });
    await actor.pause(1800);
    await say('Under Complaint Categories you can add subcategories, or change which department handles one and how long it has.');
    const categories = page.getByRole('button', { name: /Complaint Categories/ }).first();
    if (await categories.isVisible().catch(() => false)) await actor.hover(categories);
    await actor.pause(2000);
  },
};
