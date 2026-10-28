/**
 * Protocol documentation.
 *
 * Content lives here as structured blocks (not MDX) so it can be rendered inside the app,
 * localised, and type-checked. English and Traditional Chinese are written out in full; the
 * other four locales fall back to English with a notice in the UI.
 */
export type DocLang = "en" | "zh-TW";

export type DocBlock =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "callout"; tone: "info" | "warn" | "ok"; title: string; text: string }
  | { kind: "address"; label: string; value: string; note?: string }
  | { kind: "kv"; rows: [string, string][] };

export type DocSection = "getting-started" | "security" | "ai" | "economics";

export type Doc = {
  slug: string;
  section: DocSection;
  /** i18n key suffix used for the sidebar + breadcrumb label */
  key: string;
  title: Record<DocLang, string>;
  summary: Record<DocLang, string>;
  body: Record<DocLang, DocBlock[]>;
};

/** Single source of truth for the deployed arena. Follows .env.local so a redeploy cannot leave
 *  the docs pointing at a retired contract. */
export const ARENA_ADDRESS =
  (process.env.NEXT_PUBLIC_ARENA_ADDRESS as `0x${string}` | undefined) ??
  "0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5";
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const DOC_SECTIONS: { id: DocSection; emoji: string; labelKey: string }[] = [
  { id: "getting-started", emoji: "📌", labelKey: "docs.sectionGettingStarted" },
  { id: "security", emoji: "🛡️", labelKey: "docs.sectionSecurity" },
  { id: "ai", emoji: "🤖", labelKey: "docs.sectionAi" },
  { id: "economics", emoji: "💰", labelKey: "docs.sectionEconomics" },
];

const t = (en: string, zh: string) => ({ en, "zh-TW": zh });

