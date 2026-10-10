# Blah browser identities

The Blah build uses Web K's MTProto transport with browser-held Diem identities.
It creates Ed25519 identity/device keys, encrypts local custody and identity files with a
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
rotation while rejecting older or conflicting profile versions within the same
home namespace. A changed DC identity or database generation empties the slot's old
session before it can connect to the new namespace. Workers verify the saved public
profile before connecting. If discovery fails, the screen shows the error and lets you retry;
there is no fallback to Telegram or another DC. A link with `?dc=dc.example.org`
prefills the field on first use; the user still selects **Connect to Blah**.

An account slot containing a legacy Telegram/number-email session, caches from a
different home, or a signed-in session bound to neither a Diem identity nor a managed
account is emptied automatically before its state or transport keys are restored. With an app passcode,
credential cleanup finishes after unlocking, preserving other accounts in the shared
encrypted storage. Cleanup uses the normal logout account moves and reloads open
tabs; compatible accounts keep their sessions, caches and home bindings. Network, signature and
profile rollback errors do not erase a compatible session.
Logout clears that slot and moves the remaining accounts together with their home
and identity bindings, leaving the freed slot available for another home. Encrypted
identity custody survives logout and automatic slot cleanup. Existing origin-wide pins
migrate to their original account slots; unused slots can select a different home.

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
   Choose a nonempty password and enter a domain you control,
   such as `alice.example.org`.
2. Create the identity. Its details dialog opens immediately; export its encrypted
   identity file there. The password is separate
   from any Blah account/SRP password; losing both browser storage and the identity file
   means losing this device's keys.
3. Export the public profile and serve it at
   `https://alice.example.org/.well-known/blah/profile.cbor` with `application/cbor`.
   The creation dialog previews this URL below its action button as you enter the domain.
   The DC must be able to fetch it directly over public HTTPS without credentials
   or redirects. This first version does not provision DNS or profile hosting.
4. Close identity details, enter the identity password and select **Sign in to Blah**.
   Closing details locks the identity; signing in unlocks it again. The DC may request
   admission email verification or an account password. A new identity proceeds to signup.
5. Signup assigns an account number and saves a new signed profile. For manual hosting,
   reopen identity details, unlock, export and publish the latest profile, then retry sign-in.
   Details automatically reload the saved profile when opened. There is no manual refresh.

The DC refetches the numbered profile through a proof-wrapped account read before
login completes. Failed publication leaves the new profile durably available for
retry. There is no email-only, phone-number or QR identity login.

### Sign in with a paper key

A paper key is one of the identity's devices, written down as 24 words. Choose
**Sign in with paper key** in the **Saved identity** picker, enter the profile domain,
the words and a new identity password, then sign in as usual. The browser fetches the
hosted profile and keeps the paper's device key as device-only custody, like a device
identity file. It can sign in only while the hosted profile lists that device, and it
cannot add devices, publish device changes or recover the identity.

### Sign in to a managed account

An account an application manages has no browser identity. After connecting to its home
DC, choose **Sign in with a managed account token** and enter either of its tokens; the
ordinary token cannot change the profile. The token goes to `auth.importBotAuthorization`
and is not stored. A bot token is logged out again and refused, and a token for an account
homed on another DC asks you to connect to that DC instead. The account slot records
the managed account in place of an identity binding, so the session survives reloads;
identity custody operations are unavailable in that slot.

## Manage custody

**Identity Manager** opens as a normal settings page after login, from Settings or
from the menu below the account controls. Saved identities appear as a list, with separate
create/import actions. Select an identity to open a centered password form one level deeper;
unlocking reveals its details on the same page. Going back locks it. On the sign-in page, the
trailing **Identity details** icon opens a dialog; closing it by any route also locks it.
Details reload the saved profile automatically on opening and after unlocking.

The device list separates the current device from other devices, using the standard
session rows. Open a device for its public key or to terminate it; **Terminate other
devices** keeps the current device authorized. **Authorize new device** opens a separate
dialog for the new device's public key. **Add paper key** certifies a new paper device
and shows its 24 words once; it appears in the list as another device and is terminated the
same way. Renewal from a browser that holds the identity key keeps it certified. Publish
changed profiles to apply authorization or termination at the DC.

Profiles and device certificates default to 180 days. **Validity and renewal** lets you
choose whole-day periods (device validity must cover profile validity) and disable automatic
renewal. Valid changes save automatically, including when leaving details. New periods take
effect on the next renewal. Automatic renewal is enabled by
default and checks the signed profile and device validity intervals once a minute while
the browser identity is unlocked. When 80% of either interval has elapsed, it renews the
profile and certificates. It catches up after a missed interval on the next unlock.
Background checks never extend the 15-minute unlock timeout.

Renewed profiles are saved before publication. A configured publisher receives them
automatically, with failed publication retried while unlocked; manual hosting still needs
you to export and publish the latest profile. **Validity and renewal** contains the manual
renewal action and shows a publication notice at its bottom only when the hosted CBOR
file differs from the current saved profile or is missing. A failed network/CORS check is
reported separately, without claiming the profile needs publication. The domain must
allow cross-origin reads for this browser check. Existing publisher settings in imported
identity files remain supported; details does not offer publisher configuration.

