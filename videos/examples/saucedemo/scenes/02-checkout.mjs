// Video 2 — Buying something: add to cart, check the cart, your details, place the order.
import { card, outro } from './common.mjs';

export default {
  id: 'checkout',
  // Signed in by the browse scene before it (run off camera when only this video is asked for).
  async prepare({ page, base }) {
    await page.goto(`${base}/inventory.html`);
    await page.locator('[data-test="inventory-item"]').first().waitFor();
  },
  async run({ page, actor, say, data, outroMark }) {
    const c = data.customer;
    await say('# Buying something');
    await actor.pause(1200);
    await say('Add what you want to your cart.');
    for (const name of data.cart) {
      await actor.click(card(page, name).getByRole('button', { name: 'Add to cart' }), { settle: false });
    }
    await say('The cart icon counts what you’ve added. Open it to check.');
    await actor.hover(page.locator('[data-test="shopping-cart-badge"]'));
    await actor.pause(600);
    await actor.click(page.locator('[data-test="shopping-cart-link"]'));
    await page.locator('[data-test="checkout"]').waitFor();

    await say('Here’s everything in your cart. When it looks right, check out.');
    await actor.hover(page.locator('[data-test="cart-list"]'));
    await actor.pause(900);
    await actor.click(page.locator('[data-test="checkout"]'));
    await page.locator('[data-test="firstName"]').waitFor();

    await say('Enter your name and postcode.');
    await actor.type(page.locator('[data-test="firstName"]'), c.firstName);
    await actor.type(page.locator('[data-test="lastName"]'), c.lastName);
    await actor.type(page.locator('[data-test="postalCode"]'), c.postcode);
    await actor.click(page.locator('[data-test="continue"]'));
    await page.locator('[data-test="finish"]').waitFor();

    await say('The overview shows how you’ll pay, the delivery, and the total with tax.');
    await actor.hover(page.locator('[data-test="payment-info-value"]'));
    await actor.pause(500);
    await actor.hover(page.locator('[data-test="shipping-info-value"]'));
    await actor.pause(500);
    await actor.hover(page.locator('[data-test="total-label"]'));
    await actor.pause(700);
    await say('Finish places the order.');
    await actor.click(page.locator('[data-test="finish"]'));
    await page.locator('[data-test="complete-header"]').waitFor();
    await say('Done. This is a practice shop, so nothing is really sent or charged.');
    await actor.hover(page.locator('[data-test="complete-header"]'));
    await actor.pause(1200);
    await outro({ say, actor, outroMark });
  },
};
