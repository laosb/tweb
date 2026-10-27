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
profile before connecting. A DC that cannot be reached on reload (down or restarting) keeps
its saved verified profile, so a signed-in account reconnects on its own once the DC is back;
a profile the DC does return must still pass every check. If discovery fails, the screen shows
the error and lets you retry; there is no fallback to Telegram or another DC. A link with `?dc=dc.example.org`
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
`BLAH_VAPID_PUBLIC_KEY` optionally enables remote push.
`BLAH_PROFILE_HOSTING_DOMAIN` optionally prefills the hosted-name chooser with a DNS
hostname; it defaults to empty and is independent of the home DC. Deploy
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
   or redirects. With a runtime that supports name hosting, you can instead choose
   **Hosted name** during creation (see below).
4. Close identity details, enter the identity password and select **Sign in to Blah**.
   Closing details locks the identity; signing in unlocks it again. The DC may request
   admission email verification or an account password. A new identity proceeds to signup.
5. Signup assigns an account number and saves a new signed profile. For manual hosting,
   reopen identity details, unlock, export and publish the latest profile, then retry sign-in.
   Details automatically reload the saved profile when opened. There is no manual refresh.

The DC refetches the numbered profile through a proof-wrapped account read before
login completes. Failed publication leaves the new profile durably available for
retry. There is no email-only or phone-number identity login. QR login links a new device to an existing identity, as described below.

### Hosted profile names

When the loaded BlahDiem runtime exposes `hosting`, creation offers **Hosted name**
or **Your own domain**. Enter the hosting domain and a single name below it. The
chooser checks availability after typing and shows expected proof work as a number
of attempts; availability is not a reservation. The current CDN pin predates this
capability, so hosted controls stay hidden until a compatible release is deployed.
The optional build default does not enable the capability by itself.

**Claim and publish** first saves the identity, then solves the identity-bound proof
in up to four dedicated module workers on the UI side. Progress and cancellation
remain available; closing the chooser or locking the identity stops the pool. No
keys enter these workers. Cancellation, a lost name race or a failed PUT leaves the
identity saved with publication pending. In details, **Add a hosted name** can retry
or replace an unclaimed name. It also adds a hosted name to an existing user or chat identity.
One hosting domain per identity is supported, together with any own domains.

Renewal, device changes, account numbering and home moves publish signed updates
through BlahDiem's hosting API. **Retry publication** resends saved bytes without
signing another revision. An unanswered PUT is replayed before a newer revision is
signed. Removing a hosted domain publishes its release through a remaining held
name, or the last removed name; at least one profile domain must remain. If an unanswered
final release has already removed its routing name, retry reconciles all previously
held names through the host before marking it complete. Own domains
still need the current profile served at each domain, and the publication check
continues to compare every listed domain.

Public claim metadata lives in `hosting:<identity ID>` in the custody vault:
`{domain, held, proofs, unclaimed?, pending?}`. `held` contains labels, `proofs` maps labels to
nonce byte arrays, `unclaimed` remembers a claim that may be replaced after failure,
and `pending` retains the in-flight profile bytes, routing label
and hosted labels until an acknowledged PUT. Signed revisions and claim proofs are
saved before publication. Proofs are reusable public data, sent only for names not currently held. Ordinary
updates omit proofs; a proof-required response makes the cached proof eligible for
the next retry. Encrypted identity backups include the portable
`hosting: {domain, held, proofs}` record. Every save and export refreshes it from local
claim state. Restore merges names without removing locally held names and keeps local
proofs and in-flight `pending` bytes authoritative. A different local hosting domain
wins; importing an existing identity still refuses to overwrite its signed custody.
Unlock uses an existing local record as-is, so a stale sealed snapshot cannot resurrect
a released name. Old files without a hosting record remain supported. Pending publication
bytes and the replaceable `unclaimed` hint stay local; backups never copy them. Only
16 labels fit a portable record; obsolete proof entries beyond that are omitted, with
held names and current profile names kept first. Combining more than 16 held names rejects the import.

