# Blah browser identities

The Blah build uses Web K's MTProto transport with seed-derived Ed25519 identities.
An identity has 24 BIP 39 English **recovery words**, its only backup. Each sign-in
generates a fresh, non-extractable ECDSA P-256 device key. The browser stores the
CryptoKey object in IndexedDB and keeps the seed encrypted with AES-GCM under a
separate non-extractable CryptoKey. No device private key is serialized or exported.
The existing app passcode remains an optional additional lock. Telegram builds keep
the upstream auth flow.

Safari uses dedicated workers and single-tab mode because its SharedWorkers cannot structured-clone the CryptoKeys used for identity custody.

## Configure a home and build

Enter your home DC's domain on **Connect to Blah**. The browser fetches
`https://<dc>/.well-known/blah/profile.cbor` without credentials or redirects and
verifies its signature, validity, domain, endpoints, RSA key and database generation.
The endpoint must allow cross-origin reads and return `application/cbor`.
Each account slot pins an independent home. **Add Account** can connect another
slot to another home, including one that allocates the same numeric user ID.
Changed identities or database generations reset incompatible sessions before
loading caches, after app-passcode unlock when needed. Temporary discovery failures
retain the verified pin and do not erase a compatible session.

Set `BLAH_API_ID` and `BLAH_API_HASH` for an application accepted by the DC:

```sh
pnpm install --frozen-lockfile
pnpm exec vite build --mode blah
node scripts/prepare-cloudflare-assets.mjs
```

Deploy `.cloudflare/assets/` as described in [deployment](cloudflare.md).
`BLAH_VAPID_PUBLIC_KEY` optionally enables push. `BLAH_PROFILE_HOSTING_DOMAIN`
prefills the independent hosted-name chooser. `BLAH_BOOTSTRAP_FILE` and
`BLAH_SERVER_CONFIG_URL` retain operator bootstrap support.
`?http=1` maps the signed WebSocket host to HTTPS `/apiw1`; forward `POST /api…`
through the TLS proxy with the DC's real-IP header. Transport never falls back
to Telegram endpoints.

## Create an account

After home selection, the entry offers **Create Account**, **Sign In with Recovery
Words**, and **Sign In with QR Code**, plus the managed-account token link.

1. Choose a hosted name or a domain you control.
2. Write down all 24 numbered recovery words. Done becomes available after a short delay.
3. Enter three randomly selected words to verify the backup.
4. The browser creates the device, signs a profile and saves encrypted custody.
5. Publish the public profile, then continue through the existing signup name form.
   Admission email and Telegram two-step verification still use the stock cards.

For an own domain, export **public** `profile.cbor` and serve it at
`https://<domain>/.well-known/blah/profile.cbor`, with `application/cbor`, CORS and
no redirects. Publish each updated revision, including the numbered profile after
signup. Failed publication leaves the signed bytes available for export and retry.
The sign-in card resumes unfinished custody immediately after a publication failure or reload. A confirmed **Discard unfinished sign-in** removes only that pending slot's custody.

Hosted names use the runtime's policy, availability and identity-bound proof of work.
Availability is not a reservation. The public proof solver runs in dedicated workers;
no signing keys enter those workers. Cancellation or a failed PUT keeps the identity
and pending signed revision. Retry from **Blah Identity**. An unanswered PUT is
replayed with the same bytes before another revision is signed.

## Recover or link a device

**Sign In with Recovery Words** asks for the profile domain and 24 individual words.
Each field has BIP 39 autocomplete; pasting a whole phrase fills all fields. The runtime
checks the word count and checksum. The browser fetches and verifies the domain's
profile, derives the identity and rejects mismatched words before saving anything.
It enrolls a fresh device, publishes the revision and signs in. Recovery never reuses
another session's device. Hosted-name routing is rediscovered from the hosting policy;
own domains use manual public-profile export.

For QR sign-in, open the ordinary QR card after selecting the home. On a seed-holding
device, open **Settings → Devices → Link device by QR code** and scan or paste the link.
Confirm the requesting label. **Allow this device to approve sign-ins** defaults off;
enabling it transfers the seed inside the sealed grant. The approver certifies and
publishes the device before accepting the token. The joining browser stores its
non-extractable device and optional encrypted seed before completing proof login.
There is no local custody-password screen. Telegram two-step verification still applies.
After installation, a failed or reloaded QR sign-in continues with the saved device. QR login cannot create a new account.

A device without the seed can use its existing session and log itself out. It cannot
approve sign-ins, renew, or terminate other sessions. **Enter Recovery Words** checks
the seed against the current identity and stores it without changing the device key.

Managed accounts use **Sign in with a managed account token**. The token is not stored;
bot tokens are refused. Their slots have no account identity or recovery words.

## Blah Identity and sessions

**Settings → Blah Identity**, also available from the account menu, shows the current
slot's identity directly. It contains domains, home DC, publication status, public
profile export, recovery words and renewal settings. There is no saved-user-identity list.

