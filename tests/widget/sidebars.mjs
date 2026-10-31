import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function checkSidebarBootstrap(frame) {
  await expect(frame.getByRole('textbox', {name: 'Message'})).toBeVisible();
  const result = await frame.evaluate(async() => (await window.widgetSidebarFixtures()).bootstrapSnapshot());
  for(const [key, value] of Object.entries(result)) assert.equal(value, true, key);
}

export async function checkSidebars(frame) {
  await checkSidebarBootstrap(frame);
  assert.deepEqual(await frame.evaluate(async() => (await window.widgetSidebarFixtures()).hiddenEntries()), {calls: 0, popups: 0});
  for(const rtl of [false, true]) {
    await frame.evaluate(rtl => window.I18n.forceRTL(rtl), rtl);
    try {
      await frame.evaluate(async() => (await window.widgetSidebarFixtures()).openReactionParticipants());
      const popup = frame.locator('.popup-reacted-list');
      await expect(popup).toBeVisible();
      await expect(popup.locator('.chatlist-chat')).toHaveCount(7);
      await expect(popup.getByText('Customer Care', {exact: true}).first()).toBeVisible();
      await popup.locator('.popup-close').click();
      await expect(popup).toHaveCount(0);
    } finally {
      await frame.evaluate(async() => (await window.widgetSidebarFixtures()).restoreReactionManagers());
    }
  }
  await frame.evaluate(() => window.I18n.forceRTL(false));
  console.log('PASS sidebar roots: no hidden UI/manager calls, stable bootstrap/playback, registry identity, retained reacted rows LTR/RTL');
}
