// Shared scene pieces.

/**
 * Every video ends on this line. outroMark() tells the recorder where the
 * outro starts, so a video joined from several scenes keeps only the last one.
 */
export async function outro({ say, actor, outroMark }) {
  await say('That’s all there is to it. If you get stuck, ask your team admin.');
  outroMark();
  await actor.pause(1200);
}
