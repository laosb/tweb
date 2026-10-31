# Embed customer support

The `feedback-widget` branch ships one conversation with the configured DC support
account. Customers can browse history, reply, quote, edit and send text, system
emoji, photos, videos and files. There are no calls, voice or round messages,
contact sharing, message multi-select, pinning, forwarding or search. Emoji
buttons, panels and autocomplete, sticker/GIF pickers (including in the media
editor), inline bots, custom emoji sending and attach-menu apps are unavailable.
Quick reactions and the full reaction-participant list remain, without an expanded
reaction picker.

Received photos, documents (including audio and stickers), checklists, rich messages
and service text remain. Stickers and custom emoji render and play, with Copy but
no pack popups, attribution or pack menu items. Code blocks have no syntax
highlighting; polls show only their question. Gifts, giveaways, games, call history,
stories, invoices, contact/location cards and web-page previews show an
unsupported-message fallback. Pin service messages and their date separators are
hidden; forwarded messages keep their attribution. Outgoing messages show sending,
sent or failed, never read (double checks), and menus omit read dates and seen-by
lists. Message read acknowledgements otherwise stay unchanged.

Replies, quotes and message jumps stay in the support chat. Typed and received
mentions render, but there are no recipient/share pickers or global mention
suggestions. Links allow external HTTP(S) URLs with confirmation, tel/mailto and
rich maps. Other internal, `tg://` and Telegram-host links do nothing before any
lookup or request. Chat lists, profiles, shared-media browsing and account settings
are unavailable.

History fills the frame without a chat header, pinned bar or floating audio player.
Support replies show an avatar beside each group and a sender name where the client
normally shows one (not on photo/video/album bubbles); customer messages keep their
private-chat appearance. The media viewer labels customer media “Me”. There are no
presence or typing indicators, bot-command suggestions, onboarding tips or login
screens. Developer memory and log collection is disabled, including URL switches.
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

Startup is bounded to 45 seconds, including opening the support conversation. If
the DC cannot be reached or startup fails, the widget shows an error and
**Reconnect**, which reloads the page. A timeout keeps the token and session intact;
it does not sign out.

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
Missing or malformed strings fall back to the widget’s bundled English, including
plural forms. A cached pack matching `lang` and the current bundled strings applies
before rendering and catches up with server differences within five seconds;
otherwise the widget starts in English and, when `lang` is valid, tries a full fetch
within the same deadline.

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

The [build config](../vite.widget.config.ts) reuses the client's chat markup and
replaces omitted features without changing upstream client files. Runtime
restrictions guard navigation and message actions before lookups or requests.
Build guards reject changed replacement targets, eager omitted screens and
unwanted assets. Keep the
[theme CSS mapping](../scripts/widget-theme-css.ts) aligned with new surfaces and
the circle exceptions documented above.

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

### Language keys

[`languageKeys.json`](../src/widget/languageKeys.json) is the reviewed set of literal
labels, computed families, startup strings and mapped errors, with exact
hidden-construction exceptions. The [language build](../scripts/widget-language.ts)
prunes both upstream English dictionaries to this set, rejects missing definitions
and versions caches by retained strings and upstream version. Token startup needs
no `langSign` startup keys.

After a rebase or feature addition, trace actual I18n consumers outside dictionary
definitions and review computed keys where they are constructed. Supplement runtime
traces with source reachability: DC-deliverable media, service/reply previews,
errors and runtime key tables. Check the server's producers, including custom
service messages and external reply targets, rather than every schema type.
Browser tokens such as `Files` and suffix fragments such as `Voice` alone do not
establish a translation consumer.

Update the allowlist, remove unused keys from every `webk_bfb` language and keep
their key sets identical without changing retained translations. English values
and plural forms must match `src/lang.ts` / `src/langSign.ts` before build-time
branding. Remove obsolete
[`languageExceptions.json`](../tests/widget/languageExceptions.json) entries:
each needs a hidden construction that still resolves the key, never a new
translation solely for a hidden label. Excluded content needs no exception unless
such a construction remains; synthetic excluded-message tests must show the generic
fallback.

Run the harness above without a pack, then with a language-pack checkout:

```sh
WIDGET_LANGPACK_DIR=/path/to/blah-langpack/webk_bfb/en \
BLAH_SERVER_REPO=/path/to/Teleblah node scripts/test-widget.mjs
# Recheck a saved trace without starting a browser or DC:
node scripts/test-widget-language.mjs /path/to/blah-langpack/webk_bfb/en \
  /path/to/artifacts/language-resolutions.json
```

With `WIDGET_LANGPACK_DIR`, the harness builds a temporary instrumented widget,
overlays the English pack and records actual I18n resolutions, including computed
keys, plurals, plain text and accessibility labels. The
[coverage guard](../tests/widget/languageCoverage.mjs) requires the English key set
to match the allowlist and rejects unlisted resolved keys except documented hidden
constructions. `language-resolutions.json` distinguishes `pack`, `bundled` and
`missing` across reloads; no recorder ships in the release. Review the saved
accessibility snapshots too: visible labels must come from the pack and may never
use exceptions. Without pack configuration, the harness prints an explicit skip.

The release workflow neither checks out language packs nor provisions a debug DC;
its browser checks cover startup and setup only. Full language coverage remains
local. CI can use the same command with a language-pack checkout and built debug DC;
no published tags or DC pack-configuration changes are needed.

### Browser verification

The [setup fixture](../scripts/test-widget-setup.mjs) needs Playwright Chromium and
network access to the real CDN. It serves local build files under a test
`blahim.com` origin and checks profile verification, configuration/downloads,
preview styling and accessibility without a live DC or account. The workflow runs
it before packaging the unchanged build output.

The [widget harness](../scripts/test-widget.mjs) needs a built debug DC, OpenSSL and
Playwright Chromium with its OS dependencies. Run the same checks in WebKit with
`WIDGET_BROWSER=webkit`; `BLAH_BROWSER_EXECUTABLE` optionally selects an executable
or wrapper. It seeds disposable managed accounts and exercises the production
widget in a cross-origin iframe over real encrypted WebSockets, with a temporary
second-client driver and local S3 fixture for media.

Coverage spans messaging and received content, navigation/action restrictions,
account/token transitions and request boundaries, plus theme, insets, LTR/RTL,
narrow layouts and Axe. The [browser fixtures](../tests/widget/) define the detailed
contracts; language-enabled runs also observe restricted actions at manager,
worker-RPC and transport boundaries. Review light/dark screenshots and
`theme-coverage.json`; theme failures identify the element and property.

Set `TMPDIR` and `WIDGET_TEST_ARTIFACTS` to keep temporary files and failure logs in
a chosen run directory; `WIDGET_SKIP_BUILD=1` tests an already built widget.
Add `WIDGET_DIST=/path/to/extracted/archive` to test the hosted release itself.
Both browsers exercise the popup Send button, including a captionless first photo,
and capture page errors, promise rejections and media errors. WebKit uses an
existing H.264 MP4 fixture; Chromium generates VP9 WebM for its codec support.
The client's opt-in `?a11y=1` keyboard layer currently leaves the composer without
a usable editor, so the fixture runs without it. Screen-reader and physical touch
testing remain manual.

### Release and deploy

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

Each build carries its full Git commit in the `blah-widget-revision` meta tag and
`build.json` (`revision`, `version`, `builtAt` in UTC); local uncommitted changes add
`-dirty`. Startup logs `Blah widget <revision>` once. Setup displays the revision and
preserves it in the downloaded index. Keep this meta when configuring deployment.
The release includes `build.json` both beside and inside the archive, with its checksum
in `SHA256SUMS`.
