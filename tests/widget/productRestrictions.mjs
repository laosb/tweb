import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {expect as baseExpect} from '@playwright/test';

const expect = baseExpect.configure({timeout: 20_000});
const observations = [];
const noRequests = async(frame, action, label = 'restricted entry', allowConfigRead = false) => {
  // Finish read acknowledgements and reaction/media preloads from preceding UI.
  await expect.poll(() => frame.evaluate(() =>
    ![...window.__widgetRPCPending.values()].some(method => method !== 'account.updateStatus') &&
    performance.now() - window.__widgetLastRPCAt > 800)).toBe(true);
  await frame.evaluate(() => { window.__widgetManagerRequests = []; window.__widgetRPCRequests = []; });
  await action();
  const requests = await frame.evaluate(async() => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const requests = {managers: window.__widgetManagerRequests, rpc: window.__widgetRPCRequests};
    delete window.__widgetManagerRequests;
    return requests;
  });
  observations.push({label, ...requests});
  // The account's periodic presence heartbeat continues independently of clicks.
  // Keep it in the trace; every other attempted RPC and transport call must be absent.
  assert.deepEqual(requests.rpc.filter(record => record.phase !== 'end' && record.method !== 'account.updateStatus'), [],
    'restricted action sent an RPC request or transport call');
  // The preceding composer edit can finish its debounced unchanged-draft check;
  // any server write from it is still checked above.
  assert.deepEqual(requests.managers.filter(method => method !== 'appDraftsManager.syncDraft' &&
    (!allowConfigRead || method !== 'apiManager.getConfig')), [],
    'restricted action sent a manager request toward the worker');
};

