import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';

export const themeSentinels = {
  'surface-color': ['#fad7ed', '#30243e'],
  'text-color': ['#51184c', '#efb7dd'],
  'chat-background-color': ['#d8eaca', '#203b32'],
  'accent-color': ['#ce147c', '#ff52c1'],
  'incoming-bubble-color': ['#dfd2ff', '#293e61'],
  'incoming-text-color': ['#24106a', '#b5f8ea'],
  'outgoing-bubble-color': ['#ecdf95', '#663215'],
  'outgoing-text-color': ['#613100', '#ffd5a4'],
  'outgoing-accent-color': ['#087c73', '#53ead2'],
  'danger-color': ['#cf3816', '#ff7140'],
  'support-sender-color': ['#6325bf', '#ac83ff'],
  'bubble-radius': ['17.125px', '18.125px'],
  'incoming-bubble-radius': ['19.125px', '20.125px'],
  'outgoing-bubble-radius': ['21.125px', '22.125px'],
  'composer-radius': ['11.125px', '12.125px'],
  'popup-radius': ['23.125px', '24.125px'],
  'menu-radius': ['13.125px', '14.125px'],
  'button-radius': ['7.125px', '8.125px'],
  'media-radius': ['9.125px', '10.125px'],
  'avatar-radius': ['3.125px', '4.125px'],
  'pill-radius': ['5.125px', '6.125px'],
  'chat-background-image': ['linear-gradient(#d8eaca, #d8eaca)', 'linear-gradient(#203b32, #203b32)'],
  'chat-background-size': ['37px 41px', '43px 47px']
};

// Explicit exceptions, not a blanket "large radius" exemption. These are geometric circles.
const circles = '.btn-icon:not(.btn-send):not(.bubbles-corner-button), .preloader-circular, .preloader-circle, .preloader-container, .preloader-container .preloader-svg, .ripple-circle, .c-ripple__circle, .btn-icon > .c-ripple, .radio-field-main, .checkbox-toggle-circle, .audio-toggle, .audio-play, .progress-line__filled, .media-editor__color-button, .media-editor__brush-size, .media-editor__rotation-wheel-dot, .media-editor__crop-handles-circle, .media-editor__range-input-thumb, .media-editor__resizable-container-circle, .media-editor__finish-button, .media-editor__step-input-dot, .media-editor__preview-brush-size';

