import assert from 'node:assert/strict';
import {expect as baseExpect} from '@playwright/test';

const expect = baseExpect.configure({timeout: 20_000});

export async function checkMessageActions({page, frame, incoming, outgoing}) {
  const menu = frame.locator('#bubble-contextmenu');
  for(const rtl of [false, true]) {
    await frame.evaluate(rtl => window.I18n.forceRTL(rtl), rtl);
    for(const message of [incoming, outgoing]) {
      for(const selected of [false, true]) {
        await message.evaluate(element => window.appImManager.chat.bubbles.scrollToBubble(element.closest('.bubble'), 'center'));
        await message.evaluate((element, selected) => {
          const selection = getSelection();
          selection.removeAllRanges();
          if(selected) {
            const range = document.createRange();
            range.selectNodeContents(element);
            selection.addRange(range);
          }
        }, selected);
        await message.click({button: 'right'});
        await expect(menu).toBeVisible();
        await expect(menu.getByText(/^(Pin|Unpin|Forward|Search|Search Selected)$/i)).toHaveCount(0);
        const buttons = await frame.evaluate(() => window.appImManager.chat.contextMenu.buttons.map(({text, icon}) => ({text, icon})));
        assert(!buttons.some(({icon}) => ['pin', 'unpin', 'forward', 'search', 'tag_filter'].includes(icon)), JSON.stringify(buttons));
        assert(!buttons.some(({text}) => ['Search', 'Chat.SearchSelected'].includes(text)));
        if(selected) assert(await frame.evaluate(() => !!getSelection().toString()), 'the menu was opened with text selected');
        await frame.evaluate(() => getSelection().removeAllRanges());
        await page.keyboard.press('Escape');
        await expect(menu).not.toBeVisible();
      }
    }
    await frame.evaluate(() => getSelection().removeAllRanges());
    const avatar = frame.locator('.bubbles-group-avatar').last();
    await frame.evaluate(() => window.appImManager.chat.bubbles.scrollToEnd());
    await avatar.click({button: 'right'});
    await expect(menu).toBeVisible();
    assert.equal(await frame.evaluate(() => window.appImManager.chat.contextMenu.buttons.some(({text}) => text === 'Search')), false);
    assert.equal(await frame.evaluate(() => window.appImManager.chat.contextMenu.buttons.some(({text}) => text === 'VoiceChat.OpenProfile')), false);
    await expect(menu.getByRole('menuitem', {name: 'Open Profile', exact: true})).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    await avatar.click();
    await expect(frame.locator('.popup.active')).toHaveCount(0);
    for(const shortcut of ['Control+f', 'Meta+f', 'Alt+f']) await page.keyboard.press(shortcut);
    assert.equal(await frame.evaluate(() => !!window.appImManager.chat.searchSignal()), false);
    await expect(frame.locator('.topbar-search, .chat-search, .popup-forward, .bubble-beside-button.forward')).toHaveCount(0);
    await expect(frame.locator('#column-left')).toBeHidden();
  }
  await frame.evaluate(() => window.I18n.forceRTL(false));
  await frame.evaluate(() => window.appImManager.chat.bubbles.scrollToEnd());
  console.log('PASS incoming/outgoing and selected-text menus, avatar search, search shortcuts (LTR/RTL)');
}

export async function checkTagClicks({page, frame, message}) {
  await message.evaluate(element => window.appImManager.chat.bubbles.scrollToBubble(element.closest('.bubble'), 'center'));
  await expect(message.locator('a')).toHaveCount(0);
  const before = page.context().pages().length;
  for(const tag of ['#widget_no_search', '$USD']) {
    await message.evaluate((element, tag) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for(let node; (node = walker.nextNode());) {
        const offset = node.textContent.indexOf(tag);
        if(offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + tag.length);
        const {x, y, width, height} = range.getBoundingClientRect();
        document.elementFromPoint(x + width / 2, y + height / 2).click();
        return;
      }
      throw new Error('Missing tag: ' + tag);
    }, tag);
  }
  assert.equal(page.context().pages().length, before);
  assert.equal(await frame.evaluate(() => !!window.appImManager.chat.searchSignal()), false);
  await expect(frame.locator('.popup.active, .topbar-search, .chat-search')).toHaveCount(0);
  console.log('PASS hashtag/cashtag clicks render no links and open no search');
}

export async function assertHiddenPins(frame, count) {
  // Observe the actual server events in storage before asserting their absence in DOM.
  await expect.poll(() => frame.evaluate(() => {
    const {chat} = window.appImManager;
    return chat.getHistoryStorage().history.slice.filter(mid => chat.getMessage(mid)?.action?._ === 'messageActionPinMessage').length;
  })).toBe(count);
  await expect.poll(() => frame.evaluate(() => {
    const {chat} = window.appImManager;
    const {bubbles} = chat;
    const mids = chat.getHistoryStorage().history.slice.filter(mid => chat.getMessage(mid)?.action?._ === 'messageActionPinMessage');
    return mids.every(mid => bubbles.skippedMids.has(`${chat.peerId}_${mid}`) && !bubbles.getBubble(chat.peerId, mid));
  })).toBe(true);
  await expect(frame.locator('.bubble.service').filter({hasText: /pinned/i})).toHaveCount(0);
  await expect.poll(() => frame.evaluate(() => {
    const {bubbles} = window.appImManager.chat;
    return bubbles.scrollable.loadedAll.bottom && bubbles.scrolledDown;
  })).toBe(true);
  await expect.poll(() => frame.locator('.bubbles .scrollable-y').evaluate(element =>
    Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThan(2);
  await expect(frame.locator('.chat .topbar, .pinned-message')).toHaveCount(0);
  await expect.poll(() => frame.evaluate(async() => {
    const {chat} = window.appImManager;
    return (await chat.managers.dialogsStorage.getDialogOnly(chat.peerId)).unread_count;
  })).toBe(0);
  console.log(`PASS ${count} server pin event(s) hidden, history at bottom`);
}
