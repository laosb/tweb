import WidgetSharedMediaTab from '@components/sidebarRight/tabs/sharedMediaTab';
import WidgetTab from '@/widget/omitted/tab';
import {registerHotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';

export class AppSidebarRight {
  sidebarEl = document.getElementById('column-right');
  historyTabIds: WidgetTab[] = [];
  sharedMediaTab: WidgetSharedMediaTab;
  construct() { this.sidebarEl.inert = true; }
  createSharedMediaTab() { return new WidgetSharedMediaTab(this as any); }
  replaceSharedMediaTab(tab?: WidgetSharedMediaTab) { this.sharedMediaTab = tab; }
  destroySharedMediaTab(tab: WidgetSharedMediaTab) {
    if(this.sharedMediaTab === tab) this.sharedMediaTab = undefined;
    tab.destroy();
  }
  isShownOrOpening() { return false; }
  toggleSidebar() { return Promise.resolve(); }
  hide() { this.sidebarEl.inert = true; }
  reveal() {}
  getTab(): undefined { return undefined; }
  createTab(Tab = WidgetTab) { return new Tab(); }
  closeAllTabs() { this.sharedMediaTab = undefined; this.historyTabIds.length = 0; }
}

const appSidebarRight = new AppSidebarRight();
registerHotReloadGuard({appSidebarRight: appSidebarRight as any});
export default appSidebarRight;
