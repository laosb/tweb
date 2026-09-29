import assert from 'node:assert/strict';

// Exercise actual controls with maximum DNS names, full hashes and unbroken text.
export async function checkIdentityLayout(page) {
  const domain = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
  const picker = page.getByRole('combobox', {name: 'Saved identity', exact: true});
  const dialog = page.getByRole('dialog');
  async function fits(locator) {
    assert.deepEqual(await locator.evaluate(root => {
      return [root, ...root.querySelectorAll('fieldset, form, p, code, details, .row, .input-field, button')]
        .filter(element => element.getClientRects().length && getComputedStyle(element).overflowX === 'visible' &&
          element.scrollWidth > element.clientWidth + 1)
        .map(element => ({tag: element.tagName, class: element.className, text: element.textContent.slice(0, 80)}));
    }), [], 'Visible text must stay within its container');
    assert(await locator.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth;
    }), 'Container must fit the viewport');
  }
  async function widths(locator) {
    for(const width of [320, 375, 900]) {
      await page.setViewportSize({width, height: 720});
      await fits(locator);
    }
    await page.setViewportSize({width: 375, height: 720});
  }
  await picker.fill('create');
  await page.getByRole('option', {name: 'Create identity', exact: true}).click();
  await dialog.getByLabel('Profile domain', {exact: true}).fill(domain);
  await widths(dialog);
  await dialog.getByLabel('Identity password', {exact: true}).fill('long identity password');
  await dialog.getByRole('button', {name: 'Create identity', exact: true}).click();
  const details = page.getByRole('dialog', {name: 'Identity details', exact: true});
  await details.waitFor();
  await details.getByRole('button', {name: 'Export public profile', exact: true}).waitFor();
  // Error text is supplied by operations; probe its layout without causing a write.
  await details.getByRole('status').evaluate(element => element.textContent = 'LongError'.repeat(100));
  await widths(details);
  const hashes = details.locator('code[title]');
  assert(await hashes.count() >= 1, 'Exercise identity IDs');
  for(const hash of await hashes.all()) {
    assert.equal(await hash.getAttribute('title'), await hash.textContent(), 'Keep the complete ID');
    await hash.dblclick();
    assert.equal(await page.evaluate(() => getSelection().toString()), await hash.textContent(), 'Select the full ID despite ellipsis');
    assert.equal(await hash.evaluate(element => getComputedStyle(element).textOverflow), 'ellipsis');
    assert(await hash.evaluate(element => element.clientWidth <= 32 * parseFloat(getComputedStyle(element).fontSize)), 'Bound identifier width');
  }
  await hashes.first().scrollIntoViewIfNeeded();
  if(process.env.BLAH_IDENTITY_SCREENSHOT) await details.screenshot({path: process.env.BLAH_IDENTITY_SCREENSHOT + '-long-details.png', animations: 'disabled'});
  await details.getByRole('button', {name: 'Lock identity', exact: true}).click();
  await details.waitFor({state: 'detached'});
  await page.getByRole('button', {name: 'Identity details', exact: true}).click();
  await details.getByRole('button', {name: 'Unlock identity', exact: true}).waitFor();
  await widths(details);
  await details.getByRole('button', {name: 'Close', exact: true}).click();
  await details.waitFor({state: 'detached'});
  await picker.focus();
  await widths(page.getByRole('region', {name: 'Identity Manager'}));
  const option = page.getByRole('option').filter({hasText: domain});
  assert.equal(await option.locator('span').getAttribute('title'), await option.innerText());
  assert.equal(await option.locator('span').evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap');
  await picker.fill('import');
  await page.getByRole('option', {name: 'Import identity from file', exact: true}).click();
  await dialog.locator('input[type=file]').setInputFiles({name: 'identity'.repeat(30) + '.json', mimeType: 'application/json', buffer: Buffer.from('{}')});
  await widths(dialog);
  await dialog.getByRole('button', {name: 'Close', exact: true}).click();
  await dialog.waitFor({state: 'detached'});
  await page.getByText('Your keys are never uploaded.', {exact: false}).waitFor({state: 'detached'});
}
