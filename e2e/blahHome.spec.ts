import {expect, test, type Page} from '@playwright/test';
import {openStory, preparePopupSandbox} from './popupSandbox.helpers';

// Each popup by its own content: `.popup.active` re-resolves as dialogs stack and close.
const popups = (page: Page) => ({
  details: page.locator('.popup.active', {hasText: 'Profile domains'}),
  change: page.locator('.popup.active', {has: page.getByRole('textbox', {name: 'DC domain', exact: true})}),
  confirm: page.locator('.popup-confirmation.active')
});

test('identity details show the home DC and move it to this account’s DC first', async({page}) => {
  await preparePopupSandbox(page, false, {a11y: true});
  await page.setViewportSize({width: 390, height: 844});
  expect(await openStory(page, 'blah/identity-details')).toBeNull();
  const {details, change, confirm} = popups(page);
  await expect(details.getByText('old.example.org', {exact: true})).toBeVisible();
  await expect(details.getByText('Another DC', {exact: true})).toBeVisible();
  await expect(details.getByText('12345', {exact: true})).toBeVisible();
  await expect(details.getByText(/Change its home DC to dc\.example\.org/)).toBeVisible();
  await details.getByText('Change home DC', {exact: true}).click();

  const rows = change.locator('.row');
  await expect(rows.first()).toContainText('dc.example.org');
  await expect(rows.first()).toContainText('This account’s DC');
  await expect(change.getByRole('textbox', {name: 'DC domain', exact: true})).toBeVisible();
  await rows.first().click();

  await expect(confirm).toContainText('Your account on old.example.org will be deleted');
  await expect(confirm).toContainText('sign in to dc.example.org');
  await confirm.getByRole('button', {name: 'Change home DC', exact: true}).click();

  await expect(change).toHaveCount(0);
  await expect(details.getByText('This account’s DC', {exact: true})).toBeVisible();
  await expect(details.getByText('Not allocated yet', {exact: true})).toBeVisible();
  await expect(details.getByText(/Change its home DC to/)).toHaveCount(0);
});

test('a home change to another DC is entered by domain and can be cancelled', async({page}) => {
  await preparePopupSandbox(page, false, {a11y: true});
  expect(await openStory(page, 'blah/identity-details')).toBeNull();
  const {details, change, confirm} = popups(page);
  await details.getByText('Change home DC', {exact: true}).click();
  await change.getByRole('textbox', {name: 'DC domain', exact: true}).fill('dc3.example.org');
  await change.getByRole('button', {name: 'Change home DC', exact: true}).click();
  await expect(confirm).toContainText('sign in to dc3.example.org');
  await confirm.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(confirm).toHaveCount(0);
  await expect(change).toBeVisible();
  await change.getByRole('button', {name: 'Change home DC', exact: true}).click();
  await confirm.getByRole('button', {name: 'Change home DC', exact: true}).click();
  await expect(change).toHaveCount(0);
  await expect(details.getByText('dc3.example.org', {exact: true})).toBeVisible();
  await expect(details.getByText('Another DC', {exact: true})).toBeVisible();
});
