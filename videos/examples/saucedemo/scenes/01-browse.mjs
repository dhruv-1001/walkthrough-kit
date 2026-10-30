// Video 1 — Finding a product: sign in, the product list, sorting, one product.
import { card, outro } from './common.mjs';

export default {
  id: 'browse',
  async prepare({ page, base }) {
    await page.goto(`${base}/`);
    await page.getByPlaceholder('Username').waitFor();
  },
  async run({ page, actor, say, data, outroMark }) {
    await say('# Finding a product');
    await actor.pause(1200);
    await say('Sign in with your username and password.');
    await actor.type(page.getByPlaceholder('Username'), data.user.name, { delay: 45 });
    await actor.type(page.getByPlaceholder('Password'), data.user.password);
    await actor.click(page.getByRole('button', { name: 'Login' }));
    await page.locator('[data-test="inventory-item"]').first().waitFor();

    await say('Every product is on one page, with its price.');
    await actor.hover(page.locator('[data-test="inventory-item-name"]').first());
    await actor.pause(500);
    await actor.hover(page.locator('[data-test="inventory-item-price"]').first());
    await actor.scroll(500);
    await actor.pause(600);
    await actor.scrollTop();

    await say(`Sort the list to find what you want: here, ${data.sort.said}.`);
    await actor.select(page.locator('[data-test="product-sort-container"]'), data.sort.label);
    await actor.pause(900);

    await say('Open a product to read more about it.');
    await actor.click(card(page, data.product).locator('[data-test="inventory-item-name"]'));
    await page.locator('[data-test="back-to-products"]').waitFor();
    await actor.hover(page.locator('[data-test="inventory-item-desc"]'));
    await actor.pause(900);
    await say('Add it to your cart from here, or go back to the list.');
    await actor.hover(page.locator('[data-test="add-to-cart"]'));
    await actor.pause(700);
    await actor.click(page.locator('[data-test="back-to-products"]'));
    await page.locator('[data-test="inventory-item"]').first().waitFor();
    await outro({ say, actor, outroMark });
  },
};
