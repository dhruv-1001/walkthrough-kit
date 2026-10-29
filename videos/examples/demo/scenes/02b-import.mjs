// Video 2, part 2 — Many requests at once from a CSV file. Recorded in its own
// pass, so the list it ends on holds the seed plus the import, nothing else.
import { outro } from './common.mjs';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default {
  id: 'import',
  async prepare({ page, base }) {
    await page.goto(`${base}/requests`);
    await page.getByRole('table').waitFor();
  },
  async run({ page, actor, say, data, outroMark }) {
    const { ready, errors, path } = data.import;
    await say('To raise many requests at once, use Import.');
    await actor.click(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Import' }));
    await say('Start from the template: one row per request.');
    await actor.hover(page.getByRole('link', { name: 'Download the template' }));
    await actor.pause(1000);

    await say('Then choose your file.');
    const chooser = page.waitForEvent('filechooser');
    await actor.click(page.getByRole('button', { name: 'Choose a CSV file' }));
    await (await chooser).setFiles(path);
    await page.getByRole('heading', { name: /ready/ }).waitFor();

    await say(`Every row is checked before anything is saved: ${plural(ready, 'row')} ready, ${plural(errors, 'row')} with a problem.`);
    await actor.hover(page.getByRole('heading', { name: /ready/ }));
    await actor.pause(800);
    if (errors) {
      await actor.hover(page.getByText('Missing title').first());
      await actor.pause(1000);
      await say('Rows with a problem are left out. Fix them in the file and import them later.');
    }
    const button = page.getByRole('button', { name: /^Import \d+ request/ });
    await actor.click(button);
    await page.getByText('requests imported').first().waitFor();
    await actor.click(page.getByRole('link', { name: 'View requests' }));
    await page.getByRole('table').waitFor();
    await say(`The ${plural(ready, 'new request')} are on the list, ready for your team.`);
    await actor.hover(page.getByRole('table').locator('tbody tr').first());
    await actor.pause(1200);
    await outro({ say, actor, outroMark });
  },
};
