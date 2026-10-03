import {createSignal, For, onCleanup, Show} from 'solid-js';
import {createStore, reconcile} from 'solid-js/store';
import {render} from 'solid-js/web';
import {ObjectURLScope} from '@helpers/objectUrlScope';
import {randomLong} from '@helpers/random';
import {readConfig, readToken} from '@/widget/config';
import {WidgetManager, type WidgetMessage, validateAttachment} from '@/widget/manager';
import {readSnapshot, WidgetSessionController} from '@/widget/session';
import {WidgetTransport} from '@/widget/transport';
import '@/widget/style.css';

function errorText(error: unknown) {
  const code = (error as ApiError)?.type || (error as Error)?.message;
  switch(code) {
    case 'ACCESS_TOKEN_INVALID':
    case 'ACCESS_TOKEN_EXPIRED':
    case 'AUTH_KEY_UNREGISTERED': return 'This customer token is no longer valid. Please reopen support from the application.';
    case 'WIDGET_MANAGED_ACCOUNT_REQUIRED': return 'This chat requires a managed customer account.';
    case 'SUPPORT_UNAVAILABLE': return 'Support is currently unavailable.';
    case 'WIDGET_FILE_SIZE': return 'Choose a nonempty file up to 20 MB.';
    case 'WIDGET_FILE_TYPE': return 'GIFs, stickers and contact cards cannot be sent here.';
    case 'WIDGET_MESSAGE_INVALID': return 'Enter a message up to 4096 characters, or a file caption up to 1024 characters.';
    default: return 'Could not connect to support. Please try again.';
  }
}

