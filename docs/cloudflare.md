# Deploy Blah with Cloudflare Workers static assets

This is an **assets-only Worker**, not Cloudflare Pages and not a Node/Express
server. No Worker script, Cloudflare database, or Telegram proxy is required.
The browser connects directly to the configured Blah data centers over secure
WebSockets. Serve at the hostname root,
not a `/k/` subdirectory.

## Prerequisites

- Use the Node.js and pnpm versions specified in `package.json`.
- Install dependencies with `pnpm install --frozen-lockfile` and initialize any
  submodules required by your checkout.
- Supply `BLAH_API_ID` and `BLAH_API_HASH` to the build environment; the Blah
  profile intentionally does not inherit Telegram's credentials from `.env`.
  Optionally set `BLAH_SERVER_CONFIG_URL` to override the public C3 config URL
  and `BLAH_VAPID_PUBLIC_KEY` to enable your own push configuration. The C3 config
  is fetched and its RSA keys validated at build time, not by the browser.
  Build-time client configuration is public: never put a Cloudflare token or
  another secret in a `VITE_*` variable. Keep credentials out of committed files.
- Choose a Worker name in `wrangler.jsonc` (default: `blah`).

Wrangler is invoked through `pnpm --allow-build=esbuild,workerd dlx wrangler@4`,
explicitly allowing its required install scripts under pnpm 11 and keeping upstream dependency
and lock files unchanged. For reproducible CI, pin that command to a reviewed
Wrangler 4 patch version.

## Build and validate locally

From the repository root:

```sh
pnpm --allow-build=esbuild,workerd dlx wrangler@4 deploy --dry-run
```

Wrangler runs the configured custom build:

```sh
pnpm exec vite build --mode blah
node scripts/prepare-cloudflare-assets.mjs
```

The custom command deliberately bypasses the upstream `pnpm build` pipeline
(tests, typecheck, changelog generation and bundle checks). Run those quality
checks separately before releasing; a successful deployment build alone is not
evidence that they passed.

To build and serve the artifact locally:

```sh
pnpm --allow-build=esbuild,workerd dlx wrangler@4 dev --local
```

Check the printed local URL, sign-in screen, icons, fonts, language loading and
media workers. Missing assets return 404 rather than application HTML; tweb uses
hash routing, so a catch-all SPA rewrite is unnecessary. The root URL serves the
fresh `index.html`.

## Why there is an assembly step

Vite has `copyPublicDir: false`: `dist/` alone lacks runtime resources such as
icons, emoji, audio codecs, manifests and changelogs. Conversely, `public/`
contains a checked-in historical application build. Uploading `public/` directly,
or copying it over `dist/`, can ship stale application code.

The helper rebuilds `.cloudflare/assets/` from scratch:

1. Copy `public/` directories and the root files preserved by the existing
   `keepAsset.js` rule, the same rule used by upstream `build.js`. This includes
   the recorder/codec JS and WASM, manifests and snapshot page, but excludes the
   historical compiled application bundles and `public/index.html`.
2. Overlay the freshly generated `dist/`, which always wins on collisions.
   Omit `.map` files from this build: they are unnecessary at runtime and can
   exceed Cloudflare's per-asset size limit.
3. The Blah Vite plugin supplies branded icons and web manifests in `dist/`,
   including removal of Telegram's legacy `gcm_sender_id`. The overlay uses
   these without changing the upstream files.
4. Generate `_headers` with `Cache-Control: no-store`, matching `server.js`,
   plus `X-Content-Type-Options: nosniff` and
   `Referrer-Policy: strict-origin-when-cross-origin`. Do not blindly enable
   cross-origin isolation or a restrictive CSP: calls and media load remote
   resources and require their own compatibility review.

Neither source directory is changed by assembly. The build may still regenerate
upstream generated files through the existing Vite plugins; review your working
tree afterward. `.cloudflare/` and Wrangler's local `.wrangler/` state are ignored.
When upstream adds a new kind of root-level runtime asset, its preservation rule
belongs in `keepAsset.js`, not a duplicate deployment allowlist.

## Deploy when ready

Authenticate interactively with
`pnpm --allow-build=esbuild,workerd dlx wrangler@4 login`, or supply
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through your CI secret store or
shell environment. Do not commit credentials or put them in the Wrangler config.

```sh
pnpm --allow-build=esbuild,workerd dlx wrangler@4 deploy
```

This builds again and publishes to the configured Worker's `workers.dev` URL.
Add a custom domain through the Cloudflare dashboard if desired. On Workers
Builds, use `pnpm --allow-build=esbuild,workerd dlx wrangler@4 deploy` as the deploy command; the Wrangler custom
build already builds and assembles the application, so avoid a second build
command.

Cloudflare imposes asset count and per-file size limits (which also depend on
the plan). Review Wrangler validation before deploying after large upstream
asset updates. A dry run does not publish anything, authenticate a Telegram
session, or prove Telegram connectivity from the deployed origin.
