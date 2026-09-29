import {createEffect, onCleanup} from 'solid-js';
import ChatDragAndDrop from '@components/chat/dragAndDrop';
import I18n from '@lib/langPack';
import styles from '@lib/blah/identity.module.scss';
import ensureButtonSemantics from '@helpers/dom/ensureButtonSemantics';
import {attachClickEvent} from '@helpers/dom/clickEvent';

export default function BackupDropzone(props: {disabled: boolean, onFile: (file: File) => void}) {
  const host = document.createElement('div');
  const drop = new ChatDragAndDrop(host, {
    icon: 'document', header: 'BlahIdentityFile', subtitle: 'BlahDropIdentityFile',
    onDrop: (event) => {
      event.preventDefault();
      event.stopPropagation();
      drop.container.classList.remove('is-dragover');
      if(!props.disabled) props.onFile(event.dataTransfer.files[0]);
    }
  });
  drop.container.classList.add(styles.dropzone);
  drop.outlineWrapper.remove();
  drop.container.addEventListener('dragover', (event) => { event.preventDefault(); event.stopPropagation(); });
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.hidden = true;
  input.setAttribute('aria-label', I18n.format('BlahIdentityFile', true));
  input.addEventListener('change', () => {
    if(!props.disabled) props.onFile(input.files[0]);
    input.value = '';
  });
  ensureButtonSemantics(drop.container);
  const detachClick = attachClickEvent(drop.container, () => { if(!props.disabled) input.click(); });
  createEffect(() => {
    input.disabled = props.disabled;
    drop.container.setAttribute('aria-disabled', String(props.disabled));
    drop.container.tabIndex = props.disabled ? -1 : 0;
  });
  onCleanup(() => { detachClick(); drop.destroy(); });
  return <>{host}{input}</>;
}
