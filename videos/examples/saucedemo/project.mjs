// Swag Labs (https://www.saucedemo.com), the practice shop Sauce Labs runs for browser
// automation: two short videos of a public site, nothing to start.
//
// A site you can't rewind needs no stack: every pass starts from a new, signed-out
// browser, and that's enough here. Everything else is left to the defaults: one
// pass with every scene, one video per scene.
import browse from './scenes/01-browse.mjs';
import checkout from './scenes/02-checkout.mjs';

export default {
  name: 'saucedemo',
  scenes: [browse, checkout],
  videos: [
    { number: 1, id: 'browse', slug: '01-finding-a-product', scenes: ['browse'] },
    { number: 2, id: 'checkout', slug: '02-buying-something', scenes: ['checkout'] },
  ],
};
