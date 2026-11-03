/**
 * Close out pools whose endTime has passed and that were never settled.
 *
 * The contract decides what is possible here, and it decides it in one line:
 *
 *     if (optionPool[poolId][winningOption] == 0) revert NoWinningStake(winningOption);
 *
 * So a pool nobody staked cannot be *settled* — there is no winning side to pay, and naming one anyway
 * would put a fake result on a public record. What such a pool CAN do is be voided by the owner
 * (`cancelPool`), which marks it Canceled, keeps every refund whole and releases no rake. That is the
 * honest way to clear a stale market: "voided, no resolution", never "settled, we guessed".
 *
 * Two modes, chosen per pool from chain state, not from a config file:
 *   · settle  — only if one option actually holds stake AND a real outcome is supplied with
 *               `--result=<poolId>:<0|1>:<ipfsCid>`. Without a CID argument the script refuses.
 *   · cancel  — both sides empty. This is what the four stale sports/Degen pools need today.
 *
 *   bun scripts/settle-expired.ts                      # dry run: what it would do, per pool
 *   bun scripts/settle-expired.ts --execute            # send the transactions
 *   bun scripts/settle-expired.ts --execute --result=123456:1:bafy...
 *
 * Evidence: every decision writes a bundle to tmp/evidence/<poolId>.json (title, rule, on-chain
 * snapshot, timestamp, what was decided and why) and prints its sha256 so the record is auditable even
 * though a cancel needs no on-chain hash.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const REFRESH = join(ROOT, "logs", "ops-refresh.json");
const EVIDENCE = join(ROOT, "tmp", "evidence");
const REPORT = join(ROOT, "logs", "settle-expired.json");
const ARENA = process.env.ARENA_ADDRESS ?? "0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5";
const RPC = process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com";
const CAST = process.env.CAST ?? join(process.env.HOME ?? ".", ".foundry", "bin", "cast");

const execute = process.argv.includes("--execute");
const results = new Map<string, { option: number; cid: string }>();
for (const arg of process.argv.filter((a) => a.startsWith("--result="))) {
  const [id, option, cid] = arg.slice("--result=".length).split(":");
  if (id && option !== undefined && cid) results.set(id, { option: Number(option), cid });
}

type Pool = { id: string; title: string; status: number; endTime: number; netPoolUsdc: string };

function cast(args: string[]): { ok: boolean; out: string } {
  const p = Bun.spawnSync([CAST, ...args, "--rpc-url", RPC], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  return { ok: p.exitCode === 0, out: (p.stdout.toString() + p.stderr.toString()).trim() };
}

const nowSec = Math.floor(Date.now() / 1000);
const refresh = JSON.parse(readFileSync(REFRESH, "utf8")) as { pools?: Pool[] };
const stale = (refresh.pools ?? []).filter((p) => Number(p.status) === 1 && Number(p.endTime) < nowSec);

if (!stale.length) {
  console.log("no expired-and-open pools — nothing to do");
  process.exit(0);
}

mkdirSync(EVIDENCE, { recursive: true });
const decisions: Record<string, unknown>[] = [];
let failures = 0;

for (const p of stale) {
  const hours = Math.round((nowSec - Number(p.endTime)) / 3600);
  const view = cast(["call", ARENA, "getPools(uint256[])((string,string,uint64,uint8,uint8,uint256,uint256,uint256,bytes32)[])", `[${p.id}]`]);
  // The tuple comes back as (title, category, endTime, winningOption, status, totalNetPool, o0, o1, hash).
  const nums = view.out.match(/\b\d+\b/g) ?? [];
  const option0 = Number(nums[6] ?? 0);
  const option1 = Number(nums[7] ?? 0);
  const staked = option0 > 0 || option1 > 0;
  const supplied = results.get(p.id);

  const action = staked ? (supplied ? "settle" : "refuse") : "cancel";
  const why = staked
    ? supplied
      ? `option ${supplied.option} holds stake and a result+Cid was supplied`
      : "stake exists but no verified result was supplied — refusing to invent one"
    : "both sides empty: settle() would revert NoWinningStake, so the pool is voided instead";

  const bundle = {
    poolId: p.id,
    title: p.title,
    endTime: p.endTime,
    endedHoursAgo: hours,
    onChain: { option0, option1, raw: view.out.slice(0, 400) },
    action,
    why,
    decidedAt: new Date().toISOString(),
    note:
      action === "cancel"
        ? "Voided. No stake was ever placed, so there is no winner to pay and no result is being asserted."
        : action === "settle"
          ? "Settled with the supplied result; Cid points at the resolution evidence bundle."
          : "Nothing was sent. A pool with stake may only be closed against real evidence.",
  };
  const path = join(EVIDENCE, `${p.id}.json`);
  writeFileSync(path, `${JSON.stringify(bundle, null, 2)}\n`);
  const sha = new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

  console.log(`\n${p.id} · ${p.title.slice(0, 62)}`);
  console.log(`  ended ${hours}h ago · option0=${option0} option1=${option1} → ${action.toUpperCase()}`);
  console.log(`  ${why}`);
  console.log(`  evidence: ${path} sha256=${sha.slice(0, 16)}…`);

  if (!execute || action === "refuse") {
    decisions.push({ id: p.id, action, applied: false, sha });
    if (action === "refuse") failures += 1;
    continue;
  }

  if (action === "cancel") {
    const tx = cast(["send", ARENA, "cancelPool(uint256)", p.id, "--private-key", process.env.PRIVATE_KEY ?? ""]);
    const ok = tx.ok && /status\s+1|Transaction hash/i.test(tx.out);
    console.log(`  ${ok ? "✓ canceled" : "✗ cancel failed"}: ${tx.out.split("\n").slice(-2).join(" ").slice(0, 160)}`);
    decisions.push({ id: p.id, action, applied: ok, sha, tx: tx.out.slice(0, 120) });
    if (!ok) failures += 1;
  } else if (action === "settle" && supplied) {
    // A CID is a multihash string; the contract stores bytes32, so the Cid must be passed already
    // converted by the operator (cast accepts a 0x-prefixed 32-byte value).
    const tx = cast([
      "send",
      ARENA,
      "settle(uint256,uint8,bytes32)",
      p.id,
      String(supplied.option),
      supplied.cid,
      "--private-key",
      process.env.PRIVATE_KEY ?? "",
    ]);
    const ok = tx.ok && /status\s+1|Transaction hash/i.test(tx.out);
    console.log(`  ${ok ? "✓ settled" : "✗ settle failed"}: ${tx.out.split("\n").slice(-2).join(" ").slice(0, 160)}`);
    decisions.push({ id: p.id, action, applied: ok, sha, tx: tx.out.slice(0, 120) });
    if (!ok) failures += 1;
  }
}

if (execute) {
  writeFileSync(REPORT, `${JSON.stringify({ at: new Date().toISOString(), decisions }, null, 2)}\n`);
  console.log(`\nwrote ${REPORT}`);
}
console.log(`\n${stale.length} stale pool(s) · executed=${execute} · problems=${failures}`);
process.exit(failures > 0 && execute ? 1 : 0);
