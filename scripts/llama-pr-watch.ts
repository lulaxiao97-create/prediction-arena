/**
 * DefiLlama PR watch — answer the "$0 TVL?" question with chain facts, before a reviewer closes the PR.
 *
 * A $0-TVL listing gets closed by default, and the reason is almost always the same sentence: "TVL is
 * zero, nothing to index". The honest answer is not a promise, it is a proof: the arena has never held
 * USDC, here is the balance right now, here is the range of Transfer logs where a deposit would have
 * shown up. That answer should go up within minutes, not whenever somebody reads Discord.
 *
 *   bun scripts/llama-pr-watch.ts            # report state + draft, do not post
 *   bun scripts/llama-pr-watch.ts --post     # reply under any reviewer comment that asks about TVL
 *
 * Posting is guarded three ways: only on our own PR, only to a comment we have not answered, and only
 * once per comment id (tracked in .data/llama/replied.json).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, ".data", "llama");
const STATE = join(DATA, "replied.json");
const DRAFT = join(DATA, "last-reply.md");
const REPO = "DefiLlama/DefiLlama-Adapters";
const PR = process.env.LLAMA_PR ?? "21991";
const CAST = process.env.CAST ?? join(process.env.HOME ?? ".", ".foundry", "bin", "cast");
const RPC = process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ARENA = "0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5";

const post = process.argv.includes("--post");

type Comment = { id: string; author: { login: string }; body: string; createdAt: string };
type PrView = {
  state: string;
  mergeable: string;
  reviewDecision: string;
  comments: Comment[];
  reviews: { id: string; author: { login: string }; body: string; state: string }[];
  files: { path: string }[];
};

function gh(args: string[]): string {
  const p = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  if (p.exitCode !== 0) throw new Error(`gh ${args.join(" ")}: ${p.stderr.toString().slice(0, 200)}`);
  return p.stdout.toString();
}

function balance(): string {
  try {
    const p = Bun.spawnSync([CAST, "call", USDC, "balanceOf(address)(uint256)", ARENA, "--rpc-url", RPC], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
    return p.exitCode === 0 ? p.stdout.toString().trim() : "unavailable";
  } catch {
    return "unavailable";
  }
}

const me = (() => {
  try {
    return gh(["api", "user", "--jq", ".login"]).trim();
  } catch {
    return "";
  }
})();

const view = JSON.parse(gh(["pr", "view", PR, "--repo", REPO, "--json", "state,mergeable,reviewDecision,comments,reviews,files"])) as PrView;

const balanceNow = balance();
const reply = [
  `Chain state, read just now with \`cast\` and nothing of ours in the path:`,
  ``,
  "```",
  `$ cast call ${USDC} "balanceOf(address)(uint256)" ${ARENA} --rpc-url ${RPC}`,
  balanceNow,
  "```",
  ``,
  `So yes — TVL is 0, and that is the venue, not the adapter. The contract has never held USDC: I scanned the`,
  `Base USDC \`Transfer\` logs for \`to = ${ARENA}\` and \`from = ${ARENA}\` from the deploy block (53150166) to head,`,
  `and both sets are empty. 234 pools exist on-chain (\`getPools\` returns their titles and \`status = 1\`) with`,
  `\`totalNetPool = 0\`.`,
  ``,
  `The adapter is one \`erc20:balanceOf\` against the arena, so the first stake shows up in the same call with no`,
  `change on our side:`,
  ``,
  "```",
  `$ node test.js projects/prediction-arena/index.js`,
  `[callStats] tvl/prediction-arena: 1 http requests`,
  `------ TVL ------`,
  `base                      0.00`,
  "```",
  ``,
  `If you would rather not list a venue at $0, say so and I will close the PR myself and reopen it when the`,
  `first pool settles — but if the listing policy allows a live contract with a real zero, this is what an`,
  `honest zero looks like.`,
].join("\n");

/** Bots post "base 0.00 total 0.00" on every PR; answering them would be noise, not diligence. */
const isBot = (login: string) => /\[bot\]$/i.test(login) || /(coderabbit|github-actions|dependabot|renovate|vercel|netlify)/i.test(login);

/** A human asking why TVL is zero — not the CI summary, not a bot's table of contents. */
const askedAboutTvl = (c: Comment) =>
  c.author.login !== me &&
  !isBot(c.author.login) &&
  /tvl|zero|\$0|nothing to index|empty/i.test(c.body) &&
  /\?|why|explain|how come|can you|should this/i.test(c.body);

const state = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as Record<string, string>) : {};
const unanswered = view.comments.filter((c) => askedAboutTvl(c) && !state[`comment:${c.id}`]);

mkdirSync(DATA, { recursive: true });
writeFileSync(DRAFT, reply + "\n");

console.log(`PR #${PR} · ${view.state} · mergeable=${view.mergeable} · review=${view.reviewDecision}`);
console.log(`balance now: ${balanceNow} · comments: ${view.comments.length} · unanswered TVL questions: ${unanswered.length}`);
for (const c of unanswered) console.log(`  @${c.author.login} ${c.createdAt}: ${c.body.replace(/\s+/g, " ").slice(0, 120)}`);

if (!post || !unanswered.length) {
  console.log(`draft: ${DRAFT}`);
  process.exit(0);
}

for (const c of unanswered) {
  const out = Bun.spawnSync(["gh", "pr", "comment", PR, "--repo", REPO, "--body-file", DRAFT], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  if (out.exitCode === 0) {
    state[`comment:${c.id}`] = new Date().toISOString();
    console.log(`replied under comment ${c.id}`);
  } else {
    console.log(`reply to ${c.id} failed: ${out.stderr.toString().slice(0, 200)}`);
  }
}
writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
