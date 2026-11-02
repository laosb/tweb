import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function saveAndVerifyWords(page) {
  const list = page.locator('ol[dir=ltr] li');
  await expect(list).toHaveCount(24);
  const words = await list.allTextContents();
  assert.equal(words.length, 24);
  await expect(page.getByRole('heading', {name: 'Recovery Words', exact: true, level: 1})).toBeVisible();
  await expect(page.locator('p[tabindex="-1"]')).toBeFocused();
  const done = page.getByRole('button', {name: 'Done', exact: true});
  await expect(done).toBeEnabled();
  await done.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('input[list]')).toHaveCount(3);
  await expect(page.getByRole('heading', {name: 'Verify Recovery Words', exact: true, level: 1})).toBeVisible();
  await expect(page.locator('input[list]').first()).toBeFocused();
  for(const input of await page.locator('input[list]').all()) {
    const label = await input.getAttribute('aria-label') || await input.evaluate((element) => element.labels?.[0]?.textContent || element.closest('.input-field')?.textContent);
    const position = Number(label.match(/\d+/)[0]) - 1;
    await input.fill(words[position]);
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Continue', exact: true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('input[list]').last()).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  return words;
}

export async function pasteWords(page, words) {
  const input = page.locator('input[list]').first();
  await input.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', {clipboardData, bubbles: true, cancelable: true}));
  }, words.join(' '));
  assert.equal(await page.locator('input[list]').count(), 24);
}
