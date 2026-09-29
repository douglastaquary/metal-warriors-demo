import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:5188';
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url);
await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5);
await page.keyboard.press('Enter');
await page.keyboard.down('ArrowRight');
const result = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      const startFrame = window.__THREE_GAME_DIAGNOSTICS__.frame;
      const t0 = last;
      const tick = (now) => {
        times.push(now - last);
        last = now;
        if (now - t0 < 4000) requestAnimationFrame(tick);
        else {
          times.sort((a, b) => a - b);
          const gameFrames = window.__THREE_GAME_DIAGNOSTICS__.frame - startFrame;
          resolve({
            rafFps: +(times.length / ((now - t0) / 1000)).toFixed(1),
            gameFps: +(gameFrames / ((now - t0) / 1000)).toFixed(1),
            p50: +times[Math.floor(times.length * 0.5)].toFixed(2),
            p95: +times[Math.floor(times.length * 0.95)].toFixed(2),
          });
        }
      };
      requestAnimationFrame(tick);
    }),
);
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const ext = c?.getExtension('WEBGL_debug_renderer_info');
  return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log(JSON.stringify({ ...result, gl }));
await browser.close();
