# Blah browser identities

The Blah build uses Web K's MTProto transport with browser-held Diem identities.
It creates Ed25519 identity/device keys, encrypts local custody and backups with a
separate identity password, and compiles profile/proof rules from the pinned
BlahDiem Swift package to WASM. Private keys never go to a DC or profile publisher.
An ordinary Telegram build keeps the upstream login flow.

## Configure a home

This first browser integration targets **one independently operated home DC per
web origin**. Obtain its public RSA transport key, Diem identity ID (64 hex
characters), discovery domain and database generation from its operator. A numeric
DC ID does not identify a Blah home; each home is DC1.

Create an operator-controlled bootstrap JSON file:

```json
{
  "home": {
    "domain": "dc.example.org",
    "identity": "<64 lowercase hex characters>",
    "generation": "<positive decimal string>"
  },
  "dcs": [{
    "id": 1,
    "rsaPublicKey": "-----BEGIN RSA PUBLIC KEY-----\n...\n-----END RSA PUBLIC KEY-----",
    "endpoints": [{"ip": "dc.example.org", "port": 443, "wsTlsOnly": true}]
  }]
}
```

Set `BLAH_BOOTSTRAP_FILE` to that file, plus `BLAH_API_ID` and `BLAH_API_HASH`
for the DC application, then run:

```sh
pnpm install --frozen-lockfile
pnpm exec vite build --mode blah
node scripts/prepare-cloudflare-assets.mjs
```

Alternatively `BLAH_SERVER_CONFIG_URL` fetches the same bootstrap over HTTPS at
build time. There is no C3 directory dependency or runtime trust-anchor discovery.
The file/URL is a release-time trust root; independently verify the operator's
pins. These client credentials and public pins are embedded in the bundle.
`BLAH_VAPID_PUBLIC_KEY` optionally enables remote push; local notifications work
without it. Deploy `.cloudflare/assets/`, as described in [deployment](cloudflare.md).

Use a fresh origin, separate from Telegram and older number/email-based Blah
installations. The client refuses populated legacy caches and changed home pins.
A home/domain/database-generation change needs a separate origin. Endpoint/RSA
rotation preserves the home binding. Each account slot is bound to its first Diem
namespace even after logout; use another slot for another identity. Runtime home
switching and cache migration are outside this first integration.

## Create, publish and sign in

1. Open **Create or restore an identity**, choose a password of at least 12
   characters and enter a domain you control, such as `alice.example.org`.
2. Create the identity and download its encrypted backup. The password is separate
   from any Blah account/SRP password; losing both browser storage and the backup
   means losing this device's keys.
3. Download the public profile and serve it at
   `https://alice.example.org/.well-known/blah/profile.cbor` with `application/cbor`.
   The DC must be able to fetch it directly over public HTTPS without credentials
   or redirects. This first version does not provision DNS or profile hosting.
4. Optionally configure **Profile publishing** with an HTTPS PUT endpoint and a
   bearer token. The endpoint must allow the web client's origin through CORS and
   publish the supplied public bytes at the domain above. The token stays in the
   encrypted vault. The client sends no private keys to this endpoint.
5. Select **Sign in to Blah**. The DC may request admission email verification or
   an account password. A new identity proceeds to the name/signup screen.
6. Signup assigns an account number and saves a new signed profile. An automatic
   publisher receives it before login finishes. For manual hosting, select
   **Refresh profile**, download/publish the new file, and retry sign-in.

The DC refetches the numbered profile through a proof-wrapped account read before
login completes. Failed publication leaves the new profile durably available for
retry. There is no email-only, phone-number or QR identity login.

## Manage custody

**Browser identity** remains available after login. Unlock the saved identity to
export an encrypted backup, renew its profile/certificates, or authorize/revoke
other devices by their public keys. Publish every changed profile. Profiles expire
after one day; use **Renew profile and certificates** and publish before expiry
(or renew and sign in again after expiry). Device certificates last at most 30 days.
This version uses explicit renewal, not an unattended hosting service.

