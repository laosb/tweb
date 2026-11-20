// Assert whole feature graphs, including new eager imports after an upstream rename.
const OMITTED_GRAPHS = [
  /^src\/(?:components|lib)\/widgetSandbox\//,
  /^src\/components\/chat\/bubbleParts\/widgetEdit\./,
  /^src\/lib\/appManagers\/appWidgetsManager\./,
  /^src\/components\/star3D\//,
  /^src\/vendor\/(?:widget-sandbox(?:-quickjs)?|telegram-3d-star)\//,
  /(?:^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:quickjs-emscripten(?:-core)?|@telegram\/widget-sandbox-quickjs)(?:\/|$)/,
  /^src\/components\/wallet\//,
  /^src\/lib\/wallet\//,
  /^src\/lib\/appManagers\/appWalletManager\./,
  /(?:^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:@(?:ton\/wallet-engine|tonconnect\/[^/]+)|tweetnacl(?:-util)?|idb)(?:\/|$)/,
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
  const unexpected = paths.filter(path => /apple-touch-icon(?:-precomposed)?\.png|(?:^|[/_.-])(?:wallet|tonconnect|ton-connect|onramp)(?:[/_.-]|$)|assets\/img\/qr\/|rnnoise|noiseSuppression|quickjs|widget-sandbox|telegram-3d-star|emscripten-module|star(?:[-.][^/]*)?\.mesh|flecks|(?:^|\/)weights(?:[.-]|$)|EmptyChats\.svg|chat-thread-separator-dash/i.test(path));
  if(unexpected.length) throw new Error('widget omitted assets are emitted: ' + unexpected.join(', '));
}

// The orphan is safe to leave out only while no release entry/manifest names it.
export function assertWidgetCleanupReferences(source: string) {
  if(/apple-touch-icon\.png/.test(source)) throw new Error('widget references omitted apple-touch-icon.png');
}

// Graph checks catch packages before minification; this also catches Wallet
// branches/labels/schema added to otherwise retained chat and protocol modules.
export function assertWidgetWalletOutput(source: string) {
  if(/wallet[.]|tonconnect|ton_connect|ton_transfer|toncenter[.]|WalletTransaction|WalletState|messageActionGramTransfer|gram_filled|gram_refund|dialog-subtitle-badge-gram|onramp/i.test(source)) {
    throw new Error('widget Wallet code is emitted');
  }
}

/** Reject bot HTML execution, storage and wire surfaces in every emitted page and worker. */
export function assertWidgetUpstreamOutput(source: string) {
  const match = /quickjs|widget-sandbox|telegram-3d-star|appWidgetsManager|widgets__encrypted|messageMediaWidget|botInlineMessageWidget|Widget\.NetworkMarker|watchFirstScreenSight|setChatAvailableReactions|reactionsSaves|shareTheme|noPaidMessagesToken/i.exec(source);
  if(match) {
    throw new Error('widget unreachable upstream feature is emitted: ' + match[0]);
  }
}