export async function checkTheme({page, frame, artifacts, showMessage, messageMids, photo}) {
  const screenshot = name => page.locator('iframe').screenshot({path: `${artifacts}/theme-${name}.png`});
  const bubble = text => frame.locator('.bubble[data-mid]:not(.service)').filter({hasText: text});
  const textMid = messageMids.get('Support quoted reply') || Number(await bubble('Support quoted reply').getAttribute('data-mid'));
  const snapshots = [];
  await frame.evaluate(() => window.appImManager.chat.input.clearHelper());
  await frame.getByRole('textbox', {name: 'Message'}).fill('');
  const settle = async() => {
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(350);
  };
  const sweep = async(label) => {
    const result = await frame.evaluate(({sentinels, circles}) => {
      const probe = document.createElement('span');
      probe.hidden = true;
      document.body.append(probe);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', {willReadFrequently: true});
      const rgba = color => {
        probe.style.color = color;
        ctx.clearRect(0, 0, 1, 1);
        const resolved = getComputedStyle(probe).color;
        if(/^rgba?\(/.test(resolved)) {
          const parts = resolved.match(/[\d.]+/g).map(Number);
          return [...parts.slice(0, 3), (parts[3] ?? 1) * 255];
        }
        const srgb = resolved.match(/^color\(srgb ([^)]+)\)$/);
        if(srgb) {
          const parts = srgb[1].match(/-?[\d.]+/g).map(Number);
          return [...parts.slice(0, 3).map(c => c * 255), (parts[3] ?? 1) * 255];
        }
        ctx.fillStyle = resolved;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const palette = Object.entries(sentinels).filter(([name]) => name.endsWith('color')).flatMap(([, values]) => values.map(rgba));
      // Independently reproduce the documented upstream companion formulas. Do not
      // bless colors merely because the implementation emitted them into its stylesheet.
      for(const index of [0, 1]) {
        const surface = rgba(sentinels['surface-color'][index]);
        const outgoing = rgba(sentinels['outgoing-bubble-color'][index]);
        const secondary = index ? [170, 170, 170] : [112, 117, 121];
        palette.push(secondary.map((c, i) => Math.floor(surface[i] + (c - surface[i]) * .08)));
        for(const [name, values] of Object.entries(sentinels).filter(([name]) => name.endsWith('color'))) {
          const color = rgba(values[index]);
          const mix = name === 'outgoing-accent-color' ? outgoing : surface;
          const alpha = name === 'outgoing-bubble-color' ? (index ? 1 : .12) : .08;
          palette.push(color.slice(0, 3).map((c, i) => Math.floor(mix[i] + (c - mix[i]) * alpha)));
          // CSS relative HSL uses the same lightness subtraction as rgbaToHsla upstream.
          palette.push(rgba(`hsl(from ${values[index]} h s calc(l - ${name === 'accent-color' ? 4 : alpha * 100}))`));
        }
      }
      // Background-derived service/date tint is the one allowed chromatic upstream token.
      for(const el of document.querySelectorAll('.chat')) {
        palette.push(rgba(getComputedStyle(el).getPropertyValue('--message-highlighting-color')));
      }
      const radii = new Set(Object.entries(sentinels).filter(([name]) => name.endsWith('radius')).flatMap(([, values]) => values));
      const selector = el => {
        const part = el => el.localName + (el.id ? '#' + el.id : '') + [...el.classList].map(c => '.' + CSS.escape(c)).join('');
        return (el.parentElement ? part(el.parentElement) + ' > ' : '') + part(el);
      };
      const issues = [], seen = new Set();
      let elements = 0;
      const colors = value => value.match(/(?:rgba?|hsla?|color|oklch|oklab|lab|lch)\([^()]+\)|#[\da-f]{3,8}\b/g) || [];
      const inspect = (el, css, suffix = '') => {
        const properties = ['color', 'background-color', 'outline-color', 'fill', 'stroke', 'box-shadow', 'caret-color', 'background-image'];
        for(const side of ['top', 'right', 'bottom', 'left']) {
          if(parseFloat(css.getPropertyValue(`border-${side}-width`)) && css.getPropertyValue(`border-${side}-style`) !== 'none') properties.push(`border-${side}-color`);
        }
        for(const property of properties) {
          if(property === 'outline-color' && (!parseFloat(css.outlineWidth) || css.outlineStyle === 'none')) continue;
          for(const color of colors(css.getPropertyValue(property))) {
            const channels = rgba(color);
            if(channels[3] === 0 || Math.max(...channels.slice(0, 3)) - Math.min(...channels.slice(0, 3)) <= 12) continue;
            // Upstream checkbox gray and blue-gray shadows are neutral too; keep
            // these exact hues scoped to their properties without relaxing the sweep.
            if(/^border-(?:top|right|bottom|left)-color$/.test(property) && [141, 150, 156].every((c, i) => c === channels[i])) continue;
            if(property === 'box-shadow' && [16, 35, 47].every((c, i) => c === channels[i])) continue;
            // Quantization of translucent canvas pixels can move a channel by a few units.
            if(palette.some(allowed => allowed.slice(0, 3).every((c, i) => Math.abs(c - channels[i]) <= 3))) continue;
            const message = `${selector(el)}${suffix}: ${property}: ${color}`;
            if(!seen.has(message)) { seen.add(message); issues.push(message); }
          }
        }
        for(const corner of ['top-left', 'top-right', 'bottom-right', 'bottom-left']) {
          const value = css.getPropertyValue(`border-${corner}-radius`);
          if(!parseFloat(value) || value.split(' ').every(v => radii.has(v))) continue;
          if(el.matches(circles) && (value === '50%' || value === '100%' || parseFloat(value) >= Math.min(el.clientWidth, el.clientHeight) / 2)) continue;
          const message = `${selector(el)}${suffix}: border-${corner}-radius: ${value}`;
          if(!seen.has(message)) { seen.add(message); issues.push(message); }
        }
      };
      for(const el of document.body.querySelectorAll('*')) {
        if(!el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) continue;
        const rect = el.getBoundingClientRect();
        if(rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue;
        elements++;
        inspect(el, getComputedStyle(el));
        for(const pseudo of ['::before', '::after']) {
          const css = getComputedStyle(el, pseudo);
          if(css.content !== 'none' && css.content !== 'normal' && css.display !== 'none' && css.visibility !== 'hidden' && +css.opacity > 0) inspect(el, css, pseudo);
        }
      }
      probe.remove();
      return {elements, issues};
    }, {sentinels: themeSentinels, circles});
    snapshots.push({label, ...result});
    await writeFile(`${artifacts}/theme-coverage.json`, JSON.stringify(snapshots, null, 2));
    console.log(`${label}: swept ${result.elements} elements; ${result.issues.length} issues`);
  };
  const assertColor = async(locator, property, variable, index) => {
    const expected = await frame.evaluate(value => {
      const el = document.createElement('span');
      el.style.color = value;
      document.body.append(el);
      const color = getComputedStyle(el).color;
      el.remove();
      return color;
    }, themeSentinels[variable][index]);
    await expect(locator).toHaveCSS(property, expected);
  };
  const nativeColors = async() => frame.evaluate(() => {
    const selectors = ['.chat-input-wrapper', '.btn-send', '.bubble.is-out .bubble-content', '.avatar'];
    return selectors.map(selector => {
      const css = getComputedStyle(document.querySelector(selector));
      return [selector, css.color, css.backgroundColor, css.borderRadius];
    });
  });
  const menu = frame.locator('#bubble-contextmenu');
  const openMenu = async() => {
    await showMessage(textMid);
    await bubble('Support quoted reply').locator('.message').last().click({button: 'right'});
    await expect(menu).toBeVisible();
    await settle();
  };
  const close = async() => { await page.keyboard.press('Escape'); await settle(); };
  const popup = frame.locator('.popup-new-media');
  const openPopup = async() => {
    const [picker] = await Promise.all([page.waitForEvent('filechooser'),
      frame.evaluate(() => window.appImManager.chat.input.onAttachClick(false, true, true))]);
    await picker.setFiles({name: 'theme.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64')});
    await expect(popup).toBeVisible();
    await settle();
  };
  const openViewer = async() => {
    await showMessage(messageMids.get('Theme media'));
    await bubble('Theme media').locator('img.media-photo').last().click();
    await expect(frame.locator('.media-viewer-whole.active')).toBeVisible();
    await frame.evaluate(() => window.appMediaViewer.setMoverAnimationPromise);
    await settle();
  };
  for(const mode of ['defaults', 'sentinels']) {
    for(const [schemeIndex, scheme] of ['light', 'dark'].entries()) {
      await page.emulateMedia({colorScheme: scheme});
      await expect(frame.locator('html')).toHaveClass(scheme === 'dark' ? /night/ : /^(?!.*night)/);
      await showMessage(textMid);
      await settle();
      const baseline = await nativeColors();
      if(mode === 'defaults') {
        await expect(frame.locator('.chat-input-main-wrapper')).toHaveCSS('border-radius', '24px');
        await expect(frame.locator('.chat-input-main-wrapper')).toHaveCSS('background-color', scheme === 'dark' ? 'rgb(33, 33, 33)' : 'rgb(255, 255, 255)');
        await expect(frame.locator('.avatar').filter({visible: true}).first()).toHaveCSS('border-radius', '50%');
      }
      if(mode === 'sentinels') {
        await frame.evaluate(sentinels => {
          const style = document.createElement('style');
          style.id = 'widget-test-sentinels';
          style.textContent = [':root:not(.night)', ':root.night'].map((selector, i) => `${selector} { ${Object.entries(sentinels).map(([name, values]) => `--widget-${name}: ${values[i]};`).join(' ')} }`).join('\n');
          document.head.append(style);
          window.rootScope.dispatchEvent('theme_changed');
        }, themeSentinels);
        await settle();
        await expect(frame.locator('.chat-input-main-wrapper')).toHaveCSS('border-radius', themeSentinels['composer-radius'][schemeIndex]);
        await expect(frame.locator('.avatar').filter({visible: true}).first()).toHaveCSS('border-radius', themeSentinels['avatar-radius'][schemeIndex]);
        await assertColor(frame.locator('.btn-send').first(), 'background-color', 'accent-color', schemeIndex);
        await assertColor(frame.locator('.chat-input-main-wrapper'), 'background-color', 'surface-color', schemeIndex);
        await assertColor(frame.getByRole('textbox', {name: 'Message'}), 'color', 'text-color', schemeIndex);
        await assertColor(frame.locator('.blah-widget-background'), 'background-color', 'chat-background-color', schemeIndex);
        await expect(frame.locator('.blah-widget-background')).toHaveCSS('background-size', themeSentinels['chat-background-size'][schemeIndex]);
        for(const [direction, caption] of [['incoming', 'Theme support link'], ['outgoing', 'Customer link https://example.test']]) {
          await showMessage(messageMids.get(caption));
          const message = frame.locator(`.bubble[data-mid="${messageMids.get(caption)}"]`);
          await expect(message.locator('.bubble-content')).toHaveCSS('border-radius', themeSentinels[direction + '-bubble-radius'][schemeIndex]);
          await assertColor(message.locator('.bubble-content'), 'background-color', direction + '-bubble-color', schemeIndex);
          await assertColor(message.locator('.message').last(), 'color', direction + '-text-color', schemeIndex);
          await assertColor(message.locator('.message a').first(), 'color', direction === 'outgoing' ? 'outgoing-accent-color' : 'accent-color', schemeIndex);
          if(direction === 'incoming') await assertColor(message.locator('.name').first(), 'color', 'support-sender-color', schemeIndex);
        }
        // Direction overrides take precedence; removing them exposes the shared radius.
        await frame.evaluate(() => {
          for(const direction of ['incoming', 'outgoing']) document.documentElement.style.setProperty(`--widget-${direction}-bubble-radius`, 'initial');
        });
        await expect(frame.locator('.bubble.is-out .bubble-content').first()).toHaveCSS('border-radius', themeSentinels['bubble-radius'][schemeIndex]);
        await frame.evaluate(() => {
          for(const direction of ['incoming', 'outgoing']) document.documentElement.style.removeProperty(`--widget-${direction}-bubble-radius`);
        });
        await showMessage(textMid);
        await expect(bubble('Support quoted reply').locator('.quote-like').first()).toHaveCSS('border-radius', themeSentinels['media-radius'][schemeIndex]);
        await expect(frame.locator('.is-date .bubble-content').filter({visible: true}).first()).toHaveCSS('border-radius', themeSentinels['pill-radius'][schemeIndex]);
        const selection = await frame.getByRole('textbox', {name: 'Message'}).evaluate(el => getComputedStyle(el, '::selection').backgroundColor);
        assert.equal(selection, schemeIndex ? 'rgba(255, 82, 193, 0.4)' : 'rgba(206, 20, 124, 0.4)', 'native text selection follows accent');
        await sweep(scheme + '-chat');
        await frame.locator('.chat.active .toggle-emoticons').click();
        await settle();
        await sweep(scheme + '-emoji');
        await frame.locator('.chat.active .toggle-emoticons').click();
        const input = frame.getByRole('textbox', {name: 'Message'});
        await input.fill('Theme formatting');
        await input.press('Control+a');
        await expect(frame.locator('.markup-tooltip.is-visible')).toBeVisible();
        await settle();
        await sweep(scheme + '-formatting');
        await screenshot(`sentinels-${scheme}-formatting`);
        await close();
        await input.fill('');
        // The debug DC has no emoji keyword dictionary; use Unicode results with the
        // real autocomplete renderer, without adding network fixtures or CSS replicas.
        await frame.evaluate(async() => {
          const helper = window.appImManager.chat.input.emojiHelper;
          await helper.render([{emoji: '😀'}, {emoji: '🙂'}], false, helper.getMiddleware());
        });
        await expect(frame.locator('.emoji-helper')).toBeVisible();
        await settle();
        await sweep(scheme + '-autocomplete');
        await frame.evaluate(() => window.appImManager.chat.input.autocompleteHelperController.hideOtherHelpers());
        for(const caption of ['Support file', 'Widget file regression', 'Widget album regression', 'Widget audio regression', 'Theme support link', 'Customer link https://example.test']) {
          await showMessage(messageMids.get(caption));
          await settle();
          await sweep(scheme + '-' + caption);
        }
        const statusMid = messageMids.get('Widget file regression');
        await showMessage(statusMid);
        for(const status of ['sending', 'error', 'sent']) {
          await frame.evaluate(({mid, status}) => {
            const el = document.querySelector(`.bubble[data-mid="${mid}"]`);
            window.appImManager.chat.bubbles.setBubbleSendingStatus(el, status);
          }, {mid: statusMid, status});
          await settle();
          await assertColor(frame.locator(`.bubble[data-mid="${statusMid}"] .time-inner .time-sending-status`).first(), 'color', status === 'error' ? 'danger-color' : 'outgoing-accent-color', schemeIndex);
          await sweep(scheme + '-' + status);
        }
        await frame.evaluate(mid => window.appImManager.chat.input.initMessageReply({replyToMsgId: mid}), messageMids.get('Support photo'));
        await settle();
        await sweep(scheme + '-reply-composer');
        await frame.evaluate(() => window.appImManager.chat.input.clearHelper());
        await showMessage(textMid);
        await frame.locator(`.bubble[data-mid="${textMid}"]`).evaluate(el => el.classList.add('is-highlighted'));
        await settle();
        await sweep(scheme + '-reply-highlight');
        await frame.locator(`.bubble[data-mid="${textMid}"]`).evaluate(el => el.classList.remove('is-highlighted'));
        await frame.evaluate(() => window.I18n.forceRTL(true));
        await settle();
        await sweep(scheme + '-rtl');
        await screenshot(`sentinels-${scheme}-rtl`);
        await frame.evaluate(() => window.I18n.forceRTL(false));
        await settle();
      }
      await screenshot(`${mode}-${scheme}-chat`);
      await openMenu();
      await screenshot(`${mode}-${scheme}-menu`);
      if(mode === 'sentinels') {
        await expect(menu).toHaveCSS('border-radius', themeSentinels['menu-radius'][schemeIndex]);
        await assertColor(menu.locator('.danger').first(), 'color', 'danger-color', schemeIndex);
        await sweep(scheme + '-menu');
      }
      if(mode === 'sentinels') {
        await menu.getByRole('menuitem', {name: 'Delete', exact: true}).click();
        await expect(frame.locator('.popup.active')).toBeVisible();
        await settle();
        await sweep(scheme + '-confirmation');
        await screenshot(`sentinels-${scheme}-confirmation`);
      }
      await close();
      await frame.getByRole('button', {name: 'Attach', exact: true}).click();
      await settle();
      if(mode === 'sentinels') {
        const attachMenu = frame.getByRole('menu').filter({visible: true});
        await expect(attachMenu).toHaveCSS('border-radius', themeSentinels['menu-radius'][schemeIndex]);
        await assertColor(attachMenu.locator('.btn-menu-item').first(), 'color', 'text-color', schemeIndex);
        await sweep(scheme + '-attach');
      }
      await screenshot(`${mode}-${scheme}-attach`);
      await close();
      await openPopup();
      await screenshot(`${mode}-${scheme}-popup`);
      if(mode === 'sentinels') {
        await expect(popup.locator('.popup-container')).toHaveCSS('border-radius', themeSentinels['popup-radius'][schemeIndex]);
        await assertColor(popup.locator('.btn-primary').first(), 'background-color', 'accent-color', schemeIndex);
        await expect(popup.locator('.btn-primary').first()).toHaveCSS('border-radius', themeSentinels['button-radius'][schemeIndex]);
        await sweep(scheme + '-popup');
        await popup.locator('.popup-item-media').first().hover({position: {x: 5, y: 5}});
        await frame.locator('.popup-item-media-action-menu > .tgico').first().click();
        await expect(frame.locator('.media-editor__overlay')).toBeVisible();
        await settle();
        await sweep(scheme + '-editor');
        await screenshot(`sentinels-${scheme}-editor`);
        await frame.locator('.media-editor__topbar [aria-label="Close"]').click();
        await expect(frame.locator('.media-editor__overlay')).toHaveCount(0);
      }
      await close();
      // If upstream asks to discard, cancel the upload through its confirmation.
      if(await popup.count()) {
        const discard = frame.getByRole('button', {name: /discard/i});
        if(await discard.count()) await discard.last().click();
      }
      await expect(popup).toHaveCount(0);
      await openViewer();
      await screenshot(`${mode}-${scheme}-viewer`);
      if(mode === 'sentinels') {
        const caption = frame.locator('.media-viewer-caption');
        await expect.poll(() => caption.evaluate(el => getComputedStyle(el).getPropertyValue('--link-color').trim())).toBe(await frame.locator('.chat').first().evaluate(el => getComputedStyle(el).getPropertyValue('--primary-color').trim()));
        await assertColor(caption.locator('a'), 'color', 'accent-color', schemeIndex);
        await sweep(scheme + '-viewer');
      }
      await close();
      await expect(frame.locator('.media-viewer-whole')).toHaveCount(0);
      if(mode === 'sentinels') {
        // The same stylesheet reacts to the night class, then an inline mutation accepts
        // CSS functions and named colors (not only the hexadecimal fixture values).
        await page.emulateMedia({colorScheme: scheme === 'light' ? 'dark' : 'light'});
        await assertColor(frame.locator('.btn-send').first(), 'background-color', 'accent-color', 1 - schemeIndex);
        await page.emulateMedia({colorScheme: scheme});
        await assertColor(frame.locator('.btn-send').first(), 'background-color', 'accent-color', schemeIndex);
        await frame.evaluate(() => {
          document.documentElement.style.setProperty('--widget-accent-color', 'rebeccapurple');
          document.documentElement.style.setProperty('--widget-composer-radius', 'calc(1rem - 3px)');
        });
        await expect(frame.locator('.btn-send').first()).toHaveCSS('background-color', 'rgb(102, 51, 153)');
        await expect(frame.locator('.chat-input-main-wrapper')).toHaveCSS('border-radius', '13px');
        await frame.evaluate(() => {
          document.documentElement.style.removeProperty('--widget-accent-color');
          document.documentElement.style.removeProperty('--widget-composer-radius');
          document.querySelector('#widget-test-sentinels').remove();
          window.rootScope.dispatchEvent('theme_changed');
        });
        await showMessage(textMid);
        await settle();
        assert.deepEqual(await nativeColors(), baseline, 'unsetting restores ' + scheme + ' colors and radii');
      }
    }
  }
  await page.emulateMedia({colorScheme: 'light'});
  assert.deepEqual(snapshots.flatMap(({label, issues}) => issues.map(issue => label + ': ' + issue)), [], 'Visible theme coverage');
  console.log('Widget theme: defaults, live sentinels, overlays, color/radius sweep and restoration passed.');
}

export async function checkStatusTheme({page, frame, artifacts}) {
  for(const [index, scheme] of ['light', 'dark'].entries()) {
    await page.emulateMedia({colorScheme: scheme});
    await frame.evaluate(({sentinels, index}) => {
      for(const [name, values] of Object.entries(sentinels)) document.documentElement.style.setProperty('--widget-' + name, values[index]);
    }, {sentinels: themeSentinels, index});
    await expect(frame.locator('#widget [role="alert"]')).toHaveCSS('color', index ? 'rgb(255, 113, 64)' : 'rgb(207, 56, 22)');
    await expect(frame.locator('#widget button')).toHaveCSS('border-radius', themeSentinels['button-radius'][index]);
    await expect(frame.locator('#widget button')).toHaveCSS('background-color', index ? 'rgb(255, 82, 193)' : 'rgb(206, 20, 124)');
    await page.locator('iframe').screenshot({path: `${artifacts}/theme-sentinels-${scheme}-error.png`});
  }
  await frame.evaluate(sentinels => {
    for(const name of Object.keys(sentinels)) document.documentElement.style.removeProperty('--widget-' + name);
  }, themeSentinels);
}