export async function checkProductRestrictions({page, frame, driver, customerId, supportId, bubble, send, artifacts, showMessage, targetMid}) {
  const textbox = frame.getByRole('textbox', {name: 'Message'});
  const menu = frame.locator('#bubble-contextmenu');
  const target = frame.locator(`.bubble[data-mid="${targetMid}"]`);
  const fixtures = () => frame.evaluate(() => window.widgetProductFixtures());
  await fixtures();
  // Positive control for the request observer: observe an actual request reaching
  // the worker, with no replacement manager and no permission to hide failures.
  await frame.evaluate(async() => {
    window.__widgetManagerRequests = [];
    await window.rootScope.managers.appUsersManager.getSelf();
    if(!window.__widgetManagerRequests.includes('appUsersManager.getSelf')) throw new Error('Request observer inactive');
    if(!window.__widgetRPCRequests.some(record => record.layer === 'request' && record.method === 'help.getSupport') ||
      !window.__widgetRPCRequests.some(record => record.layer === 'transport' && record.method === 'help.getSupport')) {
      throw new Error('Worker RPC/transport observers inactive');
    }
    delete window.__widgetManagerRequests;
  });
  for(const rtl of [false, true]) {
    await frame.evaluate(rtl => window.I18n.forceRTL(rtl), rtl);
    await textbox.fill('@');
    await noRequests(frame, () => frame.evaluate(() => window.appImManager.chat.input.checkAutocomplete('@restricted_peer', 16, [])), 'typing @', true);
    await expect(frame.locator('.mentions-helper')).toHaveCount(0);
    await textbox.fill('');
    await showMessage(targetMid);
    const incoming = target;
    await incoming.evaluate(element => window.appImManager.chat.bubbles.scrollToBubble(element, 'center'));
    await incoming.click({button: 'right'});
    await expect(menu.getByText('Reply', {exact: true})).toBeVisible();
    await menu.getByRole('menuitem', {name: 'Reply', exact: true}).click();
    const helper = frame.locator('.reply-wrapper');
    await expect(helper).toBeVisible();
    // Open the real helper's menu, which remains the upstream reply/quote UI.
    await helper.locator('.reply-wrapper-content').hover();
    await frame.evaluate(() => window.appImManager.chat.input.replyHover?.toggle(true));
    await expect(frame.locator('.reply-line-menu')).toBeVisible();
    await expect(frame.locator('.reply-line-menu').getByText(/Reply in Another Chat|ReplyToAnotherChat/i)).toHaveCount(0);
    assert.equal(await helper.evaluate(element => !!element.querySelector('.tgico-replace_circles')), false);
    await noRequests(frame, async() => {
      assert.deepEqual(await frame.evaluate(async() => (await window.widgetProductFixtures()).restrictedEntries()),
        {cancelled: true, waiting: false, replyUnchanged: true});
    });
    await frame.evaluate(() => window.appImManager.chat.input.replyHover?.toggle(false));
    const reply = 'Restricted helper reply ' + rtl;
    await send(reply);
    const history = await driver.evaluate(id => window.widgetTestDriver.history(id), customerId);
    const message = history.messages.find(message => message.message === reply);
    assert(message?.reply_to?.reply_to_msg_id, 'support received an actual reply');
    assert.equal(message.peer_id.user_id, customerId);
  }
  await frame.evaluate(() => window.I18n.forceRTL(false));

  const links = [
    'tg://join?invite=widget_rejected', 'tg://contact?token=widget_rejected', 'tg://addlist?slug=widget_rejected',
    'tg://resolve?domain=widget_bot&startgroup=x', 'tg://new?type=contact', 'tg://contacts/new',
    'tg://settings/devices', 'tg://addstickers?set=widget_rejected', 'tg://addemoji?set=widget_rejected',
    'tg://msg_url?url=https%3A%2F%2Fexample.org&text=blocked', 'tg://unknown?x=1',
    'https://t.me/+widget_rejected', 'https://t.me/addlist/widget_rejected', 'https://t.me/addstickers/widget_rejected',
    'https://t.me/addemoji/widget_rejected', 'https://t.me/widget_bot?startgroup=x',
    'https://t.me/share/url?url=https%3A%2F%2Fexample.org', 'https://t.me/other_peer/123'
  ];
  const text = 'Received restricted links\n' + links.join('\n');
  const entities = links.map(url => ({_: 'messageEntityTextUrl', offset: text.indexOf(url), length: url.length, url}));
  await driver.evaluate(({id, text, entities}) => window.widgetTestDriver.reply(id, text, entities), {id: customerId, text, entities});
  const received = bubble(text);
  await expect(received).toBeVisible();
  const pages = page.context().pages().length;
  const inputBeforeLinks = await textbox.textContent();
  for(const url of links) {
    const anchor = received.locator('a').filter({hasText: url});
    await expect(anchor).toHaveCount(1);
    // Exercise the received anchor's real click/default action without starting
    // the independent hover-reaction preload as the pointer crosses this bubble.
    await noRequests(frame, () => anchor.evaluate(element => element.click()), url);
    await expect(frame.locator('.popup.active')).toHaveCount(0);
    await expect(textbox).toHaveText(inputBeforeLinks);
    assert.equal(await frame.evaluate(() => window.appImManager.chat.peerId), supportId);
    assert.equal(page.context().pages().length, pages);
  }
  // Both plain and masked external links retain the existing confirmation.
  const external = 'Allowed external https://example.test/widget';
  await driver.evaluate(({id, text}) => window.widgetTestDriver.reply(id, text,
    [{_: 'messageEntityUrl', offset: text.indexOf('https:'), length: 'https://example.test/widget'.length}]), {id: customerId, text: external});
  await bubble(external).locator('a.anchor-url').click();
  await expect(frame.locator('.popup-masked-url')).toBeVisible();
  await expect(bubble(external).locator('a.anchor-url')).toHaveAttribute('target', '_blank');
  await page.keyboard.press('Escape');
  await expect(frame.locator('.popup.active')).toHaveCount(0);

  const jump = `tg://privatepost?channel=${supportId}&post=${targetMid}`;
  await driver.evaluate(({id, text}) => window.widgetTestDriver.reply(id, text,
    [{_: 'messageEntityTextUrl', offset: 0, length: text.length, url: text}]), {id: customerId, text: jump});
  await bubble(jump).locator('a.anchor-url').click();
  await expect(target).toBeVisible();
  await expect(target).toHaveClass(/is-highlighted/);
  assert.equal(await frame.evaluate(() => window.appImManager.chat.peerId), supportId);
  await page.locator('iframe').screenshot({path: artifacts + '/support-message-jump.png'});
  await frame.evaluate(() => window.appImManager.chat.bubbles.scrollToEnd());
  await writeFile(artifacts + '/product-request-observation.json', JSON.stringify(observations, null, 2));
  console.log('PASS @ has no suggestions/lookup, actual reply helper has no recipient item, cancelled pickers settle, received internal links send zero requests, external confirmation and support message jump (LTR/RTL reply)');
}

