import {writeFile} from 'node:fs/promises';
import {expect as baseExpect} from '@playwright/test';

const expect = baseExpect.configure({timeout: 20_000});

export async function checkNativeEmoji({driver, customerId, send, bubble, artifacts}) {
  const results = [];
  // Emoji 17's toned wrestling is absent from Telegram's artwork table. The
  // regex already recognized it; page and worker must now both accept it.
  for(const [name, text, big, count, renderedText] of [
    ['new', '🤼🏻', true, 1],
    ['old', '👍🏽', true, 1],
    ['mixed', 'Native 🤼🏼 in text', false, 1],
    ['plain', '1/#/©', false, 1],
    ['digit', '1', false, 0],
    ['hash', '#', false, 0],
    ['bare-symbols', '♀ ♂ ⚕', false, 0, '♀️ ♂️ ⚕']
  ]) {
    const message = await send(text, {last: true, renderedText});
    if(big) await expect(message).toHaveClass(/emoji-big/);
    else await expect(message).not.toHaveClass(/emoji-big/);
    await expect(message.locator('.emoji-native')).toHaveCount(count);
    await expect(message.locator('img.emoji')).toHaveCount(0);
    results.push({name, text, big, nativeCount: count});
    await message.screenshot({path: `${artifacts}/emoji-${name}.png`});
  }
  // An incoming message is normalized in the main worker, independently of
  // the page's optimistic outgoing parse. No supplied entities can mask it.
  await driver.evaluate(({id, text}) => window.widgetTestDriver.reply(id, text), {id: customerId, text: '🤼🏿'});
  const incoming = bubble('🤼🏿');
  await expect(incoming).toBeVisible();
  await expect(incoming).toHaveClass(/emoji-big/);
  await expect(incoming.locator('.emoji-native')).toHaveCount(1);
  const entities = await incoming.evaluate(element => window.appImManager.chat.getMessage(Number(element.dataset.mid)).totalEntities);
  expect(entities).toContainEqual({_: 'messageEntityEmoji', offset: 0, length: '🤼🏿'.length, unicode: '1f93c-1f3ff'});
  await incoming.screenshot({path: `${artifacts}/emoji-incoming.png`});
  await writeFile(`${artifacts}/emoji.json`, JSON.stringify({outgoing: results, incoming: {text: '🤼🏿', entities}}, null, 2) + '\n');
  console.log('PASS native Unicode emoji page/worker, sizing and plain text');
}
