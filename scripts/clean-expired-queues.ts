/**
 * TTL garbage collection for everything that can be *sent* somewhere.
 *
 * The failure this exists for: a market ends, the copy that advertises it does not. It sits in the
 * daily funnel, in the reply queue, in the desktop pack and in the hot board, and every one of those
 * paths will happily publish "ends in 2h" twenty-six hours after it ended. Nobody notices because
 * each consumer only looks at its own file.
 *
 * Sources of truth, in order:
 *   1. `logs/ops-refresh.json` — on-chain `endTime` + `status` for every pool we know about, written
 *      by the ops tick. Authoritative.
 *   2. `frontend/public/pools.json` — the manifest, for ids the chain read never saw (demo rows).
 *
 * What it does, per run:
 *   · drops reply jobs older than JOB_TTL (2h) or pointing at a dead market
 *   · rewrites the daily funnel if its market died (through funnel-copy.ts, so the copy stays generated)
 *   · rewrites the desktop pack if its flagship market died (through push-desktop-marketing.ts)
 *   · rewrites the hot board so the "top 3" only ever contains live, unsettled markets
 *   · reports pools that ended >24h ago and are still unsettled — those need a human, not a filter
 *
 *   bun scripts/clean-expired-queues.ts            # collect + print
 *   bun scripts/clean-expired-queues.ts --dry      # report only, touch nothing
 *   bun scripts/clean-expired-queues.ts --json     # machine-readable summary on stdout
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const REFRESH = join(ROOT, "logs", "ops-refresh.json");
const MANIFEST = join(ROOT, "frontend", "public", "pools.json");
const QUEUE = join(ROOT, ".data", "intercept", "reply-queue");
const FUNNEL = join(ROOT, ".data", "daily-funnel.txt");
const FUNNEL_CN = join(ROOT, ".data", "daily-funnel-cn.txt");
const HOT = join(ROOT, ".data", "hot.json");
const PACK = join(ROOT, "marketing", "PredictionArena_Marketing");
const REPORT = join(ROOT, ".data", "clean-report.json");
const BUN = process.env.BUN ?? join(process.env.HOME ?? ".", ".bun", "bin", "bun");

const JOB_TTL_MS = Number(process.env.JOB_TTL_MIN ?? 120) * 60_000;
/** Settled-but-unsettled grace: a pool that has been over for this long is an ops bug, not noise. */
const UNSETTLED_ALARM_MS = 24 * 3600_000;

const dry = process.argv.includes("--dry");
const asJson = process.argv.includes("--json");

type ChainPool = { id: string; title?: string; status: number; endTime: number };
type ManifestPool = { id: string | number; title?: string; status?: number; endTimeUtc?: string };

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** id → { dead: why it cannot be advertised any more } */
function expiryMap(): { dead: Map<string, string>; unsettled: { id: string; hours: number }[] } {
  const nowSec = Math.floor(Date.now() / 1000);
  const dead = new Map<string, string>();
  const unsettled: { id: string; hours: number }[] = [];

  const chain = readJson<{ pools?: ChainPool[] }>(REFRESH, {}).pools ?? [];
  for (const p of chain) {
    if (Number(p.status) !== 1) {
      dead.set(String(p.id), `status=${p.status}`);
      continue;
    }
    if (Number(p.endTime) <= nowSec) {
      const hours = Math.round((nowSec - Number(p.endTime)) / 3600);
      dead.set(String(p.id), `ended ${hours}h ago`);
      if (nowSec - Number(p.endTime) > UNSETTLED_ALARM_MS / 1000) unsettled.push({ id: String(p.id), hours });
    }
  }

  // Manifest rows the chain read did not cover (demo ids): trust their own endTimeUtc.
  const manifest = readJson<{ pools?: ManifestPool[] }>(MANIFEST, {}).pools ?? [];
  for (const p of manifest) {
    const id = String(p.id);
    if (dead.has(id)) continue;
    if ((p.status ?? 1) !== 1) {
      dead.set(id, `status=${p.status}`);
      continue;
    }
    const end = p.endTimeUtc ? Date.parse(p.endTimeUtc) : NaN;
    if (Number.isFinite(end) && end <= Date.now()) {
      dead.set(id, `ended ${Math.round((Date.now() - end) / 3600_000)}h ago`);
    }
  }
  return { dead, unsettled };
}

/** The market a piece of copy talks about: `/market/<id>` or the first pool id it mentions. */
function marketOf(text: string): string | null {
  const link = text.match(/\/market\/(\d+)/);
  if (link) return link[1];
  return null;
}

function run(cmd: string[]): { ok: boolean; out: string } {
  if (dry) return { ok: true, out: "(dry) would run " + cmd.join(" ") };
  const p = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  return { ok: p.exitCode === 0, out: (p.stdout.toString() + p.stderr.toString()).trim().split("\n").slice(-2).join(" · ") };
}

