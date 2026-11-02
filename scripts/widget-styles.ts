import omittedStyles from '../src/widget/omittedStyles.json';

/** Keep upstream's entry and ordering; only these individually reviewed uses go. */
export function widgetStyles(source: string) {
  const expected = new Set(omittedStyles.map(entry => `@use "${entry}";`));
  const lines = source.split('\n');
  for(const entry of expected) {
    if(lines.filter(line => line === entry).length !== 1) throw new Error('re-review widget SCSS omission: ' + entry);
  }
  return lines.filter(line => !expected.has(line)).join('\n');
}

// These feature roots must not be restored by another entry/import. The widget's
// own hide rules are excluded by the caller. Shared .reply, .popup-peer and
// .tabs-container styles deliberately remain in their upstream partials.
const HIDDEN_CLASS_ROOTS = [
  'token',
  'topbar-chat-info',
  'sidebar-header__subtitle',
  'sidebar-left-overlay',
  'sidebar-resize-handle',
  'group-permissions-container',
  'is-settings-highlighted',
  'search-group',
  'emoticons',
  'emoji-padding',
  'no-border-top',
  'topics-slider',
  'accounts-limit',
  'chat-preview-wrapper',
  'chat-preview-bg',
  'payment-verification',
  'payment-item',
  'call-video-mirror',
  'group-call',
  'autocomplete-peer-helper',
  'stickers-helper',
  'emoji-helper',
  'inline-helper',
  'chat-search',
  'bot-commands',
  'voice-recording',
  'video-recording',
  'profile',
  'settings-search-layer',
  'search-super',
  'emoji-dropdown',
  'selector',
  'gifs-masonry',
  'quiz-hint',
  'reply-keyboard',
  'similar-channels',
  'topbar-search',
  'folders-sidebar',
  'bubble-star-gift-container',
  'conference-encryption',
  'passcode-lock-screen',
  'test-dc-badge',
  'popup-create-contact',
  'popup-stickers',
  'popup-forward',
  'popup-join-chat-invite',
  'popup-call',
  'popup-group-call',
  'popup-sponsored',
  'popup-mute',
  'popup-payment',
  'popup-gift-premium',
  'popup-web-app',
  'popup-chatlist-invite',
  'popup-boost',
  'popup-premium',
  'popup-gift-link',
  'popup-toggle-read-date',
  'popup-report-ad',
  'popup-stars',
  'popup-star-reaction',
  'popup-star-gift',
  'popup-chat-preview'
];
const HIDDEN_ROOTS = new RegExp(
  String.raw`\.(?:${HIDDEN_CLASS_ROOTS.join('|')})(?=[\s.#:[>,+~\]-]|$)|\bpoll-element(?=[\s.#:[>,+~\]]|$)`
);

// Existing hidden fragments inside shared button/chat-bubble partials. Discard
// only these exact selectors; any new feature rule still fails the guard.
const SHARED_HIDDEN_SELECTORS = new Set([
  '.pinned-call .group-call-description',
  '.popup-forward-auto-height .popup-add-members-premium-subtitle',
  '.bubbles.is-selecting .bubble:not(.is-album) poll-element',
  '.bubble poll-element',
  '.bubble.is-out poll-element .poll-answer-selected',
  'html.no-touch .bubble.is-out poll-element .poll-answer:hover .animation-ring',
  '.bubble.is-out poll-element .poll-avatars .stacked-avatars',
  '.bubble.is-out poll-element .progress-ring__circle',
  '.bubble.is-out poll-element .c-ripple__circle',
  '.bubble.is-out poll-element .c-ripple__circle:not(.hiding)',
  '.bubble.is-out.is-sending poll-element'
]);

export function widgetStyleSelector(selector: string) {
  if(SHARED_HIDDEN_SELECTORS.has(selector)) return false;
  assertWidgetStyleSelector(selector);
  return true;
}

export function assertWidgetStyleSelector(selector: string) {
  if(HIDDEN_ROOTS.test(selector)) throw new Error('widget omitted selector reappeared: ' + selector);
}
