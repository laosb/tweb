import {DialogElement, DialogElementOptions} from '@components/dialogElement';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import cancelEvent from '@helpers/dom/cancelEvent';
import {registerHotReloadGuard, hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import {startWidgetDialogs} from '@/widget/dialogsBootstrap';
import type Scrollable from '@components/scrollable';

// The full reacted-list popup keeps native dialog rows, without a dialog list.
export class AppDialogsManager {
  filterId = 0;
  forumTab: undefined;
  start() { startWidgetDialogs(); }
  closeForAccountSwitch() {}
  openAfterAccountSwitch() {}
  toggleForumTabByPeerId() { return Promise.resolve(false); }
  isChatListNarrow() { return false; }
  getTextColor(active: boolean) { return active ? 'white' : 'secondary-text-color'; }
  getPrimaryColor(active: boolean) { return active ? 'white' : 'primary-color'; }
  setDialogActive(element: HTMLElement, active: boolean) { element.classList.toggle('active', active); }

  createChatList(options: {new?: boolean, dialogSize?: number} = {}) {
    const list = document.createElement('ul');
    list.setAttribute('role', 'presentation');
    list.classList.add('chatlist');
    if(options.new) list.classList.add('chatlist-new');
    if(options.dialogSize) list.classList.add('chatlist-' + options.dialogSize);
    return list;
  }

  setListClickListener({list, onFound, openInner}: {
    list: HTMLElement,
    onFound?: (target: HTMLElement) => void | boolean,
    openInner?: boolean,
    autonomous?: boolean,
    withContext?: boolean
  }) {
    attachClickEvent(list, (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-peer-id]');
      if(!row || !list.contains(row)) return;
      cancelEvent(event);
      if(onFound?.(row) === false) return;
      const im = hotReloadGuard.appImManager;
      const options = {peerId: row.dataset.peerId.toPeerId()};
      if(openInner) void im.setInnerPeer(options);
      else void im.setPeer(options);
    });
  }

  addDialogNew(options: DialogElementOptions & {container?: HTMLElement | Scrollable | false, append?: boolean}) {
    const row = new DialogElement({autonomous: !!options.container, avatarSize: 'bigger', ...options});
    (row.container as any).dialogElement = row;
    if(options.container) options.container[options.append === false ? 'prepend' : 'append'](row.container);
    return row;
  }
}

const appDialogsManager = new AppDialogsManager();
registerHotReloadGuard({appDialogsManager: appDialogsManager as any});
export default appDialogsManager;
