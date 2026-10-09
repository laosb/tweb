# Embed customer support

The `feedback-widget` branch ships one conversation with the configured DC support
account, rendered by the full client's own chat page. Customers get its message
bubbles, history, replies, editing and media viewer, and can send text, system emoji,
photos, videos and files. There are no chat lists, profiles, account settings, calls,
voice or round messages, contact sharing, sticker or GIF pickers, inline bots, custom
emoji or attach-menu apps; links to other chats and profiles do not navigate. Code
blocks show without syntax highlighting, and a poll shows only its question.
The widget follows the system's light or dark appearance.

## Build and configure

Download the latest [widget archive](https://feedback-widget.blahim.com/feedback-widget.tar.gz)
and [SHA256SUMS](https://feedback-widget.blahim.com/SHA256SUMS), or use a dated tweb GitHub release,
verify it with `sha256sum -c SHA256SUMS`, and extract the archive. It contains the
compiled client, the original unconfigured `index.html`, `setup.html` and the
static files they load. The [hosted setup page](https://feedback-widget.blahim.com/setup.html) configures
the latest archive; use the setup page inside a dated archive for that version.
No build is needed to configure a release:

1. Serve the extracted folder on an HTTPS origin allowed by the BlahDiem CDN and
   open `setup.html`. Use HTTP on localhost only with a CDN that allows that origin;
   opening the files directly with `file://` is not supported.
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
   Keep the release's other files beside it, then serve the widget over HTTPS.
   Repeat setup when deployment pins change; the running widget does not refresh them.

Setup uses the same pinned CDN release and `BLAH_DIEM_CDN_HOST` build override as
the [Blah client](blah.md#update-and-verify-the-wasm-adapter). The default CDN allows
HTTPS `*.blahim.com` origins. A custom CDN must allow the setup origin for both its
JavaScript and WASM. Only setup loads the runtime: the running widget takes its
DC and application pins from its `index.html` and never contacts the CDN, so it can be
hosted on any suitable HTTPS origin. For GitHub builds, set the `BLAH_DIEM_CDN_HOST`
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
Telegram endpoint/key, discovery, HTTP fallback or numeric DC migration. Query
parameters such as `test=1` and `debug=1` cannot change the widget's transport or
enable credential logging. Configure the support account in the DC's admin UI.

The DC must include the managed-account support exception: ordinary customer tokens
may initiate a conversation with that DC's configured support contact. Blocks and
contact privacy still apply. Actual bots are not customer accounts and are refused
by this widget.

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
live in the widget origin's IndexedDB and storage, with its shared and service
workers, and reloading restores them before revalidating the token. The token
itself is not stored. One origin holds one customer at a time, so sibling widgets
for different customers need different origins.

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

The other variables are `--widget-surface-color` and `--widget-text-color` for the
header and composer, `--widget-chat-background-image` and `-size`, the incoming
bubble and text colors, and `--widget-incoming-bubble-radius` and
`--widget-outgoing-bubble-radius` to override the shared radius. Unset variables keep
the client's light or dark theme. The chat has no wallpaper: it sits on
`--widget-chat-background-color`, or the theme's plain background color when unset, with
the optional image drawn over it (`cover` unless a size is set). Service-message pills
take their tint from that color. Maintain readable contrast for each pair in both modes.

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

## Maintain and verify

The widget mode lives in [`src/widget/`](../src/widget/). `vite build --mode widget`
(through [`vite.widget.config.ts`](../vite.widget.config.ts)) reads the pins from the
document instead of build-time configuration, renders emoji and text with system fonts
so the release carries no emoji images or webfonts, replaces wallpapers with a plain
background color, and pins the URL modes. To keep the
release small, the config also leaves out what a customer cannot use there: the
client's screens outside the chat; stories, calls, mini apps, payments, Stars, Premium,
boosts and the AI editor, whose entry modules build as no-ops; public files for hidden
features; and the modules it replaces with [`src/widget/omitted/`](../src/widget/omitted/).
The build fails if one of those modules is renamed upstream or an omitted screen
becomes an eager import. The client's startup hands
over to [`src/widget/index.ts`](../src/widget/index.ts) in place of the auth flow; it
signs in with the token and opens the support chat.
[`src/widget/restrictions.ts`](../src/widget/restrictions.ts) narrows the client by
wrapping a few upstream entry points rather than editing them, and fails at startup if
one is renamed.

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
build config and tests. Upstream files carry only the widget's configuration hooks
(`src/config/blah.ts`, `src/config/app.ts`, the worker URL helper, the DC URL and the
start-up hand-over) plus `*:widget` package scripts and the README pointer. After
rebasing, adapt the wrapped entry points in `restrictions.ts` and run the checks below.

```sh
pnpm test:widget
pnpm run typecheck
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
OS dependencies. It seeds disposable managed accounts, runs the production widget
inside a cross-origin iframe and uses real encrypted WebSockets. It checks customer-first
messaging, a support reply, reload, the single-chat restrictions, account
replacement/logout across page loads and fragment changes, revoked/missing/invalid
tokens, CSS customization in light and dark mode, narrow layout and Axe, and that no
request leaves the widget origin. Its second-client driver is built only into a
temporary directory. The client's opt-in `?a11y=1` keyboard layer currently leaves the
composer without a usable editor, so the fixture runs without it. Screen-reader and
physical touch testing remain manual.
