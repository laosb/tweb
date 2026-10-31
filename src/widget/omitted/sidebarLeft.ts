import WidgetTab from '@/widget/omitted/tab';
import {registerHotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import noop from '@helpers/noop';

export class AppSidebarLeft {
  sidebarEl = document.getElementById('column-left');
  historyTabIds: WidgetTab[] = [];
  inputSearch = {input: document.createElement('input'), value: '', remove: noop};
  construct() { this.sidebarEl.inert = true; }
  isCollapsed() { return false; }
  hasSomethingOpenInside() { return false; }
  closeEverythingInside() { return Promise.resolve(); }
  closeEverythingInsideNaturally() { return Promise.resolve(); }
  initNavigation() {}
  onCollapsedChange() {}
  reveal() {}
  getTab(): undefined { return undefined; }
  createTab(Tab = WidgetTab) { return new Tab(); }
  initSearch() { return {open: noop, openWithPeerId: noop, openWithArchive: noop, close: noop}; }
}

const appSidebarLeft = new AppSidebarLeft();
registerHotReloadGuard({appSidebarLeft: appSidebarLeft as any});
export default appSidebarLeft;
