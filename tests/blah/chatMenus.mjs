// Real composer clicks against a fresh DC, without preloading its bot catalogue.
export async function checkChatMenus({page, expect}) {
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForFunction(() => !!window.appImManager?.chat);
  const pageErrors = [];
  const shots = process.env.BLAH_MENU_SCREENSHOTS;
  const onPageError = error => pageErrors.push(error.message);
  const checkMessageMenu = async(text, group) => {
    const chat = page.locator('#column-center .chat.active');
    await chat.locator('.chat-input .input-message-input[contenteditable="true"]').focus();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    const bubble = chat.locator('.bubble').filter({hasText: text}).last();
    await expect(bubble).toBeVisible();
    await expect(bubble).not.toHaveClass(/is-sending/);
    const before = pageErrors.length;
    page.on('pageerror', onPageError);
    await bubble.locator('.message').click({button: 'right'});
    const menu = page.locator('#bubble-contextmenu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Reply', {exact: true})).toBeVisible();
    const strip = menu.locator('.btn-menu-reactions-reaction');
    const emoji = label => ({'Thumbs Up': '👍', 'Thumbs Down': '👎', 'Red Heart': '❤'}[label] || label);
    await expect.poll(async() => (await strip.evaluateAll(elements => elements.map(e => e.getAttribute('aria-label')))).map(emoji))
      .toEqual(['👍', '👎', '❤']);
    for(let i = 0; i < 3; ++i) await expect(strip.nth(i).locator('.btn-menu-reactions-reaction-select canvas')).toBeVisible({timeout: 30_000});
    const direction = text.endsWith('RTL') ? 'rtl' : 'ltr';
    if(shots) {
      await page.waitForTimeout(600);
      await page.screenshot({path: `${shots}/${group ? 'group' : 'blah-dm'}-menu-${direction}.png`});
    }
    if(group) {
      await strip.first().click();
      await expect.poll(() => bubble.locator('reaction-element').evaluateAll(elements =>
        elements.map(e => e.reactionCount?.reaction?.emoticon))).toContain('👍');
    } else await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    if(group) {
      if(shots) await page.screenshot({path: `${shots}/group-thumbsup-${direction}.png`});
      await page.waitForTimeout(1500);
      await expect(bubble.locator('reaction-element .reaction-sticker')).not.toHaveClass(/has-animation/, {timeout: 30_000});
      const still = bubble.locator('reaction-element img.media-sticker');
      await expect(still).toHaveCount(1);
      await expect(still).toBeVisible();
      await expect.poll(() => still.evaluate(image => {
        if(!image.complete || !image.naturalWidth) return false;
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data
          .some((value, index) => index % 4 === 3 && value > 0);
      }), {timeout: 30_000}).toBe(true);
      if(shots) await page.screenshot({path: `${shots}/group-thumbsup-resting-${direction}.png`});
    }
    page.off('pageerror', onPageError);
    expect(pageErrors.slice(before)).toEqual([]);
  };
  try {
    for(const rtl of [false, true]) {
      const url = new URL(page.url());
      url.searchParams.delete('a11y');
      if(rtl) url.searchParams.set('rtl', '1');
      else url.searchParams.delete('rtl');
      await page.goto(url.href);
      await page.locator('#page-chats').waitFor({state: 'visible'});
      await page.waitForFunction(() => !!window.appImManager?.chat);
      const peerId = await page.evaluate(async() => {
        const managers = window.rootScope.managers;
        return -(await managers.appChatsManager.createChannel({title: 'Attachment menu regression', about: '', megagroup: true}));
      });
      await page.evaluate(peerId => window.appImManager.setPeer({peerId}), peerId);
      await page.waitForFunction(peerId => window.appImManager.chat.peerId === peerId && !window.appImManager.chat.setPeerPromise, peerId);
      await page.locator('#column-center .chat.active .attach-file').click();
      const menu = page.getByRole('menu').filter({has: page.getByRole('menuitem', {name: 'Document', exact: true})});
      await expect(menu).toBeVisible();
      await page.mouse.click(1000, 120);
      await expect(menu).not.toBeVisible();
      await checkMessageMenu(`Group context menu ${rtl ? 'RTL' : 'LTR'}`, true);
      await page.evaluate(() => window.appImManager.setPeer({peerId: 777000}));
      await page.waitForFunction(() => window.appImManager.chat.peerId === 777000 && !window.appImManager.chat.setPeerPromise);
      await checkMessageMenu(`Service context menu ${rtl ? 'RTL' : 'LTR'}`, false);
      if(process.env.BLAH_MENU_RPC_DIAGNOSTICS) {
        const failures = await page.evaluate(async() => (await window.collectLogs())
          .filter(entry => entry.args?.[0] === 'rpc error' && entry.args?.[1]?.error_message === 'METHOD_NOT_FOUND')
          .map(entry => ({source: entry.src, method: entry.args[2]?.humanReadable, error: entry.args[1].error_message})));
        console.log('MENU_RPC_FAILURES', JSON.stringify(failures));
      }
      console.log(`PASS ${rtl ? 'RTL' : 'LTR'} attachment and real group/service message menus offer exactly 👍 👎 ❤, group reacts with 👍, resting image decodes with visible pixels, and no pageerror`);
    }
  } finally {
    page.off('pageerror', onPageError);
    if(pageErrors.length) console.error('Message menu pageerrors:', pageErrors);
  }
}
