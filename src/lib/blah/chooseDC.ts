import type {BlahConfig} from '@config/blah';
import lang from '@/lang';
import {connectDC, savedDC} from '@lib/blah/discovery';
import '@lib/blah/discovery.scss';

/** Runs before the app graph starts workers or restores chat caches. */
export async function chooseDC(): Promise<BlahConfig> {
  if(document.readyState === 'loading') {
    await new Promise<void>((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), {once: true}));
  }
  const panel = document.createElement('main');
  panel.className = 'blah-dc-setup';
  const form = document.createElement('form');
  const heading = document.createElement('h1');
  heading.textContent = lang.BlahDCConnect;
  const description = document.createElement('p');
  description.textContent = lang.BlahDCDescription;
  description.id = 'blah-dc-description';
  const label = document.createElement('label');
  label.textContent = lang.BlahDCDomain;
  const input = document.createElement('input');
  input.type = 'text';
  input.name = 'dc-domain';
  input.required = true;
  input.setAttribute('autocomplete', 'url');
  input.autocapitalize = 'none';
  input.spellcheck = false;
  input.placeholder = 'dc.example.org';
  input.setAttribute('aria-describedby', description.id + ' blah-dc-status');
  label.append(input);
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = lang.BlahDCConnect;
  const status = document.createElement('p');
  status.id = 'blah-dc-status';
  status.setAttribute('role', 'status');
  form.append(heading, description, label, button, status);
  panel.append(form);
  const siblings = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
  const inert = siblings.map((node) => node.inert);
  siblings.forEach((node) => { node.inert = true; });
  document.body.append(panel);

  return new Promise<BlahConfig>((resolve) => {
    let busy = false;
    const connect = async() => {
      if(busy) return;
      busy = true;
      button.disabled = true;
      input.readOnly = true;
      form.setAttribute('aria-busy', 'true');
      status.textContent = lang.BlahDCLoading;
      try {
        const config = await connectDC(input.value);
        panel.remove();
        siblings.forEach((node, i) => { node.inert = inert[i]; });
        resolve(config);
      } catch(error) {
        status.textContent = error instanceof Error ? error.message : lang.BlahDCFailed;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      } finally {
        busy = false;
        button.disabled = false;
        input.readOnly = false;
        form.removeAttribute('aria-busy');
      }
    };
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    form.addEventListener('submit', (event) => { event.preventDefault(); void connect(); });
    void savedDC().then((saved) => {
      if(saved) {
        input.value = saved.domain;
        void connect();
      } else {
        input.value = new URL(location.href).searchParams.get('dc') || '';
        input.focus();
      }
    }).catch((error) => {
      status.textContent = error instanceof Error ? error.message : lang.BlahDCFailed;
      input.focus();
    });
  });
}
