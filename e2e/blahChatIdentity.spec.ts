import {expect, test} from '@playwright/test';
import {openStory, preparePopupSandbox} from './popupSandbox.helpers';

for(const rtl of [false, true]) {
  test(`chat creation verifies recovery words before preparing custody (${rtl ? 'RTL' : 'LTR'})`, async({page}) => {
    await preparePopupSandbox(page, false, {a11y: true});
    await page.evaluate((rtl) => document.documentElement.dir = rtl ? 'rtl' : 'ltr', rtl);
    await page.setViewportSize({width: 390, height: 844});
    expect(await openStory(page, 'blah/cross-server-words')).toBeNull();
    const dialog = page.getByRole('dialog', {name: 'Cross-server', exact: true});
    await expect(dialog.locator('ol li')).toHaveCount(24);
    const words = await dialog.locator('ol li').allTextContents();
    const done = dialog.getByRole('button', {name: 'Done', exact: true});
    await expect(done).toBeDisabled();
    await expect(done).toBeEnabled();
    await expect(dialog.locator('p[tabindex="-1"]')).toBeFocused();
    await done.focus();
    await page.keyboard.press('Space');
    await expect(dialog.locator('input[list]')).toHaveCount(3);
    await expect(dialog.locator('input[list]').first()).toBeFocused();
    const continueButton = dialog.getByRole('button', {name: 'Continue', exact: true});
    await expect(continueButton).toBeDisabled();
    for(const input of await dialog.locator('input[list]').all()) {
      const label = await input.evaluate((element: HTMLInputElement) => element.labels?.[0]?.textContent || element.closest('.input-field').textContent);
      await input.fill(words[Number(label.match(/\d+/)[0]) - 1]);
    }
    await continueButton.click();
    await expect(dialog.getByRole('button', {name: 'Export public profile', exact: true})).toBeVisible();
    await expect(dialog.locator('input[type=password], input[type=file]')).toHaveCount(0);
    await dialog.getByRole('button', {name: 'New Channel', exact: true}).click();
    await expect(dialog).toContainText('chat is now bound');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}

test('chat restore pastes all 24 words into individual autocomplete fields', async({page}) => {
  await preparePopupSandbox(page, false, {a11y: true});
  expect(await openStory(page, 'blah/restore-chat')).toBeNull();
  const dialog = page.getByRole('dialog', {name: 'Restore chat identity', exact: true});
  await dialog.getByRole('textbox', {name: 'Profile domain', exact: true}).fill('news.example.org');
  await expect(dialog.locator('input[list]')).toHaveCount(24);
  await dialog.locator('input[list]').first().evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', Array(23).fill('abandon').concat('art').join(' '));
    element.dispatchEvent(new ClipboardEvent('paste', {clipboardData, bubbles: true, cancelable: true}));
  });
  await expect(dialog.locator('input[list]').last()).toHaveValue('art');
  await expect(dialog.locator('datalist option')).toHaveCount(2048);
  await expect(dialog.getByRole('button', {name: 'Continue', exact: true})).toBeEnabled();
});


test('prepared chat setup resumes with publication focus and restores its opener', async({page}) => {
  await preparePopupSandbox(page, false, {a11y: true});
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Resume setup opener';
    document.body.append(button); button.focus();
  });
  expect(await openStory(page, 'blah/cross-server-publication')).toBeNull();
  const dialog = page.getByRole('dialog', {name: 'Cross-server', exact: true});
  await expect(dialog.locator('ol')).toHaveCount(0);
  await expect(dialog.getByRole('button', {name: 'Export public profile', exact: true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Resume setup opener', exact: true})).toBeFocused();
});
