import {expect, test} from '@playwright/test';
import {openStory, preparePopupSandbox} from './popupSandbox.helpers';

for(const rtl of [false, true]) {
  test(`hosted name controls stay within narrow identity settings (${rtl ? 'RTL' : 'LTR'})`, async({page}) => {
    await preparePopupSandbox(page, false, {a11y: true});
    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate((rtl) => document.documentElement.dir = rtl ? 'rtl' : 'ltr', rtl);
    expect(await openStory(page, 'blah/identity-hosted')).toBeNull();
    await page.getByRole('button', {name: 'Add a hosted name', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Add a hosted name', exact: true});
    await dialog.getByRole('textbox', {name: 'Hosting domain', exact: true}).fill('names.example.org');
    await dialog.getByRole('textbox', {name: 'Name', exact: true}).fill('alice');
    await expect(dialog.getByRole('button', {name: 'Claim and publish', exact: true})).toBeEnabled();
    expect(await dialog.locator('input, button').evaluateAll((elements) => elements.every((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth;
    }))).toBe(true);
    await dialog.getByRole('button', {name: 'Claim and publish', exact: true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('dialog', {name: 'Blah Identity', exact: true})).toContainText('alice.names.example.org');
  });
}

test('non-holder settings offer recovery words without domain mutation controls', async({page}) => {
  await preparePopupSandbox(page, false, {a11y: true});
  expect(await openStory(page, 'blah/identity-non-holder')).toBeNull();
  const dialog = page.getByRole('dialog', {name: 'Blah Identity', exact: true});
  await expect(dialog.getByRole('button', {name: 'Enter Recovery Words', exact: true})).toBeVisible();
  await expect(dialog.getByRole('button', {name: 'Remove Recovery Words from This Device', exact: true})).toHaveCount(0);
  await expect(dialog.getByRole('button', {name: 'Add domain', exact: true})).toHaveCount(0);
});
