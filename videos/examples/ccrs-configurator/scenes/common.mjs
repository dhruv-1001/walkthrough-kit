// Shared scene pieces.

export const DOCS_LINE = 'For more information, check out our documentation page.';

/** "1 county, 17 sub-counties and 86 wards": the list's own wording ("1 county · 17 sub-counties · 86 wards"). */
export function levelCountWords(levelCounts) {
  const words = levelCounts.map(({ level, count }) => {
    const word = level.toLowerCase();
    return `${count} ${count === 1 ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`}`;
  });
  return { listed: words.join(' · '), spoken: `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` };
}

/**
 * Every video ends here: the documentation line, with the cursor resting on
 * the page's Documentation rail (the step's own guide when the rail is open,
 * "Open DIGIT Docs" in the account menu where there is no rail, e.g. in
 * Management Studio). outroMark() lets a joined video cut this off when
 * another part follows.
 */
export async function docsOutro({ page, actor, say, outroMark }) {
  await say(DOCS_LINE);
  outroMark();
  const rail = page.getByRole('complementary', { name: 'Documentation' });
  if (await rail.isVisible().catch(() => false)) {
    await actor.hover(rail.getByRole('link').first());
    await actor.pause(1200);
    await actor.hover(rail.getByRole('link', { name: /Open DIGIT Docs/ }).first());
  } else {
    // No rail (Management Studio): the account menu has "Open DIGIT Docs".
    const account = page.getByRole('button', { name: 'Account' });
    if (await account.isVisible().catch(() => false)) {
      await actor.click(account, { settle: false, after: 500 });
      await actor.hover(page.getByRole('menuitem', { name: 'Open DIGIT Docs' }));
      await actor.pause(1500);
    }
  }
  await actor.pause(800);
}
