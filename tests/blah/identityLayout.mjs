import assert from 'node:assert/strict';

export async function checkIdentityLayout(page) {
  for(const rtl of [false, true]) {
    await page.evaluate((rtl) => document.documentElement.dir = rtl ? 'rtl' : 'ltr', rtl);
    for(const width of [320, 375, 900]) {
      await page.setViewportSize({width, height: 800});
      const overflows = await page.locator('#auth-pages').evaluate((root) => [...root.querySelectorAll('form, ol, input, button')]
        .filter((element) => element.getClientRects().length && element.getBoundingClientRect().right > innerWidth + 1)
        .map((element) => element.tagName));
      assert.deepEqual(overflows, []);
    }
  }
}
