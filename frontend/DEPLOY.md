# Deploying Prediction Arena

Production checklist for a public deployment of `frontend/`.

**Currently live on Render** — `render.yaml` at the repo root is the source of truth for that deploy
(root dir `frontend`, `npm install && npm run build`, `npx next start -p $PORT`), and CI triggers the
deploy hook on every push to `main`. The Vercel path below is kept for hosts that can complete
Vercel's verification step; nothing in the app is host-specific.

---

## 1. Project settings

| Setting | Value |
|---|---|
| **Root Directory** | `frontend` |
| **Framework preset** | Next.js |
| **Build Command** | `bun run build` (or `npm run build`) |
| **Output Directory** | `.next` |
| **Install Command** | `bun install` (or `npm ci`) |
| **Node version** | 20+ (the app is built and tested on Node 26 locally) |

The repo root also contains the Hardhat project (`contracts/`, `scripts/`, `test/`). Keeping
**Root Directory = `frontend`** is what prevents the platform from trying to build the contracts.
If you must deploy from the repo root, add a custom install step so Hardhat's dev dependencies are
not installed on the platform.

---

## 2. Environment variables

Set these in the platform dashboard (Project → Settings → Environment Variables) for **Production**,
**Preview** and **Development**. They mirror `frontend/.env.local`, which is gitignored and never
committed.

### Required

| Variable | Example | Notes |
|---|---|---|
| `NEXT_PUBLIC_ARENA_ADDRESS` | `0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5` | Deployed v3 contract (pausable + batch read) on Base. If unset the app falls back to the build-time ABI address and, failing that, demo mode. |

| `NEXT_PUBLIC_ADMIN_ADDRESSES` | — | Comma-separated operator wallets allowed to open `/admin`. Public half of the console gate. |
| `ADMIN_ADDRESSES` | — | Same list, read by `/api/admin/metrics`. Without it the endpoint answers `503` and the console cannot load counters. |
| `BOARD_SOURCE_URL` | raw.githubusercontent…/pools.json | Where `/api/board` reads the live manifest from. Unset = the default constant in `src/app/api/board/route.ts`. |
| `NEXT_PUBLIC_CHAIN_ID` | `8453` | Base mainnet. |
| `NEXT_PUBLIC_BASE_RPC_URL` | `https://base-rpc.publicnode.com` | Public RPC. `mainnet.base.org` rate-limits `eth_getLogs`; publicnode works. Use a paid endpoint (Alchemy/QuickNode) if you expect volume. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | `41ec…33d9` | From cloud.reown.com. **Without it the QR/deep-link flow stays disabled** and only injected + Coinbase Wallet work. |
| `NEXT_PUBLIC_SITE_URL` | `https://app.yourdomain.com` | Absolute origin. Used for `metadataBase` (OG images) and the WalletConnect metadata `appUrl`. Must match the domain you actually serve. |
| `NEXT_PUBLIC_ARENA_DEPLOY_BLOCK` | `52935381` | First block to scan for `PoolCreated`. Around the deployment block of the contract. |

### Optional

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | Only needed if you keep the testnet chain in the wallet picker. |
| `NEXT_PUBLIC_AI_DEBATE` | `1` to render the AI debate surfaces. Generator runs server-side; the browser never calls a model. |
| `ALLOWED_DEV_ORIGINS` | Comma-separated hosts for Next's dev-only cross-origin check. Irrelevant to production. |

### Server-only (never prefixed with `NEXT_PUBLIC_`)

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | Used by `scripts/gen-market.ts` **on the ops box**, not on Vercel. Do not add it to the hosting dashboard unless you plan to run generation there — the site does not need it. |
| `BASESCAN_API_KEY` | Contract verification only. |

> Anything prefixed `NEXT_PUBLIC_` is inlined into the client bundle. Never put a private key, an
> API secret, or a seed phrase behind that prefix.

---

## 3. Domain

1. **Pick the origin.** `app.<yourdomain>.com` keeps the marketing root free for a landing page.
   A `*.vercel.app` host works for staging but WalletConnect will show it in the QR metadata, so set
   `NEXT_PUBLIC_SITE_URL` to the custom domain once it is live.
2. **Add the domain** in the platform (Project → Settings → Domains), then create the DNS records it
   prints (`A`/`CNAME` for the apex, `CNAME` for subdomains). TLS is issued automatically.
3. **Redirect the bare domain.** Point `yourdomain.com` → `app.yourdomain.com` with a 308 so links
   never split across two origins.
