# Widget icon review

`iconNames.json` is the conservative release allowlist, not a trace of the icons
seen in one browser session. Re-review additions with the emitted-literal guard
and the full harness. The original `src/icons.ts` map and font are unchanged.

The static review includes literals in the client, shared chunk and lazy media
editor, compound `ButtonIcon` strings, CSS content glyphs and RTL mirror tables.
Some names are retained for entire related families, including hidden branches
of shared constructors. The following runtime selections were checked at their
construction sites rather than guessed from names observed on screen:

- `chat/input.ts`: `ChatInputHelperType` maps edit/webpage/forward/reply/suggested
  to edit/link/forward/reply/suggested; send-button state tables and paid-star
  badge construction. `sendingStatusIcon.ts` keeps all pending/sent/read/error
  fallback glyphs, including the error state normally drawn with an SVG mask.
- `autoDeleteIcon.ts`: every duration digit (1–8), clock, empty circle and
  hours/days/weeks/months/years overlay. Unknown durations use the clock.
- `mediaViewer/base.ts`: callers supply literal top-button arrays; rotate maps
  to rotate_left, zoom switches zoomin/zoomout; previous/next and all viewer
  download/copy/delete/edit/menu controls remain.
- `lib/mediaPlayer/{index.ts,playbackRateButton.tsx}`, `playbackRateButton.ts`,
  `volumeSelector.ts`: play/pause/fullscreen/smallscreen/PiP, every volume level,
  every rate icon and the geometric digits 0–9, dot and x (rates up to 5).
- `mediaEditor/`: adjustment-tab records, crop tools, brush types, text alignment
  and all three fontframe styles, undo/redo/close/rotate/resize/alignment layer
  actions. Aspect-ratio previews are inline SVG, not font glyphs. Resizable
  layers' keyboard controls retain every physical arrow and size/rotation tool.
- `chat/markupTooltip.ts`, `richMessageInput/toolbar.ts` and `inputEditor/`:
  inactive/active format tables, heading levels 1–6, table row/column insertions,
  horizontal/vertical merges, media replacement, album/carousel, file and rich
  button controls. Monospace/subscript/superscript labels are ordinary text.
- `wrappers/{document.ts,messagePreviewIcon.ts,richMessagePreview.ts}` and
  `avatarNew.tsx`: received media/service/reply preview classifications, generic
  files/music/contact/card fallbacks and avatar fallbacks. File extensions are
  text inside a CSS document shape, never arbitrary font names derived from a
  received filename. Keep download/cancel/play/status glyphs as well.
- `popups/reactedList.tsx`, `reactionContextMenu.ts`, `buttonTypes.ts`, menus,
  checkbox controls and `helpers/dom/iconButtonLabel.ts`: option/table/prop
  selections come from literal caller records. The accessibility layer labels
  these controls; it does not invent glyph names. Direction changes a mirror
  class, never the font's codepoint.

The build scans emitted JavaScript literals and template fragments and emitted
CSS glyphs. Runtime inputs do not provide arbitrary `Icon` names. A new computed
family needs an explicit review here and in the allowlist; the browser harness
compares every retained glyph and every observed icon with the original font.
