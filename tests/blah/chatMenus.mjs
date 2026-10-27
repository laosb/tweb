// Real composer clicks against a fresh DC, without preloading its bot catalogue.
export async function checkChatMenus({page, expect}) {
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForFunction(() => !!window.appImManager?.chat);
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
    console.log(`PASS ${rtl ? 'RTL' : 'LTR'} attachment menu opens on click and closes`);
  }
}