Chat identities use the same claim/release controls in their details. The Cross-server
form offers **Hosted name** when the runtime supports it. Its dialog saves channel custody
and the default paper device before running the UI proof workers, then publishes through
the hosting API. Save the backup and paper words before binding as usual. Cancellation
keeps the attempt reusable; publication errors offer retry. Binding still requires an
exact public-profile match, and numbering publishes the updated hosted profile.

There is no Diem bot identity manager: custody and the WASM adapter manage only `user`
and `channel`. The upstream managed-bot popup calls `appBotsManager.createManagedBot`
(`bots.createBot`) with a manager, display name and Telegram username; it neither creates
nor imports signing keys or Diem bot profiles. Resource-profile verification can display
bot domains, and managed-account token sign-in explicitly refuses bots. These paths do
not offer hosted-name claims.

### Sign in with a paper key

A paper key is one of the identity's devices, written down as 24 words. Choose
**Sign in with paper key** in the **Saved identity** picker, enter the profile domain,
the words and a new identity password, then sign in as usual. The browser fetches the
hosted profile and keeps the paper's device key as device-only custody, like a device
identity file. It can sign in only while the hosted profile lists that device, and it
cannot add devices, publish device changes or recover the identity.

### Log in by QR code

Connect the new browser to your home DC, then choose **Log in by QR code**. On a
signed-in device, open **Settings → Devices → Link device by QR code**, or the
same action in **Identity Manager → Identity details → Devices**. Scan the code
with the camera, when supported, or use **Copy Link** on the new device and paste
its `tg://login` link. Both devices must
use the same home DC.

The approving device shows the new device’s name and **Also let this device approve
new devices**, checked by default. Clear it to give the new browser device-only
custody. Enter your existing identity password if asked. Approval needs custody
that can authorize devices; a paper key alone cannot do this.

The updated public profile is saved before publication. A configured publisher
must acknowledge it before approval continues. With manual hosting, export and
publish the file at the displayed URL, then continue. If the DC still sees an old
profile, acceptance retries with fresh challenges after 1, 2, 4, 8 and 15 seconds.
An expired code needs another scan.

The new browser generates its own device key and a temporary encryption key. The
login link’s secret stays between the two devices; the DC receives only the
public request and encrypted response. When approved, choose a **new local identity
password** in the new browser. Custody and the account-slot binding are saved before
sign-in completes. Telegram’s existing two-step verification password still applies.
The approval satisfies the per-sign-in email check; QR login cannot create an account.

Approval authority travels only inside the encrypted grant. Portable publisher,
renewal and hosted-name metadata can travel with it, but pending publication bytes
and other local retry state never do. Cancelling the flow destroys temporary link
keys; an already saved device certification remains in Identity Manager and can be
terminated there. Existing local identity custody is never overwritten by a grant.

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
Chat identities have a separate list, labelled by the attached chat title or by their
domain and **Not attached**. They share exports, devices, paper keys and renewal with
user identities, including domain and hosted-name editing, and never enter the sign-in picker.
Import detects the signed profile kind, including in encrypted identity files.

