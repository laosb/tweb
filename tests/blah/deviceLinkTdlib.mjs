import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {readFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import {inspectLinkedCustody, openDeviceLinkIdentity} from './deviceLink.mjs';

// Keep the peer's stdout exclusively for sequential JSON-lines replies. Its
// private custody stays in the disposable fixture directory, outside the browser.
function startPeer(tele) {
  const child = spawn(process.env.DENO || 'deno', ['run', '-A', '--unstable-sloppy-imports',
    '--config=Tests/e2e/deno.json', '--import-map=Tests/e2e/import-map.json',
    'Tests/e2e/tools/tdlib-qr-peer.ts'], {cwd: tele, detached: true, stdio: ['pipe', 'pipe', 'inherit']});
  const exited = once(child, 'exit');
  void exited.catch(() => {});
  child.stdin.on('error', () => {}); // The exit/error promise reports a broken peer.
  const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
  return {
    async call(command, fields = {}) {
      let timer;
      try {
        child.stdin.write(JSON.stringify({command, ...fields}) + '\n');
        const line = await Promise.race([lines.next(), exited.then(([code, signal]) => {
          throw new Error(`TDLib peer exited during ${command}: ${code ?? signal}`);
        }), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('TDLib peer timed out: ' + command)), 90000);
        })]);
        assert(!line.done, 'TDLib peer exited before replying to ' + command);
        const reply = JSON.parse(line.value);
        if(reply.error) throw new Error(reply.error);
        return reply.result;
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch{}
      }, 5000);
      try {
        const [code, signal] = await exited;
        assert.equal(code, 0, 'TDLib peer shutdown failed: ' + signal);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export async function checkDeviceLinkTdlib({browser, page, origin, signedDC, identityID, userId, tele, dir, port, rsa, dc, runtimeURL}) {
  assert(process.env.TDLIB_PATH, 'Set TDLIB_PATH to the QR-capable fork libtdjson');
  const peer = startPeer(tele);
  let context;
  let next;
  const profilePath = dir + '/profiles/alice.example.org.cbor';
  const password = 'cross-client browser password';
  try {
    const pending = await peer.call('start', {directory: dir, port, keyPem: rsa.pkcs1Pem, dc});
    const details = await openDeviceLinkIdentity(page, 'test identity password', identityID);
    await details.getByRole('button', {name: 'Link device by QR code', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Link device by QR code', exact: true});
    const before = await readFile(profilePath);
    const altered = await peer.call('tamper', {link: pending.link});
    await dialog.getByRole('textbox', {name: 'Login link', exact: true}).fill(altered.link);
    await dialog.getByRole('button', {name: 'Continue', exact: true}).click();
    await expect(dialog.getByRole('status')).toHaveText('Could not link this device. Check that both devices use the same home server, then try again with a new code.');
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    assert.deepEqual(await readFile(profilePath), before, 'Rejected link must not publish a certification');
    assert.equal((await peer.call('status')).state, 'authorizationStateWaitOtherDeviceConfirmation');
    console.log('PASS cross-client negative A: tweb rejects altered blah digest before certification; TDLib stays unauthorized.');

    await dialog.getByRole('textbox', {name: 'Login link', exact: true}).fill(pending.link);
    await dialog.getByRole('button', {name: 'Continue', exact: true}).click();
    await expect(dialog.getByText('Log in on TDLib cross-client peer?', {exact: true})).toBeVisible();
    await expect(dialog.getByRole('checkbox', {name: 'Also let this device approve new devices', exact: true})).toBeChecked();
    await dialog.getByRole('button', {name: 'Log in', exact: true}).click();
    await dialog.waitFor({state: 'detached'});
    const received = await peer.call('receive');
    assert.equal(received.state, 'authorizationStateReady');
    assert.equal(String(received.user.id), String(userId));
    assert.equal(Buffer.from(received.identityID, 'base64').toString('hex'), identityID);
    assert.equal(received.hasIdentityKey, true);
    assert.equal(received.sessions.length, 2);
    console.log('PASS cross-client A: tweb Ed25519 identity -> TDLib; transferred custody installed, same account, 2 sessions.');
    await page.reload();
    await page.locator('#page-chats').waitFor({state: 'visible'});

    context = await browser.newContext({ignoreHTTPSErrors: true, deviceScaleFactor: 3});
    context.setDefaultTimeout(30000);
    await context.route('https://dc.example.org/.well-known/blah/profile.cbor', route => route.fulfill({
      contentType: 'application/cbor', body: Buffer.from(signedDC.profile)
    }));
    next = await context.newPage();
    await next.goto(origin + '/?noServiceWorker=1&a11y=1');
    await next.getByRole('textbox', {name: 'DC domain', exact: true}).fill('dc.example.org');
    await next.getByRole('button', {name: 'Connect to Blah', exact: true}).click();
    await next.getByRole('button', {name: /Log in by QR code/i}).click();
    const canvas = next.locator('canvas[class*="qrCanvas"]');
    await canvas.waitFor({state: 'visible'});
    // Read only the rendered bitmap, never intercept the manager or token RPC.
    let link;
    await expect.poll(async() => {
      const pixels = await canvas.evaluate(canvas => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let binary = '';
        for(let offset = 0; offset < data.length; offset += 8192) binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
        return {width: canvas.width, height: canvas.height, rgba: btoa(binary)};
      });
      try { link = (await peer.call('decodeQR', pixels)).link; return true; }
      catch(error) { if(!String(error).includes('could not be decoded')) throw error; return false; }
    }, {timeout: 15000}).toBe(true);
    assert.equal(new URL(link).protocol, 'tg:');
    assert(new URL(link).searchParams.get('blah'));
    const published = await readFile(profilePath);
    const installed = await readFile(dir + '/qr-peer-custody.json');
    const tampered = await peer.call('tamper', {link});
    await assert.rejects(() => peer.call('approve', {link: tampered.link}), /requestDigestMismatch/);
    assert.deepEqual(await readFile(profilePath), published);
    assert.deepEqual(await readFile(dir + '/qr-peer-custody.json'), installed);
    assert.equal((await peer.call('status')).sessions.length, 2);
    await expect(next.getByLabel('Identity password', {exact: true})).toHaveCount(0);
    await expect(canvas).toBeVisible();
    console.log('PASS cross-client negative B: TDLib rejects altered blah digest without changing custody, publication or sessions.');

    assert.deepEqual(await peer.call('approve', {link}), {approved: true, transferIdentity: false});
    await next.getByLabel('Identity password', {exact: true}).fill(password);
    await next.getByRole('button', {name: /^Continue$|^Sign in to Blah$/i}).click();
    await next.locator('#page-chats').waitFor({state: 'visible'});
    await next.waitForFunction(() => JSON.parse(localStorage.getItem('account1') || '{}').userId);
    assert.equal(String(await next.evaluate(() => JSON.parse(localStorage.getItem('account1')).userId)), String(userId));
    await next.reload();
    await next.locator('#page-chats').waitFor({state: 'visible'});
    await inspectLinkedCustody(next, {identityID, password, runtimeURL, userId, origin}, false);
    const newDetails = await openDeviceLinkIdentity(next, password, identityID);
    const identity = await next.evaluate(async identityID =>
      (await window.rootScope.managers.appAccountManager.blahIdentity({action: 'inspect', id: identityID})).identity, identityID);
    const current = identity.devices.find(device => device.current);
    assert(current, 'Linked browser must be certified in its installed profile');
    assert.notEqual(current.id, Buffer.from(pending.deviceID, 'base64').toString('hex'));
    await expect(newDetails.getByText('This browser', {exact: true})).toBeVisible();
    await newDetails.getByRole('button').filter({hasText: 'This browser'}).click();
    await expect(next.getByRole('dialog').getByText(current.id, {exact: true})).toBeVisible();
    assert.equal((await peer.call('status')).sessions.length, 3);
    console.log('PASS cross-client B: transferred TDLib identity -> rendered tweb QR; device-only login, password, reload, certified device UI, 3 sessions.');
    console.log('PASS cross-client QR: 2 directions, 2 tampered-link checks, 0 failures.');
  } catch(error) {
    console.error('Cross-client original browser:', await page.locator('body').innerText({timeout: 2000}).catch(() => 'unavailable'));
    if(next) console.error('Cross-client new browser:', await next.locator('body').innerText({timeout: 2000}).catch(() => 'unavailable'));
    throw error;
  } finally {
    await Promise.all([context?.close(), peer.close()]);
  }
}
