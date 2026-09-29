# Blah browser identities

The Blah build uses Web K's MTProto transport with browser-held Diem identities.
It creates Ed25519 identity/device keys, encrypts local custody and backups with a
separate identity password, and compiles profile/proof rules from the pinned
BlahDiem Swift package to WASM. Private keys never go to a DC or profile publisher.
An ordinary Telegram build keeps the upstream login flow.

## Configure a home

Sign-in starts with **Connect to Blah**, using the same card, domain field and
buttons as the rest of the login flow. Enter a DC domain (or its HTTPS origin),
such as `dc.example.org`. The browser fetches
`https://dc.example.org/.well-known/blah/profile.cbor` without credentials or
redirects and verifies its Diem certificates, signature, validity and advertised
domain with BlahDiem WASM. The current browser crypto adapter supports Ed25519 DC
profiles, including those created by the DC setup wizard.

The profile must advertise a TLS WebSocket client endpoint and a database
generation. Blah uses the signed endpoint's exact path/query and RSA transport key;
TCP and plain WebSocket endpoints cannot be used by this browser client. The profile
endpoint must allow cross-origin reads and return `application/cbor`.

The first verified profile pins **one independent home DC per account slot**.
Use **Add Account** to sign in to another home on the same web origin; accounts
keep separate transport keys, discovery profiles and identity namespaces.
Selecting a home reloads open tabs so they share the updated account configuration.
On reload, Blah fetches and verifies the profile again, allowing endpoint and RSA
rotation while rejecting changed DC identities, database generations, and older or
conflicting profile versions. Workers verify the saved public profile before
connecting. If discovery fails, the screen shows the error and lets you retry;
there is no fallback to Telegram or another DC. A link with `?dc=dc.example.org`
prefills the field on first use; the user still selects **Connect to Blah**.

Use a fresh origin, separate from Telegram and older number/email-based Blah
installations. Populated legacy caches are refused. A selected slot cannot switch
homes while it holds an account or transport cache.
Logout clears that slot and moves the remaining accounts together with their home
and identity bindings, leaving the freed slot available for another home. Encrypted
identity custody survives logout. Existing origin-wide pins migrate to their
original account slots; unused slots can select a different home.

### Build the client

Set `BLAH_API_ID` and `BLAH_API_HASH` for an application accepted by the target DC,
then run:

```sh
pnpm install --frozen-lockfile
pnpm exec vite build --mode blah
node scripts/prepare-cloudflare-assets.mjs
```

No endpoint or RSA-key file is needed for domain discovery. Application credentials
are still embedded at build time; the DC profile does not register an application.
`BLAH_VAPID_PUBLIC_KEY` optionally enables remote push. Deploy
`.cloudflare/assets/`, as described in [deployment](cloudflare.md).

An existing operator deployment can retain its release-time bootstrap by setting
`BLAH_BOOTSTRAP_FILE` or `BLAH_SERVER_CONFIG_URL`. That mode skips the domain
step and continues to use its independently verified operator pins. The bootstrap
format and validation are owned by [blah-config.mjs](../scripts/blah-config.mjs).

## Create, publish and sign in

1. Choose **Create identity** in the **Saved identity** picker to open its dialog.
   Choose a password of at least 12 characters and enter a domain you control,
   such as `alice.example.org`.
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
5. Select **Sign in to Blah**. For a saved, locked identity, enter its identity password;
   the same action unlocks it and starts sign-in. The DC may request admission email
   verification or an account password. A new identity proceeds to the name/signup screen.
6. Signup assigns an account number and saves a new signed profile. An automatic
   publisher receives it before login finishes. For manual hosting, select
   **Refresh profile**, download/publish the new file, and retry sign-in.

The DC refetches the numbered profile through a proof-wrapped account read before
login completes. Failed publication leaves the new profile durably available for
retry. There is no email-only, phone-number or QR identity login.

## Manage custody

**Browser identity** opens as a normal settings page after login, from Settings or
the menu item immediately below the account controls. Choose a saved identity with
the searchable picker and unlock it to export an encrypted backup, renew its profile/certificates, or authorize/revoke
other devices by their public keys. Publish every changed profile. Profiles expire
after one day; use **Renew profile and certificates** and publish before expiry
(or renew and sign in again after expiry). Device certificates last at most 30 days.
This version uses explicit renewal, not an unattended hosting service.