Any saved user identity unlocks, whichever DC hosts it. Its **Home DC** section shows that
DC (by domain when this browser knows it), whether the DC has allocated a user ID yet, and
whether it is the DC of the current account. An identity hosted elsewhere can manage custody
here but cannot sign in or prove anything for this account. **Change home DC** lists the
current account's DC first and accepts any other DC domain, whose public profile is verified
as on sign-in. After a warning, it signs a profile of a newer home epoch without an account
number. Publish it, then sign in to the new DC, which allocates a new user ID. Whichever DC
receives that profile deletes the old account; chats, contacts and settings do not move. If
the current account was signed in with that identity, it is signed out.

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
pnpm exec playwright test e2e/blahDomains.spec.ts e2e/blahHosting.spec.ts e2e/blahChatIdentity.spec.ts
BLAH_SERVER_REPO=/path/to/Teleblah node scripts/test-blah-server.mjs
```

The browser fixture needs Playwright Chromium (`pnpm exec playwright install
--with-deps chromium`); `BLAH_BROWSER_EXECUTABLE` can select an installed browser.
It exercises real WebCrypto/WASM creation, encryption, proof binding, numbering,
renewal, recovery and account-slot isolation without contacting Telegram.
The chat-identity Playwright suite uses only the popup sandbox and checks cancellation,
backups, publication steps, keyboard focus and narrow layouts. It needs no network or
authenticated account.
Both WASM browser fixtures serve local content under test `blahim.com` origins and need
network access to load the real CDN module and WASM under its CORS policy.
For an unreleased runtime, set `BLAH_DIEM_LOCAL_DIST=/path/to/BlahDiem/Web/dist`
on either test command to serve its `diem.js`, `diem.wasm` and optional
`device-link-worker.js` at the pinned URLs,
including in shared workers. Production builds do not read this switch. The pinned
release includes `verifyProfile` for resource-profile checks.
The server fixture additionally builds the Blah client, starts two disposable debug
Teleblah DCs, and checks domain discovery with a signed profile, its exact WebSocket path/query,
endpoint rotation with another tab open, accounts on two independent homes, sign-in
keyboard/error handling and Axe (with `?a11y=1`, contrast in increased-contrast mode), signup, public profile publication, reload and restored-device
login over PFS through the normal shared worker, plus dialog keyboard containment, focus restoration, narrow-screen
layout and Axe checks. Screen-reader and touch-device testing remain manual.
It also creates a Cross-server channel and upgrades an unchanged home-only channel,
saves encrypted backups, checks the default paper words, publishes both profile revisions, and checks
chat custody stays out of the sign-in picker. A proof-wrapped read refreshes the DC's
stored numbered profile; an info-panel check after reload clears the five-minute lookup cache.
With an unreleased hosting runtime, `BLAH_TEST_HOSTING=1 BLAH_TEST_HOSTING_ONLY=1`
on the server fixture runs a focused UI claim/release against a disposable DC configured
with `BLAH_PROFILE_HOSTING_CONFIG` and tiny proof difficulty. Without the `ONLY` switch
it also runs the account checks.
The account checks use Teleblah's test-only profile-directory transport; production
still requires public HTTPS profile hosting. It needs `openssl` and the server binary
already built. This validates identity/login support, not every post-login Telegram RPC.

`BLAH_TEST_MENUS_ONLY=1` checks that clicking the attachment button opens the
built-in attachment menu against the disposable DC, in LTR and RTL.

For QR interoperability with the real TDLib fork, build Teleblah's server and
`BlahDeviceLinkTool` (`swift build --jobs 3 --product BlahMTProtoServer` and
`swift build --jobs 3 --product BlahDeviceLinkTool` in that checkout), then run:

```sh
BLAH_SERVER_REPO=/path/to/Teleblah \
TDLIB_PATH=/path/to/qr-capable/libtdjson.so \
BLAH_DIEM_LOCAL_DIST=/path/to/BlahDiem/Web/dist \
BLAH_TEST_DEVICE_LINK_TDLIB=1 BLAH_TEST_DEVICE_LINK_ONLY=1 \
  node scripts/test-blah-server.mjs
