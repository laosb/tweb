import WidgetTab from '@/widget/omitted/tab';

// No settings/profile payload loaders or lazy screens in the widget.
export class AppEditProfileTab extends WidgetTab {}
export class AppSettingsTab extends WidgetTab {}
export class AppContactsTab extends WidgetTab {}
export class AppNewChannelTab extends WidgetTab {}
export class AppChatFoldersTab extends WidgetTab {}
export class AppEditFolderTab extends WidgetTab {}
export class AppMyStoriesTab extends WidgetTab {}
export class AppPrivateSearchTab extends WidgetTab {}

export function getEditProfileInitArgs() { return {}; }