**Lock identity** (or 15 minutes without an identity operation) discards the in-memory unlock key without logging out of the
chat session. Reloading the worker also requires unlocking before the next identity
operation. Backups contain the identity and current device keys and publisher
settings, encrypted with PBKDF2-SHA-256/AES-256-GCM. Importing a backup recovers that
same device; it does not enroll a distinct device. Choose **Import identity from file**
in the saved-identity picker to open its own dialog, then drop the encrypted backup
onto the file dropzone or choose it with **Choose backup file**. Enter its password
and select **Import identity from file** to start the import.
An existing local identity cannot
be overwritten by an older backup. Keep a current backup after profile changes.
Ordinary chat logout does not delete identity custody. Clearing all site data does.

## Build and verify the WASM adapter

The minimized `public/assets/blah/diem.js` / `diem.wasm` pair is built and released
by [BlahDiem](https://github.com/UInt8Co/BlahDiem/tree/main/Web), using generated
BridgeJS bindings and Swift 6.4 Embedded. Tweb tracks the JavaScript bindings, generated
declarations, licenses and provenance. WASM binaries are never committed. The binary
is an ignored local cache: Vite builds, the dev server and the browser fixture verify
its checksum and download it from the pinned release if absent. With a published
release, the client build needs no Swift, Binaryen or WASI shim dependency. WASM loads
lazily in the account manager's worker (and supports the in-process fallback). Vite resolves
asset URLs for both workers and pages, including deployments under a URL prefix.

The release tag and manifest hash in `public/assets/blah/source.json` pin the bundle.
To prepare the binary, update to another dated release, or test a local build:

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
The server fixture additionally builds the Blah client, starts two disposable debug
Teleblah DCs, and checks domain discovery with a signed profile, its exact WebSocket path/query,
endpoint rotation with another tab open, accounts on two independent homes, sign-in
keyboard/error handling and Axe (contrast in increased-contrast mode), signup, public profile publication, reload and restored-device
login over PFS through the normal shared worker, plus dialog keyboard containment, focus restoration, narrow-screen
layout and Axe checks. Screen-reader and touch-device testing remain manual.
It uses Teleblah's test-only profile-directory transport; production
still requires public HTTPS profile hosting. It needs `openssl` and the server binary
already built. This validates identity/login support, not every post-login Telegram RPC.

## Keeping upstream rebases small

`src/lib/blah/` owns custody, the identity UI and application proof adapters;
BlahDiem owns the Swift bridge, minimization and release workflow.
`public/assets/blah/manifest.json` identifies the build and checksums.
`source.json` distinguishes a published release from an unpublished local build.
The checked-in pin references a published release, so a fresh checkout downloads its
matching WASM automatically. Local development imports use `release: null` and require
a matching local BlahDiem build; they are never silently replaced by a public release.
The importer verifies every asset before replacing the bundle, and restoring the pin
also verifies the manifest hash. User identity requests explicitly select `kind: 'user'`;
invocation proofs carry the reviewed challenge bytes and the current transport binding.
There is no separate Swift package or copy of protocol rules in tweb.
Do not duplicate Diem's CBOR, certificate or proof implementation in TypeScript.
The Telegram schema is extended in memory, leaving generated upstream files intact.
Blah home selection and persistence stay in `src/lib/blah/`; upstream account and
transport hooks pass the account slot explicitly, including RSA key selection and
duplicate-account detection. Small upstream hooks expose public transport
identifiers, wrap identity login
requests, gate cache loading, expose the manager action and mount the identity UI.
Shared code/password/signup screens keep handling ordinary Telegram responses.
Identity views use Web K's Material buttons, text fields, popup lifecycle, settings
scaffold and chat-upload dropzone. The saved-identity picker is a Blah-owned
search combobox under `src/lib/blah/`, reusing the phone-region picker's presentation;
its input explicitly uses search semantics. The upstream picker
stays unchanged to keep rebases local.

Build-time configuration and branding remain in `scripts/blah-config.mjs` and
`scripts/blah-branding.mjs`. Branding transforms dictionary values/display literals
without editing upstream language sources, protocol identifiers or user content.
Blah uses bundled language packs. Rebuild on application-credential, operator-bootstrap
or push-key changes; discovered DC endpoints refresh at runtime.
