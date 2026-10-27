# Security policy

Prediction Arena escrows real USDC on Base mainnet. Reports that put user funds at risk are the
highest priority, and they are handled privately until a fix is live on chain.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private channel:

1. Go to the **Security** tab of this repository → **Report a vulnerability**
   (`/security/advisories/new`). This opens a private advisory visible only to maintainers.

Include what you can: the affected function, a failing test or a scripted reproduction, the funds at
risk (a number, not a category), and the preconditions (who must hold which role, what state a market
must be in).

## In scope

| Target | Detail |
|---|---|
| `contracts/PredictionArena.sol` | deployed at [`0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5`](https://basescan.org/address/0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5) on Base mainnet (chain id 8453) |
| `frontend/` | transaction construction, approval targets, signature and RPC handling |
| `scripts/` | deploy, seed, settle and ops automation |

## Out of scope

- Gas optimisation and compiler-version preferences with no security impact.
- Rate limiting, caching and availability of public RPC endpoints, and behaviour of third-party
  wallets (Rainbow, MetaMask, Coinbase Wallet, WalletConnect).
- Market *outcomes*. Resolution is an operator statement about the world, backed by an evidence hash;
  disputing a verdict is a governance question, not a vulnerability.
- Issues that require a compromised operator key or a malicious owner. The owner can pause new
  markets and settle them — that is the documented trust model, not a bug. Note, however, that
  `emergencyRefund()` is permissionless after `EMERGENCY_REFUND_DELAY` (30 days), so an operator that
  goes silent cannot trap collateral forever.

## What to expect

- Acknowledgement within 72 hours.
- A written assessment — accepted, or a concrete reason for rejection — before any public write-up.
- Credit in the advisory and in the repository history if you want it.

Please do not test against mainnet in ways that move other users' funds. Fork Base at the deploy block
(`52935381`) and prove the issue there; `scripts/seed-fork-demo.ts` shows the pattern.
