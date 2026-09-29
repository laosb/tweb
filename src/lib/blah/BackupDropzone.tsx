import {onCleanup, onMount} from 'solid-js';
import Button from '@components/buttonTsx';
import ChatDragAndDrop from '@components/chat/dragAndDrop';
import I18n from '@lib/langPack';
import styles from '@lib/blah/identity.module.scss';

export default function BackupDropzone(props: {disabled: boolean, onFile: (file: File) => void}) {
  const host = document.createElement('div');
  const drop = new ChatDragAndDrop(host, {
    icon: 'document', header: 'BlahEncryptedBackup', subtitle: 'BlahDropBackup',
    onDrop: (event) => {
      event.preventDefault();
      event.stopPropagation();
      drop.container.classList.remove('is-dragover');
      if(!props.disabled) props.onFile(event.dataTransfer.files[0]);
    }
  });
  drop.container.classList.add(styles.dropzone);
  drop.container.addEventListener('dragover', (event) => { event.preventDefault(); event.stopPropagation(); });
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.hidden = true;
  input.setAttribute('aria-label', I18n.format('BlahEncryptedBackup', true));
  input.addEventListener('change', () => {
    if(!props.disabled) props.onFile(input.files[0]);
    input.value = '';
  });
  const observer = new ResizeObserver(() => drop.setPath());
  onMount(() => { observer.observe(drop.container); drop.setPath(); });
  onCleanup(() => { observer.disconnect(); drop.destroy(); });
  return <>{host}{input}<Button primaryTransparent disabled={props.disabled}
    onClick={() => input.click()} text="BlahChooseBackup" /></>;
}