**Recovery Words** opens only after explicit confirmation. **Remove Recovery Words
from This Device** drops only the encrypted seed and wrapping key; the device stays
signed in. It can become a holder again by entering matching words.

Profiles and all listed device certificates default to 180 days. Holders renew after
80% of either validity interval while the app is running, with no unlock step. Whole-day
validity settings and the automatic-renewal toggle save automatically. Failed automatic
publication is retried; own-domain profiles still need manual export and publication.
Non-holders never renew.

The stock Devices screen shows ordinary authorizations. Holders can terminate one or
all other sessions. The client maps authorization hashes through `blah.getSessionDevices`,
publishes a profile without the victim devices, then sends the normal reset RPC. It
retries `DEVICE_STILL_LISTED` once after a short delay. Non-holders see a recovery-word
explanation and entry action instead of termination controls. After login, holders
prune exactly the listed devices the server reports as retired. Devices still completing sign-in remain listed.

Ordinary logout retires the device on the server and deletes that slot's local device
and seed. Forgot-passcode logout clears every account slot's custody. The next holder prune removes its certificate from the profile. Custody
moves with remaining account slots through a durable relocation journal; interrupted moves resume before any account loads.
Relocation, logout and legacy discard share a lifecycle lock; ordinary account writes in other tabs
can still race a logout shift, as in upstream. Chat custody
is independent of account logout and remains encrypted in this browser.

A home move signs a newer home epoch and clears the account number. Publish it before
signing in at the destination. The old account is removed; chats, contacts and settings
do not move. DC operator sign-in uses the DC domain and its recovery words and publishes
DC-kind profile revisions through the DC's public renewal endpoint.

## Chat identities

Cross-server channel/group creation displays and verifies the chat's own recovery words
before creating custody. Publish its initial profile, bind/create through the existing
chat managers, then publish the numbered profile. A committed chat RPC is recorded before
numbering so retrying cannot create a duplicate. Cancellation preserves already-created
custody for the form's retry and for **Blah Identity → Chat identities**.

Chat custody has a separate device CryptoKey and encrypted seed per identity. It never
replaces the account slot's signer. Restore using the chat domain and recovery words;
show its words again after confirmation. Public domain and attachment metadata remain
separate from encrypted custody.

Protected deletion and **Claim ownership** use the held chat device automatically.
If custody is elsewhere, restore it first. Claim requires membership and transfers
ownership to the current account through the existing identity-proven manager path.
Handover means giving the recipient the chat's domain and recovery words. They restore,
join, and claim ownership. Sharing words does not revoke the sender's custody.

Profile domains are username candidates. Publish domain changes, then send
`/check_profile` to the DC service account. Edit Profile uses the existing verified-domain
activation and ordering controls. Resource-profile checks remain cached and never add
a blocking request to chat opening.

## Runtime and validation

BlahDiem owns the cryptographic rules and the JavaScript/WASM implementation. Only matching
type declarations live in `src/vendor/blahdiem/`. The runtime loads lazily from the pinned
CDN URL in `scripts/blah-config.mjs`; set `BLAH_DIEM_CDN_HOST` to override its DNS host.
Keep production pins unchanged until the new runtime release is published. Local integration
fixtures accept `BLAH_DIEM_LOCAL_DIST=/path/to/BlahDiem/Web/dist` for unpublished assets.
The runtime must expose `seeds`, `deviceKeys`, seed-aware device linking and `enroll`.

```sh
./node_modules/.bin/vitest run src/tests/blah src/tests/blah*.test.ts src/tests/blah*.test.tsx
NODE_OPTIONS=--max-old-space-size=3072 ./node_modules/.bin/tsc --noEmit
node scripts/test-blah-browser.mjs
BLAH_SERVER_REPO=/path/to/Teleblah node scripts/test-blah-server.mjs
./node_modules/.bin/playwright test e2e/blahDomains.spec.ts e2e/blahHome.spec.ts e2e/blahHosting.spec.ts e2e/blahChatIdentity.spec.ts
```

Unit tests use runtime mocks and real WebCrypto custody checks. Browser/server fixtures
exercise the unpublished runtime and disposable DCs; they are a separate integration
stage. Popup stories cover recovery words, restore, holder/non-holder settings, public
publication, hosted names and QR approval. The e2e specs include narrow layouts and RTL.
Screen-reader and touch-device checks remain manual.

The custody format is a clean break: startup discards `blah-browser-identities-v2` and
logs out identity-bound slots using it. No secret decoding or migration is attempted.
Managed sessions and public home pins are retained. telegram-tt remains on its old pin
and has not been migrated.

## Keeping upstream rebases small

`src/lib/blah/` owns custody, recovery-word UI, identity settings, publication and proof
adapters. Blah-only auth cards live in `src/pages/cards/`. Stock auth/signup/2FA, settings,
session rows, confirmations, inputs and chat managers remain the UI scaffolding. Upstream
files receive only the hooks to mount/gate this behavior. The Telegram schema is extended
in memory; generated upstream TL files stay unchanged. Do not duplicate Diem's CBOR,
certificate, derivation or proof implementation in TypeScript.