4. **Preserve headers for the wallet flows.** If you front the app with your own CDN, pass through
   `Permissions-Policy` and keep `Cross-Origin-Opener-Policy: same-origin-allow-popups` — several
   wallet popups break under stricter COOP settings.
5. **Set `NEXT_PUBLIC_SITE_URL` to the final domain and redeploy.** It is inlined at build time, so
   changing it later requires a rebuild, not just an env edit.

### The production domain: predictionarena.online

Registrar NS point at Cloudflare (`alaric.ns.cloudflare.com`, `bristol.ns.cloudflare.com`), so every
record lives in the Cloudflare zone — Render only ever sees the origin it was given.

| Type | Name | Value | Proxy |
|---|---|---|---|
| `A` | `@` (root) | the Render origin's IPv4 (or `CNAME` flattening to `prediction-arena-81d9.onrender.com`) | Proxied |
| `CNAME` | `www` | `prediction-arena-81d9.onrender.com` | Proxied |

Cloudflare flattens a root `CNAME` to an `A` record, so either form works for the apex; the flat
`CNAME` keeps the value readable if Render's anycast IPs change. Proxying is safe for WalletConnect
as long as the proxy does not buffer or rewrite `/.well-known/walletconnect.txt` (it is served
`no-store`, `text/plain`, so a plain "DNS only" record on that name is never needed).

On the platform side both hostnames are added under Settings → Custom Domains:

- `predictionarena.online` (primary)
- `www.predictionarena.online` (redirects to the apex with a 308 so links never split origins)

Verification for this domain:

```
dig +short NS predictionarena.online          # alaric / bristol
dig +short www.predictionarena.online         # resolves to a Render edge
curl -sI https://predictionarena.online | head -3
curl -s  https://predictionarena.online/.well-known/walletconnect.txt
curl -sA 'Twitterbot/1.0' https://predictionarena.online/market/1 | grep -o 'og:url[^>]*'
```

### Verifying after the first deploy

```
curl -sI https://<domain>/ | grep -i -E 'content-type|strict-transport'
curl -s  https://<domain>/manifest.json | head -20        # PWA manifest must be 200 JSON
curl -sI https://<domain>/sw.js                           # 200, application/javascript
curl -sI https://<domain>/icon-512.png                    # 200 image/png
curl -s  https://<domain>/pools.json  | head -5           # market manifest
```

Then, in a real browser:

1. **Desktop**: connect a wallet, open a market, confirm the slider reads 50 – 10,000 USDC and the
   network indicator says Base.
2. **Mobile browser**: open the same URL, tap *Place Prediction* → the bottom sheet must slide up.
3. **Add to Home Screen**: iOS Safari *Share → Add to Home Screen*, Android Chrome *⋮ → Install app*.
   It must open full-screen (no browser chrome), icon = the gold shield.
4. **Wallet in-app browsers**: open the URL inside MetaMask / Coinbase Wallet / OKX. `window.ethereum`
   is injected there, so the connect button works without WalletConnect at all.
5. **WalletConnect QR**: desktop click *Connect* → WalletConnect → scan with a phone wallet. This is
   the path that requires `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to be set at build time; if the QR
   is missing, that variable did not reach the build.

---

## 4. Contract-side prerequisites

- The contract address in `NEXT_PUBLIC_ARENA_ADDRESS` must be verified on Basescan, otherwise users
  cannot audit what they are signing.
- `owner` is currently the deployer EOA. Before real money, transfer ownership to a Safe:
  `arena.transferOwnership(<safe>)`.
- The ops daemon (`scripts/ops-daemon.sh`) must run somewhere with the fee-wallet key — **not** on the
  hosting platform. A separate small VPS plus `crontab` entry:
  `0 * * * * cd /path/to/repo && bash scripts/ops-daemon.sh >> logs/cron.log 2>&1`
- If you want the site to update automatically when the daemon opens a market, the public
  `pools.json` must be rewritten on the host that serves them. On Vercel the app is
  immutable, so either:
  - run the daemon against the same repo and redeploy (`vercel --prod`) after a new market, or
  - host `pools.json` in object storage and point the fetch there, or
  - keep the built-in 60s polling and accept that new markets appear after the next deploy.

---

## 5. Post-deploy smoke test (copy/paste)

```bash
DOMAIN=https://app.yourdomain.com
for p in / /docs /docs/security /manifest.json /sw.js /pools.json /icon-512.png /covers/crypto.jpg; do
  printf "%-24s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$DOMAIN$p")"
done
```

Every line must read `200`. A `404` on `pools.json` means `public/` was not copied —
check the output directory setting. A `404` on `sw.js` means the service worker will never register
and the app will not be installable.