function Widget() {
  const [manager, setManager] = createSignal<WidgetManager>();
  const [state, setState] = createStore<{messages: WidgetMessage[]}>({messages: []});
  const [status, setStatus] = createSignal('Connecting to support…');
  const [error, setError] = createSignal('');
  const [draft, setDraft] = createSignal('');
  const [file, setFile] = createSignal<File>();
  const [busy, setBusy] = createSignal(false);
  const [older, setOlder] = createSignal(false);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const [photos, setPhotos] = createStore<Record<number, string>>({});
  const urls = new ObjectURLScope();
  let list: HTMLDivElement, input: HTMLInputElement;
  let generation = 0, nonce = randomLong(), refreshTimer: ReturnType<typeof setTimeout>;
  let refreshPending: Promise<void>;
  let controller: WidgetSessionController<WidgetManager>;

  const sync = (scroll = false) => {
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    setState('messages', reconcile(manager().view, {key: 'id'}));
    if(scroll || nearBottom) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  };
  const markRead = () => {
    if(document.visibilityState === 'visible' && document.hasFocus()) manager()?.markRead().catch(() => {});
  };
  const refresh = () => {
    const current = manager(), run = generation;
    if(!current || refreshPending || loadingOlder()) return;
    const pending = (async() => {
      try {
        await current.synchronize();
        if(run !== generation) return;
        sync();
        markRead();
      } catch(err) { if(run === generation) setError(errorText(err)); }
    })();
    refreshPending = pending;
    void pending.finally(() => { if(refreshPending === pending) refreshPending = undefined; });
  };

  const start = async() => {
    const run = ++generation;
    clearTimeout(refreshTimer);
    refreshPending = undefined;
    setManager(undefined);
    setState('messages', []);
    setPhotos(reconcile({}));
    urls.dispose();
    setDraft(''); setFile(undefined); setBusy(false); setOlder(false); setLoadingOlder(false);
    if(input) input.value = '';
    nonce = randomLong();
    setError(''); setStatus('Connecting to support…');
    const token = readToken(location.hash);
    let config: ReturnType<typeof readConfig>;
    try { config = readConfig(); } catch{}
    try {
      const current = await controller.replace(config, token);
      if(run !== generation) return;
      if(!token) { setStatus('This support chat requires a customer token.'); return; }
      if(!config) { setStatus('Support has not been configured.'); return; }
      if(!current) return;
      const hasOlder = await current.history();
      if(run !== generation) return;
      setManager(current);
      setOlder(hasOlder);
      sync(true);
      current.onChange = () => {
        if(run !== generation) return;
        sync();
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 150);
      };
      setStatus('');
      markRead();
    } catch(err) {
      if(run === generation) { setStatus(''); setError(errorText(err)); }
    }
  };

  try {
    // window.name survives same-origin iframe reloads. An unnamed frame gets a
    // random namespace, so sibling widgets never overwrite one another's key.
    if(!window.name) window.name = 'blah-widget-' + crypto.randomUUID();
    const key = 'blah:feedback:v1:' + location.pathname + ':' + window.name;
    const storage = window.sessionStorage;
    const snapshot = readSnapshot(storage.getItem(key));
    controller = new WidgetSessionController(snapshot, (value) => {
      if(value) storage.setItem(key, JSON.stringify(value));
      else storage.removeItem(key);
    }, (config, digest, saved, save) => new WidgetManager(new WidgetTransport(config, digest, saved, save), config));
    void start();
  } catch{
    setStatus('This support chat needs browser session storage. Please reopen it from the application.');
  }

  const onHashChange = () => { if(controller) void start(); };
  const onPageHide = () => { ++generation; controller?.suspend(); };
  const onPageShow = (event: PageTransitionEvent) => { if(event.persisted) onHashChange(); };
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('focus', markRead);
  document.addEventListener('visibilitychange', markRead);
  const poll = setInterval(() => { if(document.visibilityState === 'visible') refresh(); }, 10_000);
  onCleanup(() => {
    onPageHide();
    clearInterval(poll); clearTimeout(refreshTimer);
    urls.dispose();
    window.removeEventListener('hashchange', onHashChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('focus', markRead);
    document.removeEventListener('visibilitychange', markRead);
  });

  const send = async(event: SubmitEvent) => {
    event.preventDefault();
    const current = controller?.active, run = generation;
    if(!current || busy()) return;
    setBusy(true); setError('');
    try {
      await current.send(draft(), nonce, file());
      if(run !== generation) return;
      setDraft(''); setFile(undefined); input.value = ''; nonce = randomLong();
      await current.history();
      if(run === generation) sync(true);
    } catch(err) { if(run === generation) setError(errorText(err)); }
    finally { if(run === generation) setBusy(false); }
  };

  const chooseFile = async() => {
    const selected = input.files?.[0], run = generation;
    if(!selected) return;
    try {
      await validateAttachment(selected);
      if(run !== generation) return;
      setFile(selected); nonce = randomLong(); setError('');
    } catch(err) { if(run === generation) { input.value = ''; setError(errorText(err)); } }
  };

  const loadOlder = async() => {
    const current = manager(), run = generation;
    if(!current || loadingOlder()) return;
    const height = list.scrollHeight, top = list.scrollTop;
    setLoadingOlder(true);
    try {
      const more = await current.history(state.messages[0]?.id);
      if(run !== generation) return;
      setOlder(more); setState('messages', reconcile(current.view, {key: 'id'}));
      requestAnimationFrame(() => { list.scrollTop = top + list.scrollHeight - height; });
    } catch(err) { if(run === generation) setError(errorText(err)); }
    finally { if(run === generation) setLoadingOlder(false); }
  };

  const download = async(id: number) => {
    const current = manager(), run = generation;
    try {
      const result = await current.download(id);
      if(run !== generation) return;
      const url = urls.create(result.blob);
      if(result.photo) { if(photos[id]) urls.release(photos[id]); setPhotos(id, url); }
      else {
        const link = document.createElement('a');
        link.href = url; link.download = result.name; link.click();
        setTimeout(() => urls.release(url), 30_000);
      }
    } catch(err) { if(run === generation) setError(errorText(err)); }
  };

  return <main class="widget" aria-label="Customer support">
    <header class="widget-header"><span class="widget-avatar" aria-hidden="true">{(manager()?.supportName || 'Support').slice(0, 1)}</span>
      <h1>{manager()?.supportName || 'Support'}</h1><span class="widget-subtitle">We’re here to help</span>
    </header>
    <div class="widget-history" ref={list} role="region" aria-label="Conversation" tabIndex={0}>
      <Show when={older()}><button class="widget-older" type="button" disabled={loadingOlder()} onClick={loadOlder}>{loadingOlder() ? 'Loading…' : 'Earlier messages'}</button></Show>
      <Show when={manager() && !state.messages.length}><p class="widget-empty">How can we help?</p></Show>
      <ol class="widget-messages"><For each={state.messages}>{(message) => <li class="widget-message" classList={{'widget-outgoing': message.outgoing}}>
        <div class="widget-bubble">
          <span class="widget-sr-only">{message.outgoing ? 'You' : manager()?.supportName}: </span>
          <Show when={message.text}><p class="widget-text" dir="auto">{message.text}</p></Show>
          <Show when={message.attachment}><button type="button" class="widget-attachment" onClick={() => download(message.id)}>
            {message.attachment.photo ? 'View photo' : 'Download ' + message.attachment.name}
          </button></Show>
          <Show when={photos[message.id]}><img class="widget-photo" src={photos[message.id]} alt="Chat attachment" /></Show>
          <Show when={message.unsupported}><p class="widget-text">Attachment unavailable in this chat.</p></Show>
          <time class="widget-time" dateTime={new Date(message.date * 1000).toISOString()}>{new Date(message.date * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</time>
        </div>
      </li>}</For></ol>
    </div>
    <p class="widget-status" role="status">{status()}</p>
    <Show when={error()}><div class="widget-error"><p role="alert">{error()}</p><button type="button" onClick={onHashChange}>Reconnect</button></div></Show>
    <form class="widget-composer" onSubmit={send}>
      <Show when={file()}><div class="widget-file-name">{file().name}<button type="button" disabled={busy()} onClick={() => { setFile(undefined); input.value = ''; nonce = randomLong(); }}>Remove attachment</button></div></Show>
      <label class="widget-sr-only" for="message">Message to support</label>
      <textarea id="message" rows={2} placeholder="Write a message…" value={draft()} disabled={!manager() || busy()}
        maxLength={file() ? 1024 : 4096} onInput={(event) => { setDraft(event.currentTarget.value); nonce = randomLong(); }} />
      <div class="widget-actions">
        <input ref={input} class="widget-sr-only" type="file" id="attachment" tabIndex={-1} aria-label="Choose an attachment" disabled={!manager() || busy()} onChange={chooseFile} />
        <button type="button" class="widget-attach" disabled={!manager() || busy()} onClick={() => input.click()}>Attach file</button>
        <span class="widget-limit">Up to 20 MB</span>
        <button type="submit" class="widget-send" disabled={!manager() || busy() || (!draft().trim() && !file())}>{busy() ? 'Sending…' : 'Send'}</button>
      </div>
    </form>
  </main>;
}

render(Widget, document.getElementById('widget'));
