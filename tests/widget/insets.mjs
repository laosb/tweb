import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function checkStatusInsets(frame) {
  const result = await frame.locator('#widget').evaluate(el => {
    const sides = ['top', 'right', 'bottom', 'left'];
    sides.forEach((side, i) => document.documentElement.style.setProperty('--widget-inset-' + side, [44, 30, 34, 20][i] + 'px'));
    const computed = getComputedStyle(el);
    const padding = sides.map(side => parseFloat(computed.getPropertyValue('padding-' + side)));
    const content = el.firstElementChild.getBoundingClientRect();
    const inside = content.top >= 44 && content.right <= innerWidth - 30 && content.bottom <= innerHeight - 34 && content.left >= 20;
    sides.forEach(side => document.documentElement.style.removeProperty('--widget-inset-' + side));
    return {padding, inside};
  });
  assert.deepEqual(result, {padding: [68, 54, 58, 44], inside: true});
}

export async function checkInsets({page, frame, artifacts, showMessage, messageMids, photo}) {
  const original = [0, 0, 0, 0], native = [44, 30, 34, 20], keyboard = [24, 12, 100, 36];
  const setInsets = async(values) => {
    await frame.evaluate(values => {
      ['top', 'right', 'bottom', 'left'].forEach((side, i) => {
        if(values) document.documentElement.style.setProperty('--widget-inset-' + side, values[i] + 'px');
        else document.documentElement.style.removeProperty('--widget-inset-' + side);
      });
    }, values);
    await expect.poll(() => frame.evaluate(() => window.appImManager.chat.chatPaddingTop[0]())).toBe(values?.[0] || 0);
    await page.waitForTimeout(400);
  };
  const rect = locator => locator.evaluate(el => {
    const {left, top, right, bottom, width, height} = el.getBoundingClientRect();
    return {left, top, right, bottom, width, height};
  });
  const inside = async(locator, values, label) => {
    const box = await rect(locator);
    const size = await frame.evaluate(() => ({width: innerWidth, height: innerHeight}));
    assert(box.width > 0 && box.height > 0, label + ' has geometry');
    assert(box.left >= values[3] - 1 && box.top >= values[0] - 1 &&
      box.right <= size.width - values[1] + 1 && box.bottom <= size.height - values[2] + 1,
    label + ': ' + JSON.stringify({box, values, size}));
    return box;
  };
  const fullFrame = async(selector) => {
    const box = await rect(frame.locator(selector));
    const size = await frame.evaluate(() => ({width: innerWidth, height: innerHeight}));
    for(const key of ['top', 'left']) assert(Math.abs(box[key]) <= 1, selector + ' ' + key);
    for(const key of ['width', 'height']) assert(Math.abs(box[key] - size[key]) <= 1, selector + ' ' + key);
  };
  const composer = frame.locator('.chat.active .chat-input-main');
  const toBottom = async() => {
    await frame.evaluate(() => window.appImManager.chat.bubbles.scrollToEnd());
    await page.waitForTimeout(500);
  };
  const atBottom = async() => {
    await expect.poll(() => frame.evaluate(() => {
      const el = window.appImManager.chat.bubbles.scrollable.container;
      return Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop);
    })).toBeLessThanOrEqual(1);
  };
  const assertChat = async(values) => {
    const input = await inside(composer, values, 'composer stack');
    await fullFrame('.blah-widget-background');
    await fullFrame('.chat.active .bubbles-scrollable');
    const fades = await frame.locator('.bubbles-scrollable').evaluate(el => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;top:0;left:0;width:var(--bubbles-scrollable-fade-top);height:var(--bubbles-scrollable-fade-bottom);font-size:var(--page-chats-padding)';
      el.append(probe);
      const {width: top, height: bottom} = probe.getBoundingClientRect();
      const pagePadding = parseFloat(getComputedStyle(probe).fontSize);
      probe.remove();
      return {top, bottom, pagePadding};
    });
    assert.equal(fades.top, values[0] + 8, 'top fade includes inset and normal ramp');
    assert.equal(fades.bottom, values[2] + 56 + fades.pagePadding, 'bottom fade includes inset and normal band');
    const last = frame.locator('.chat.active .bubble[data-mid]').last().locator('.bubble-content').first();
    const box = await inside(last, values, 'last bubble at bottom');
    assert(box.bottom <= input.top + 1, 'last bubble clears composer');
    await atBottom();
    const avatars = frame.locator('.chat.active .bubbles-group-avatar');
    for(const avatar of await avatars.all()) {
      const box = await rect(avatar);
      if(box.bottom > values[0] && box.top < input.top) await inside(avatar, values, 'visible group avatar');
    }
  };
  await toBottom();
  await atBottom();
  const baseline = await rect(composer);
  for(const rtl of [false, true]) {
    await frame.evaluate(rtl => window.I18n.forceRTL(rtl), rtl);
    await toBottom();
    for(const values of [native, [34, 20, 44, 30], [44, 30, 0, 20], keyboard, native]) {
      await setInsets(values);
      await assertChat(values);
    }
    const insetBox = await rect(composer);
    assert(Math.abs(baseline.bottom - insetBox.bottom - native[2]) <= 1, 'composer follows bottom inset');
    await showMessage(messageMids.get(''));
    await frame.waitForFunction(() => !window.appImManager.chat.bubbles.isHeavyAnimationInProgress);
    await frame.evaluate(() => { window.appImManager.chat.bubbles.scrollable.container.scrollTop = 1; });
    await page.waitForTimeout(100);
    await frame.evaluate(() => { window.appImManager.chat.bubbles.scrollable.container.scrollTop = 0; });
    await page.waitForTimeout(600);
    await inside(frame.locator('.chat.active .bubble[data-mid]').first().locator('.bubble-content').first(), native, 'oldest bubble at top');
    await inside(frame.locator('.chat.active .is-date .bubble-content').first(), native, 'date pill');
    await expect(frame.locator('.chat.active .bubbles-go-down')).toBeVisible();
    await inside(frame.locator('.chat.active .bubbles-go-down'), native, 'go-down button');
    await toBottom();
    for(const theme of ['light', 'dark']) {
      await page.emulateMedia({colorScheme: theme});
      await page.waitForTimeout(400);
      await page.locator('iframe').screenshot({path: `${artifacts}/insets-chat-${theme}-${rtl ? 'rtl' : 'ltr'}.png`});
    }
    await setInsets(null);
    await assertChat(original);
    assert.deepEqual(await rect(composer), baseline, 'unsetting restores original composer geometry');
  }
  await frame.evaluate(() => window.I18n.forceRTL(false));
  await setInsets(native);
  await frame.evaluate(mid => window.appImManager.chat.input.initMessageReply({replyToMsgId: mid}), messageMids.get('Support photo'));
  await page.waitForTimeout(400);
  await inside(composer, native, 'reply composer stack');
  await atBottom();
  await frame.evaluate(() => window.appImManager.chat.input.clearHelper());
  await frame.evaluate(mid => window.appImManager.chat.input.initMessageEditing(mid), messageMids.get('Widget photo regression'));
  await page.waitForTimeout(400);
  await inside(composer, native, 'edit composer stack');
  await frame.evaluate(() => window.appImManager.chat.input.clearHelper());
  await frame.getByRole('textbox', {name: 'Message'}).fill('');
  await expect(frame.locator('.toggle-emoticons, .emoji-dropdown')).toHaveCount(0);
  await frame.locator('.chat.active .attach-file').click();
  const attachmentMenu = frame.getByRole('menu').filter({has: frame.getByRole('menuitem', {name: 'Document', exact: true})});
  await inside(attachmentMenu, native, 'attach menu');
  await page.keyboard.press('Escape');
  await toBottom();
  await frame.locator('.chat.active .bubble[data-mid]:not(.service)').getByText('Support quoted reply', {exact: true}).click({button: 'right'});
  const messageMenu = frame.locator('#bubble-contextmenu');
  await expect(messageMenu).toBeVisible();
  await page.waitForTimeout(400);
  console.log('Inset message-menu geometry (upstream viewport clamp):', JSON.stringify(await rect(messageMenu)));
  await page.locator('iframe').screenshot({path: `${artifacts}/insets-message-menu.png`});
  await messageMenu.getByRole('menuitem', {name: 'Delete', exact: true}).click();
  await expect(frame.locator('.popup.active')).toBeVisible();
  await page.waitForTimeout(400);
  await inside(frame.locator('.popup.active .popup-container'), native, 'delete confirmation');
  await frame.locator('.popup.active').getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(frame.locator('.popup')).toHaveCount(0);
  const [picker] = await Promise.all([page.waitForEvent('filechooser'),
    frame.evaluate(() => window.appImManager.chat.input.onAttachClick(false, true, true))]);
  await picker.setFiles({name: 'inset-preview.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64')});
  await expect(frame.locator('.popup-new-media')).toBeVisible();
  await page.waitForTimeout(400);
  await inside(frame.locator('.popup-new-media .popup-container'), native, 'send-media popup');
  await page.keyboard.press('Escape');
  // Discard confirmation, when the popup asks for one.
  const discard = frame.getByRole('button', {name: 'Discard', exact: true});
  if(await discard.isVisible()) {
    await inside(frame.locator('.popup-confirmation .popup-container'), native, 'discard confirmation');
    await discard.click();
  }
  await expect(frame.locator('.popup')).toHaveCount(0);

  for(const width of [390, 800]) {
    await page.locator('iframe').evaluate((el, width) => el.style.width = width + 'px', width);
    for(const rtl of [false, true]) {
      await frame.evaluate(rtl => window.I18n.forceRTL(rtl), rtl);
      await showMessage(messageMids.get('Widget photo regression'));
      await frame.locator(`.bubble[data-mid="${messageMids.get('Widget photo regression')}"] img.media-photo`).last().click();
      const viewer = frame.locator('.media-viewer-whole.active');
      await expect(viewer).toBeVisible();
      await frame.evaluate(() => window.appMediaViewer.setMoverAnimationPromise);
      const media = viewer.locator('.media-viewer-mover.center');
      const mediaBox = await rect(media);
      for(const values of [native, keyboard, original, native]) {
        await setInsets(values === original ? null : values);
        await fullFrame('.media-viewer');
        assert.deepEqual(await rect(media), mediaBox, 'insets do not resize or move media');
        await inside(viewer.locator('.media-viewer-topbar'), values, 'viewer topbar');
        await inside(viewer.locator('.media-viewer-caption'), values, 'viewer caption');
        if(width === 800) {
          for(const side of ['prev', 'next']) await inside(viewer.locator('.media-viewer-switcher-' + side), values, 'navigation ' + side);
        }
      }
      for(const theme of ['light', 'dark']) {
        await page.emulateMedia({colorScheme: theme});
        await page.waitForTimeout(400);
        await page.locator('iframe').screenshot({path: `${artifacts}/insets-viewer-${width}-${theme}-${rtl ? 'rtl' : 'ltr'}.png`});
      }
      if(width === 800) {
        await frame.evaluate(() => window.appMediaViewer.buttons.zoomin.click());
        await inside(viewer.locator('.zoom-container'), native, 'zoom control');
        await frame.evaluate(() => window.appMediaViewer.buttons.zoomin.click());
      }
      await page.keyboard.press('Escape');
      await expect(frame.locator('.media-viewer-whole')).toHaveCount(0);
    }
    await frame.evaluate(() => window.I18n.forceRTL(false));
    await showMessage(messageMids.get('Widget video regression'));
    await frame.locator(`.bubble[data-mid="${messageMids.get('Widget video regression')}"] video`).click();
    await expect(frame.locator('.media-viewer-whole.active')).toBeVisible();
    await expect.poll(() => frame.evaluate(() => !!window.appMediaViewer.videoPlayer)).toBe(true);
    await frame.evaluate(() => window.appMediaViewer.videoPlayer.lockControls(true));
    for(const values of [native, keyboard, original]) {
      await setInsets(values === original ? null : values);
      await inside(frame.locator('.media-viewer-whole .default__controls'), values, 'video controls');
      await inside(frame.locator('.media-viewer-whole .media-viewer-caption'), values, 'video caption');
      await fullFrame('.media-viewer');
    }
    await setInsets(native);
    await page.locator('iframe').screenshot({path: `${artifacts}/insets-video-${width}.png`});
    await page.keyboard.press('Escape');
    await expect(frame.locator('.media-viewer-whole')).toHaveCount(0);
  }
  await page.locator('iframe').evaluate(el => el.style.width = '390px');
  await frame.evaluate(() => window.I18n.forceRTL(false));
  await setInsets(null);
  await page.emulateMedia({colorScheme: 'light'});
  console.log('PASS live physical widget insets, scroll preservation, edge-to-edge surfaces, LTR/RTL and viewer geometry');
}
