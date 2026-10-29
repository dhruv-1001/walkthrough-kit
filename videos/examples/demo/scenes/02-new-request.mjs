// Video 2, part 1 — Raising a request by hand, on the New request form.
import { outro } from './common.mjs';

export default {
  id: 'new-request',
  async prepare({ page, base }) {
    await page.goto(`${base}/`);
    await page.getByText('Recent requests').waitFor();
  },
  async run({ page, actor, rec, say, data, outroMark }) {
    const r = data.request;
    await say('# Raising requests');
    await actor.pause(1200);
    await say('You can raise requests one at a time, or many at once from a spreadsheet. This video shows both, one at a time first.');
    await actor.hover(page.getByRole('link', { name: 'New request' }));
    await actor.pause(900);
    await actor.hover(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Import' }));
    await actor.pause(900);
    await actor.click(page.getByRole('link', { name: 'New request' }));
    await page.getByLabel('Title').waitFor();

    await say('Give it a short title.');
    await actor.type(page.getByLabel('Title'), r.title);
    await say('Pick a category, and how urgent it is.');
    await actor.select(page.getByLabel('Category'), r.category);
    await actor.check(page.getByRole('radio', { name: r.priority }));
    await say('Then describe what happened.');
    await actor.type(page.getByLabel('Description'), r.description, { delay: 35 });

    await say('Create the request.');
    await actor.click(page.getByRole('button', { name: 'Create request' }));
    // Server time isn't worth watching: cut it out of the video.
    await rec.cut(() => page.getByRole('heading', { name: r.title }).waitFor());
    await say('It gets a number, and your team sees it straight away.');
    await actor.hover(page.getByRole('heading', { name: r.title }));
    await actor.pause(1200);
    await outro({ say, actor, outroMark });
  },
};