export async function checkReceivedPackMenus({page, frame, mid, artifacts}) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const bubble = frame.locator(`.bubble[data-mid="${mid}"]`);
  for(const custom of [false, true]) {
    for(const rtl of [false, true]) {
      await frame.evaluate(rtl => window.I18n.forceRTL(rtl), rtl);
      await frame.evaluate(async({mid, custom}) => (await window.widgetProductFixtures()).renderReceivedPackMedia(mid, custom), {mid, custom});
      await expect(bubble).toBeInViewport();
      await expect(bubble.locator(custom ? '.custom-emoji' : '.media-sticker-wrapper').first()).toBeVisible();
      const playing = () => bubble.evaluate((element, custom) => {
        const video = custom ? element.querySelector('.custom-emoji')?.player : element.querySelector('video');
        return video instanceof HTMLVideoElement && video.readyState >= 2 && !video.paused ? video.currentTime : -1;
      }, custom);
      await expect.poll(playing).toBeGreaterThanOrEqual(0);
      const before = await playing();
      await expect.poll(playing).not.toBe(before);
      await bubble.click({button: 'right'});
      const menu = frame.locator('#bubble-contextmenu');
      await expect(menu).toBeVisible();
      await expect(menu.getByText(/View Pack|Sticker Set|contains.*pack|emoji pack/i)).toHaveCount(0);
      assert.equal(await frame.evaluate(() => window.appImManager.chat.contextMenu.buttons.some(button => button.localName === 'emojis')), false);
      if(custom) {
        await menu.getByRole('menuitem', {name: 'Copy', exact: true}).click();
        await expect(menu).not.toBeVisible();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Received custom emoji 😀');
      } else await page.keyboard.press('Escape');
      await noRequests(frame, () => bubble.locator(custom ? '.custom-emoji' : '.media-sticker-wrapper').first()
      .evaluate(element => element.click()), custom ? 'custom emoji click' : 'sticker click');
      await page.locator('iframe').screenshot({path: `${artifacts}/received-${custom ? 'emoji' : 'sticker'}-${rtl ? 'rtl' : 'ltr'}.png`});
      await frame.evaluate(async() => (await window.widgetProductFixtures()).restoreMedia());
    }
  }
  await frame.evaluate(() => window.I18n.forceRTL(false));
  await writeFile(artifacts + '/product-request-observation.json', JSON.stringify(observations, null, 2));
  console.log('PASS received sticker/custom emoji rendering and playback, pack-free context menus and emoji Copy (LTR/RTL)');
}

