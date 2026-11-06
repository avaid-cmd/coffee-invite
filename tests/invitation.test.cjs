// npm install --no-save playwright
// node --test tests/invitation.test.cjs
// Tests only the published website; no local application server is started.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit, devices } = require('playwright');
const url = process.env.INVITATION_URL || 'https://avaid-cmd.github.io/coffee-invite/';
for (const [name, engine, contextOptions] of [
  ['iPhone / WebKit', webkit, { ...devices['iPhone 13'] }],
  ['small iPhone / WebKit', webkit, { ...devices['iPhone SE'] }],
  ['Android / Chrome', chromium, { ...devices['Pixel 7'] }],
  ['desktop / Chrome', chromium, { viewport: { width: 1280, height: 900 } }]
]) {
  test(name + ': five choices, evasion, correct route, responsive bounds', { timeout: 120000 }, async () => {
    const options = engine === chromium ? { channel: 'chrome' } :
      (process.env.WEBKIT_EXECUTABLE ? { executablePath: process.env.WEBKIT_EXECUTABLE } : {});
    const browser = await engine.launch(options);
    try {
      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url + '?test=' + Date.now(), { waitUntil: 'networkidle' });
      assert.equal(await page.title(), 'Маленькая авантюра');
      await page.locator('.pin-button').last().waitFor();
      assert.equal(await page.locator('.pin-button').count(), 5);
      assert.equal(await page.locator('.pin-button.correct').count(), 1);
      assert.ok(await page.locator('.leaflet-tile-loaded').count() > 0, 'Real map tiles loaded');
      await page.evaluate(() => { location.hash = 'final'; });
      assert.ok(await page.locator('#q1').isVisible(), 'Hash cannot skip the game');
      for (const pin of await page.locator('.pin-button').all()) {
        const box = await pin.boundingBox();
        const map = await page.locator('#map').boundingBox();
        assert.ok(box.x >= map.x && box.x + box.width <= map.x + map.width, 'Pin horizontally inside map');
        assert.ok(box.y >= map.y && box.y + box.height <= map.y + map.height, 'Pin vertically inside map');
      }
      const falsePin = page.locator('.pin-button:not(.correct)').first();
      for (let i = 0; i < 15; i++) {
        const before = await falsePin.boundingBox();
        if (contextOptions.hasTouch) await falsePin.tap(); else await falsePin.click();
        const after = await falsePin.boundingBox();
        assert.ok(before.x !== after.x || before.y !== after.y, 'False pin always moves');
        assert.ok(await page.locator('#q1').isVisible());
        assert.equal(await page.locator('.leaflet-popup').count(), 0);
      }
      await page.locator('.pin-button.correct').click();
      await page.getByRole('button', { name: 'Дальше →', exact: true }).click();
      for (const step of ['q2', 'q3']) {
        assert.ok(await page.locator('#' + step).isVisible());
        assert.equal(await page.locator('#' + step + ' .choice').count(), 5);
        assert.equal(await page.locator('#' + step + ' .good').count(), 1);
        for (const button of await page.locator('#' + step + ' .bad').all()) {
          for (let i = 0; i < 8; i++) {
            const before = await button.boundingBox();
            if (contextOptions.hasTouch) await button.tap(); else await button.click();
            const after = await button.boundingBox();
            assert.ok(before.x !== after.x || before.y !== after.y, 'False answer always moves');
            const arena = await page.locator('#' + step + ' .choices').boundingBox();
            assert.ok(after.x >= arena.x && after.x + after.width <= arena.x + arena.width, 'Answer inside card');
            const good = await page.locator('#' + step + ' .good').boundingBox();
            assert.ok(after.y + after.height <= good.y || after.y >= good.y + good.height, 'Correct answer stays accessible');
            assert.ok(await page.locator('#' + step).isVisible());
          }
        }
        await page.locator('#' + step + ' .good').click();
        if (step === 'q2') {
          assert.ok(await page.locator('#photo').isVisible(), 'Correct answer reveals photo step');
          assert.ok(await page.getByText('Здесь будет фото места', { exact: true }).isVisible());
          await page.locator('#photo .primary').click();
        }
      }
      assert.ok(await page.locator('#final').isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.reload({ waitUntil: 'networkidle' });
      assert.ok(await page.locator('#q1').isVisible(), 'Refresh restarts invitation');
    } finally {
      await browser.close();
    }
  });
}
