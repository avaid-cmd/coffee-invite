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
      // Observe Leaflet marker updates without adding test hooks to application code.
      await page.addInitScript(() => {
        let leaflet;
        window.markerMoves = [];
        Object.defineProperty(window, 'L', {
          configurable: true,
          get() { return leaflet; },
          set(value) {
            leaflet = value;
            const original = value.Marker.prototype.setLatLng;
            value.Marker.prototype.setLatLng = function () {
              const result = original.apply(this, arguments);
              const point = this.getLatLng();
              window.markerMoves.push([point.lat, point.lng]);
              return result;
            };
          }
        });
      });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url + '?test=' + Date.now(), { waitUntil: 'networkidle' });
      assert.equal(await page.title(), 'Маленькая авантюра');
      assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 250, 240)', 'Light theme');
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
      const allowedLand = new Set(await page.locator('#land-points').evaluate(el =>
        JSON.parse(el.textContent).map(point => JSON.stringify(point))));
      assert.ok(allowedLand.size > 1000, 'Mapped city streets and footpaths available');
      const falsePin = page.locator('.pin-button:not(.correct)').first();
      for (let i = 0; i < 15; i++) {
        const before = await falsePin.boundingBox();
        const mapBefore = await page.locator('#map').boundingBox();
        if (contextOptions.hasTouch) await falsePin.tap(); else await falsePin.click();
        const after = await falsePin.boundingBox();
        const target = await page.evaluate(() => window.markerMoves.at(-1));
        assert.ok(allowedLand.has(JSON.stringify(target)), 'Jump lands on a mapped street or footpath, never arbitrary sea pixels');
        assert.ok(Math.hypot(before.x-after.x,before.y-after.y) >= Math.min(mapBefore.width,mapBefore.height)*0.40, 'False pin makes a large jump');
        const mapAfter = await page.locator('#map').boundingBox();
        assert.ok(after.x >= mapAfter.x && after.x+after.width <= mapAfter.x+mapAfter.width && after.y >= mapAfter.y && after.y+after.height <= mapAfter.y+mapAfter.height, 'Jump stays inside map');
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
            const viewport = page.viewportSize();
            assert.ok(Math.hypot(before.x-after.x,before.y-after.y) >= Math.min(viewport.width,viewport.height)*0.40, 'Answer makes a large jump');
            assert.ok(after.width <= 220 && after.height < 52, 'Compact answer button');
            assert.ok(after.x >= 0 && after.x+after.width <= viewport.width && after.y >= 0 && after.y+after.height <= viewport.height, 'Answer stays on screen');
            const good = await page.locator('#' + step + ' .good').boundingBox();
            assert.ok(after.x+after.width <= good.x || after.x >= good.x+good.width || after.y+after.height <= good.y || after.y >= good.y+good.height, 'Correct answer stays accessible');
            assert.ok(await page.locator('#' + step).isVisible());
          }
        }
        await page.locator('#' + step + ' .good').click();
        if (step === 'q2') {
          assert.ok(await page.locator('#photo').isVisible(), 'Correct answer reveals photo step');
          assert.ok(await page.getByText('Здесь будет фото', { exact: true }).isVisible());
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
