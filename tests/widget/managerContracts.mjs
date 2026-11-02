import assert from 'node:assert/strict';
import {cp, readdir, readFile, writeFile} from 'node:fs/promises';
import {expect as baseExpect} from '@playwright/test';

const expect = baseExpect.configure({timeout: 20_000});

// Instrument a disposable copy of the production output. No debugger attachment
// (which can change worker lifetime during reload), extra release file or product
// hook is needed. Replay across documents catches errors between token changes.
export async function withWorkerConsole(dist, destination) {
  await cp(dist, destination, {recursive: true});
  const files = (await readdir(destination)).filter(file => /(?:\.worker-|^sw-).*\.js$/.test(file));
  assert(files.some(file => file.startsWith('index.worker-')), 'missing main worker');
  for(const file of files) {
    const source = await readFile(destination + '/' + file, 'utf8');
    const preamble = `(${function(label) {
      const channel = new BroadcastChannel('widget-worker-contracts');
      const realm = label + ':' + Math.random().toString(36).slice(2);
      const records = [];
      const describe = value => {
        let text;
        try {
          text = typeof value === 'string' ? value : value?.stack || value?.message || JSON.stringify(value);
        } catch{ text = String(value); }
        return String(text).replace(/\b\d+:[A-Za-z0-9_-]{25,}\b/g, '<customer-token>');
      };
      const record = (level, args) => {
        const data = {realm, index: records.length, level, text: args.map(describe).join(' ')};
        records.push(data);
        channel.postMessage(data);
      };
      channel.onmessage = event => {
        if(event.data === 'replay') records.forEach(data => channel.postMessage(data));
      };
      for(const level of ['log', 'info', 'warn', 'error', 'debug']) {
        const original = console[level].bind(console);
        console[level] = (...args) => { record(level, args); original(...args); };
      }
      addEventListener('error', event => record('uncaught', [event.error || event.message]));
      addEventListener('unhandledrejection', event => record('rejection', [event.reason]));
      record('ready', [label]);
    }.toString()})(${JSON.stringify(file)});\n`;
    await writeFile(destination + '/' + file, preamble + source);
  }
  return destination;
}

export async function observeWorkerConsole(context) {
  const records = new Map();
  await context.exposeBinding('__widgetWorkerConsole', (_source, record) => {
    records.set(record.realm + ':' + record.index, record);
  });
  await context.addInitScript(() => {
    const channel = new BroadcastChannel('widget-worker-contracts');
    channel.onmessage = event => {
      if(typeof event.data === 'object') window.__widgetWorkerConsole(event.data).catch(() => {});
    };
    channel.postMessage('replay');
  });
  return records;
}

export function assertWorkerConsole(records) {
  const entries = [...records.values()];
  assert(entries.some(record => record.level === 'ready' && record.text.startsWith('index.worker-')), 'main worker logging did not attach');
  // Present on 69ad6dee0: optional DC methods, absent sticker sets, and in-flight
  // requests from keys the token-transition checks deliberately revoke. None is
  // a missing JavaScript manager method; every other worker exception fails.
  const broken = entries.filter(record => /is not a function|method.*not found|cannot (?:read|set|convert).*undefined/i.test(record.text) ||
    record.level === 'uncaught' || record.level === 'rejection' &&
    !/^(?:CODE#400 METHOD_NOT_(?:FOUND|IMPLEMENTED)|CODE#401 AUTH_KEY_UNREGISTERED|NO_STICKERS)$/.test(record.text));
  assert.deepEqual(broken, [], 'worker JS/RPC contract errors');
}

export async function checkManagerMessages({page, frame, driver, customerId, bubble, send, messageMids}) {
  await send('Manager contract editable');
  const mid = messageMids.get('Manager contract editable');
  await frame.evaluate(mid => window.appImManager.chat.input.initMessageEditing(mid), mid);
  await frame.getByRole('textbox', {name: 'Message'}).fill('Manager contract edited');
  await page.keyboard.press('Enter');
  await expect(bubble('Manager contract edited')).toBeVisible();
  const incoming = 'Manager contract support reply';
  await driver.evaluate(({id, text}) => window.widgetTestDriver.reply(id, text), {id: customerId, text: incoming});
  await expect(bubble(incoming)).toBeVisible();
  const replyMid = Number(await bubble(incoming).getAttribute('data-mid'));
  await frame.evaluate(mid => window.appImManager.chat.input.initMessageReply({replyToMsgId: mid}), replyMid);
  await send('Manager contract actual reply');
  await expect(bubble('Manager contract actual reply').locator('.reply')).toBeVisible();
  await bubble(incoming).locator('.message').last().click({button: 'right'});
  await expect(frame.locator('#bubble-contextmenu')).toBeVisible();
  await frame.locator('#bubble-contextmenu .btn-menu-reactions-reaction').first().click();
  await expect(bubble(incoming).locator('.reaction')).toBeVisible();

  // Confirm the real Delete action: this runs worker deletion/translation cleanup.
  await bubble('Manager contract edited').locator('.message').last().click({button: 'right'});
  await frame.getByRole('menuitem', {name: 'Delete', exact: true}).click();
  await frame.locator('.popup.active').getByRole('button', {name: 'Delete', exact: true}).click();
  await expect(frame.locator(`.bubble[data-mid="${mid}"]`)).toHaveCount(0);

  console.log('PASS manager message contracts: actual edit/delete/reply/reaction');
  await driver.evaluate(id => window.widgetTestDriver.historyService(id), customerId);
  await expect(frame.locator('.bubble.service').filter({hasText: /auto.delete/i})).toBeVisible();
  await driver.evaluate(id => window.widgetTestDriver.externalServiceReply(id), customerId);
  await expect(bubble('Manager contract external service reply')).toBeVisible();
  await expect(bubble('Manager contract external service reply').locator('.reply')).toBeVisible();
  const external = await frame.evaluate(() => {
    const {chat} = window.appImManager;
    const mid = Number([...document.querySelectorAll('.bubble[data-mid]')].find(el => el.textContent.includes('Manager contract external service reply')).dataset.mid);
    const message = chat.getMessage(mid);
    return {peer: message.reply_to.reply_to_peer_id?._, replyMid: message.reply_to.reply_to_msg_id};
  });
  assert.equal(external.peer, 'peerChannel');
  assert(external.replyMid > 0);
  console.log('PASS manager message contracts: actual edit/delete/reply/reaction, received history-TTL service and external channel-service reply');
}
