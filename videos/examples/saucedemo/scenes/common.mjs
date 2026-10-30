// Shared scene pieces.

/** A product's card on the list, found by its name. */
export const card = (page, name) => page.locator('[data-test="inventory-item"]').filter({ hasText: name });

/** Every video ends on this line; outroMark() marks where it starts (see the demo project). */
export async function outro({ say, actor, outroMark }) {
  await say('That’s all there is to it.');
  outroMark();
  await actor.pause(1200);
}
