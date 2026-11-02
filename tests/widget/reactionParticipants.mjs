import {expect as baseExpect} from '@playwright/test';

const expect = baseExpect.configure({timeout: 20_000});

/** A real quick reaction and the paginated participant-list entry. Only the
 * preview's count is inflated to expose Show All with one disposable customer;
 * the full list and its rows come from the real server, without fake peers. */
export async function checkReactionParticipants({page, frame, bubble, artifacts}) {
  const target = bubble('Widget photo regression');
  await target.scrollIntoViewIfNeeded();
  await target.getByText('Widget photo regression', {exact: true}).click({button: 'right'});
  const quick = frame.locator('#bubble-contextmenu .btn-menu-reactions-reaction').first();
  await expect(quick.locator('.btn-menu-reactions-reaction-select canvas')).toBeVisible();
  await quick.click();
  const reaction = target.locator('.reaction').first();
  await expect(reaction).toBeVisible();
  await frame.evaluate(() => {
    const managers = window.appImManager.chat.contextMenu.managers;
    const original = managers.appReactionsManager;
    // A method assignment on the manager proxy is ignored by its get trap;
    // replace the local manager object, preserving every other proxied method.
    managers.appReactionsManager = new Proxy(original, {get(target, key) {
      if(key !== 'getMessageReactionsList') return target[key];
      return async(...args) => {
        const result = await original.getMessageReactionsList(...args);
        return {...result, count: result.reactions.length + 1};
      };
    }});
    window.__restoreWidgetReactionPreview = () => { managers.appReactionsManager = original; };
  });
  try {
    for(const scheme of ['light', 'dark']) {
      await page.emulateMedia({colorScheme: scheme});
      for(const rtl of [false, true]) {
        await frame.evaluate(rtl => window.I18n.forceRTL(rtl), rtl);
        await reaction.click({button: 'right'});
        await frame.getByRole('menuitem', {name: /show.?all.?reactions/i}).click();
        const popup = frame.locator('.popup-reacted-list.active');
        await expect(popup).toBeVisible();
        await expect(popup.locator('.tabs-tab.active .chatlist-chat')).toBeVisible();
        await expect(popup.locator('.tabs-container')).toHaveCSS('display', 'grid');
        await page.locator('iframe').screenshot({path: `${artifacts}/reaction-participants-${scheme}-${rtl ? 'rtl' : 'ltr'}.png`});
        await page.keyboard.press('Escape');
        await expect(popup).not.toBeVisible();
      }
    }
  } finally {
    await frame.evaluate(() => { window.__restoreWidgetReactionPreview(); delete window.__restoreWidgetReactionPreview; window.I18n.forceRTL(false); });
    await page.emulateMedia({colorScheme: 'light'});
  }
  console.log('PASS real reaction participants and tabs (light/dark, LTR/RTL)');
}