export const DOCS: Doc[] = [
  {
    slug: "getting-started/overview",
    section: "getting-started",
    key: "overview",
    title: t("Overview & Vision", "協議概覽與願景"),
    summary: t(
      "What a binary prediction market is, and why settlement is the only thing that matters.",
      "什麼是二元預測市場，以及為什麼「結算」才是唯一關鍵。"
    ),
    body: {
      en: [
        {
          kind: "p",
          text: "Prediction Arena is a two-sided prediction market for binary questions. Every market has exactly two outcomes — Yes and No. Liquidity from both sides is pooled; when the market resolves, the winning side splits the entire net pool pro-rata by their stake.",
        },
        {
          kind: "p",
          text: "The protocol is deployed on Base Mainnet and settles in native USDC (6 decimals). There is no wrapper token, no share NFT, and no synthetic exposure: your USDC goes into the pool, and the pool pays out directly.",
        },
        { kind: "h2", text: "Why pari-mutuel instead of an order book" },
        {
          kind: "p",
          text: "An order book needs market makers and inventory risk. A pari-mutuel pool needs neither: the implied probability of an outcome is simply that side's share of the pool, and the payout multiple is total net pool divided by that side. This makes the market work from the very first deposit, which matters for long-tail questions.",
        },
        {
          kind: "list",
          items: [
            "Implied probability = side liquidity / total liquidity",
            "Payout multiple = total net pool / side net pool",
            "Fees are taken per ticket and escrowed per market — they never enter the pool",
            "Resolution is written on-chain as a bytes32 evidence hash, so every settlement is auditable after the fact",
          ],
        },
        {
          kind: "callout",
          tone: "info",
          title: "What this protocol is not",
          text: "It is not a decentralised oracle. The operator is the oracle at this stage (Phase 1), with a permissionless escape hatch if the operator disappears. Phase 3 replaces the operator with an on-chain resolution market — see Oracle & Settlement Roadmap.",
        },
        { kind: "h2", text: "Deployment" },
        {
          kind: "address",
          label: "Prediction Arena",
          value: ARENA_ADDRESS,
          note: "Base Mainnet · chainId 8453 · verified source",
        },
        { kind: "address", label: "Settlement token (USDC)", value: USDC_ADDRESS, note: "Native USDC on Base, 6 decimals" },
        {
          kind: "kv",
          rows: [
            ["Platform fee", "4.00% of every stake, escrowed per market"],
            ["Referral share", "30% of the fee (= 1.2% of stake)"],
            ["Minimum ticket", "5 USDC"],
            ["Per-ticket cap", "max(20% of the lighter side, 50 USDC)"],
            ["Emergency refund delay", "30 days after the close time"],
          ],
        },
      ],
      "zh-TW": [
        {
          kind: "p",
          text: "Prediction Arena 是一個二元預測市場協議。每個市場只有兩個結果 —— 是（Yes）與否（No）。兩側資金共同形成彩池，市場結算時，勝方按本金比例分得整個淨池。",
        },
        {
          kind: "p",
          text: "協議部署在 Base 主網，以原生 USDC（6 位小數）結算。沒有包裝代幣、沒有份額 NFT、沒有合成資產：你的 USDC 直接進入彩池，賠付也直接從彩池支付。",
        },
        { kind: "h2", text: "為什麼用同注分彩而非訂單簿" },
        {
          kind: "p",
          text: "訂單簿需要做市商與庫存風險，同注分彩兩者都不需要：某個結果的隱含機率就是該側資金佔比，賠付倍數就是淨池除以該側淨額。這讓市場從第一筆存款開始就能運作，對長尾問題尤其重要。",
        },
        {
          kind: "list",
          items: [
            "隱含機率 = 該側流動性 / 總流動性",
            "賠付倍數 = 淨池總額 / 該側淨額",
            "手續費逐筆抽取並按市場託管，永不進入彩池",
            "結算以 bytes32 證據雜湊寫入鏈上，事後任何人都能複核",
          ],
        },
        {
          kind: "callout",
          tone: "info",
          title: "這個協議不是什麼",
          text: "它目前不是去中心化預言機。第一階段由營運方擔任預言機，並提供「營運方消失時任何人可強制退款」的逃生通道。第三階段才會以鏈上結算市場取代營運方 —— 見「預言機與結算路線圖」。",
        },
        { kind: "h2", text: "部署資訊" },
        {
          kind: "address",
          label: "Prediction Arena",
          value: ARENA_ADDRESS,
          note: "Base 主網 · chainId 8453 · 原始碼已驗證",
        },
        { kind: "address", label: "結算代幣（USDC）", value: USDC_ADDRESS, note: "Base 原生 USDC，6 位小數" },
        {
          kind: "kv",
          rows: [
            ["平台手續費", "每筆本金的 4.00%，按市場託管"],
            ["推薦分成", "手續費的 30%（= 本金的 1.2%）"],
            ["最低注額", "5 USDC"],
            ["單筆上限", "max(較弱一側的 20%, 50 USDC)"],
            ["緊急退款延遲", "關盤後 30 天"],
          ],
        },
      ],
    },
  },

  {
    slug: "getting-started/quick-start",
    section: "getting-started",
    key: "quickstart",
    title: t("Quick Start Guide", "快速開始"),
    summary: t("Connect, take a position, claim — the full loop in three transactions.", "連接錢包、建立部位、領取獎金 —— 三筆交易走完全流程。"),
    body: {
      en: [
        { kind: "h2", text: "1 · Connect a wallet on Base" },
        {
          kind: "p",
          text: "Use any injected wallet, Coinbase Wallet, or WalletConnect. The app targets Base Mainnet (chainId 8453) and will prompt a network switch if you are elsewhere. You need USDC on Base for the position and a small amount of ETH for gas — Base gas is routinely below $0.01 per transaction.",
        },
        { kind: "h2", text: "2 · Pick a market and a side" },
        {
          kind: "p",
          text: "Open any market, choose Yes or No, and enter an amount. The trade panel recalculates implied probability, estimated shares, potential payout and the 4% fee as you type. Two limits apply:",
        },
        {
          kind: "list",
          items: [
            "Minimum ticket: 5 USDC",
            "Maximum per ticket: 20% of the lighter side, with a 50 USDC floor during bootstrap",
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          title: "Bootstrap phase",
          text: "While a market is thin, the bootstrap floor of 50 USDC is what makes the market tradeable at all — without it, 20% of a 22.5 USDC seed would be 4.5 USDC, below the 5 USDC minimum. This is why the panel advertises a 50 USDC cap.",
        },
        { kind: "h2", text: "3 · Approve + bet in one flow" },
        {
          kind: "p",
          text: "The app checks your USDC allowance first and only asks for an approval when it is short. The bet call then moves your stake into the pool and splits it in the same transaction:",
        },
        {
          kind: "code",
          lang: "text",
          code: `stake 50.00 USDC
  fee   2.00  (4%)      -> escrowed for this market
  net  48.00            -> added to your side's pool

if your side wins:
  payout = 48.00 x (total net pool / winning side net pool)`,
        },
        { kind: "h2", text: "4 · Claim after settlement" },
        {
          kind: "p",
          text: "Once the operator calls settle(outcome, evidenceHash), the winning side can pull its payout. Claims are pull-based and one-shot per wallet per market. If the market is cancelled instead, every position refunds 100% of the gross stake — fee included.",
        },
        {
          kind: "callout",
          tone: "ok",
          title: "Nothing expires",
          text: "Unclaimed winnings and refunds stay claimable forever. There is no deadline that can strand your funds.",
        },
      ],
      "zh-TW": [
        { kind: "h2", text: "1 · 在 Base 上連接錢包" },
        {
          kind: "p",
          text: "支援瀏覽器注入錢包、Coinbase Wallet 或 WalletConnect。應用目標為 Base 主網（chainId 8453），若你目前在其他網路會提示切換。你需要 Base 上的 USDC 作為本金，以及少量 ETH 支付 gas —— Base 每筆交易 gas 通常低於 0.01 美元。",
        },
        { kind: "h2", text: "2 · 選擇市場與方向" },
        {
          kind: "p",
          text: "打開任一市場，選擇「是」或「否」，輸入金額。交易面板會隨著輸入即時重算隱含機率、預估份額、潛在回報與 4% 手續費。有兩條限制：",
        },
        {
          kind: "list",
          items: ["最低注額：5 USDC", "單筆上限：較弱一側的 20%，啟動期下限 50 USDC"],
        },
        {
          kind: "callout",
          tone: "warn",
          title: "啟動階段",
          text: "市場訂單稀薄時，50 USDC 的啟動下限正是讓市場能交易的原因 —— 否則 22.5 USDC 種子的 20% 只有 4.5 USDC，低於 5 USDC 最低門檻。這就是面板顯示 50 USDC 上限的由來。",
        },
        { kind: "h2", text: "3 · 授權與下注一次完成" },
        {
          kind: "p",
          text: "應用會先檢查 USDC 授權額度，不足時才要求授權；接著在同一流程中把本金送入彩池並完成拆帳：",
        },
        {
          kind: "code",
          lang: "text",
          code: `本金 50.00 USDC
  手續費  2.00 (4%)   -> 按本市場託管
  淨額   48.00        -> 計入你那一側的彩池

若你那一側勝出：
  賠付 = 48.00 x (淨池總額 / 勝方淨額)`,
        },
        { kind: "h2", text: "4 · 結算後領取" },
        {
          kind: "p",
          text: "營運方呼叫 settle(outcome, evidenceHash) 後，勝方即可提取賠付。領取採 pull 模式，每個錢包在每個市場僅能領一次。若市場被取消，所有部位按本金 100% 退款（含手續費）。",
        },
        {
          kind: "callout",
          tone: "ok",
          title: "不會過期",
          text: "未領取的獎金與退款永久可領，不存在會讓資金卡住的期限。",
        },
      ],
    },
  },

  {
    slug: "security",
    section: "security",
    key: "securityOverview",
    title: t("Security Overview", "安全總覽"),
    summary: t("What has been hardened, what has been tested, and what is still trust.", "已加固什麼、已測試什麼、還有什麼屬於信任邊界。"),
    body: {
      en: [
        {
          kind: "p",
          text: "The deployed contract is a hardened revision. Three P0 findings from the internal audit were fixed before deployment, and the live bytecode was re-verified byte-for-byte against the audited source.",
        },
        {
          kind: "kv",
          rows: [
            ["Runtime code", "11,028 bytes on Base"],
            ["Compiler", "solc 0.8.20, optimizer 200 runs, evmVersion paris"],
            ["Source == deployment", "10 immutable slots differ, 0 unexplained bytes"],
            ["Unit + invariant tests", "27 passing"],
            ["Red-team scenarios", "11/11 blocked, 1 recovery path verified, 1 documented residual"],
            ["On-chain attack suite", "43 checks, 0 failures (fork against real bytecode)"],
          ],
        },
        { kind: "h2", text: "What is enforced on-chain" },
        {
          kind: "list",
          items: [
            "Every value-moving entry point is nonReentrant and follows checks-effects-interactions",
            "The bet token can never be rescued by anyone, including the owner — a compromised key cannot drain the pool through rescueERC20",
            "Fees are escrowed per market and only released by settle(); a cancelled market releases nothing",
            "A cancelled market refunds 100% of gross stake, so the platform cannot keep rake on a void",
            "Anyone may force a cancelled market 30 days after the close time if the operator disappears",
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          title: "Documented residual risk",
          text: "The owner is the oracle and may bet through a fresh wallet (address-based guard only blocks the owner address). This is a trust assumption, not a code hole — decentralising settlement is the only complete fix and is scheduled for Phase 3.",
        },
        { kind: "h2", text: "Where to read more" },
        {
          kind: "list",
          items: [
            "Hardened Contract Spec — the exact invariants and storage layout",
            "P0 Vulnerabilities Mitigation — F-01 / F-02 / F-03 in detail",
            "Emergency Escape Hatch — the 30-day permissionless refund path",
          ],
        },
        { kind: "h2", text: "Official channels (and how to spot an impostor)" },
        {
          kind: "list",
          items: [
            "X: @Predict065 — x.com/Predict065 is the only account. x.com/PredictionArena belongs to an unrelated sports-news account, and the retired @Pred_Arena is no longer ours.",
            "Telegram: @predictionarena_hq — t.me/predictionarena_hq is the only channel.",
            "GitHub: github.com/lulaxiao97-create/prediction-arena — the only source of truth for the deployed code.",
            "No admin, moderator or support agent will ever DM you first, ask for your seed phrase, or offer a private sale, airdrop claim or 'rescue' service.",
            "The contract address is 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5 on Base. Anything else is not this protocol.",
          ],
        },
      ],
      "zh-TW": [
        {
          kind: "p",
          text: "目前部署的是加固版合約。內部審計中的三個 P0 問題已在部署前修復，且鏈上字節碼已與受審計原始碼逐位元組核對。",
        },
        {
          kind: "kv",
          rows: [
            ["執行時字節碼", "Base 上 11,028 bytes"],
            ["編譯器", "solc 0.8.20，optimizer 200 runs，evmVersion paris"],
            ["原始碼 == 部署", "僅 10 個 immutable 槽不同，0 個無法解釋的差異"],
            ["單元與不變式測試", "27 項通過"],
            ["紅隊情境", "11/11 全部攔截、1 條恢復路徑驗證、1 項已知殘留"],
            ["鏈上攻擊測試", "43 項檢查 0 失敗（對真實字節碼 fork）"],
          ],
        },
        { kind: "h2", text: "鏈上強制執行的規則" },
        {
          kind: "list",
          items: [
            "所有涉及資金轉移的入口皆為 nonReentrant 且遵循 checks-effects-interactions",
            "賭注代幣任何人都無法救援，包含 owner —— 私鑰洩漏也無法透過 rescueERC20 抽乾彩池",
            "手續費按市場託管，只有 settle() 才釋放；取消盤不釋放任何手續費",
            "取消盤按本金 100% 退款，平台無法在作廢盤上留下抽水",
            "營運方消失時，任何人可在關盤 30 天後強制取消並解鎖退款",
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          title: "已知殘留風險",
          text: "owner 是預言機，且可透過全新錢包下注（地址檢查只擋 owner 地址）。這屬於信任假設而非程式漏洞 —— 唯一完整的解法是去中心化結算，已列入第三階段。",
        },
        { kind: "h2", text: "延伸閱讀" },
        {
          kind: "list",
          items: [
            "加固版合約規範 —— 完整不變式與儲存佈局",
            "P0 漏洞修復 —— F-01 / F-02 / F-03 詳解",
            "緊急逃生通道 —— 30 天無需許可的退款路徑",
          ],
        },
        { kind: "h2", text: "官方渠道（與辨識冒名者的方法）" },
        {
          kind: "list",
          items: [
            "X：@Predict065 —— 唯一帳號是 x.com/Predict065。x.com/PredictionArena 屬於一個無關的體育新聞帳號，舊的 @Pred_Arena 已停用。",
            "Telegram：@predictionarena_hq —— 唯一頻道是 t.me/predictionarena_hq。",
            "GitHub：github.com/lulaxiao97-create/prediction-arena —— 部署程式碼的唯一來源。",
            "任何管理員、版主或客服都不會主動私訊你、不會索要助記詞，也不會提供私募、空投領取或「救援」服務。",
            "合約地址是 Base 上的 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5，其餘皆非本協議。",
          ],
        },
      ],
    },
  },

  {
    slug: "security/hardened-contract",
    section: "security",
    key: "hardenedContract",
    title: t("Hardened Contract Spec", "加固版合約規範"),
    summary: t("Storage layout, invariants, and the exact solvency equation the contract must never break.", "儲存佈局、不變式，以及合約絕不能破壞的償付方程式。"),
    body: {
      en: [
        {
          kind: "address",
          label: "Verified contract",
          value: ARENA_ADDRESS,
          note: "Basescan-verified · solc 0.8.20 · optimizer 200 · paris",
        },
        { kind: "h2", text: "Money flow per ticket" },
        {
          kind: "code",
          lang: "text",
          code: `F  = floor(A x 400 / 10000)        // 4% rake on the gross stake A
R  = floor(F x 3000 / 10000)       // referral cut, 30% of the rake
Ad = F - R                          // platform cut
N  = A - F                          // credited to the option pool

pool.rakeAdmin            += Ad     // escrowed per market
poolReferral[poolId][kol] += R      // escrowed per market
optionPool[poolId][opt]   += N
totalNetPool              += N`,
        },
        {
          kind: "p",
          text: "Nothing is withdrawable while a market is open. That is precisely what makes a 100% refund on cancellation arithmetically possible: the full gross stake is still sitting in the contract, untouched.",
        },
        { kind: "h2", text: "Solvency invariant" },
        {
          kind: "code",
          lang: "text",
          code: `usdc.balanceOf(arena) >=
    SUM(pool.totalNetPool)                 // every open + settled market
  + SUM(unpaid rake escrow of open pools)
  + accumulatedAdminFees                   // released only by settle()
  + SUM(poolReferral[settled pools])       // claimable only after settle`,
        },
        {
          kind: "callout",
          tone: "ok",
          title: "Verified on a mainnet fork",
          text: "A mixed-state run (10 markets: open, settled, cancelled) ended with balance 473.040002 USDC against 473.040000 USDC owed — a 2 wei surplus from integer rounding. Rounding always favours the contract, never the claimant.",
        },
        { kind: "h2", text: "Payout formula" },
        {
          kind: "code",
          lang: "text",
          code: `payout = stake x totalNetPool / optionPool[winningOption]

// floor division, so SUM(payouts) <= totalNetPool always
// the residual dust (a few wei per market) is permanently locked`,
        },
        { kind: "h2", text: "Access control surface" },
        {
          kind: "kv",
          rows: [
            ["owner-only", "createPool, seedPool, settle, cancelPool, withdrawAdminFees, setFeeVault, rescueERC20"],
            ["permissionless", "bet, claimRewards, claimRefund, withdrawReferralFees, emergencyRefund"],
            ["never rescueable", "the USDC bet token (rescueERC20 reverts for it)"],
            ["owner cannot bet", "bet() reverts OwnerCannotBet — the oracle may not take positions from the owner address"],
          ],
        },
      ],
      "zh-TW": [
        {
          kind: "address",
          label: "已驗證合約",
          value: ARENA_ADDRESS,
          note: "Basescan 已驗證 · solc 0.8.20 · optimizer 200 · paris",
        },
        { kind: "h2", text: "每筆注單的資金流" },
        {
          kind: "code",
          lang: "text",
          code: `F  = floor(A x 400 / 10000)        // 對本金 A 抽 4%
R  = floor(F x 3000 / 10000)       // 推薦分成，手續費的 30%
Ad = F - R                          // 平台實收
N  = A - F                          // 計入選項池

pool.rakeAdmin            += Ad     // 按市場託管
poolReferral[poolId][kol] += R      // 按市場託管
optionPool[poolId][opt]   += N
totalNetPool              += N`,
        },
        {
          kind: "p",
          text: "市場進行中時，上述金額全部不可提取。這正是「取消盤可 100% 退款」在算術上成立的原因：整筆本金仍完整躺在合約裡。",
        },
        { kind: "h2", text: "償付不變式" },
        {
          kind: "code",
          lang: "text",
          code: `usdc.balanceOf(arena) >=
    Σ(pool.totalNetPool)                   // 所有進行中 + 已結算市場
  + Σ(未釋放的手續費託管)
  + accumulatedAdminFees                   // 僅由 settle() 釋放
  + Σ(poolReferral[已結算市場])             // 結算後才可提`,
        },
        {
          kind: "callout",
          tone: "ok",
          title: "已在主網 fork 驗證",
          text: "混合狀態測試（10 個市場：進行中、已結算、已取消）最終餘額 473.040002 USDC，應付 473.040000 USDC —— 2 wei 的整數捨入盈餘。捨入永遠有利於合約，不會有利於領取者。",
        },
        { kind: "h2", text: "賠付公式" },
        {
          kind: "code",
          lang: "text",
          code: `payout = stake x totalNetPool / optionPool[winningOption]

// 向下取整，因此 Σ(payouts) 永遠 <= totalNetPool
// 每個市場殘留數 wei 粉塵，永久鎖定`,
        },
        { kind: "h2", text: "權限邊界" },
        {
          kind: "kv",
          rows: [
            ["僅 owner", "createPool、seedPool、settle、cancelPool、withdrawAdminFees、setFeeVault、rescueERC20"],
            ["任何人可呼叫", "bet、claimRewards、claimRefund、withdrawReferralFees、emergencyRefund"],
            ["永不可救援", "USDC 賭注代幣（rescueERC20 對其直接 revert）"],
            ["owner 不可下注", "bet() 會 revert OwnerCannotBet —— 預言機不得以 owner 地址建立部位"],
          ],
        },
      ],
    },
  },

  {
    slug: "security/p0-mitigations",
    section: "security",
    key: "p0",
    title: t("P0 Vulnerabilities Mitigation", "P0 漏洞修復"),
    summary: t("F-01, F-02 and F-03 — what was broken, what changed, and how it is tested.", "F-01、F-02、F-03 —— 修了什麼、怎麼改、如何驗證。"),
    body: {
      en: [
        { kind: "h2", text: "F-01 · Oracle conflict of interest" },
        {
          kind: "p",
          text: "The owner is the oracle and was previously allowed to place bets. That is a guaranteed-profit loop: take a position, then declare the outcome that pays it. The patch blocks the owner address at the bet entry point (OwnerCannotBet) and, separately, the frontend never offers a position to the owner wallet.",
        },
        {
          kind: "code",
          lang: "solidity",
          code: `function bet(uint256 poolId, uint8 option, uint256 amount, address referrer)
    external nonReentrant
{
    if (msg.sender == owner()) revert OwnerCannotBet();
    ...
}`,
        },
        {
          kind: "callout",
          tone: "warn",
          title: "Residual",
          text: "This blocks the address, not sybils. A fresh wallet still works — the complete fix is decentralised resolution, not an address filter.",
        },
        { kind: "h2", text: "F-02 · Cancel rug (platform kept the rake)" },
        {
          kind: "p",
          text: "Cancellation used to refund only the net stake, so the 4% rake stayed with the platform. The fix moved the rake into per-market escrow: while a market is open nothing is withdrawable, so cancelling releases nothing and claimRefund pays stake + fee = 100% of gross.",
        },
        {
          kind: "code",
          lang: "solidity",
          code: `// claimRefund
refund = _stake[poolId][msg.sender][0] + _stake[poolId][msg.sender][1]
       + _feePaid[poolId][msg.sender];   // fee included -> 100% of gross`,
        },
        { kind: "p", text: "Red-team result: a 50 USDC position on a cancelled market refunds 50.000000 USDC; platform rake kept = 0.000000 USDC." },
        { kind: "h2", text: "F-03 · Operator disappearance froze funds" },
        {
          kind: "p",
          text: "If the operator key is lost, settle() can never be called and every position would be stuck forever. The fix is a permissionless escape hatch: 30 days after the close time, any address can void the market and unlock 100% refunds.",
        },
        {
          kind: "code",
          lang: "solidity",
          code: `uint256 eligibleAt = uint256(pool.endTime) + EMERGENCY_REFUND_DELAY; // 30 days
if (block.timestamp < eligibleAt) revert EmergencyTooEarly(eligibleAt);
_cancel(poolId);   // escrow stays untouched -> everyone refunds 100%`,
        },
        {
          kind: "kv",
          rows: [
            ["Before the window", "emergencyRefund reverts with EmergencyTooEarly(eligibleAt)"],
            ["After the window", "any address can void; every position refunds 100% of gross"],
            ["On a settled market", "reverts PoolNotOpen — a live result cannot be retro-voided"],
          ],
        },
        {
          kind: "callout",
          tone: "info",
          title: "Market-design consequence",
          text: "If a question's real outcome takes longer than 30 days to become known, the pool will be voided by the escape hatch. Long-horizon markets should either be split into shorter legs or settle before the window closes.",
        },
      ],
      "zh-TW": [
        { kind: "h2", text: "F-01 · 預言機利益衝突" },
        {
          kind: "p",
          text: "owner 同時是預言機，原本還被允許下注 —— 這是一個保證獲利的迴圈：先建立部位，再宣告會讓自己獲利的結果。修復後在 bet 入口直接攔截 owner 地址（OwnerCannotBet），前端也不再對 owner 錢包提供下注入口。",
        },
        {
          kind: "code",
          lang: "solidity",
          code: `function bet(uint256 poolId, uint8 option, uint256 amount, address referrer)
    external nonReentrant
{
    if (msg.sender == owner()) revert OwnerCannotBet();
    ...
}`,
        },
        {
          kind: "callout",
          tone: "warn",
          title: "殘留風險",
          text: "這裡擋的是地址，不是女巫。換一個新錢包依然可行 —— 完整解法是去中心化結算，而不是地址過濾。",
        },
        { kind: "h2", text: "F-02 · 取消盤抽水（平台留下手續費）" },
        {
          kind: "p",
          text: "原本取消盤只退淨本金，4% 手續費留在平台。修復後把手續費移入「按市場託管」：市場進行中任何金額都不可提取，因此取消時無任何手續費可釋放，claimRefund 退還本金 + 手續費 = 本金的 100%。",
        },
        {
          kind: "code",
          lang: "solidity",
          code: `// claimRefund
refund = _stake[poolId][msg.sender][0] + _stake[poolId][msg.sender][1]
       + _feePaid[poolId][msg.sender];   // 含手續費 -> 本金的 100%`,
        },
        { kind: "p", text: "紅隊結果：取消盤上 50 USDC 的部位退回 50.000000 USDC，平台留下的抽水為 0.000000 USDC。" },
        { kind: "h2", text: "F-03 · 營運方消失導致資金凍結" },
        {
          kind: "p",
          text: "若營運方私鑰遺失，settle() 永遠不會被呼叫，所有部位將永久卡住。修復方式是無需許可的逃生通道：關盤 30 天後，任何地址都能作廢該市場並解鎖 100% 退款。",
        },
        {
          kind: "code",
          lang: "solidity",
          code: `uint256 eligibleAt = uint256(pool.endTime) + EMERGENCY_REFUND_DELAY; // 30 天
if (block.timestamp < eligibleAt) revert EmergencyTooEarly(eligibleAt);
_cancel(poolId);   // 託管不動 -> 所有部位 100% 退款`,
        },
        {
          kind: "kv",
          rows: [
            ["未到窗口", "emergencyRefund 以 EmergencyTooEarly(eligibleAt) revert"],
            ["窗口之後", "任何地址可作廢，所有部位按本金 100% 退款"],
            ["已結算市場", "revert PoolNotOpen —— 已出結果的市場不能被追溯作廢"],
          ],
        },
        {
          kind: "callout",
          tone: "info",
          title: "對市場設計的影響",
          text: "若某個問題的真實結果需要超過 30 天才明朗，彩池會被逃生通道作廢。長週期市場應拆成較短的階段，或在窗口關閉前完成結算。",
        },
      ],
    },
  },

  {
    slug: "security/emergency-escape",
    section: "security",
    key: "escape",
    title: t("Emergency Escape Hatch", "緊急逃生通道"),
    summary: t("The 30-day permissionless refund: when it opens, what it does, and what it cannot do.", "30 天無需許可退款：何時開啟、做什麼、不能做什麼。"),
    body: {
      en: [
        {
          kind: "p",
          text: "emergencyRefund(poolId) is the protocol's dead-man switch. It exists because a prediction market that cannot be resolved is worse than one that is voided: void returns everyone's principal, whereas a frozen market returns nothing to anyone.",
        },
        { kind: "h2", text: "Preconditions" },
        {
          kind: "list",
          items: [
            "The market status must be Open (a settled or already-cancelled market reverts)",
            "block.timestamp >= endTime + 30 days",
            "No privilege required — any address, including one with no position",
          ],
        },
        { kind: "h2", text: "What it does" },
        {
          kind: "code",
          lang: "solidity",
          code: `function emergencyRefund(uint256 poolId) external {
    Pool storage pool = _pools[poolId];
    if (pool.status != PoolStatus.Open) revert PoolNotOpen(poolId);
    uint256 eligibleAt = uint256(pool.endTime) + EMERGENCY_REFUND_DELAY;
    if (block.timestamp < eligibleAt) revert EmergencyTooEarly(eligibleAt);
    _cancel(poolId);              // rake escrow zeroed, nothing released
    emit EmergencyRefund(poolId, msg.sender, block.timestamp);
}`,
        },
        { kind: "p", text: "After the void, each participant calls claimRefund and receives 100% of their gross stake, fee included. Nobody can claim twice; the refund flag is per wallet per market." },
        { kind: "h2", text: "What it cannot do" },
        {
          kind: "list",
          items: [
            "It cannot be used to steal: it pays every position back to its owner, never to the caller",
            "It cannot touch a settled market — the result stands",
            "It cannot release platform fees: a cancelled market releases zero rake",
            "It cannot be triggered early, even by the owner, without waiting the full 30 days",
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          title: "Economic side effect worth knowing",
          text: "If the operator stays silent for 30 days, a position on the losing side can recover 100% of its stake. That removes the winner's profit for that market. Settling promptly is therefore part of the operator's obligation, not an optional courtesy.",
        },
      ],
      "zh-TW": [
        {
          kind: "p",
          text: "emergencyRefund(poolId) 是協議的「斷路器」。它存在的理由很簡單：一個無法結算的預測市場，比一個被作廢的市場更糟 —— 作廢會把本金還給所有人，凍結則誰都拿不到。",
        },
        { kind: "h2", text: "前置條件" },
        {
          kind: "list",
          items: [
            "市場狀態必須為 Open（已結算或已取消會 revert）",
            "block.timestamp >= endTime + 30 天",
            "不需要任何權限 —— 任何地址都可呼叫，包含沒有任何部位的地址",
          ],
        },
        { kind: "h2", text: "它做什麼" },
        {
          kind: "code",
          lang: "solidity",
          code: `function emergencyRefund(uint256 poolId) external {
    Pool storage pool = _pools[poolId];
    if (pool.status != PoolStatus.Open) revert PoolNotOpen(poolId);
    uint256 eligibleAt = uint256(pool.endTime) + EMERGENCY_REFUND_DELAY;
    if (block.timestamp < eligibleAt) revert EmergencyTooEarly(eligibleAt);
    _cancel(poolId);              // 託管歸零，不釋放任何手續費
    emit EmergencyRefund(poolId, msg.sender, block.timestamp);
}`,
        },
        { kind: "p", text: "作廢後，每位參與者呼叫 claimRefund 取回本金的 100%（含手續費）。不可重複領取，退款標記為「每個錢包 × 每個市場」。" },
        { kind: "h2", text: "它不能做什麼" },
        {
          kind: "list",
          items: [
            "不能拿來偷錢：它把每個部位還給本人，不會給呼叫者",
            "不能動已結算市場 —— 結果維持有效",
            "不能釋放平台手續費：取消盤釋放的抽水為零",
            "任何人（包含 owner）都無法提前觸發，必須等滿 30 天",
          ],
        },
        {
          kind: "callout",
          tone: "warn",
          title: "值得知道的經濟副作用",
          text: "若營運方沉默 30 天，押錯邊的部位也能拿回 100% 本金，該市場贏家的利潤因此消失。所以「及時結算」是營運方的義務，不是可選的服務。",
        },
      ],
    },
  },

  {
    slug: "ai/dual-agent",
    section: "ai",
    key: "dualAgent",
    title: t("Dual-Agent Debate Engine", "雙代理辯論引擎"),
    summary: t("Three independent personas argue both sides before you take a position.", "三個獨立人格在你建立部位前，先替正反雙方辯論。"),
    body: {
      en: [
        {
          kind: "p",
          text: "Every market ships with two structured stances — a bull case and a bear case — plus a three-agent debate transcript. The goal is not to predict for you; it is to make the disagreement legible before you commit capital.",
        },
        { kind: "h2", text: "The three personas" },
        {
          kind: "kv",
          rows: [
            ["Macro Hawk 🦅", "Rates, liquidity, term structure. Zero tolerance for 'this time is different'."],
            ["Onchain Detective 🔍", "Whale wallets, DEX flows, stablecoin net issuance. Only balances count as evidence."],
            ["Meme Master 🐸", "Call density, community heat, KOL consensus as a contrarian signal."],
          ],
        },
        { kind: "h2", text: "Why three and not one" },
        {
          kind: "p",
          text: "A single model produces a single confident answer, which is exactly the failure mode of prediction. Splitting the reasoning into three constraints — fundamentals, flows, sentiment — forces disagreement into the open, and the market's implied probability becomes the aggregation mechanism instead of any one model's opinion.",
        },
        { kind: "h2", text: "Evidence trail" },
        {
          kind: "list",
          items: [
            "Each claim can carry an IPFS CID pointing at the snapshot it was derived from",
            "At settlement the operator writes a bytes32 evidence hash on-chain (settlementHash)",
            "Anyone can re-fetch the snapshot and compare it with the recorded hash",
            "The debate text itself is off-chain content, clearly labelled as AI-generated commentary — never as on-chain data",
          ],
        },
        {
          kind: "callout",
          tone: "info",
          title: "This is not a signal service",
          text: "Agent stances are editorial content, not financial advice, and they carry no on-chain authority. The only on-chain facts are the pool balances, the settlement hash and the timestamps.",
        },
      ],
      "zh-TW": [
        {
          kind: "p",
          text: "每個市場都附帶兩份結構化立場 —— 看多與看空 —— 以及三位代理的辯論逐字稿。目的不是替你預測，而是讓「分歧」在你投入資金之前變得可讀。",
        },
        { kind: "h2", text: "三個代理人格" },
        {
          kind: "kv",
          rows: [
            ["宏觀鷹派 🦅", "利率、流動性、期限結構。對「這次不一樣」零容忍。"],
            ["鏈上偵探 🔍", "巨鯨錢包、DEX 資金流、穩定幣淨發行。只認餘額變動作為證據。"],
            ["迷因大師 🐸", "喊單密度、社群熱度、KOL 共識作為反向指標。"],
          ],
        },
        { kind: "h2", text: "為什麼是三個而不是一個" },
        {
          kind: "p",
          text: "單一模型會給出單一且自信的答案，而這正是預測最典型的失敗模式。把推理拆成三個約束 —— 基本面、資金流、情緒面 —— 能迫使分歧浮上檯面，市場的隱含機率於是成為聚合機制，而不是任何單一模型的意見。",
        },
        { kind: "h2", text: "證據鏈" },
        {
          kind: "list",
          items: [
            "每條主張可附 IPFS CID，指向它依據的快照",
            "結算時營運方把 bytes32 證據雜湊寫入鏈上（settlementHash）",
            "任何人都能重新取得快照並與鏈上雜湊比對",
            "辯論文字本身是鏈下內容，且明確標註為 AI 生成評論，不會被當成鏈上資料",
          ],
        },
        {
          kind: "callout",
          tone: "info",
          title: "這不是訊號服務",
          text: "代理立場屬於編輯內容，不是投資建議，也不具備任何鏈上權威。唯一的鏈上事實是彩池餘額、結算雜湊與時間戳。",
        },
      ],
    },
  },

  {
    slug: "ai/oracle-roadmap",
    section: "ai",
    key: "oracle",
    title: t("Oracle & Settlement Roadmap", "預言機與結算路線圖"),
    summary: t("From an operator-signed result to an on-chain resolution market.", "從營運方簽名的結果，走向鏈上結算市場。"),
    body: {
      en: [
        {
          kind: "p",
          text: "Settlement is the single most important trust boundary in a prediction market. Today it is a signed transaction from the operator. The roadmap replaces that with a market for the truth.",
        },
        { kind: "h2", text: "Phase 1 · Operator as oracle (live)" },
        {
          kind: "list",
          items: [
            "owner calls settle(poolId, winningOption, evidenceHash) after endTime",
            "The evidence hash is written to storage and emitted in PoolSettled",
            "The owner cannot bet from its own address; it can still resolve against users (documented)",
            "If the operator disappears for 30 days, anyone voids the market and refunds 100%",
          ],
        },
        { kind: "h2", text: "Phase 2 · Bonded resolution with a dispute window" },
        {
          kind: "list",
          items: [
            "Proposer posts a bond and an outcome; a challenge window opens",
            "Challengers post a matching bond; escalation goes to an arbitrator (UMA-style optimistic oracle or a Kleros court)",
            "Wrong proposers lose the bond, which is paid to the challenger",
            "The 30-day escape hatch shortens, because resolution is now contested rather than trusted",
          ],
        },
        { kind: "h2", text: "Phase 3 · On-chain resolution market" },
        {
          kind: "p",
          text: "The final form removes the operator from the critical path entirely: the resolution itself becomes a prediction market settled by a decentralised oracle, with the same evidence-hash discipline applied to every layer. At that point the sybil residual (F-01) disappears, because there is no privileged address left to exploit.",
        },
        {
          kind: "callout",
          tone: "warn",
          title: "What must not be rushed",
          text: "Each phase adds a new attack surface (bond griefing, arbitrator bias, oracle latency). Shipping an optimistic oracle before the pool accounting is proven is how protocols lose money — the current phase is deliberately boring.",
        },
      ],
      "zh-TW": [
        {
          kind: "p",
          text: "結算是預測市場最重要的信任邊界。目前它是一筆由營運方簽名的交易；路線圖的目標，是用「對真相本身的市場」取代它。",
        },
        { kind: "h2", text: "第一階段 · 營運方作為預言機（已上線）" },
        {
          kind: "list",
          items: [
            "endTime 之後，owner 呼叫 settle(poolId, winningOption, evidenceHash)",
            "證據雜湊寫入儲存，並在 PoolSettled 事件中發出",
            "owner 不得以自身地址下注，但仍可與用戶對賭結算（已知風險）",
            "營運方消失 30 天，任何人可作廢市場並 100% 退款",
          ],
        },
        { kind: "h2", text: "第二階段 · 帶挑戰窗口的保證金結算" },
        {
          kind: "list",
          items: [
            "提議者質押保證金並提交結果，開啟挑戰窗口",
            "挑戰者質押對等保證金，爭議升級至仲裁層（UMA 式樂觀預言機或 Kleros 法庭）",
            "錯誤提議者被沒收保證金，支付給挑戰者",
            "30 天逃生通道可縮短，因為結算從「信任」變成「可爭議」",
          ],
        },
        { kind: "h2", text: "第三階段 · 鏈上結算市場" },
        {
          kind: "p",
          text: "最終形態會把營運方從關鍵路徑上完全移除：結算本身成為一個由去中心化預言機裁定的預測市場，並且每一層都沿用同樣的證據雜湊紀律。屆時 F-01 的女巫殘留也會消失 —— 因為不再存在可被利用的特權地址。",
        },
        {
          kind: "callout",
          tone: "warn",
          title: "不能急的部分",
          text: "每個階段都會引入新的攻擊面（保證金騷擾、仲裁者偏誤、預言機延遲）。在彩池記帳尚未被充分驗證前就上樂觀預言機，正是協議虧錢的典型方式 —— 目前這一階段刻意保持「無聊」。",
        },
      ],
    },
  },

  {
    slug: "economics/fees",
    section: "economics",
    key: "fees",
    title: t("Fee Structure & Referral Program", "手續費結構與推薦計畫"),
    summary: t("4% escrowed per market, 30% of it to the referrer, and why the escrow matters.", "4% 按市場託管、其中 30% 給推薦人，以及為什麼託管如此重要。"),
    body: {
      en: [
        {
          kind: "p",
          text: "Fees are the only revenue in the protocol, and they are deliberately boring: 4% of every stake, taken at the moment of the bet, never touched again until the market settles.",
        },
        {
          kind: "kv",
          rows: [
            ["Platform fee", "4.00% of gross stake (400 bps)"],
            ["Referral share", "30% of the fee (3000 bps) = 1.20% of stake"],
            ["Platform keeps", "2.80% of stake"],
            ["Charged on", "bet() only — seeds pay no fee, refunds return the fee"],
            ["Released by", "settle() only"],
          ],
        },
        { kind: "h2", text: "Why escrow instead of instant revenue" },
        {
          kind: "p",
          text: "If the rake were booked as profit immediately, a cancelled market would have to claw it back from the platform or from other markets. Escrowing per market makes the refund path arithmetically trivial: the money never left, so the refund is exact, and no other market's accounting is disturbed.",
        },
        {
          kind: "code",
          lang: "text",
          code: `open market   : fee escrowed, withdrawAdminFees() reverts (NothingToWithdraw)
settle()      : pool.rakeAdmin -> accumulatedAdminFees, then withdrawable
cancelPool()  : escrow zeroed, refunds pay stake + fee back to bettors
KOL cut       : poolReferral[poolId][kol], claimable only after settle`,
        },
        { kind: "h2", text: "Referral mechanics" },
        {
          kind: "list",
          items: [
            "Pass ?ref=0x… in the URL; the app forwards it as the referrer argument",
            "The cut is escrowed per market and claimed with withdrawReferralFees(poolId)",
            "Self-referral (referrer == bettor), the arena itself, and the fee vault are all neutralised to zero",
            "A cancelled market releases no referral money — it is refunded to bettors along with the fee",
          ],
        },
        {
          kind: "callout",
          tone: "info",
          title: "Open question: referral whitelisting",
          text: "Referrers are not whitelisted, so any wallet can route the 1.2% to a second address it controls, making the effective rake 2.8% instead of 4%. That is a known economic leak, not a security hole, and a whitelist is the obvious fix if the program needs to be revenue-accurate.",
        },
        { kind: "h2", text: "Solvency accounting" },
        {
          kind: "p",
          text: "The three buckets — pool principal, escrowed rake, released platform profit — are tracked separately and reconciled by the invariant documented in the Hardened Contract Spec. On a fork with 10 mixed-state markets the contract held 473.040002 USDC against 473.040000 USDC owed: a 2 wei surplus created by floor division.",
        },
      ],
      "zh-TW": [
        {
          kind: "p",
          text: "手續費是協議唯一的收入來源，而且刻意保持「無聊」：每筆本金抽 4%，在下注當下即鎖定，直到市場結算前都不再被觸碰。",
        },
        {
          kind: "kv",
          rows: [
            ["平台手續費", "本金的 4.00%（400 bps）"],
            ["推薦分成", "手續費的 30%（3000 bps）= 本金的 1.20%"],
            ["平台實收", "本金的 2.80%"],
            ["收取時機", "僅 bet() —— 種子不收費，退款會把手續費退回"],
            ["釋放時機", "僅 settle()"],
          ],
        },
        { kind: "h2", text: "為什麼要託管而不是即時入帳" },
        {
          kind: "p",
          text: "若抽水在下注當下就記為利潤，取消盤時就必須從平台或其他市場把錢挖回來。按市場託管讓退款路徑在算術上變得平凡：錢從未離開，退款精確，也不干擾其他市場的帳。",
        },
        {
          kind: "code",
          lang: "text",
          code: `進行中   : 手續費託管，withdrawAdminFees() revert（NothingToWithdraw）
settle() : pool.rakeAdmin -> accumulatedAdminFees，之後可提
cancel   : 託管歸零，退款把本金 + 手續費還給下注者
KOL 分成 : poolReferral[poolId][kol]，結算後才可提`,
        },
        { kind: "h2", text: "推薦機制" },
        {
          kind: "list",
          items: [
            "在網址帶 ?ref=0x… ，應用會以 referrer 參數轉發",
            "分成按市場託管，以 withdrawReferralFees(poolId) 領取",
            "自我推薦（referrer == 下注者）、合約自身、feeVault 都會被歸零",
            "取消盤不釋放推薦分成 —— 它會連同手續費一併退還給下注者",
          ],
        },
        {
          kind: "callout",
          tone: "info",
          title: "待解問題：推薦白名單",
          text: "推薦人沒有白名單，任何錢包都能把 1.2% 導到自己控制的第二個地址，使實收費率從 4% 降到 2.8%。這屬於已知的經濟漏損而非安全漏洞；若計畫需要收入精確，白名單是顯而易見的解法。",
        },
        { kind: "h2", text: "償付記帳" },
        {
          kind: "p",
          text: "三個桶子 —— 彩池本金、託管抽水、已釋放平台利潤 —— 分別追蹤，並由「加固版合約規範」中的不變式對帳。在 10 個混合狀態市場的 fork 上，合約持有 473.040002 USDC，應付 473.040000 USDC：向下取整造成 2 wei 的盈餘。",
        },
      ],
    },
  },
];

export function findDoc(slug?: string[]): Doc | undefined {
  if (!slug || slug.length === 0) return DOCS[0];
  const joined = slug.join("/");
  return DOCS.find((doc) => doc.slug === joined);
}

export function docsBySection(section: DocSection): Doc[] {
  return DOCS.filter((doc) => doc.section === section);
}

export function neighbours(slug: string): { prev?: Doc; next?: Doc } {
  const index = DOCS.findIndex((doc) => doc.slug === slug);
  if (index < 0) return {};
  return { prev: DOCS[index - 1], next: DOCS[index + 1] };
}
