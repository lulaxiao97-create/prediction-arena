/**
 * Trade CTA resolution.
 *
 * Pulled out of the component so the ordering of blockers is testable without a browser or a
 * wallet. Order matters: "connect a wallet" outranks "no USDC" (we cannot read a balance without
 * an address), and "no USDC at all" outranks "insufficient for this amount" because the remedies
 * differ — one is a deposit, the other is a smaller size.
 */
export type TradeGuardReason =
  | "ok"
  | "no-wallet"
  | "wrong-chain"
  | "demo"
  | "empty-amount"
  | "no-usdc"
  | "insufficient-usdc"
  | "no-gas"
  | "above-cap"
  | "below-min";

/** 0.00002 ETH — ~13 bet() calls at 0.01 gwei. Below this a wallet cannot transact reliably. */
export const GAS_FLOOR = 20_000_000_000_000n;

export function resolveTradeGuard(input: {
  address?: string | null;
  wrongChain?: boolean;
  live?: boolean;
  usdcBalance?: bigint;
  ethBalance?: bigint;
  amount: bigint;
  cap: bigint;
  minBet: bigint;
  gasFloor?: bigint;
}): TradeGuardReason {
  const { address, wrongChain, live, usdcBalance, ethBalance, amount, cap, minBet } = input;
  const gasFloor = input.gasFloor ?? GAS_FLOOR;

  if (!address) return "no-wallet";
  if (wrongChain) return "wrong-chain";
  if (!live) return "demo";
  if (amount === 0n) return "empty-amount";

  // Only assert what we actually know: an unread balance must not block a trade.
  if (usdcBalance !== undefined && usdcBalance === 0n) return "no-usdc";
  if (usdcBalance !== undefined && amount > usdcBalance) return "insufficient-usdc";
  if (ethBalance !== undefined && ethBalance < gasFloor) return "no-gas";

  if (amount > cap) return "above-cap";
  if (amount < minBet) return "below-min";
  return "ok";
}

/** Quick-size chips scale with the live cap so a raised cap is actually reachable in one tap. */
export function quickAmountsFor(cap: bigint): number[] {
  const base = [5, 10, 25, 50];
  const usdc = (n: number) => BigInt(n) * 1_000_000n;
  if (cap >= usdc(500)) return [...base, 100, 250, 500];
  if (cap >= usdc(100)) return [...base, 100];
  return base;
}
