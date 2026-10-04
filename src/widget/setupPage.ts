import {ObjectURLScope} from '@helpers/objectUrlScope';
import {discoverWidgetDC, generateWidgetIndex, themeDeclarations, themeFields, type WidgetTheme} from '@/widget/setup';
import widgetCSS from '@/widget/style.css?inline';
import '@/widget/setupStyle.css';

const domain = document.querySelector<HTMLInputElement>('#dc-domain');
const verify = document.querySelector<HTMLButtonElement>('#verify');
const download = document.querySelector<HTMLButtonElement>('#download');
const dcStatus = document.querySelector<HTMLElement>('#dc-status');
const downloadStatus = document.querySelector<HTMLElement>('#download-status');
const details = document.querySelector<HTMLElement>('#dc-details');
const fields = document.querySelector<HTMLElement>('#theme-fields');
const preview = document.querySelector<HTMLIFrameElement>('#preview');
const urls = new ObjectURLScope();
const theme: WidgetTheme = {};
let verified: Awaited<ReturnType<typeof discoverWidgetDC>>;
let revision = 0;

function updatePreview() {
  preview.srcdoc = `<!doctype html><html lang="en"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>Support preview</title>
    <style>${widgetCSS}\n:root {${themeDeclarations(theme)}}</style></head><body>
    <main class="widget">
      <header class="widget-header"><div class="widget-avatar" aria-hidden="true">B</div>
        <h1>Customer support</h1><span class="widget-subtitle">We're here to help</span></header>
      <div class="widget-history"><ol class="widget-messages">
        <li class="widget-message"><div class="widget-bubble"><p class="widget-text">Hello! How can we help you today?</p><time class="widget-time">10:24</time></div></li>
        <li class="widget-message widget-outgoing"><div class="widget-bubble"><p class="widget-text">I have a question about my order.</p><time class="widget-time">10:25</time></div></li>
        <li class="widget-message"><div class="widget-bubble"><p class="widget-text">Of course. Let's take a look together.</p><time class="widget-time">10:25</time></div></li>
      </ol></div>
      <div class="widget-composer"><textarea aria-label="Sample message" placeholder="Write a message…" disabled></textarea>
        <div class="widget-actions"><button disabled>Attach file</button><span class="widget-limit">Up to 20 MB</span><button class="widget-send" disabled>Send</button></div>
      </div>
    </main></body></html>`;
}

for(const {name, label: text, property} of themeFields) {
  const label = document.createElement('label');
  label.textContent = text;
  const input = document.createElement('input');
  input.type = 'text';
  input.name = name;
  input.placeholder = 'Widget default';
  input.spellcheck = false;
  input.setAttribute('aria-describedby', 'theme-help');
  input.title = `CSS ${property}: --widget-${name}`;
  input.addEventListener('input', () => {
    try {
      themeDeclarations({[name]: input.value});
      input.setCustomValidity('');
      input.removeAttribute('aria-invalid');
      theme[name] = input.value;
      updatePreview();
    } catch(error) {
      input.setCustomValidity((error as Error).message);
      input.setAttribute('aria-invalid', 'true');
    }
  });
  label.append(input);
  fields.append(label);
}

document.querySelector('#reset-theme').addEventListener('click', () => {
  for(const input of fields.querySelectorAll('input')) {
    input.value = '';
    input.setCustomValidity('');
    input.removeAttribute('aria-invalid');
  }
  for(const {name} of themeFields) delete theme[name];
  updatePreview();
});

function clearDC() {
  ++revision;
  verified = undefined;
  details.hidden = true;
  download.disabled = true;
  verify.disabled = false;
  dcStatus.textContent = '';
  downloadStatus.textContent = 'Verify a DC to enable download.';
}
domain.addEventListener('input', clearDC);
document.querySelector('#dc-form').addEventListener('submit', async(event) => {
  event.preventDefault();
  clearDC();
  const current = revision;
  verify.disabled = true;
  dcStatus.textContent = 'Fetching and verifying the public profile…';
  try {
    if(!isSecureContext) throw new Error('Open setup.html over HTTPS or on localhost to verify DC profiles.');
    const result = await discoverWidgetDC(domain.value);
    if(current !== revision) return;
    verified = result;
    domain.value = result.domain;
    document.querySelector('#dc-identity').textContent = result.version.id;
    document.querySelector('#dc-endpoint').textContent = result.dc.url;
    document.querySelector('#dc-expires').textContent = new Date(Number(result.version.expiresAt) * 1000).toLocaleString();
    details.hidden = false;
    dcStatus.textContent = 'DC profile verified.';
    downloadStatus.textContent = 'Add your app credentials, then download your configuration.';
    download.disabled = false;
  } catch(error) {
    if(current === revision) dcStatus.textContent = 'Could not verify the DC: ' + (error as Error).message;
  } finally {
    if(current === revision) verify.disabled = false;
  }
});

document.querySelector('#configuration-form').addEventListener('submit', async(event) => {
  event.preventDefault();
  if(!verified) return;
  const selected = verified;
  download.disabled = true;
  downloadStatus.textContent = 'Preparing index.html…';
  try {
    const response = await fetch(new URL('index.html', location.href), {cache: 'no-store', credentials: 'omit', redirect: 'error'});
    if(!response.ok) throw new Error('Could not load the widget index.html: HTTP ' + response.status);
    const template = await response.text();
    if(verified !== selected) throw new Error('The DC changed. Verify it before downloading.');
    if(!document.querySelector<HTMLFormElement>('#configuration-form').reportValidity()) {
      throw new Error('Correct the highlighted field before downloading.');
    }
    if(BigInt(selected.version.expiresAt) <= BigInt(Math.floor(Date.now() / 1000))) {
      clearDC();
      throw new Error('The DC profile expired. Verify it again before downloading.');
    }
    const html = generateWidgetIndex(template, {
      dcId: selected.dc.id, url: selected.dc.url, rsaKey: selected.dc.rsaKey,
      apiId: +document.querySelector<HTMLInputElement>('#api-id').value,
      apiHash: document.querySelector<HTMLInputElement>('#api-hash').value.trim()
    }, theme);
    urls.dispose();
    const link = document.createElement('a');
    link.href = urls.create(new Blob([html], {type: 'text/html;charset=utf-8'}));
    link.download = 'index.html';
    document.body.append(link);
    link.click();
    link.remove();
    downloadStatus.textContent = 'Downloaded. Replace index.html in the release folder, keeping the assets beside it.';
  } catch(error) {
    downloadStatus.textContent = (error as Error).message;
  } finally {
    download.disabled = !verified;
  }
});

window.addEventListener('pagehide', () => urls.dispose());
updatePreview();
