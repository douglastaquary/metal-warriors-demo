import { expect, test, type Page } from '@playwright/test';

// Drives the first two sections with real keyboard input and checks that the
// run actually progresses (distance, kills, score) without softlocks, then
// verifies the fail -> continue -> retry path from the game-over screen.

type BotSnapshot = {
  frame: number;
  state: string;
  score: number;
  kills: number;
  x: number;
  armor: number;
};

const FIRE = 'KeyX';
const JUMP = 'KeyZ';

const INPUT_SCRIPT: Array<{ keys: string[]; ms: number }> = [
  { keys: ['ArrowRight', FIRE], ms: 1400 },
  { keys: ['ArrowRight', FIRE, JUMP], ms: 700 },
  { keys: ['ArrowUp', FIRE], ms: 900 },
  { keys: ['ArrowRight', FIRE], ms: 1400 },
  { keys: ['ArrowRight', FIRE, JUMP], ms: 900 },
  { keys: ['ArrowUp', FIRE], ms: 900 },
  { keys: ['ArrowRight', FIRE], ms: 1600 },
  { keys: ['ArrowRight', FIRE, JUMP], ms: 900 },
  { keys: ['ArrowRight', FIRE], ms: 1600 },
];

const sample = (page: Page): Promise<BotSnapshot | null> =>
  page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    if (!d) return null;
    return { frame: d.frame, state: d.state, score: d.score, kills: d.kills, x: d.player.position.x, armor: d.player.armor };
  });

test('bot playtest: real input clears enemies and advances the stage', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Keyboard bot; touch input is covered by visual.spec.ts.');
  test.setTimeout(90_000);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.seed(12345));
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await sample(page))?.state).toBe('playing');

  const before = (await sample(page)) as BotSnapshot;
  const snapshots: BotSnapshot[] = [before];
  let softlockWindows = 0;

  for (const step of INPUT_SCRIPT) {
    for (const key of step.keys) await page.keyboard.down(key);
    await page.waitForTimeout(step.ms);
    for (const key of step.keys) await page.keyboard.up(key);
    const snap = await sample(page);
    const prev = snapshots[snapshots.length - 1];
    if (!snap) continue;
    const moved = Math.abs(snap.x - prev.x);
    const progressed = snap.score > prev.score || snap.kills > prev.kills;
    if (snap.state === 'playing' && snap.frame > prev.frame && moved < 0.2 && !progressed) softlockWindows += 1;
    snapshots.push(snap);
  }

  const after = snapshots[snapshots.length - 1];
  const report = {
    steps: INPUT_SCRIPT.length,
    framesAdvanced: after.frame - before.frame,
    xBefore: before.x,
    xAfter: after.x,
    kills: after.kills,
    scoreAfter: after.score,
    finalState: after.state,
    softlockWindows,
    consoleErrors,
    pageErrors,
  };
  await testInfo.attach('bot-playtest-report', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  console.log(`bot playtest: ${JSON.stringify(report)}`);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(report.framesAdvanced).toBeGreaterThan(100);
  expect(report.xAfter - report.xBefore, 'player must push forward through the level').toBeGreaterThan(15);
  expect(report.kills, 'bot should destroy at least one enemy').toBeGreaterThan(0);
  expect(report.scoreAfter).toBeGreaterThan(before.score);
  expect(report.softlockWindows).toBeLessThanOrEqual(2);
});

test('fail state offers continue and resumes play from the checkpoint', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Flow check runs once on desktop.');
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('game-over'));
  await expect(page.locator('#overlay-gameover')).toBeVisible();
  await page.locator('#overlay-gameover [data-action="continue"]').click();
  await expect.poll(async () => (await sample(page))?.state).toBe('playing');
  const snap = (await sample(page)) as BotSnapshot;
  expect(snap.armor).toBeGreaterThan(0);

  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowRight');
  await expect.poll(async () => (await sample(page))?.x ?? 0).toBeGreaterThan(snap.x + 1);
});
