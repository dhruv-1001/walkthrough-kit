// Video 2 — Account branding: logo, name, theme, save.
// Later (master 5dc402e09): logo, banner and theme in Management Studio →
// Branding (admin/BrandingPage.tsx, BrandingEditor mode="console"); the name in
// Workspace settings (BrandingStep.tsx NameHint, identity/WorkspacePage.tsx).
import { resolve } from 'node:path';

export default {
  id: 'branding',
  async prepare({ page, base }) {
    if (!page.url().includes('/onboarding/home')) await page.goto(`${base}/configurator/onboarding/home`);
    await page.getByRole('heading', { name: /set up your account/i }).waitFor();
  },
  async run({ page, actor, say, data }) {
    await say('# Account branding');
    await actor.pause(1200);
    await say('Branding is the first step. Open it from Home, or from the list on the left.');
    await actor.click(page.getByRole('button', { name: /^Set up Branding/i }).first());
    await page.getByRole('heading', { name: 'Branding', exact: true }).waitFor();
    await actor.pause(600);

    await say('Your logo, name and colours appear on every page citizens and employees see.');
    await actor.pause(1500);

    await say('Upload your logo: a PNG or JPG, at least 128 pixels square.');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      actor.click(page.getByRole('button', { name: /^(Upload logo|Replace)$/ }).first()),
    ]);
    await chooser.setFiles(resolve(data.dir, '..', data.branding.logo));
    await page.getByText('Logo uploaded.').waitFor();
    await actor.pause(1200);

    const name = page.getByLabel('Account name', { exact: true });
    await actor.hover(name);
    await say('The account name comes from sign-up. You can rename it later in Workspace settings.');
    await actor.pause(1500);

    await say('Pick a brand theme. It colours the citizen and employee apps.');
    await actor.click(page.getByRole('button', { name: data.branding.theme, exact: true }), { after: 900 });
    await say('The logo and theme can be changed later too, in Management Studio, under Branding.');
    await actor.pause(1200);

    await say('Save and continue. Geography unlocks next.');
    await actor.click(page.getByRole('button', { name: 'Save and continue' }));
    await page.waitForURL(/\/onboarding\/geography/, { timeout: 60000 });
    await page.getByRole('heading', { name: 'Geography', exact: true }).waitFor();
    await actor.pause(1500);
  },
};
