// Video 2, part 2 — No logo yet: the logo is optional, so save the theme and
// move on; the logo can be added later. (Recorded in the "from spreadsheets"
// pass.) Master has no "Skip branding" button any more: a saved theme
// completes Branding and the logo is optional (BrandingStep.tsx save()).
// Until setup is finished a done step stays open (progress.ts stepStatus);
// after it, Branding is in Management Studio (admin/BrandingPage.tsx).
import { docsOutro } from './common.mjs';

export default {
  id: 'branding-later',
  async prepare({ page, base }) {
    if (!page.url().includes('/onboarding/branding')) await page.goto(`${base}/configurator/onboarding/branding`);
    await page.getByRole('heading', { name: 'Branding', exact: true }).waitFor();
    await page.waitForLoadState('networkidle').catch(() => {});
  },
  async run({ page, actor, say, outroMark }) {
    await say('# Leaving the logo for later');
    await actor.pause(1200);
    await say('Not ready with a logo yet? It’s optional.');
    await actor.hover(page.getByRole('button', { name: /^(Upload logo|Replace)$/ }).first());
    await actor.pause(1200);
    await say('Keep the theme that’s already picked, or choose another, and save and continue.');
    await actor.hover(page.getByRole('group', { name: /Brand Theme/ }).or(page.getByText('Brand Theme', { exact: true })).first());
    await actor.pause(1000);
    await actor.click(page.getByRole('button', { name: 'Save and continue' }));
    // pgr-services before 7a62c952d (#2673) still wants a logo for Branding's DONE, so the save
    // is refused and "Continue anyway" appears. Off camera that's fine (it records the step
    // SKIPPED); on camera it would show a failure master doesn't have, so stop instead.
    const refused = page.getByRole('button', { name: 'Continue anyway' });
    await page.waitForURL(/\/onboarding\/geography/, { timeout: 20000 }).catch(async (err) => {
      if (!(await refused.isVisible().catch(() => false))) throw err;
      if (actor.speed) throw new Error('Branding without a logo was refused: this pgr-services predates 7a62c952d (#2673); deploy a master image from 5dc402e09 or later');
      console.warn('    ! Branding without a logo was refused (old pgr-services); continuing anyway, off camera');
      await refused.click();
      await page.waitForURL(/\/onboarding\/geography/, { timeout: 60000 });
    });
    await page.getByRole('heading', { name: 'Geography', exact: true }).first().waitFor();
    await say('Until setup is finished, Branding stays open in the list on the left.');
    await actor.hover(page.getByRole('link', { name: /^Branding/ }).or(page.getByRole('button', { name: /^Branding/ })).first());
    await actor.pause(1200);
    await say('After setup, add it in Management Studio, under Branding.');
    await actor.pause(1200);
    await docsOutro({ page, actor, say, outroMark });
  },
};
