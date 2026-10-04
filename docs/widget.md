# Embed customer support

The `feedback-widget` branch ships one conversation with the configured DC support
account. Text, ordinary Unicode emoji, photos and files up to 20 MB are supported.
There are no chat lists, profiles, account settings, calls, contact sharing, sticker
or GIF pickers, inline bots or custom emoji. Pasted content is plain text. Messages
with other media show a placeholder; profile names and mentions do not navigate.

## Build and configure

Download the latest [widget archive](https://feedback-widget.blahim.com/feedback-widget.tar.gz)
and [SHA256SUMS](https://feedback-widget.blahim.com/SHA256SUMS), or use a dated tweb GitHub release,
verify it with `sha256sum -c SHA256SUMS`, and extract the archive. It contains the
compiled widget, the original unconfigured `index.html`, `setup.html` and their
assets. The [hosted setup page](https://feedback-widget.blahim.com/setup.html) configures
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
4. Set CSS variables while checking the sample preview. Blank values use the
   widget defaults; the preview sends no messages and needs no account.
5. Select **Download index.html** and replace the extracted entry with that file.
   Keep the matching `assets/` folder beside it, then serve the widget over HTTPS.
   Repeat setup when deployment pins change; the running widget does not refresh them.

Setup uses the same pinned CDN release and `BLAH_DIEM_CDN_HOST` build override as
the [Blah client](blah.md#update-and-verify-the-wasm-adapter). The default CDN allows
HTTPS `*.blahim.com` origins. A custom CDN must allow the setup origin for both its
JavaScript and WASM. The runtime is loaded only for setup and is not packaged in the
archive; the generated widget can be hosted on any suitable HTTPS origin independently
of setup's CDN access. For GitHub builds, set the `BLAH_DIEM_CDN_HOST` repository
variable to use your own CDN hostname.

To build from source:

```sh
pnpm install --frozen-lockfile
pnpm build:widget
```

Serve **only `dist/widget/`** over HTTPS. `pnpm start:widget` runs the widget locally;
`pnpm serve:widget` builds and previews it. The existing `pnpm start` / `pnpm build`
commands continue to target the full client, which is excluded from the widget artifact.
The existing full-client Docker and Cloudflare packaging are not widget packaging.

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
The exact WebSocket path and query are retained. Missing or invalid tags fail closed;
the running widget has no Telegram endpoint/key, discovery, HTTP fallback or numeric DC migration.
Query parameters such as `test=1` and `debug=1` cannot change the widget's transport
or enable credential logging. Configure the support account in the DC's admin UI.

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
The page needs a secure context and working session storage.

Every load requires the hash token and revalidates it, even when the transport key
is restored. Changing or removing the token clears the visible conversation
immediately and revokes the old authorization before any replacement login.
Changes to the fragment in a running frame follow the same path. Offline revocation
keeps the old key for retry and does not expose the previous account or sign in the
replacement prematurely. Invalid credentials show an error with no login form.

Transport keys and a token digest live in session storage scoped to the widget
path and iframe name; the token is not copied to storage. Give sibling widgets
distinct names. Unnamed frames receive random names which survive same-origin
reloads. The normal client's accounts, IndexedDB, service workers and shared
workers are not used. Message content stays in memory and is discarded on account
changes. Reloading fetches history again; difference replay catches missed updates.

## Theme with CSS variables

Put overrides in the **widget document**, for example a stylesheet linked from its
head. CSS variables on the parent page do not cross an iframe boundary. A
same-origin host may set them on `iframe.contentDocument.documentElement.style`.

```css
:root {
  --widget-chat-background-color: #f6f2ec;
  --widget-chat-background-image: url('/brand/support-background.png');
  --widget-chat-background-size: cover;
  --widget-incoming-bubble-color: white;
  --widget-incoming-text-color: #182230;
  --widget-outgoing-bubble-color: #235347;
  --widget-outgoing-text-color: white;
  --widget-bubble-radius: 12px;
  --widget-accent-color: #235347;
}
```

`--widget-incoming-bubble-radius` and `--widget-outgoing-bubble-radius` optionally
override the shared radius. `--widget-surface-color` and `--widget-text-color`
control the shell. Background images default to `none`; no Telegram wallpaper is
loaded. Maintain readable contrast when changing bubble/text pairs.

## Maintain and verify

The independent entry and domain adapter live in [`src/widget/`](../src/widget/).
They reuse tweb's authorizer, networker, crypto worker, generated TL schema and Solid
runtime. [`vite.widget.config.ts`](../vite.widget.config.ts) reuses the upstream
aliases and supplies widget-only transport/debug adapters. A build assertion
rejects imports of full-client pages, components and manager bootstrap.

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
so setup can fetch `/index.html` without following a redirect.

Keep future rebase conflicts small: widget behavior belongs in these separate files
and adapters. Reuse upstream code through imports; keep shared chat, auth, transport
and component files intact. The only integration edits are the README pointer and
additional `*:widget` package scripts. Existing scripts remain upstream-owned; do
not copy their pipelines into widget-specific client commands. Adapt to upstream
API changes within the widget modules and run the checks below after rebasing.

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
messaging, a support reply, reload, account replacement/logout across page loads and
fragment changes, revoked/missing/invalid tokens, CSS customization, narrow layout,
keyboard focus and Axe. Its second-client
driver is built only into a temporary directory. Unit fixtures cover attachment
restrictions and upload requests; screen-reader and physical touch testing remain
manual.
