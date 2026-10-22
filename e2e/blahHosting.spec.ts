import {expect, test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openStory, preparePopupSandbox} from './popupSandbox.helpers';

for(const kind of ['user', 'chat'] as const) for(const direction of ['ltr', 'rtl'] as const) test(`hosted ${kind} chooser availability, keyboard and narrow layout (${direction})`, async({page}) => {
  await preparePopupSandbox(page, false, {a11y: true});
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate((dir) => window.popupSandbox.setDirection(dir), direction);
  expect(await openStory(page, kind === 'chat' ? 'blah/hosted-chat-details' : 'blah/hosted-details')).toBeNull();
  const details = page.getByRole('dialog', {name: 'Identity details', exact: true});
  await details.getByRole('button', {name: 'Add a hosted name', exact: true}).click();
  const chooser = page.getByRole('dialog', {name: 'Add a hosted name', exact: true});
  const host = chooser.getByRole('textbox', {name: 'Hosting domain', exact: true});
  const name = chooser.getByRole('textbox', {name: 'Name', exact: true});
  await host.fill('id.example');
  await name.fill('taken');
  await expect(chooser.getByText('This name is taken. Choose another name.', {exact: true})).toBeVisible();
  await name.fill('invalid');
  await expect(chooser.getByText('Enter a valid host and name.', {exact: true})).toBeVisible();
  await name.fill('offline');
  await expect(chooser.getByText(/could not be reached/)).toBeVisible();
  await name.fill('limited');
  const claim = chooser.getByRole('button', {name: 'Claim and publish', exact: true});
  await expect(claim).toBeEnabled();
  await claim.focus();
  await page.keyboard.press('Enter');
  await expect(chooser.getByText(/Retry after 30 seconds/)).toBeVisible();
  await name.fill('proof');
  await expect(claim).toBeEnabled();
  const box = await chooser.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  expect(await host.getAttribute('dir')).toBe('ltr');
  const axe = await new AxeBuilder({page}).include('.popup.active').disableRules(['color-contrast']).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({path: `test-results/blah-hosting-${kind}-${direction}.png`});
  await claim.press('Space');
  await expect(chooser).toHaveCount(0);
  const added = details.getByRole('group', {name: 'proof.id.example', exact: true});
  await expect(added).toBeVisible();
  await added.getByRole('button', {name: 'Delete', exact: true}).click();
  await expect(added).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
});

test('create keeps custody after cancellation and terminates proof workers on close', async({page}) => {
  await preparePopupSandbox(page, false, {a11y: true});
  await page.evaluate(() => {
    const OriginalWorker = window.Worker;
    (window as any).proofWorkers = {started: 0, stopped: 0};
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if(String(url).includes('hostingPow')) {
          (window as any).proofWorkers.started++;
          const terminate = this.terminate.bind(this);
          this.terminate = () => { (window as any).proofWorkers.stopped++; terminate(); };
        }
      }
    };
  });
  expect(await openStory(page, 'blah/hosted-create')).toBeNull();
  const dialog = page.locator('.popup.active').last();
  await dialog.getByRole('combobox', {name: 'Profile address'}).selectOption('hosted');
  await dialog.getByLabel('Identity password', {exact: true}).fill('x');
  await dialog.getByRole('textbox', {name: 'Hosting domain', exact: true}).fill('id.example');
  const name = dialog.getByRole('textbox', {name: 'Name', exact: true});
  await name.fill('slow');
  const claim = dialog.getByRole('button', {name: 'Claim and publish'});
  await expect(claim).toBeEnabled();
  await claim.click();
  await expect(dialog.getByText(/Finding a proof:/)).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async() => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({name, value}) => [name, value]));
  const before = await metrics();
  await page.waitForTimeout(1000);
  const after = await metrics();
  expect(after.LayoutCount - before.LayoutCount).toBeLessThan(30);
  console.log('Proof progress over 1s:', {layouts: after.LayoutCount - before.LayoutCount,
    styleRecalculations: after.RecalcStyleCount - before.RecalcStyleCount, layoutSeconds: after.LayoutDuration - before.LayoutDuration});
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(dialog.getByText(/Claim cancelled/)).toBeVisible();
  await expect(dialog.getByText(/Your identity has been saved/)).toBeVisible();
  await expect(claim).toBeEnabled();
  await name.fill('locked');
  await expect(claim).toBeEnabled();
  await claim.click();
  await expect(dialog.getByText(/Claim cancelled/)).toBeVisible();
  await name.fill('slow');
  await expect(claim).toBeEnabled();
  await claim.click();
  await expect(dialog.getByText(/Finding a proof:/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const {started, stopped} = (window as any).proofWorkers;
    return started > 0 && started === stopped;
  })).toBe(true);
});

test('older runtime keeps the own-domain creation flow', async({page}) => {
  await preparePopupSandbox(page, false, {a11y: true});
  expect(await openStory(page, 'blah/identity-create')).toBeNull();
  const dialog = page.locator('.popup.active').last();
  await expect(dialog.getByRole('textbox', {name: 'Profile domain', exact: true})).toBeVisible();
  await expect(dialog.getByRole('combobox', {name: 'Profile address'})).toHaveCount(0);
});