**Lock identity** (or 15 minutes without an identity operation) discards the in-memory unlock key without logging out of the
chat session. Reloading the worker also requires unlocking before the next identity
operation. Backups contain the identity and current device keys and publisher
settings, encrypted with PBKDF2-SHA-256/AES-256-GCM. Restoring a backup restores that
same device; it does not enroll a distinct device. An existing local identity cannot
be overwritten by an older backup. Keep a current backup after profile changes.
Ordinary chat logout does not delete identity custody. Clearing all site data does.

## Build and verify the WASM adapter

The minimized `public/assets/blah/diem.js` / `diem.wasm` pair is built and released
by [BlahDiem](https://github.com/UInt8Co/BlahDiem/tree/main/Web), using generated
BridgeJS bindings and Swift 6.4 Embedded. Tweb vendors the pair, generated declarations and provenance;
its build needs no Swift, Binaryen or WASI shim dependency. WASM loads lazily in
the account manager's worker (and supports the in-process fallback). Vite resolves
asset URLs for both workers and pages, including deployments under a URL prefix.

The release tag and manifest hash in `public/assets/blah/source.json` pin the bundle.
To restore that release, update to another dated release, or test a local build:

```sh
node scripts/update-blah-wasm.mjs
node scripts/update-blah-wasm.mjs --release YYYYMMDD-sha4
# Local development: build Web/ in the BlahDiem checkout first.
node scripts/update-blah-wasm.mjs --from-dir ../BlahDiem/Web/dist

# Verify the vendored library and client integration:
pnpm exec vitest run src/tests/blah src/tests/webPushApiManager.test.ts
pnpm run typecheck
node scripts/test-blah-browser.mjs
BLAH_SERVER_REPO=/path/to/Teleblah node scripts/test-blah-server.mjs
```

The browser fixture needs Playwright Chromium (`pnpm exec playwright install
--with-deps chromium`); `BLAH_BROWSER_EXECUTABLE` can select an installed browser.
It exercises real WebCrypto/WASM creation, encryption, proof binding, numbering,
renewal, recovery and account-slot isolation without contacting Telegram.
The server fixture additionally builds the Blah client, starts a disposable debug
Teleblah DC, and checks signup, public profile publication, reload and restored-device
login over PFS through the normal shared worker, plus dialog keyboard containment, focus restoration, narrow-screen
layout and Axe checks. Screen-reader and touch-device testing remain manual.
It uses Teleblah's test-only profile-directory transport; production
still requires public HTTPS profile hosting. It needs `openssl` and the server binary
already built. This validates identity/login support, not every post-login Telegram RPC.

## Keeping upstream rebases small

`src/lib/blah/` owns custody, the identity UI and application proof adapters;
BlahDiem owns the Swift bridge, minimization and release workflow.
`public/assets/blah/manifest.json` identifies the vendored build and checksums.
`source.json` distinguishes a published release from an unpublished local build.
The importer verifies every asset before replacing the bundle, and restoring the pin
also verifies the manifest hash. User identity requests explicitly select `kind: 'user'`;
invocation proofs carry the reviewed challenge bytes and the current transport binding.
There is no separate Swift package or copy of protocol rules in tweb.
Do not duplicate Diem's CBOR, certificate or proof implementation in TypeScript.
The Telegram schema is extended in memory, leaving generated upstream files intact.
Small upstream hooks expose public transport identifiers, wrap identity login
requests, gate cache loading, expose the manager action and mount the identity UI.
Shared code/password/signup screens keep handling ordinary Telegram responses.

Build-time configuration and branding remain in `scripts/blah-config.mjs` and
`scripts/blah-branding.mjs`. Branding transforms dictionary values/display literals
without editing upstream language sources, protocol identifiers or user content.
Blah uses bundled language packs. Rebuild on bootstrap or push-key changes.
