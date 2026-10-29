// Video 1 — Getting started: sign in, what the dashboard shows, one request.
import { outro } from './common.mjs';

export default {
  id: 'sign-in',
  // Off camera, before recording starts: land on the sign-in page.
  async prepare({ page, base }) {
    await page.goto(`${base}/login`);
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  },
  async run({ page, actor, say, data, outroMark }) {
    await say('# Getting started with Brightdesk');
    await actor.pause(1200);
    await say('Sign in with your work email and password.');
    await actor.type(page.getByLabel('Email'), data.user.email, { delay: 45 });
    await actor.type(page.getByLabel('Password'), data.user.password);
    await actor.click(page.getByRole('button', { name: 'Sign in' }));
    await page.getByText('Recent requests').waitFor();

    await say('The dashboard shows what needs your attention.');
    for (const tile of ['Open requests', 'High priority', 'Resolved']) {
      await actor.hover(page.locator('.tile-label', { hasText: tile }));
      await actor.pause(700);
    }
    await say('Open requests are waiting for your team. High priority ones need you first.');
    await actor.pause(600);
    await say('Below them are the newest requests. Open one to see it in full.');
    const first = page.locator('.recent a').first();
    await actor.hover(first);
    await actor.click(first);
    await page.getByRole('button', { name: 'Mark as resolved' }).waitFor();
    await say('Each request has a category, a priority and a status. Mark it as resolved once it’s done.');
    await actor.hover(page.locator('.meta'));
    await actor.pause(900);
    await actor.hover(page.getByRole('button', { name: 'Mark as resolved' }));
    await actor.pause(900);

    await say('Use the menu on the left to move between pages.');
    for (const item of ['Requests', 'Import', 'Settings']) {
      await actor.hover(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: item }));
      await actor.pause(500);
    }
    await outro({ say, actor, outroMark });
  },
};
