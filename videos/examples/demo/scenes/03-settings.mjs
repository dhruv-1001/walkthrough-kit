// Video 3 — Your team's look: name and accent colour, both changeable any time.
import { outro } from './common.mjs';

export default {
  id: 'settings',
  async prepare({ page, base }) {
    await page.goto(`${base}/`);
    await page.getByText('Recent requests').waitFor();
  },
  async run({ page, actor, say, data, outroMark }) {
    const { name, accent } = data.team;
    await say('# Your team’s look');
    await actor.pause(1200);
    await say('Open Settings to change how Brightdesk looks for your team.');
    await actor.click(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }));
    await page.getByLabel('Team name').waitFor();

    await say('Give your team a name. It shows in the menu and on the sign-in page.');
    await actor.type(page.getByLabel('Team name'), name);
    await say('Choose an accent colour for buttons and highlights.');
    await actor.check(page.getByRole('radio', { name: accent }));
    await actor.pause(500);
    await say('Save, and the change shows straight away.');
    await actor.click(page.getByRole('button', { name: 'Save changes' }));
    await page.getByRole('status').filter({ hasText: 'Settings saved' }).waitFor();
    await actor.hover(page.locator('.side .brand'));
    await actor.pause(1500);
    await say('Nothing here is permanent: come back and change it whenever you like.');
    await actor.pause(800);
    await outro({ say, actor, outroMark });
  },
};
