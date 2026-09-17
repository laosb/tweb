# Blah build profile

This integration follows [laosb/telegram-tt](https://github.com/laosb/telegram-tt),
without replacing Web K's MTProto implementation or maintaining a second app.
An ordinary `pnpm start` / `pnpm build` still targets Telegram.

## Configure and build

Supply these variables through your shell or CI build environment, **not a
committed file**:

| Variable | Purpose |
| --- | --- |
| `BLAH_API_ID` | Your Blah C3 application's numeric API ID (required) |
| `BLAH_API_HASH` | Its matching API hash (required) |
| `BLAH_SERVER_CONFIG_URL` | C3 topology URL; defaults to `https://center.blahim.com/api/dcs` |
| `BLAH_VAPID_PUBLIC_KEY` | Your application's VAPID public key; optional |

Then run:

```sh
pnpm exec vite build --mode blah
node scripts/prepare-cloudflare-assets.mjs
```

The assembled static site is `.cloudflare/assets/`; do not deploy the old
checked-in `public/index.html`. See [Cloudflare instructions](cloudflare.md)
for local serving, dry-run validation and deployment.

These are **client** credentials: the API ID/hash and public keys necessarily
appear in the browser bundle. Never use a server administrator credential or
Cloudflare API token here. No credentials are included in this fork.

Use a separate origin for Blah, rather than replacing an existing Telegram
installation at the same origin. Web K's account databases and service-worker
storage are origin-scoped, not backend-scoped; sharing them would mix sessions.
The same applies when switching between unrelated Blah installations.

## Behavior and trust

- `.env.blah` enables `VITE_BLAH=1`. The build fetches C3 over HTTPS and embeds
  its validated DC IDs, TLS WebSocket endpoints and 2048-bit RSA public keys.
  Failure to fetch/validate, or missing Blah credentials, fails the build.
  C3 and HTTPS are release-time trust roots; this does not verify a separately
  signed topology document.
- DC IDs **1–255** are supported, including account-key persistence, legacy
  migration and logout/cleanup. Zero is invalid. Ordinary Telegram builds keep
  the original 1–5 range.
- The first C3 entry is the default DC. As in Web A, an unknown but valid DC ID
  uses that endpoint. Each DC uses its first TLS endpoint; reconnects retry
  that endpoint, not alternate addresses. A DC without TLS is rejected, since
  an HTTPS-hosted client cannot use insecure WebSockets.
- WebSocket transport is mandatory. The build disables HTTP, HTTP uploads and
  transport auto-switching, including query-string HTTP overrides. It replaces,
  rather than extends, Telegram's trusted RSA keys. RSA fingerprinting still
  uses Web K's existing TL/SHA-1 implementation.
- Login starts with a Blah number or email address. Digit-only input not
  already starting with `999` receives the `+999` prefix; other input is
  trimmed and passed unchanged. QR login remains available. The existing
  code/password/signup cards are reused, including the server's code length
  and Fragment URL. Email codes use `email_verification`.
- Without a VAPID key, remote push is disabled; local notifications remain
  available. Changing the build key renews an old subscription. The active Blah
  manifests omit Telegram's legacy `gcm_sender_id`.
- The page title, favicon, touch icon and installed-app metadata use Blah
  branding in this profile only. The logo comes from the referenced Web A fork;
  no runtime download or global replacement of Telegram strings is involved.
  Separate `site.blah.webmanifest` and `site_apple.blah.webmanifest` outputs
  leave the upstream manifests intact even with the legacy `build.js` workflow.

Rebuild after topology, RSA-key or VAPID-key changes. This is not a runtime
server selector and it does not proxy traffic through Cloudflare.

### Updating icons

`public/assets/blah/logo.svg` is the source. PNG fallbacks and install icons are
checked in so production builds need no image-rendering dependency. After
changing the SVG, regenerate them with the existing Playwright dependency:

```sh
pnpm exec playwright install chromium --only-shell
node scripts/generate-blah-icons.mjs
```

## Keeping rebases small

Blah-specific policy lives in `scripts/blah-config.mjs`, `src/config/blah.ts`
and the identifier card/helper. Upstream touchpoints are deliberately limited
to build defines, endpoint/key selection, the auth entry/default, shared login
manager methods, push validation, and the DC range used by account storage.
Generated API schemas, protocol/crypto code, upstream branding assets, compiled `public/`
bundles, dependencies and lockfiles are not forked.

The Workers artifact builder reuses `keepAsset.js` instead of duplicating
upstream's static-asset preservation rules. On rebase, check these boundaries
and run:

```sh
pnpm exec vitest run src/tests/blah src/tests/webPushApiManager.test.ts
pnpm run typecheck
```

These isolated tests do not authenticate a real Blah account. Before releasing,
also verify sign-in, DC migration, media transfers and push with a C3-registered
application against the intended deployment.
