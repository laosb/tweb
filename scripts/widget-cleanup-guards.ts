// Assert whole feature graphs, including new eager imports after an upstream rename.
const OMITTED_GRAPHS = [
  /^src\/components\/(appSelectPeers|selectorSearch|searchGroup|topPeersList|foldersTabs|folderTitleTsx|dialogsPinnedReorder)\./,
  /^src\/components\/folderTags\//,
  /^src\/stores\/(folders|folderTags)\./,
  /^src\/components\/popups\/(pickUser|stickers|joinChatInvite|sharedFolderInvite|createContact|addBotToChat|requestPeer|shareUrl|channelsTooMuch)\./,
  /^src\/components\/popups\/createBot\//,
  /^src\/components\/(addChatUsers|shareContact|editPeer|avatarEdit)\./,
  /^src\/components\/chat\/(mentionsHelper|autocompletePeerHelper)\./,
  /^src\/helpers\/dom\/createStickersContextMenu\./,
  /^src\/lib\/appDialogsManager\./,
  // Shared with scheduling and ordinary TTL icons despite their settings paths.
  /^src\/components\/sidebarLeft\/(?!tabs\/passcodeLock\/inlineSelect(?:\.module)?\.|tabs\/autoDeleteMessages\/options\.)/,
  /^src\/components\/sidebarRight\//,
  /^src\/components\/(appSearchSuper\w*|sharedMedia\w*|searchWebPageRow)\./,
  /^src\/components\/stargifts\/profile(?:List|Store)\./,
  /^src\/components\/solidJsTabs\/(tabs|index|providedTabs|superTabProvider|scaffoldSolidJSTab)\./,
  /^src\/components\/autonomousDialogList\/(?!constants\.)/,
  /^src\/components\/(archiveDialog(?:ContextMenu)?|dialogs(?:ContextMenu|Selection(?:Base|Header)?)|sortedDialogList|forumTopicsSelection)\./,
  /^src\/components\/forumTab\//,
  /^src\/components\/stories\//,
  /^src\/components\/(peerProfile(?:Avatars)?|businessHours|chatThemesPicker|passwordInputField|monkeys\/password)\./,
  /^src\/components\/passcodeLock\//,
  /^src\/lib\/appManagers\/utils\/useLockScreenShortcut\./,
  /^src\/helpers\/qrCode\//,
  /^src\/components\/popups\/(myQrCode|emailSetup|passkey|starsRating|starReaction|makePaid|giftPremium|deleteMegagroupMessages(?:Actions|Shared)?|deleteDialog|mute|editMemberTag|memberTagInfo)\./,
  /^src\/components\/chat\/(sendAs|bubbles\/unknownUser|bubbleParts\/(dice|paidServiceMessage|(?:update)?ChatThreadSeparators?|chatThreadSeparator))\./,
  /^src\/components\/wrappers\/webPage\./,
  /^src\/components\/stars\/starsAmount\./,
  /^src\/components\/premium\/premiumOptionsForm\./,
  /^src\/config\/currencies\./,
  /^src\/components\/chat\/recording\//,
  /^src\/components\/chat\/voiceRecording\//,
  /^src\/helpers\/(voiceRecorder|videoRecorder)\//,
  /^src\/helpers\/voiceWaveformAnalyser\./,
  /^src\/lib\/calls\/helpers\/(getStream|acquireStream)\./,
  /^src\/components\/chat\/(topbar(?:Plates|Plate|Sponsored|GroupCall|Live)?|actions|requests|chatAutomation|similarChannels|translation)\./,
  /^src\/components\/chat\/(topbarGroupCall|topbarLive)\//,
  /^src\/components\/chat\/(pinnedMessage|selection|selectionRange|paidMessagesInterceptor|pendingUndoableMessage|undoablePaidTooltip|removeFee|commandsHelper|botCommands|processPeerFullForCommands)\./,
  /^src\/components\/chat\/priceChangedInterceptor\//,
  /^src\/components\/(rtmp\/adminPopup|openBoosts)\./,
  /^src\/components\/chatTips\//,
  /^src\/pages\/(AuthCardsHost|authFlow|mountAuthFlow)\./,
  /^src\/components\/(quizHint|popups\/toggleReadDate)\./,
  /^src\/lib\/debug\//,
  /^src\/lib\/calls\/noiseSuppression\//,
  /^src\/vendor\/rnnoise\//
];

export function assertWidgetCleanupModules(paths: string[], replaced: string[]) {
  const allowed = new Set(replaced);
  const unexpected = paths.filter(path => !allowed.has(path) && OMITTED_GRAPHS.some(pattern => pattern.test(path)));
  if(unexpected.length) throw new Error('widget omitted feature code is reachable: ' + unexpected.join(', '));
}

export function assertWidgetCleanupAssets(paths: string[]) {
  const unexpected = paths.filter(path => /rnnoise|noiseSuppression|(?:^|\/)weights(?:[.-]|$)|EmptyChats\.svg|chat-thread-separator-dash/i.test(path));
  if(unexpected.length) throw new Error('widget omitted assets are emitted: ' + unexpected.join(', '));
}
