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
            const initialize = value.Marker.prototype.initialize;
            value.Marker.prototype.initialize = function (latlng, options) {
              const result = initialize.apply(this, arguments);
              if (options && options.icon && options.icon.options.html.includes(' correct')) {
                const point = this.getLatLng();
                window.meetingPoint = [point.lat, point.lng];
              }
              return result;
            };
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
      assert.deepEqual(await page.evaluate(() => window.meetingPoint), [12.228754, 109.200047], 'Correct pin is Z Beach Nha Trang');
      const pinStyles = await page.locator('.pin-button').evaluateAll(pins => pins.map(pin => {
        const style = getComputedStyle(pin);
        return JSON.stringify([style.backgroundColor,style.width,style.height,style.borderRadius,pin.textContent]);
      }));
      assert.equal(new Set(pinStyles).size, 1, 'All five map pins look identical');
      assert.ok((await page.locator('.pin-button').allTextContents()).every(text => text === ''), 'Pins have no crosses or text');
      assert.equal(await page.locator('.pin-button').first().evaluate(pin => getComputedStyle(pin).backgroundColor), 'rgb(129, 174, 148)', 'All map pins are green');
      assert.equal(await page.locator('.footer').count(), 0, 'No test-version footer');
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
      assert.equal(await page.locator('.user-location').count(), 0, 'Location is requested only after a tap');
      await context.setGeolocation({ latitude: 12.2405, longitude: 109.1968, accuracy: 25 });
      await context.grantPermissions(['geolocation'], { origin: new URL(url).origin });
      await page.getByRole('button', { name: 'Моя локация' }).click();
      await page.locator('.user-location').waitFor({ state: 'attached' });
      assert.equal(await page.locator('#location-status').textContent(), 'Ты на карте');
      assert.equal(await page.locator('.user-location').count(), 1);
      assert.equal(await page.locator('.user-accuracy').count(), 1);
      await page.getByRole('button', { name: 'Моя локация' }).click();
      await page.waitForFunction(() => !document.getElementById('locate-me').disabled);
      assert.equal(await page.locator('.user-location').count(), 1, 'Repeated lookup updates one marker');
      assert.equal(await page.locator('.pin-button').count(), 5, 'Location marker is separate from five game pins');
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
      assert.equal(await page.locator('.leaflet-popup strong').textContent(), 'Z Beach Nha Trang');
      await page.getByRole('button', { name: 'Дальше →', exact: true }).click();
      for (const step of ['q2', 'q3']) {
        assert.ok(await page.locator('#' + step).isVisible());
        assert.equal(await page.locator('#' + step + ' .choice').count(), 5);
        assert.equal(await page.locator('#' + step + ' .good').count(), 1);
        const choices = page.locator('#' + step + ' .choice');
        const colors = await choices.evaluateAll(buttons => buttons.map(button => {
          const style = getComputedStyle(button);
          return JSON.stringify([style.backgroundColor,style.color,style.borderColor,style.fontWeight]);
        }));
        assert.equal(new Set(colors).size, 1, 'Correct answer has no visual color or weight hint');
        const first = await choices.nth(0).boundingBox();
        const second = await choices.nth(1).boundingBox();
        const third = await choices.nth(2).boundingBox();
        assert.ok(second.x > first.x && Math.abs(first.y-second.y) < 1, 'Answers are side by side in two columns');
        assert.ok(third.y > first.y, 'Third answer starts the next row');
        const labels = await choices.allTextContents();
        assert.deepEqual(labels, step === 'q2'
          ? ['В море','На подушках','На баре','У входа','Где-то в Нячанге']
          : ['18:00','00:00','19:30','14:00','17:00']);
        assert.equal(await page.locator('#' + step + ' .good').textContent(), step === 'q2' ? 'На баре' : '19:30');
        if (step === 'q3') assert.equal(await page.locator('#title3').textContent(), 'Я жду тебя в…');
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
          assert.equal(await page.locator('#meeting-label').textContent(), 'Z Beach Nha Trang');
          const photo = page.locator('#meeting-photo');
          await photo.evaluate(image => image.decode());
          const image = await photo.evaluate(image => ({
            loaded:image.complete, width:image.naturalWidth, height:image.naturalHeight, src:image.currentSrc
          }));
          assert.equal(image.loaded, true);
          assert.equal(image.width, 1032);
          assert.equal(image.height, 1280);
          assert.ok(image.src.endsWith('/z-beach.jpg'), 'Uploaded meeting photo is shown');
          const photoBox = await photo.boundingBox();
          assert.ok(photoBox.width <= page.viewportSize().width, 'Photo fits mobile screen');
          assert.ok(Math.abs(photoBox.height/photoBox.width - 1280/1032) < 0.01, 'Full photo preserves aspect ratio without cropping');
          assert.equal(await page.getByText('Здесь будет фото', { exact: true }).count(), 0);
          await page.locator('#photo .primary').click();
        }
      }
      assert.ok(await page.locator('#final').isVisible());
      assert.ok(await page.getByText('Я жду тебя в 19:30.', { exact: true }).isVisible(), 'Meeting time confirmed');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.reload({ waitUntil: 'networkidle' });
      assert.ok(await page.locator('#q1').isVisible(), 'Refresh restarts invitation');
      assert.equal(await page.getByText('Один вариант не убежит.', { exact: true }).count(), 0, 'No answer hints');
      assert.equal(await page.locator('.user-location').count(), 0);
      // Deterministically verify denial and timeout without needing physical GPS.
      await page.evaluate(() => {
        navigator.geolocation.getCurrentPosition = (success, error) => error({ code: 1, message: 'Denied' });
      });
      await page.getByRole('button', { name: 'Моя локация' }).click();
      assert.match(await page.locator('#location-status').textContent(), /Разреши доступ/);
      assert.equal(await page.getByRole('button', { name: 'Моя локация' }).isEnabled(), true);
      await page.evaluate(() => {
        navigator.geolocation.getCurrentPosition = (success, error) => error({ code: 3, message: 'Timeout' });
      });
      await page.getByRole('button', { name: 'Моя локация' }).click();
      assert.match(await page.locator('#location-status').textContent(), /Не удалось определить/);
      assert.equal(await page.getByRole('button', { name: 'Моя локация' }).isEnabled(), true);
      assert.equal(await page.locator('.pin-button').count(), 5);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
}
