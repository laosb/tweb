# Embed customer support

The `feedback-widget` branch ships one conversation with the configured DC support
account, rendered by the full client's own chat page. Customers get its message
bubbles, history, replies, editing and media viewer, and can send text, system emoji,
photos, videos and files. There are no chat lists, profiles, account settings, calls,
voice or round messages, message multi-select, contact sharing, emoji buttons or
panels, emoji autocomplete, sticker or GIF pickers (including the media editor),
inline bots, custom emoji or attach-menu apps; links to other chats and profiles
do not navigate. Code blocks show without syntax highlighting, and a poll
shows only its question. Quick reactions remain; their expanded picker is omitted.
Outgoing messages show sending, sent or failed, never read (double checks); message
menus omit read dates and seen-by lists. The history fills the frame without a
chat header, pinned bar, search or floating audio player. Support replies use the native group layout: an avatar beside each group and a
sender name where upstream shows one (not on photo/video/album bubbles);
your messages keep their private-chat appearance. The media viewer omits forwarding
and labels your media “Me”. There are no presence or typing indicators.
Message read acknowledgements otherwise stay unchanged.
The widget follows the system's light or dark appearance.

## Build and configure

Download the latest [widget archive](https://feedback-widget.blahim.com/feedback-widget.tar.gz)
and [SHA256SUMS](https://feedback-widget.blahim.com/SHA256SUMS), or use a dated tweb GitHub release,
verify it with `sha256sum -c SHA256SUMS`, and extract the archive. It contains the
compiled client, the original unconfigured `index.html`, `setup.html` and the
static files they load. The widget itself needs no BlahDiem: it reads its pins from
`index.html` and never contacts the CDN. No build is needed to configure a release:

1. Open the [hosted setup page](https://feedback-widget.blahim.com/setup.html) to
   configure the latest release. For a dated release, serve the archive's
   `setup.html` and its files on an HTTPS origin allowed by the BlahDiem CDN.
   Only setup needs that allowance. HTTP on localhost also requires CDN allowance;
   `file://` is not supported. Alternatively, set the documented meta tags below by hand.
2. Enter the DC's profile domain and select **Verify DC**. BlahDiem verifies its
   signed public profile, including the domain and validity, before setup selects
   its TLS WebSocket endpoint and RSA public key. The profile publisher must allow
   cross-origin reads. Setup shows the verified identity and exact endpoint.
3. Enter your application ID and hash from the DC's application settings. They are
   not part of the public DC profile. Do not enter customer tokens in setup.
4. Set CSS variables while checking the sample preview, in light and dark mode.
   Blank values keep the client's defaults; the preview sends no messages and
   needs no account.
5. Select **Download index.html** and replace the extracted entry with that file.
   Keep the release's other files beside it, then serve the widget on any suitable
   HTTPS origin; no BlahDiem CDN allowance is needed.
   Repeat setup when deployment pins change; the running widget does not refresh them.

Setup uses the same pinned CDN release and `BLAH_DIEM_CDN_HOST` build override as
the [Blah client](blah.md#update-and-verify-the-wasm-adapter). The default CDN allows
HTTPS `*.blahim.com` origins. A custom CDN must allow the setup origin for both its
JavaScript and WASM. For GitHub builds, set the `BLAH_DIEM_CDN_HOST`
repository variable to use your own CDN hostname.

To build from source:

```sh
pnpm install --frozen-lockfile
pnpm build:widget
```

Serve **only `dist/widget/`** over HTTPS. `pnpm start:widget` runs the widget locally;
`pnpm serve:widget` builds and previews it. The existing `pnpm start` / `pnpm build`
commands continue to build the ordinary client; the full-client Docker and Cloudflare
packaging are not widget packaging.

Setup writes these public deployment tags. They can also be set manually in
`widget/index.html` before building, or in `dist/widget/index.html` afterwards:

```html
<meta name="blah-widget-dc-id" content="1">
<meta name="blah-widget-dc-url" content="wss://dc.example.org/apiws">
<meta name="blah-widget-rsa-modulus" content="YOUR_512_HEX_DIGIT_RSA_MODULUS">
<meta name="blah-widget-rsa-exponent" content="010001">
<meta name="blah-widget-api-id" content="YOUR_APP_ID">
<meta name="blah-widget-api-hash" content="YOUR_32_HEX_DIGIT_APP_HASH">
```

Use the DC's 2048-bit RSA **public** key, encoded as hexadecimal modulus/exponent.
The exact WebSocket path and query are retained. The page hands the validated pins to
the client's workers. Missing or invalid tags fail closed; the running widget has no
Telegram endpoint/key, discovery or numeric DC migration. HTTP uses the same pinned
host and port over HTTPS at `/apiw1`, without the WebSocket path or query. The TLS
proxy must forward those POSTs to the DC's MTProto listener with its configured
real-IP header. Transport selection follows `.env`; `?http=1` selects HTTP only.
Query parameters such as `test=1` and `debug=1` cannot move the widget off its pinned
DC or enable credential logging.
Configure the support account in the DC's admin UI.

The DC must include the managed-account support exception: ordinary customer tokens
may initiate a conversation with that DC's configured support contact. Blocks and
contact privacy still apply. Actual bots are not customer accounts and are refused
by this widget.

Configure S3-compatible object storage on the DC before accepting attachments.
Text messaging alone does not verify that storage is available: a DC without it
rejects media finalization with `FILE_STORAGE_UNAVAILABLE`.

## Embed and authenticate

Provision one managed account per customer on your backend. Give the browser its
**ordinary token**, and keep its super token on your backend. The token is presented
to `auth.importBotAuthorization`; no other login method exists.

```html
<iframe id="support" name="customer-feedback" title="Customer support"
  style="width: 390px; height: 640px; border: 0"
  referrerpolicy="no-referrer"></iframe>
<script>
  // Obtain customerToken from your application's authenticated backend.
  document.getElementById('support').src =
    'https://support.example.org/#token=' + encodeURIComponent(customerToken);
</script>
```

Use a dedicated widget origin and configure its response headers to permit your
application's origin in CSP `frame-ancestors`. Do not send `X-Frame-Options: DENY`
or `SAMEORIGIN` on a cross-origin widget. If using an iframe sandbox, allow scripts,
same-origin storage and downloads. No camera, microphone or popup permission is needed.
The page needs a secure context and working IndexedDB storage.

Every load requires the hash token and revalidates it, even for a restored session.
A token for a different account logs the previous one out before the replacement
signs in; removing the token logs out. Changes to the fragment in a running frame
reload it and follow the same path. A revoked or invalid token shows an error with no
login form, and the chat stays hidden.

The widget is the ordinary client with its storage: the session and message cache
live in the widget origin's IndexedDB and storage, with its workers. Reloading
restores them before revalidating the token.
On Safari the widget uses a dedicated worker: WebKit cannot read attachment Blobs
passed from a cross-origin iframe to a shared worker. The token
itself is not stored. One origin holds one customer at a time, so sibling widgets
for different customers need different origins.

## Language

The embedding page chooses the language with `?lang=zh-hans` before the token fragment,
for example `index.html?lang=zh-hans#token=...`. Codes are lowercased and underscores
become hyphens. The widget requests the `webk_bfb` pack from its DC's configured
[language-pack repository](https://docs.blahim.com/guides/language-packs/).
Missing strings fall back to bundled English. A cached pack matching `lang` and the
current bundled strings applies before rendering and catches up with server differences
within five seconds; otherwise the widget starts in English and, when `lang` is valid,
tries a full fetch within the same deadline.

## Theme with CSS variables

Put overrides in the **widget document**, for example a stylesheet linked from its
head. CSS variables on the parent page do not cross an iframe boundary. A
same-origin host may set them on `iframe.contentDocument.documentElement.style`.
Scope dark-mode values with `:root.night`, the class the client sets in dark mode:

```css
:root {
  --widget-bubble-radius: 12px;
}
:root:not(.night) {
  --widget-chat-background-color: #f6f2ec;
  --widget-outgoing-bubble-color: #235347;
  --widget-outgoing-text-color: white;
  --widget-accent-color: #235347;
}
:root.night {
  --widget-outgoing-bubble-color: #2f6b5c;
}
```

Every variable is optional. Unset values keep the client's current light/dark look.
Colors accept CSS colors; corners accept CSS lengths (including `calc()` and `%`).
Set scheme-specific values under `:root:not(.night)` and `:root.night`; setup emits
corners and image size once for both schemes. Overrides update without reloading.

| Variable (`--widget-` prefix) | Covers | Setup scope |
| --- | --- | --- |
| `surface-color` | Composer, surfaces and translucent menus | Per scheme |
| `text-color` | Composer and interface text | Per scheme |
| `chat-background-color` | Chat backdrop; derived service/date tint | Per scheme |
| `chat-background-image` | Optional backdrop image | Per scheme |
| `chat-background-size` | Backdrop sizing (default `cover`) | Shared |
| `accent-color` | Links, active icons/buttons, controls, focus, progress, selection and reply-jump tint, including overlays | Per scheme |
| `incoming-bubble-color`, `incoming-text-color` | Support bubble fill and text | Per scheme |
| `outgoing-bubble-color`, `outgoing-text-color` | Customer bubble fill and text | Per scheme |
| `outgoing-accent-color` | Customer links, reply accents, files, time/status and selection | Per scheme |
| `danger-color` | Failed status, errors and destructive actions | Per scheme |
| `support-sender-color` | Sender names, initials avatars and peer-colored replies/quotes | Per scheme |
| `bubble-radius` | Shared bubble corners; tails, grouped inner corners and bubble media follow | Shared |
| `incoming-bubble-radius`, `outgoing-bubble-radius` | Override shared bubble corners by direction | Shared |
| `composer-radius` | Input bar and send button | Shared |
| `popup-radius` | Dialogs and editor panels | Shared |
| `menu-radius` | Menus, tooltips, toasts, autocomplete and viewer controls | Shared |
| `button-radius` | Buttons, fields, checkboxes and small control corners | Shared |
| `media-radius` | Thumbnails, file icons, replies/quotes and media previews | Shared |
| `avatar-radius` | Avatars | Shared |
| `pill-radius` | Date/service pills, go-down/unread badges, reactions, tracks and scrollbar thumbs | Shared |
| `inset-top`, `inset-right`, `inset-bottom`, `inset-left` | Host UI clearance (see below) | Shared |

The chat has no wallpaper unless an image is supplied. Service/date colors remain
derived from the chat background. Intrinsic circles (radio dots, spinner rings,
round icon/playback buttons and slider knobs) stay round; send, go-down and avatars
have explicit overrides. Content colors in photos, system emoji and the media
editor's paint palette are unchanged. Maintain readable contrast in both schemes.
Setup keeps the additional controls under **More colors and corners**.

Text uses fonts installed on the customer's system: Roboto where present, otherwise
the system interface font. The release ships no webfonts. To use your own, declare it
in the widget document and set the client's font variables, doubling `:root` so the
override wins over the client's stylesheet:

```css
@font-face {
  font-family: "Brand Sans";
  src: url("/fonts/brand-sans.woff2") format("woff2");
}
:root:root {
  --font-regular: "Brand Sans", system-ui, sans-serif;
  --font-monospace: ui-monospace, monospace;
}
```

### UI insets

Hosts can set `--widget-inset-top`, `--widget-inset-right`,
`--widget-inset-bottom` and `--widget-inset-left` on the widget document's `:root`.
These are physical sides, including in RTL, and accept CSS lengths. Each defaults
to `env(safe-area-inset-<side>, 0px)`; unset in an iframe, they are zero.
Chat controls, history at rest, viewer controls and status content clear them;
backgrounds, media and the scroller stay edge to edge, with the scroll fades
extended across the insets. Changes take effect without reloading.

A native host that handles safe areas itself can supply its own values, for example
from a WKWebView (values below are CSS pixels):

```swift
webView.evaluateJavaScript("""
  for (const [side, px] of Object.entries({top: 44, right: 0, bottom: 34, left: 0})) {
    document.documentElement.style.setProperty('--widget-inset-' + side, px + 'px');
  }
""")
```

The host should drop the bottom inset itself when its keyboard covers that area,
and restore it when the keyboard closes. Set all four to `0px` if the native view
already excludes every safe area.

## Maintain and verify

The widget mode lives in [`src/widget/`](../src/widget/). `vite build --mode widget`
(through [`vite.widget.config.ts`](../vite.widget.config.ts)) reads the pins from the
document instead of build-time configuration, renders emoji and text with system fonts
so the release carries no emoji images or webfonts, replaces wallpapers with a plain
background color, and pins the URL modes. To keep the
release small, the config also leaves out what a customer cannot use there: the
client's screens outside the chat; stories, calls, mini apps, payments, Stars, Premium,
boosts and the AI editor, whose entry modules build as no-ops; public files for hidden
features, app icons and manifests; emoji panels, autocomplete and the media editor
sticker tab; and the modules it replaces with
[`src/widget/omitted/`](../src/widget/omitted/). The build fails if one of those modules
is renamed upstream or an omitted screen becomes an eager import. To keep the file count
low, the client builds as one script and stylesheet, the media editor as one more loaded
when a customer edits a photo, and each worker as a single file. The client's startup hands
over to [`src/widget/index.ts`](../src/widget/index.ts) in place of the auth flow; it
signs in with the token and opens the support chat.
[`src/widget/restrictions.ts`](../src/widget/restrictions.ts) narrows the client by
wrapping a few upstream entry points rather than editing them, and fails at startup if
one is renamed. `chatRestrictions.ts` detaches the empty topbar after chat construction
and removes sender links' navigation and focus attributes, including on peer-title
updates; native group rendering decides where sender names appear. The media viewer's
self-author text is the widget-owned “Me”. These restrictions also disable message multi-select through the
selection controller and remove its menu items, covering pointer, touch, keyboard
and report-selection entry points while keeping hover reactions.

[`widget-release.yml`](../.github/workflows/widget-release.yml) builds and verifies
pushes and pull requests targeting `feedback-widget`. Successful branch pushes and
manual runs on that branch publish the compiled archive on GitHub Releases. Tags
use `<YYYYMMDD>-<sha4>` with the UTC commit date and first four hexadecimal SHA
characters, so retries use the same tag. Pull requests do not publish. A tag already
pointing at a different commit fails rather than replacing that release.

After publishing, the workflow downloads that exact release, checks its checksum,
and deploys it as the `feedback-widget` Cloudflare Worker using
[`wrangler.widget.jsonc`](../wrangler.widget.jsonc). It publishes `setup.html`, the
original `index.html`, matching assets, `feedback-widget.tar.gz` and `SHA256SUMS` at
`feedback-widget.blahim.com`; `/` redirects to `/setup.html`. The archive is not
rebuilt for hosting. Re-running an older release skips deployment when a newer
GitHub release exists. A failed deployment can be retried without repeating the build.

Set these GitHub Actions repository secrets before the first deployment:

- `CLOUDFLARE_API_TOKEN`: a token with the **Edit Cloudflare Workers** permissions,
  scoped to the target account and its `blahim.com` zone, including domain/route management.
- `CLOUDFLARE_ACCOUNT_ID`: the account that owns the Worker and the active `blahim.com` zone.

Wrangler provisions the custom domain and TLS certificate. The default BlahDiem CDN
allows this setup origin; a `BLAH_DIEM_CDN_HOST` override must allow it as well.
Cloudflare credentials are used only by the deployment step and never enter the
widget build or its static assets. The hosting rules keep HTML, the archive and its
checksum uncached, and hashed assets immutable. HTML path normalization stays disabled
so setup can fetch `/index.html` without following a redirect. `/index.html` also allows
any origin to read it, so a provisioning page hosted elsewhere, such as the Blah server's
feedback DC setup page, can configure the same release.

Keep future rebase conflicts small: widget behavior belongs in `src/widget/`, its
build config and tests. Shared files carry the widget's configuration hooks
(`src/config/blah.ts`, `src/config/app.ts`, the worker URL helper, the DC URL and the
start-up hand-over), plus `*:widget` package scripts and the README pointer. After
rebasing, adapt the wrapped entry points in `restrictions.ts` and
`selectionRestrictions.ts` and run the checks below.

```sh
pnpm test:widget
pnpm run typecheck
pnpm lint
pnpm exec vite build --config vite.widget.config.ts
node scripts/test-widget-setup.mjs
BLAH_SERVER_REPO=/path/to/Teleblah node scripts/test-widget.mjs
```

The setup fixture needs Playwright Chromium and network access to the real CDN;
it serves local build files under a test `blahim.com` origin. It verifies signed
profile discovery and rejection, CSS preview, generated downloads, subdirectory
asset loading, keyboard navigation, narrow layout and Axe. It requires no live DC
or account. The workflow runs it before packaging the unchanged build output.

The last command needs a built debug DC, OpenSSL and Playwright Chromium with its
OS dependencies. Run the same checks in WebKit with `WIDGET_BROWSER=webkit`;
`BLAH_BROWSER_EXECUTABLE` optionally selects a browser executable or wrapper.
The harness seeds disposable managed accounts, runs the production widget
inside a cross-origin iframe and uses real encrypted WebSockets. It checks customer-first
messaging, attachment-menu opening on click, photo-first contact, video/file uploads and byte-for-byte downloads,
a support reply, read outgoing text/media/albums retaining single checks before and after
reload, no chat header or reserved space in LTR/RTL, group-style support senders,
private media-viewer controls and authors, no read-date menu items,
the single-chat and no-multi-select restrictions, account
replacement/logout across page loads and fragment changes, revoked/missing/invalid
tokens, CSS customization in light and dark mode, narrow layout and Axe, and that no
request leaves the widget origin. Its second-client driver is built only into a
temporary directory. Inset checks cover live changes and removal, resting history
and bottom anchoring, LTR/RTL, full-frame backgrounds/scrollers, composer and
viewer geometry, send-media popups and light/dark screenshots. Its local S3 fixture
holds disposable media bytes; upload
authorization, finalization and downloads run through the real DC. Set
`TMPDIR` and `WIDGET_TEST_ARTIFACTS` to keep temporary files and failure logs in a
chosen run directory; `WIDGET_SKIP_BUILD=1` tests an already built widget.
Theme checks set distinct light/dark sentinels, sweep visible colors and corners
(including pseudo-elements) in chat, menus, send-media and the viewer, and verify
that removing overrides restores defaults. Failures name the element and property;
`theme-coverage.json` and default/sentinel screenshots accompany the run. Setup
checks keyboard disclosure/validation, all exported fields and the sample styles.
The widget-only CSS build maps fixed corners with upstream defaults as fallbacks;
keep `scripts/widget-theme-css.ts` and the documented circle exceptions aligned
when adding a new surface.
Add `WIDGET_DIST=/path/to/extracted/archive`
to test the hosted release itself. Both browsers exercise the popup Send button
inside a cross-origin iframe, including a captionless first photo, and capture
page errors, promise rejections and media errors. WebKit uses an existing H.264 MP4
fixture; Chromium generates VP9 WebM, since the test browsers differ in codec support.
The client's opt-in `?a11y=1` keyboard layer currently leaves the
composer without a usable editor, so the fixture runs without it. Screen-reader and
physical touch testing remain manual.

Startup is bounded to 45 seconds, including opening the support conversation. If the DC
cannot be reached or startup fails, the widget shows an error and **Reconnect**, which
reloads the page. A timeout keeps the token and session intact; it does not sign out.

Each build carries its full Git commit in the `blah-widget-revision` meta tag and
`build.json` (`revision`, `version`, `builtAt` in UTC); local uncommitted changes add
`-dirty`. Startup logs `Blah widget <revision>` once. Setup displays the revision and
preserves it in the downloaded index. Keep this meta when configuring deployment.
The release includes `build.json` both beside and inside the archive, with its checksum
in `SHA256SUMS`.
