import {checkVisibleLanguage} from './languageCoverage.mjs';
import {expect as baseExpect} from '@playwright/test';

const expect = baseExpect.configure({timeout: 20_000});

export async function checkLanguageSurfaces({page, frame, showMessage, messageMids, photo, strings, artifacts}) {
  const snapshot = async(name) => {
    await page.waitForTimeout(350); // let popup/menu opacity transitions finish before checking visible keys
    await checkVisibleLanguage(frame, strings, name, artifacts);
  };
  const closePopup = async() => {
    await page.keyboard.press('Escape');
    await expect(frame.locator('.popup')).toHaveCount(0);
  };
  for(const rtl of [false, true]) {
    await frame.evaluate(rtl => window.I18n.forceRTL(rtl), rtl);
    await showMessage(messageMids.get('Widget photo regression'));
    const photoBubble = frame.locator(`.bubble[data-mid="${messageMids.get('Widget photo regression')}"]`);
    await frame.evaluate(() => window.getSelection()?.removeAllRanges());
    await photoBubble.locator('img.media-photo').last().click();
    const viewer = frame.locator('.media-viewer-whole.active');
    await expect(viewer).toBeVisible();
    await frame.evaluate(() => window.appMediaViewer.setMoverAnimationPromise);
    await viewer.getByRole('button', {name: 'More', exact: true}).click();
    const menu = frame.getByRole('menu').filter({visible: true});
    await expect(menu.getByText('Edit this photo', {exact: true})).toBeVisible();
    await snapshot('viewer-menu-' + rtl);
    await menu.getByRole('menuitem', {name: 'Edit this photo', exact: true}).click();
    const editor = frame.locator('.media-editor__overlay');
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute('aria-busy', 'false');
    for(const tab of ['Crop', 'Text', 'Draw', 'Adjustments']) {
      await editor.getByRole('tab', {name: tab, exact: true}).click();
      await expect(editor.getByRole('tab', {name: tab, exact: true})).toHaveAttribute('aria-selected', 'true');
      await snapshot('editor-' + tab + '-' + rtl);
    }
    await editor.getByRole('button', {name: 'Close', exact: true}).click();
    await expect(editor).toHaveCount(0);
    await frame.evaluate(() => window.appImManager.chat.input.clearHelper());
    if(await viewer.count()) {
      await page.keyboard.press('Escape');
      await expect(viewer).toHaveCount(0);
    }

    await frame.evaluate(() => {
      const input = window.appImManager.chat.input;
      input.setInputValue('Formatting coverage', true);
      input.setMessageInputExpanded(true);
    });
    const toolbar = frame.locator('.message-input-editor-toolbar-bottom');
    await expect(toolbar).toBeVisible();
    for(const label of ['More actions', 'Lists and details']) {
      const button = toolbar.getByRole('button', {name: label, exact: true});
      await button.click();
      await expect(frame.getByRole('menu').filter({visible: true})).toBeVisible();
      await snapshot('format-' + label.replaceAll(' ', '-') + '-' + rtl);
      await frame.locator('.btn-menu-overlay').evaluate(element => element.click());
      await expect(frame.getByRole('menu').filter({visible: true})).toHaveCount(0);
    }
    await frame.evaluate(() => window.appImManager.chat.input.scheduleSending());
    await expect(frame.locator('.popup.active')).toBeVisible();
    await snapshot('schedule-' + rtl);
    await closePopup();
    await frame.evaluate(() => {
      const input = window.appImManager.chat.input;
      input.setMessageInputExpanded(false);
      input.setInputValue('', true);
    });
    await showMessage(messageMids.get('Widget photo regression'));
    await photoBubble.getByText('Widget photo regression', {exact: true}).click({button: 'right'});
    await frame.locator('#bubble-contextmenu').getByRole('menuitem', {name: 'Delete', exact: true}).click();
    await expect(frame.locator('.popup.active')).toBeVisible();
    await snapshot('delete-' + rtl);
    await frame.locator('.popup.active').getByText('Cancel', {exact: true}).click();
    await expect(frame.locator('.popup.active')).toHaveCount(0);

    const [picker] = await Promise.all([page.waitForEvent('filechooser'),
      frame.evaluate(() => window.appImManager.chat.input.onAttachClick(false, true, true))]);
    await picker.setFiles([{name: 'coverage-one.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64')},
      {name: 'coverage-two.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64')}]);
    const popup = frame.locator('.popup-new-media');
    await expect(popup).toBeVisible();
    await popup.getByRole('button', {name: 'More', exact: true}).click();
    await expect(frame.getByRole('menu').filter({visible: true})).toBeVisible();
    await snapshot('album-menu-' + rtl);
    await page.keyboard.press('Escape');
    await closePopup();
  }
  await frame.evaluate(() => window.I18n.forceRTL(false));
  const mid = messageMids.get('Widget photo regression');
  const excluded = await frame.evaluate(async(mid) => (await window.widgetLanguageFixtures()).excludedMessages(), mid);
  for(const rtl of [false, true]) {
    await frame.evaluate(rtl => window.I18n.forceRTL(rtl), rtl);
    for(let index = 0; index < excluded; ++index) {
      const preview = await frame.evaluate(async({mid, index}) =>
        (await window.widgetLanguageFixtures()).renderExcluded(mid, index), {mid, index});
      expect(preview).toContain('Unsupported Message');
      await expect(frame.locator(`.bubble[data-mid="${mid}"] .bubble-unsupported`)).toBeVisible();
      await snapshot('excluded-' + index + '-' + rtl);
    }
  }
  await frame.evaluate(async(mid) => (await window.widgetLanguageFixtures()).restoreMessage(mid), mid);
  await expect(frame.locator(`.bubble[data-mid="${mid}"] .bubble-unsupported`)).toHaveCount(0);
  await frame.evaluate(() => window.I18n.forceRTL(false));
  console.log('PASS excluded received families: bubbles and previews fall back in LTR/RTL');
  const previews = await frame.evaluate(async(mid) => {
    const fixture = await window.widgetLanguageFixtures();
    return fixture.renderPreviews(window.appImManager.chat.getMessage(mid));
  }, messageMids.get('Widget photo regression'));
  expect(previews.rows).toBeGreaterThan(40);
  expect(previews.text).toContain('Application service text');
  expect(previews.text).not.toMatch(/\[messageAction|SelfDestructingOnMobile\./);
  await showMessage(messageMids.get('Widget photo regression'));
  await frame.evaluate(async(mid) => (await window.widgetLanguageFixtures()).addTextEntities(mid), messageMids.get('Widget photo regression'));
  const textEntities = frame.locator('#widget-language-links');
  await textEntities.locator('.formatted-date').click();
  await expect(frame.getByRole('menu').filter({visible: true})).toBeVisible();
  await snapshot('formatted-date');
  await frame.getByRole('menuitem', {name: 'Copy Date', exact: true}).click();
  await expect(frame.getByRole('menu').filter({visible: true})).toHaveCount(0);
  await page.waitForTimeout(350);
  await expect(textEntities.locator('a')).toHaveAttribute('onclick', 'showMaskedAlert(this)');
  // Invoke the same confirmation handler as a received masked link.
  await textEntities.locator('a').evaluate(element => window.showMaskedAlert(element));
  await expect(frame.locator('.popup.active')).toBeVisible();
  await snapshot('masked-link');
  await closePopup();
  await textEntities.evaluate(element => element.remove());
  await Promise.all([frame.waitForNavigation(), frame.evaluate(() => location.reload())]);
  await expect(frame.getByRole('textbox', {name: 'Message'})).toBeVisible();
  console.log('PASS language surfaces: viewer edit menu, photo editor tabs, expanded formatting, delete confirmation, album options in LTR/RTL');
}