```

This needs Deno on `PATH` (or `DENO`), the fork's device-link APIs, and matching
BlahDiem QR support. `BLAH_DEVICE_LINK_TOOL_BIN` selects a prebuilt crypto tool.
The fixture creates an Ed25519 identity in tweb, approves a TDLib peer with key
transfer through the paste UI, then uses that peer to approve a fresh browser
without transfer. It decodes the rendered QR bitmap with `jsqr`, completes the
local password step, reloads, and checks the certified device in Identity Manager.
Both directions reject an altered `blah` digest before certification. The peer
uses Teleblah's existing TDLib FFI and Swift crypto adapters on the same DC's TCP
endpoint; the profile publisher stays separate from the DC. Omitting the `ONLY`
switch also runs the ordinary server checks. `TMPDIR` chooses the disposable
fixture directory; keys and databases are removed at shutdown.

## Keeping upstream rebases small

`src/lib/blah/` owns custody, the identity UI and application proof adapters;
BlahDiem owns the Swift bridge, minimization and release workflow.
Identity requests select `kind: 'user'` or `kind: 'channel'` through the same WASM adapter;
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

## Resource identities

A channel or supergroup without an identity known to your home DC shows
**Only people on <home DC domain> can join** in its info panel. This notice comes
from the DC's profile lookup; a failed lookup does not show it. Lookups are cached
for five minutes, and switching accounts clears the cache. Monoforums follow their broadcast
and do not show a separate notice.

In the Blah build, a user/bot or channel/supergroup without an active public username
shows its identity's first domain as a copyable **Identity** row after signature and
peer-binding verification (including valid lapsed profiles). These are signed profile
claims, not proof of current domain control; the row uses `verifyProfile` from the
pinned BlahDiem release.

### Cross-server creation and upgrade

**Cross-server** on the channel/group creation form reveals the own-domain / hosted-name choice (or a profile-domain field on older runtimes).
Existing channels and supergroups offer it to their creator in the edit form; monoforums
follow their broadcast. A known binding is shown permanently enabled with its domain.
Failed profile lookups hide the control rather than treating the identity as absent.
These lookups belong to the edit form, never the chat-open path.

The dialog generates an unnumbered channel identity on the account's home DC, seals it
with a nonempty password, and certifies a default paper device. Save the encrypted
`<domain>-identity.cbor` file and write down its 24 words, which are shown once.
Export and serve the public profile at the displayed HTTPS well-known URL, with
`application/cbor`, CORS access and no redirects. The browser checks for an exact match
before binding; an unavailable host is reported separately from an unpublished profile.

Creation wraps the existing create RPC with the channel device's invocation proof.
For a basic-group request, custody follows the returned migrated supergroup. Upgrade
wraps the first changed title, description or photo; with only the toggle changed it
resends the title. A no-op title error counts as success only after the DC confirms the
same channel identity. Remaining edits use the ordinary managers.

After binding, the saved identity is numbered with the channel ID. Export and publish
this updated profile so receiving homes can verify the binding; the final step offers
export and recheck and can be closed to finish later in Identity Manager. Binding is
permanent. Cancellation before the RPC keeps custody as unattached and leaves the form
open; retrying that form reuses its identity. A recorded successful RPC is resumed after
a numbering/save failure rather than creating another chat.

Channel custody has separate unlocked sessions per account slot and identity, with the
same 15-minute auto-lock and renewal/publication policy as user custody. It never changes
the slot's user signer or namespace binding. Public kind/domain and attachment metadata
sit alongside encrypted custody. Losing the default paper words does not reveal them
again; unlock the saved identity to authorize a new paper key.

### Deletion, ownership and handover

Deleting a bound channel, group or community requires its chat identity's proof and
an account that is still its creator. The worker uses held chat custody automatically;
locked custody prompts for its password and retries once. Cancellation aborts deletion.
If custody is elsewhere, import the identity in **Identity Manager → Chat identities**.
Unbound chats keep their ordinary deletion path.

Ownership follows the chat identity. An unlocked, bound identity offers **Claim ownership**
when the current account is a member but not the creator. This proves
`messages.editChatCreator` for `inputUserSelf` with `inputCheckPasswordEmpty`, processes
the returned updates and makes that account the creator. Join the chat first. A bound
chat cannot be transferred directly to a different user through this RPC.

To hand over a chat, give its recipient a **new paper key** (preferred: the identity-key
holder can remove it later), or the identity file and its password. Publish the updated
profile after adding or removing a paper key. The recipient imports it and claims
ownership for their own account. Sharing custody does not revoke the sender's custody.

The chat section offers file import and **Use paper key** (profile domain, 24 words and a
new browser password). Import verifies the profile kind and takes the chat number from
its signed home account. A paper key is stored as device-only channel custody: it can
prove deletion or claim, but cannot add devices or renew the identity. Imported chat
identities stay in the chat section and never become sign-in candidates.
