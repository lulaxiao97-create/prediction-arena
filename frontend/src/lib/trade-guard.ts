/**
 * Trade CTA resolution.
 *
 * Pulled out of the component so the ordering of blockers is testable without a browser or a
 * wallet.
 *
 * **Balance and gas are deliberately not checked here.** A wallet with no USDC on Base can still
 * press the button: the transaction goes to the user's wallet, the wallet (or the node) is what
 * refuses an unaffordable `bet()`, and the user sees that prompt in the place that can actually fix
 * it. Gating the CTA on a client-side `balanceOf` made an empty wallet look like a broken venue and
 * blocked the one action — sending the transaction — that produces the real answer.
 *
 * What is left is what the front end genuinely knows before a signature: is there a wallet, is it
 * on the right chain, does this build hold a contract, and is the typed amount inside the
 * contract's own window.
 */
export type TradeGuardReason =
  | "ok"
  | "no-wallet"
  | "wrong-chain"
  | "demo"
  | "empty-amount"
  | "above-cap"
  | "below-min";

export function resolveTradeGuard(input: {
  address?: string | null;
  wrongChain?: boolean;
  live?: boolean;
  amount: bigint;
  cap: bigint;
  minBet: bigint;
}): TradeGuardReason {
  const { address, wrongChain, live, amount, cap, minBet } = input;

  if (!address) return "no-wallet";
  if (wrongChain) return "wrong-chain";
  if (!live) return "demo";
  if (amount === 0n) return "empty-amount";

  if (amount > cap) return "above-cap";
  if (amount < minBet) return "below-min";
  return "ok";
}

/**
 * Quick-size chips for the v2 window. Fixed ladder (50 → 10,000) filtered by the live cap, so a
 * pool that somehow reports a lower ceiling never offers an unclickable chip.
 */
export const QUICK_CHIPS = [50, 100, 500, 1_000, 5_000, 10_000] as const;

export function quickAmountsFor(cap: bigint): number[] {
  const usdc = (n: number) => BigInt(n) * 1_000_000n;
  return QUICK_CHIPS.filter((chip) => usdc(chip) <= cap);
}