// Real DC payloads, in both the release and instrumented harness runs.
export async function checkReceivedLinkActivations({page, frame, driver, customerId, supportId, bubble, artifacts, targetMid, observeRequests}) {
  const initialUrl = frame.url();
  const pageCount = page.context().pages().length;
  const forbidden = ['https://t.me./other/123', 'https://TELEGRAM.ME./other/123', 'https://telesco.pe./other/123',
    'https://t。me。/other/123', 'https://bücher.telegram.me./other/123', 'https://xn--bcher-kva.telesco.pe./other/123'];
  const text = 'Absolute Telegram hosts\n' + forbidden.join('\n');
  await driver.evaluate(({id, text, urls}) => window.widgetTestDriver.reply(id, text,
    urls.map(url => ({_: 'messageEntityTextUrl', offset: text.indexOf(url), length: url.length, url}))),
  {id: customerId, text, urls: forbidden});
  const received = bubble(text);
  await expect(received).toBeVisible();
  // The DC strips user-sent markup (botReplyMarkup). Decorate this real received
  // message at the renderer boundary to exercise URL buttons too, in both builds.
  await received.evaluate(async(element, urls) => {
    const {chat} = window.appImManager;
    const base = chat.getMessage(+element.dataset.mid);
    const reply_markup = {_: 'replyInlineMarkup', pFlags: {}, rows: urls.map((url, i) => ({_: 'keyboardInlineButtonRow', buttons: [
      {_: 'keyboardInlineButton', text: 'Forbidden URL ' + i, type: {_: 'inlineButtonTypeUrl', url}}
    ]}))};
    await chat.bubbles.safeRenderMessage({message: {...base, reply_markup}, bubble: element});
    await chat.bubbles.messagesQueuePromise;
  }, forbidden);
  const checkBlocked = async(anchor, label, native = false) => {
    const action = async() => {
      if(native) {
        await anchor.click();
        await anchor.click({button: 'middle'});
        await anchor.click({modifiers: ['Control']});
        await anchor.click({modifiers: ['Meta']});
        await anchor.focus();
        await page.keyboard.press('Enter');
      }
      const prevented = await anchor.evaluate(element => [
        new MouseEvent('click', {bubbles: true, cancelable: true}),
        new MouseEvent('click', {bubbles: true, cancelable: true, shiftKey: true}),
        new MouseEvent('click', {bubbles: true, cancelable: true, altKey: true}),
        new MouseEvent('auxclick', {bubbles: true, cancelable: true, button: 1}),
        new KeyboardEvent('keydown', {bubbles: true, cancelable: true, key: 'Enter'})
      ].map(event => { element.dispatchEvent(event); return event.defaultPrevented; }));
      assert(prevented.every(Boolean), label + ' did not cancel every activation');
    };
    if(observeRequests) await noRequests(frame, action, label);
    else await action();
    await expect(frame.locator('.popup.active')).toHaveCount(0);
    assert.equal(frame.url(), initialUrl, label + ' changed the token fragment');
    assert.equal(page.context().pages().length, pageCount, label + ' opened a page');
    assert.equal(await frame.evaluate(() => window.appImManager.chat.peerId), supportId);
  };
  for(let i = 0; i < forbidden.length; ++i) {
    await checkBlocked(received.locator('a.anchor-url').filter({hasText: forbidden[i]}), 'received dotted text URL ' + i);
    await checkBlocked(received.getByText('Forbidden URL ' + i, {exact: true}).locator('xpath=ancestor-or-self::a[1]'), 'received dotted URL button ' + i);
  }

  const jump = `tg://privatepost?channel=${supportId}&post=${targetMid}`;
  const caption = 'Caption Named Customer @blocked_caption https://example.test/caption ' + jump;
  const entities = [
    {_: 'messageEntityMentionName', offset: caption.indexOf('Named Customer'), length: 'Named Customer'.length, user_id: customerId},
    {_: 'messageEntityMention', offset: caption.indexOf('@blocked_caption'), length: '@blocked_caption'.length},
    ...['https://example.test/caption', jump].map(url => ({_: 'messageEntityTextUrl', offset: caption.indexOf(url), length: url.length, url}))
  ];
  await driver.evaluate(({id, caption, entities}) => window.widgetTestDriver.echoMedia(id, 'Widget photo regression', caption, false, entities),
    {id: customerId, caption, entities});
  const photo = bubble(caption);
  await expect(photo).toBeVisible();
  const mid = Number(await photo.getAttribute('data-mid'));
  for(const rtl of [false, true]) {
    await frame.evaluate(rtl => window.I18n.forceRTL(rtl), rtl);
    await photo.locator('img.media-photo').last().click();
    const viewer = frame.locator('.media-viewer-whole.active');
    await expect(viewer).toBeVisible();
    await frame.evaluate(() => window.appMediaViewer.setMoverAnimationPromise);
    const content = viewer.locator('.media-viewer-caption');
    await expect(content.locator('a.follow')).toHaveAttribute('href', '#' + customerId);
    await checkBlocked(content.locator('a.follow'), 'viewer named mention ' + rtl, true);
    await checkBlocked(content.locator('a.mention'), 'viewer plain mention ' + rtl, true);
    await content.locator('a.anchor-url').filter({hasText: 'https://example.test/caption'}).click();
    await expect(frame.locator('.popup-masked-url')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(frame.locator('.popup.active')).toHaveCount(0);
    await page.locator('iframe').screenshot({path: `${artifacts}/caption-links-${rtl ? 'rtl' : 'ltr'}.png`});
    await content.locator('a.anchor-url').filter({hasText: jump}).click();
    await expect(viewer).toHaveCount(0);
    await expect(frame.locator(`.bubble[data-mid="${targetMid}"]`)).toHaveClass(/is-highlighted/);
    // The composer uses the actual reply/quote preview, outside the history guard.
    await frame.evaluate(mid => window.appImManager.chat.input.initMessageReply({replyToMsgId: mid}), mid);
    const preview = frame.locator('.reply-wrapper');
    await expect(preview).toBeVisible();
    for(const selector of ['a.follow', 'a.mention']) {
      const anchor = preview.locator(selector);
      if(await anchor.count()) await checkBlocked(anchor, 'composer ' + selector + ' ' + rtl);
    }
    await frame.evaluate(() => window.appImManager.chat.input.clearHelper());
    await frame.evaluate(() => window.appImManager.chat.bubbles.scrollToEnd());
  }
  await frame.evaluate(() => window.I18n.forceRTL(false));
  if(observeRequests) await writeFile(artifacts + '/product-request-observation.json', JSON.stringify(observations, null, 2));
  console.log('PASS real received caption named/plain mentions keep token on click/middle/modifiers/Enter; absolute Telegram text URLs and URL buttons inert; caption external confirmation and support jump (LTR/RTL)');
}