**Lock identity** (or 15 minutes without an identity operation) discards the in-memory unlock key without logging out of the
chat session. Reloading the worker also requires unlocking before the next identity
operation. Identity files contain the identity and current device keys and publisher
settings in BlahDiem’s password-protected CBOR/HPKE format. No password length or
complexity rules apply beyond requiring a nonempty value; JSON files are unsupported. Importing an identity file recovers that
same device; it does not enroll a distinct device. Choose **Import identity from file**
in the saved-identity picker to open its own dialog, then drop the identity file
onto the file area or click that area to choose one. Enter its password below the file area
and select **Import identity from file** to start the import.
An existing local identity cannot
be overwritten by an older identity file. Keep a current copy after profile changes.
Ordinary chat logout does not delete identity custody. Clearing all site data does,
and browsers may clear it after inactivity. Keep a copy of your identity and key files;
the identity dialogs remind you below their main action button. Keys are never uploaded.

## Update and verify the WASM adapter

[BlahDiem](https://github.com/UInt8Co/BlahDiem/tree/main/Web) owns the JavaScript/WASM
runtime. Tweb imports its pinned module lazily in the account manager's worker (with an
in-process fallback). Set `BLAH_DIEM_CDN_HOST` in the build environment or
`.env.blah.local` to override the default `bd-cdn.blahim.com` for both the worker and page.
Supply a DNS hostname without a scheme, port or path; HTTPS and the release path stay pinned.
The module loads matching WASM relative to its own CDN URL. The default CDN admits HTTPS
`*.blahim.com` page origins; a replacement must allow the page origin through CORS for both
assets. Builds and typechecking use checked-in declarations and need no runtime download
or WASM toolchain.

To change releases, update the versioned path in [`blah-config.mjs`](../scripts/blah-config.mjs)
and replace `diem.d.ts` and `bridge-js.d.ts` in `src/vendor/blahdiem/` with the declarations
from the same release, retaining its license. JavaScript and WASM stay on the CDN.
Verify the library and client integration:

```sh
pnpm exec vitest run src/tests/blah src/tests/webPushApiManager.test.ts
pnpm run typecheck
node scripts/test-blah-browser.mjs
BLAH_SERVER_REPO=/path/to/Teleblah node scripts/test-blah-server.mjs
```

The browser fixture needs Playwright Chromium (`pnpm exec playwright install
--with-deps chromium`); `BLAH_BROWSER_EXECUTABLE` can select an installed browser.
It exercises real WebCrypto/WASM creation, encryption, proof binding, numbering,
renewal, recovery and account-slot isolation without contacting Telegram.
Both browser fixtures serve local content under test `blahim.com` origins and need
network access to load the real CDN module and WASM under its CORS policy.
The server fixture additionally builds the Blah client, starts two disposable debug
Teleblah DCs, and checks domain discovery with a signed profile, its exact WebSocket path/query,
endpoint rotation with another tab open, accounts on two independent homes, sign-in
keyboard/error handling and Axe (with `?a11y=1`, contrast in increased-contrast mode), signup, public profile publication, reload and restored-device
login over PFS through the normal shared worker, plus dialog keyboard containment, focus restoration, narrow-screen
layout and Axe checks. Screen-reader and touch-device testing remain manual.
It uses Teleblah's test-only profile-directory transport; production
still requires public HTTPS profile hosting. It needs `openssl` and the server binary
already built. This validates identity/login support, not every post-login Telegram RPC.

## Keeping upstream rebases small

`src/lib/blah/` owns custody, the identity UI and application proof adapters;
BlahDiem owns the Swift bridge, minimization and release workflow.
User identity requests explicitly select `kind: 'user'`;
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
search combobox under `src/lib/blah/`, reusing the phone-region picker's presentation
and Web K's editable-text control to avoid native form autofill suggestions. Public domain labels are
cached separately from encrypted keys; older saved identities acquire their labels on the
next unlock. Identity and device IDs are displayed on a bounded line with ellipses;
the complete values remain selectable and available in their tooltips. Long domains,
filenames and messages wrap within the dialog. Details reuse Web K's popup, section and row components. The upstream picker
stays unchanged to keep rebases local.

Build-time configuration and branding remain in `scripts/blah-config.mjs` and
`scripts/blah-branding.mjs`. Branding transforms dictionary values/display literals
without editing upstream language sources, protocol identifiers or user content.
Blah uses bundled language packs. Rebuild on application-credential, operator-bootstrap
or push-key changes; discovered DC endpoints refresh at runtime.

## Domain usernames

Every domain in Identity Manager is a username candidate.
Add or remove domains there, keeping at least one profile domain, and publish the new
exported profile at every listed domain. Send `/check_profile` to the service account
named after your DC domain to refresh availability. The DC checks at most 15 domains
by default; its administrator can change that limit.

In **Edit Profile**, enable the verified domains you want to display and drag active
usernames to set their order. New verified names start hidden. These use Telegram's
collectible-username controls; Blah does not offer an editable regular username.