const { dead, unsettled } = expiryMap();
const actions: { kind: string; target: string; reason: string }[] = [];

// ── 1. reply queue ────────────────────────────────────────────────────────────────────────────
let droppedJobs = 0;
if (existsSync(QUEUE)) {
  for (const name of readdirSync(QUEUE)) {
    if (!name.endsWith(".json")) continue;
    const path = join(QUEUE, name);
    const job = readJson<{ queuedAt?: string; text?: string; marketId?: string | null } | null>(path, null);
    const reason = (() => {
      if (!job) return "unreadable";
      const age = Date.now() - Date.parse(job.queuedAt ?? "");
      if (Number.isFinite(age) && age > JOB_TTL_MS) return `queued ${Math.round(age / 60_000)}m ago (> ${JOB_TTL_MS / 60_000}m)`;
      const id = job.marketId || marketOf(job.text ?? "");
      if (id && dead.has(id)) return `market ${id} ${dead.get(id)}`;
      return null;
    })();
    if (reason) {
      droppedJobs += 1;
      actions.push({ kind: "reply-queue", target: name, reason });
      if (!dry) {
        try {
          unlinkSync(path);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

// ── 2. daily funnel ──────────────────────────────────────────────────────────────────────────
for (const file of [FUNNEL, FUNNEL_CN]) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  const id = marketOf(text);
  if (id && dead.has(id)) {
    const r = run([BUN, "scripts/funnel-copy.ts"]);
    actions.push({ kind: "funnel", target: file.split("/").pop()!, reason: `market ${id} ${dead.get(id)} → rebuilt ${r.ok ? "ok" : "FAILED"}` });
  }
}

// ── 3. desktop pack flagship ─────────────────────────────────────────────────────────────────
for (const name of ["01-main-tweet.txt", "01-main-tweets.txt"]) {
  const file = join(PACK, name);
  if (!existsSync(file)) continue;
  const id = marketOf(readFileSync(file, "utf8"));
  if (id && dead.has(id)) {
    const r = run([BUN, "scripts/push-desktop-marketing.ts"]);
    actions.push({ kind: "pack", target: name, reason: `market ${id} ${dead.get(id)} → rebuilt ${r.ok ? "ok" : "FAILED"}` });
    break; // one rebuild is enough, both files come from the same run
  }
}

// ── 4. hot board: keep only live pools, and cap the published shortlist at 3 ─────────────────
const hot = readJson<{ hot?: { id: string | number; title?: string }[] }>(HOT, {});
const deadInHot = (hot.hot ?? []).filter((p) => dead.has(String(p.id)));
if (deadInHot.length) {
  const r = run([BUN, "scripts/hot-board.ts"]);
  actions.push({
    kind: "hot-board",
    target: "hot.json",
    reason: `${deadInHot.map((p) => p.id).join(",")} dead → rebuilt ${r.ok ? "ok" : "FAILED"}`,
  });
}

// The "top 3" the queues work from. Written every run so downstream never has to re-derive it.
const top3 = (readJson<{ hot?: { id: string | number; title?: string; heat?: number }[] }>(HOT, {}).hot ?? [])
  .filter((p) => !dead.has(String(p.id)))
  .slice(0, 3);
if (!dry) {
  mkdirSync(join(ROOT, ".data"), { recursive: true });
  writeFileSync(join(ROOT, ".data", "hot-3.json"), JSON.stringify({ at: new Date().toISOString(), top: top3 }, null, 2) + "\n");
  writeFileSync(
    REPORT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        deadMarkets: dead.size,
        unsettledOver24h: unsettled,
        droppedJobs,
        top3: top3.map((p) => p.id),
        actions,
      },
      null,
      2,
    ) + "\n",
  );
}

const summary = {
  at: new Date().toISOString(),
  deadMarkets: dead.size,
  deadSample: [...dead.entries()].slice(0, 5).map(([id, why]) => `${id}: ${why}`),
  unsettledOver24h: unsettled,
  droppedJobs,
  top3: top3.map((p) => ({ id: String(p.id), title: p.title })),
  actions,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`clean · dead markets ${dead.size} · dropped jobs ${droppedJobs} · actions ${actions.length}`);
  for (const a of actions) console.log(`  ${a.kind}: ${a.target} — ${a.reason}`);
  console.log(`  top 3 live: ${top3.map((p) => p.id).join(", ") || "(none)"}`);
  if (unsettled.length) {
    console.log(`  ⚠ ${unsettled.length} pool(s) ended >24h ago and are still unsettled: ${unsettled.map((u) => `${u.id} (${u.hours}h)`).join(", ")}`);
  }
}
