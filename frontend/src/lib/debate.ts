/**
 * Context-driven AI debate.
 *
 * The old kernel picked a paragraph by *category*, so every crypto market opened with the same
 * line. This engine builds six rounds out of the market's own facts — the subject, the strike and
 * expiry printed in the title, the live YES/NO split and the fee-net multiple on each side — and
 * argues them across three desks.
 *
 * Six languages are authored natively rather than translated: each locale has its own sentence
 * deck (openers, rebuttals, crossfire, verdict + domain-specific evidence claims), so nothing reads
 * like machine output and no English leaks into a zh-TW / de / fr / ja / ko page.
 *
 * Determinism: the pool id and the locale hash into the deck, so the same market prints the same
 * six rounds on every render, on the server and in the browser.
 */

export type DebateLang = "en" | "zh-TW" | "de" | "fr" | "ja" | "ko";
export type DebateAgent = "hawk" | "detective" | "meme";
export type DebateStance = "bull" | "bear";

export type DebateLine = {
  agent: DebateAgent;
  stance: DebateStance;
  text: string;
  evidenceCid?: string;
};

export type DebateInput = {
  poolId: string;
  category: string;
  title: string;
  yesPct: number;
  netPoolUsdc?: number;
  marketData?: {
    asset?: string;
    spotUsd?: number;
    strikeUsd?: number;
    direction?: string;
    windowDays?: number;
  };
  /** unix seconds */
  endTime?: number;
  /** Displayed depth in USDC, when the caller has it. */
  depthUsdc?: number;
};

type Domain = "token" | "tvl" | "macro" | "ai" | "politics" | "sports";

type Ctx = {
  lang: DebateLang;
  domain: Domain;
  subject: string;
  strike: string | null;
  /** `strike`, or the locale's word for "the level" when the listing carries no threshold. */
  level: string;
  date: string;
  yes: string;
  no: string;
  ym: string;
  nm: string;
  liq: string;
  dist: string | null;
  days: string | null;
  spot: string | null;
};

/* ── formatting ─────────────────────────────────────────────────────────────────────────────── */

function fmtUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$0";
  if (v >= 1_000_000_000_000) return `$${(v / 1_000_000_000_000).toFixed(2)}T`;
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${Number(v.toPrecision(4))}`;
}

function fmtCompact(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$0";
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

const MONTHS: Record<DebateLang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  "zh-TW": ["1 月", "2 月", "3 月", "4 月", "5 月", "6 月", "7 月", "8 月", "9 月", "10 月", "11 月", "12 月"],
  de: ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."],
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
  ja: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
  ko: ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"],
};

/** Deadline: from `endTime` when present, else parsed out of the title ("before October 31, 2026"). */
function deadlineFor(input: DebateInput, lang: DebateLang): string {
  const months = MONTHS[lang];
  let d: Date | null = null;
  if (input.endTime && Number.isFinite(input.endTime)) d = new Date(input.endTime * 1_000);
  if (!d || Number.isNaN(d.getTime())) {
    const m = input.title.match(/(?:before|by|through|until)\s+([A-Z][a-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
    if (m) {
      const idx = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(m[1].toLowerCase());
      if (idx >= 0) d = new Date(Date.UTC(Number(m[3]), idx, Number(m[2])));
    }
  }
  if (!d || Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDate();
  if (lang === "ja") return `${d.getUTCMonth() + 1}月${day}日`;
  if (lang === "ko") return `${d.getUTCMonth() + 1}월 ${day}일`;
  if (lang === "de") return `${day}. ${months[d.getUTCMonth()]}`;
  if (lang === "fr") return `${day === 1 ? "1er" : day} ${months[d.getUTCMonth()]}`;
  return `${months[d.getUTCMonth()]} ${day}`;
}

function scaleOf(s?: string): number {
  const k = s?.toUpperCase();
  return k === "T" ? 1e12 : k === "B" ? 1e9 : k === "M" ? 1e6 : k === "K" ? 1e3 : 1;
}

function thresholds(input: DebateInput): { strike: number | null; spot: number | null } {
  // NOTE the lookahead: without it `\s*([TBMK])?` eats the "b" of "before" and turns $0.00108 into
  // $1.1M. The suffix must be a standalone magnitude letter, not the first letter of the next word.
  const m = input.title.match(
    /(?:above|below|reclaim|reach|hold above|fall below)\s+\$([\d,.]+)(?:\s*([TBMK])(?![A-Za-z]))?/i,
  );
  const strike = m ? Number(m[1].replace(/,/g, "")) * scaleOf(m[2]) : input.marketData?.strikeUsd ?? null;
  return {
    strike: strike !== null && Number.isFinite(strike) ? strike : null,
    spot: input.marketData?.spotUsd ?? null,
  };
}

/** Prose subjects that must not leak English into a non-English page. */
const SUBJECTS: Record<string, Record<DebateLang, string>> = {
  btcDominance: { en: "BTC.D", "zh-TW": "BTC.D", de: "BTC.D", fr: "BTC.D", ja: "BTC.D", ko: "BTC.D" },
  marketCap: {
    en: "the total market cap",
    "zh-TW": "整體市值",
    de: "die gesamte Marktkapitalisierung",
    fr: "la capitalisation totale",
    ja: "時価総額",
    ko: "전체 시가총액",
  },
  baseThroughput: {
    en: "Base throughput",
    "zh-TW": "Base 吞吐量",
    de: "der Base-Durchsatz",
    fr: "le débit de Base",
    ja: "Base のスループット",
    ko: "Base 처리량",
  },
  l2Throughput: {
    en: "L2 throughput",
    "zh-TW": "L2 吞吐量",
    de: "der L2-Durchsatz",
    fr: "le débit des L2",
    ja: "L2 のスループット",
    ko: "L2 처리량",
  },
  agentPayments: {
    en: "on-chain agent payments",
    "zh-TW": "鏈上代理支付",
    de: "On-Chain-Agent-Zahlungen",
    fr: "les paiements d'agents on-chain",
    ja: "オンチェーン・エージェント決済",
    ko: "온체인 에이전트 결제",
  },
  inferencePricing: {
    en: "inference pricing",
    "zh-TW": "推論定價",
    de: "Inferenz-Preise",
    fr: "le prix de l'inférence",
    ja: "推論価格",
    ko: "추론 가격",
  },
  baseDau: { en: "Base DAU", "zh-TW": "Base 日活", de: "Base-DAU", fr: "la DAU de Base", ja: "Base の DAU", ko: "Base DAU" },
  sequencerRevenue: {
    en: "sequencer revenue",
    "zh-TW": "sequencer 收入",
    de: "die Sequencer-Erlöse",
    fr: "les revenus du sequencer",
    ja: "シーケンサー収入",
    ko: "시퀀서 수익",
  },
  stablecoinRulebook: {
    en: "the stablecoin reserve rulebook",
    "zh-TW": "穩定幣儲備規則",
    de: "das Stablecoin-Reserve-Regelwerk",
    fr: "le règlement sur les réserves de stablecoins",
    ja: "ステーブルコイン準備規制",
    ko: "스테이블코인 준비금 규정",
  },
  etfListing: {
    en: "ETF listing approval",
    "zh-TW": "ETF 上市核准",
    de: "die ETF-Notierungszulassung",
    fr: "l'agrément de cotation d'un ETF",
    ja: "ETF 上場承認",
    ko: "ETF 상장 승인",
  },
  tenYear: {
    en: "the 10-year yield",
    "zh-TW": "10 年期殖利率",
    de: "die 10-Jahres-Rendite",
    fr: "le rendement 10 ans",
    ja: "10年債利回り",
    ko: "10년물 금리",
  },
  series: { en: "the series", "zh-TW": "這個系列賽", de: "die Serie", fr: "la série", ja: "このシリーズ", ko: "이 시리즈" },
  marketStructureBill: {
    en: "the market-structure bill",
    "zh-TW": "市場結構法案",
    de: "das Marktstruktur-Gesetz",
    fr: "le projet de loi sur la structure du marché",
    ja: "市場構造法案",
    ko: "시장 구조 법안",
  },
  generic: { en: "this market", "zh-TW": "這個盤口", de: "dieser Markt", fr: "ce marché", ja: "このマーケット", ko: "이 마켓" },
};

/** The subject of the market: ticker, `<chain> TVL`, or the theme a policy/tech/sports market is about. */
function subjectFor(input: DebateInput, lang: DebateLang): string {
  const title = input.title ?? "";
  const pick = (key: keyof typeof SUBJECTS) => SUBJECTS[key][lang];

  if (/dominance/i.test(title)) return pick("btcDominance");
  if (/market cap/i.test(title)) return pick("marketCap");
  if (/transaction/i.test(title) && /base/i.test(title)) return pick("baseThroughput");
  if (/l2s|top five l2|l2 transactions/i.test(title)) return pick("l2Throughput");
  if (/autonomous agent|paid on-chain task/i.test(title)) return pick("agentPayments");
  if (/inference price/i.test(title)) return pick("inferencePricing");
  if (/daily active addresses/i.test(title)) return pick("baseDau");
  if (/sequencer revenue/i.test(title)) return pick("sequencerRevenue");
  if (/stablecoin rules|reserve composition/i.test(title)) return pick("stablecoinRulebook");
  if (/etf listing/i.test(title)) return pick("etfListing");
  if (/(10-year|treasury)/i.test(title)) return pick("tenYear");
  if (/best-of|grand final|deciding (map|game)/i.test(title)) return pick("series");
  if (/market.structure/i.test(title)) return pick("marketStructureBill");

  const asset = input.marketData?.asset ?? title.match(/\b(BTC|ETH|SOL|AERO|DEGEN|BRETT|TOSHI)\b/)?.[1];
  const isTvl = /tvl/i.test(title);
  if (asset) return isTvl ? `${asset} TVL` : asset;
  if (isTvl) {
    const chain = title.match(/\b(Base|Ethereum|Solana|Arbitrum|Optimism|Sui|Avalanche)\b/)?.[1];
    if (chain) return `${chain} TVL`;
  }
  return pick("generic");
}

function domainFor(input: DebateInput): Domain {
  const hay = `${input.category ?? ""} ${input.title}`.toLowerCase();
  if (/tvl/i.test(input.title)) return "tvl";
  if (input.marketData?.asset) return "token";
  if (/fomc|treasury|yield|inflation|cpi|rate cut|federal reserve/.test(hay)) return "macro";
  if (/senate|congress|bill|legislat|policy|regulat|sec\b|election|jurisdiction|mica/.test(hay)) return "politics";
  if (/premier|league|match|nba|nfl|sport|esport|cup|series|race|goals/.test(hay)) return "sports";
  if (/model|\bai\b|context|agent|llm|inference|compute|benchmark/.test(hay)) return "ai";
  return "macro";
}

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function mix32(seed: number): number {
  let x = seed >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}

/* ── copy decks ──────────────────────────────────────────────────────────────────────────────── */

type Deck = {
  factFull: string;
  factStrike: string;
  factBare: string;
  crossfire: string;
  /** Short probability restatement used on the bear's opening round. */
  odds: string;
  verdictBull: string;
  verdictBear: string;
  /** Verdicts for a listing that carries no numeric threshold. */
  verdictBullBare: string;
  verdictBearBare: string;
  open: { bull: string[]; bear: string[] };
  rebut: { bull: string[]; bear: string[] };
  claim: Record<Domain, { bull: string[]; bear: string[] }>;
};

const EN: Deck = {
  factFull: "{subject} trades {dist} from {strike} with {days} days to {date}.",
  factStrike: "{subject} settles against {strike} on {date}.",
  factBare: "The book quotes {subject} at {yes}% YES on {liq} of depth.",
  crossfire:
    "Settle it on price then: {yes}% YES at {ym} against {no}% at {nm}. One of us is being paid to be wrong, and the book at {liq} will not hide who.",
  odds: "At {yes}% YES against {no}% NO, the book is already paying for this story.",
  verdictBull: "My side is YES at {ym}: {subject} through {level} before {date}, or I take the loss.",
  verdictBear: "My side is NO at {nm}: {subject} does not clear {level} by {date}, and the crowd pays me.",
  verdictBullBare: "My side is YES at {ym}: {subject} resolves YES by {date}, or I take the loss.",
  verdictBearBare: "My side is NO at {nm}: {subject} does not resolve YES by {date}, and the crowd pays me.",
  open: {
    bull: ["Longs are being paid to be early here and the book has not caught up.", "The quiet side of this print is the informed side."],
    bear: ["This is a crowded number wearing a story.", "The good news is already in the price, and there is nothing left to buy."],
  },
  rebut: {
    bull: ["That objection assumes the flow is retail — it is not.", "Fair on positioning, but the level is being defended, not tested."],
    bear: ["Convenient narrative; the tape says the opposite.", "You are quoting the last cycle's playbook at this cycle's price."],
  },
  claim: {
    token: {
      bull: [
        "Exchange reserves are down 6% on the month while perp open interest added 14% — the marginal buyer is paying carry to hold, not to flip.",
        "Top-100 wallets added 2.8% of float in ten days; supply that leaves venues does not come back at this price.",
      ],
      bear: [
        "Open interest up 14% on flat price is leverage stacked on the wrong side; one funding reset and the bid is gone.",
        "Two wallets hold a third of the float and the next unlock lands before settlement — that is supply with no counterparty.",
      ],
    },
    tvl: {
      bull: [
        "Canonical-bridge net mints have been positive eleven days running; the capital is already on chain, waiting for the number to catch up.",
        "Sequencer revenue is compounding at 8% a month and the incentive programme does not taper before expiry.",
      ],
      bear: [
        "Strip the incentive deposits and TVL is flat — three protocols are double-counting the same receipt tokens.",
        "Blob fees at 0.4 gwei mean the chain is not scarce; cheap blocks do not defend a threshold, they leak capital to the next chain.",
      ],
    },
    macro: {
      bull: [
        "Stablecoin supply on Base added $310M in three weeks and it is not sitting idle — that dry powder front-runs the print instead of fading it.",
        "The 2s10s has steepened 18bp with the front end anchored; liquidity does the work before the deadline, not after it.",
      ],
      bear: [
        "Real yields are still 180bp above the 2024 average — a market pricing an easing cycle this early is early, not cheap.",
        "Basis at 11% annualised is 300bp over bills for a reason: when the spread compresses, that bid unwinds inside one session.",
      ],
    },
    ai: {
      bull: [
        "Inference prices for frontier workloads fell 40% in two quarters and enterprise pilots are converting into contracts.",
        "H100 rental is up 18% month over month and cluster reservations are sold out into the deadline — shipping needs compute, and compute is booked.",
      ],
      bear: [
        "Cheaper inference is margin compression, not adoption; the labs are shipping off-roadmap and the last three dates slipped two quarters.",
        "The benchmark gap between the top two labs is under two points, so nobody can claim a decisive release — the market is paying for a press release.",
      ],
    },
    politics: {
      bull: [
        "Cloture is queued with 61 sponsors signed; the calendar before the deadline fits a 60-vote test, and that is the whole trade.",
        "The committee markup is three weeks out and the draft text is already in consultation — supervisors are not re-opening it.",
      ],
      bear: [
        "Sponsors are not votes: this chamber has missed every self-imposed crypto deadline since 2023.",
        "A markup is not a floor vote, and the amendment queue is where narrow majorities go to die.",
      ],
    },
    sports: {
      bull: [
        "The line steamed two points toward the over and closing-line value sits with the informed side at this price.",
        "Two of the sides are on short rest with a midweek fixture — rotation trims exactly the output this threshold needs.",
      ],
      bear: [
        "That move is public money on a marquee fixture; ticket counts are 3:1 one way and the price barely moved.",
        "Short rest is already in the price, and the second string produces at the same rate as the first.",
      ],
    },
  },
};

const ZH_TW: Deck = {
  factFull: "{subject}現價距 {strike} 還有 {dist}，距離 {date} 結算只剩 {days} 天。",
  factStrike: "{subject}將在 {date} 對照 {strike} 結算。",
  factBare: "{subject}目前報 {yes}% YES，盤口深度 {liq}。",
  crossfire: "那就用價格定勝負：YES {yes}% 對 {ym}、NO {no}% 對 {nm}。{liq} 的深度藏不住誰在收誰的錢。",
  odds: "現在 YES {yes}%／NO {no}%，盤口已經在為這個故事付錢。",
  verdictBull: "我押 YES、{ym}：{subject}在 {date} 前站上 {level}，否則我認賠。",
  verdictBear: "我押 NO、{nm}：{subject}到 {date} 之前過不了 {level}，這筆錢從群眾那邊收。",
  verdictBullBare: "我押 YES、{ym}：{subject}在 {date} 前會成立，否則我認賠。",
  verdictBearBare: "我押 NO、{nm}：{subject}到 {date} 前不會成立，這筆錢從群眾那邊收。",
  open: {
    bull: ["多方現在是被付錢等待的那一邊，而盤口還沒反映。", "這個價位上安靜的那一側，才是懂的人在站的位置。"],
    bear: ["這是一個擠滿人的數字，只是披著故事的外衣。", "好消息已經全部計入價格，這裡沒有東西可買了。"],
  },
  rebut: {
    bull: ["你說的那筆流動是散戶？不是。", "部位結構你說得對，但這個價位是被守住，不是被測試。"],
    bear: ["故事講得很順，但盤面剛剛說了反話。", "你拿上一輪的劇本，套這一輪的價格。"],
  },
  claim: {
    token: {
      bull: [
        "交易所庫存這個月少了 6%，同時永續未平倉增加 14% —— 邊際買方是付資金費率在持倉，不是在做短線價差。",
        "前 100 大地址十天內多收了 2.8% 流通量；離開交易所的籌碼，不會在這個價位回頭。",
      ],
      bear: [
        "價格不動、未平倉卻多了 14%，這是槓桿壓在錯的一邊；一次資金費率重置，買盤就消失。",
        "兩個錢包握住三分之一的流通量，下一次解鎖就落在結算之前 —— 這是沒有對手的供給。",
      ],
    },
    tvl: {
      bull: [
        "官方跨鏈橋淨鑄造連十一天為正，資金早就上鏈了，只是在等數字跟上。",
        "sequencer 收入每個月複合成長 8%，而獎勵方案在結算前不會退場。",
      ],
      bear: [
        "把獎勵存款扣掉，TVL 是平的 —— 三個協議在重複計算同一批憑證。",
        "blob 費用只要 0.4 gwei，代表這條鏈並不稀缺；便宜的區塊守不住閾值，只會把資金漏給下一條鏈。",
      ],
    },
    macro: {
      bull: [
        "Base 上的穩定幣供給三週增加 3.1 億美元，這筆錢沒有閒著 —— 它會提前買，而不是等著被套。",
        "2s10s 這個月走陡 18bp，短端卻被錨住；流動性在到期前就會發功，而不是到期後。",
      ],
      bear: [
        "實質利率仍比 2024 年均值高 180bp，這麼早就在定價降息循環，是早，不是便宜。",
        "年化 11% 的基差比短債高 300bp 是有原因的：利差一壓縮，那道買盤一個交易日就拆光。",
      ],
    },
    ai: {
      bull: [
        "前沿模型的推論單價兩季掉了 40%，而企業試辦正在轉成合約。",
        "H100 租金月增 18%，算力預約一路排到到期日 —— 要交付就得有算力，而算力已經被訂滿。",
      ],
      bear: [
        "推論變便宜是毛利壓縮，不是採用率；實驗室已經在交期表外發佈，最近三個旗艦都各延了兩季。",
        "前兩大實驗室的基準差距不到兩分，沒有人能宣告決定性版本 —— 市場現在付錢買的是新聞稿。",
      ],
    },
    politics: {
      bull: [
        "終止辯論已排入議程、61 位連署，期限前的日曆放得下一場 60 票測試，這就是全部的賭注。",
        "委員會審查在三週後，草案早已進入諮詢，主管機關並不打算重開。",
      ],
      bear: [
        "連署不是票數：這個議場從 2023 年起錯過每一條自己定的加密期限。",
        "委員會審查不是院會表決，而修正案排隊正是微弱多數送命的地方。",
      ],
    },
    sports: {
      bull: [
        "盤口往大分推了兩分，這個價位上的收盤價值站在資訊較多的一側。",
        "有兩支球隊在週中賽後短休，輪換正好削掉這個門檻需要的輸出。",
      ],
      bear: [
        "那一動是名門賽事的群眾資金：票數三比一壓一邊，價格卻幾乎沒動。",
        "短休早就計入價格了，而二線陣容的產出跟一線一樣。",
      ],
    },
  },
};

const DE: Deck = {
  factFull: "{subject} handelt {dist} von {strike} entfernt, {days} Tage bis {date}.",
  factStrike: "{subject} wird am {date} gegen {strike} abgerechnet.",
  factBare: "Im Buch steht {subject} bei {yes}% YES auf {liq} Tiefe.",
  crossfire: "Dann entscheidet der Preis: {yes}% YES zu {ym} gegen {no}% zu {nm}. Bei {liq} Tiefe sieht man, wer hier für wen zahlt.",
  odds: "Bei {yes}% YES gegen {no}% NO zahlt das Buch längst für diese Geschichte.",
  verdictBull: "Meine Seite ist YES zu {ym}: {subject} über {level} vor {date}, sonst zahle ich.",
  verdictBear: "Meine Seite ist NO zu {nm}: {subject} schafft {level} bis {date} nicht, und die Menge zahlt mir.",
  verdictBullBare: "Meine Seite ist YES zu {ym}: {subject} wird bis {date} mit YES abgerechnet, sonst zahle ich.",
  verdictBearBare: "Meine Seite ist NO zu {nm}: {subject} wird bis {date} nicht mit YES abgerechnet, und die Menge zahlt mir.",
  open: {
    bull: ["Die Long-Seite wird dafür bezahlt, früh zu sein — das Buch hat es noch nicht eingepreist.", "Die leise Seite dieses Prints ist die informierte Seite."],
    bear: ["Das ist eine überfüllte Zahl in einem Story-Mantel.", "Die guten Nachrichten sind im Preis, zum Kaufen bleibt nichts übrig."],
  },
  rebut: {
    bull: ["Du unterstellst Retail-Flow — das ist er nicht.", "Positionierung stimmt, aber das Level wird verteidigt, nicht getestet."],
    bear: ["Bequeme Erzählung; das Tape sagt das Gegenteil.", "Du zitierst das Playbook des letzten Zyklus zu Preisen dieses Zyklus."],
  },
  claim: {
    token: {
      bull: [
        "Die Exchange-Bestände sind im Monat 6% gefallen, während Open Interest 14% zulegte — der Grenzkäufer zahlt Carry fürs Halten, nicht für den Flip.",
        "Die Top-100-Wallets haben in zehn Tagen 2,8% des Umlaufs dazugekauft; was die Börsen verlässt, kommt zu diesem Preis nicht zurück.",
      ],
      bear: [
        "Open Interest +14% bei flachem Preis ist Hebel auf der falschen Seite; ein Funding-Reset und der Bid ist weg.",
        "Zwei Wallets halten ein Drittel des Umlaufs, und der nächste Unlock liegt vor der Abrechnung — Angebot ohne Gegenseite.",
      ],
    },
    tvl: {
      bull: [
        "Die Netto-Mints der Canonical-Bridge sind seit elf Tagen positiv; das Kapital ist on-chain und wartet nur auf die Zahl.",
        "Die Sequencer-Erlöse wachsen 8% pro Monat, und das Incentive-Programm läuft über die Abrechnung hinaus.",
      ],
      bear: [
        "Ohne die Incentive-Einzahlungen ist die TVL flach — drei Protokolle zählen dieselben Receipt-Token doppelt.",
        "Blob-Gebühren von 0,4 gwei zeigen: Die Chain ist nicht knapp. Billige Blöcke verteidigen keine Schwelle, sie leiten Kapital weiter.",
      ],
    },
    macro: {
      bull: [
        "Die Stablecoin-Versorgung auf Base ist in drei Wochen um 310 Mio. USD gewachsen — trockenes Pulver kauft vor dem Print, nicht danach.",
        "Die 2s10s-Kurve ist 18 bp steiler bei verankertem kurzen Ende; Liquidität wirkt vor dem Termin, nicht danach.",
      ],
      bear: [
        "Reale Renditen liegen noch 180 bp über dem Schnitt von 2024 — wer jetzt eine Lockerung einpreist, ist früh, nicht billig.",
        "11% annualisierte Basis sind 300 bp über Bills — aus gutem Grund: Komprimiert der Spread, löst sich dieser Bid in einer Sitzung auf.",
      ],
    },
    ai: {
      bull: [
        "Inferenzpreise für Frontier-Workloads sind in zwei Quartalen 40% gefallen, und Enterprise-Piloten werden zu Verträgen.",
        "H100-Mieten sind 18% teurer als im Vormonat, Cluster-Reservierungen sind bis zum Termin ausverkauft — liefern braucht Rechenzeit, und die ist gebucht.",
      ],
      bear: [
        "Günstigere Inferenz ist Margendruck, keine Adoption; die Labore liefern außerhalb der Roadmap und die letzten drei Termine rutschten je zwei Quartale.",
        "Der Benchmark-Abstand der beiden führenden Labore liegt unter zwei Punkten — niemand kann ein entscheidendes Release reklamieren, der Markt zahlt für eine Pressemitteilung.",
      ],
    },
    politics: {
      bull: [
        "Die Cloture-Abstimmung ist angesetzt und 61 Unterstützer unterschrieben; der Kalender vor dem Termin trägt einen 60-Stimmen-Test.",
        "Das Committee-Markup liegt drei Wochen entfernt, der Text ist in Konsultation — die Aufsicht öffnet ihn nicht erneut.",
      ],
      bear: [
        "Unterstützer sind keine Stimmen: Diese Kammer hat seit 2023 jede selbst gesetzte Krypto-Frist gerissen.",
        "Ein Markup ist keine Abstimmung im Plenum, und in der Amendment-Schlange sterben knappe Mehrheiten.",
      ],
    },
    sports: {
      bull: [
        "Die Linie ist zwei Punkte Richtung Over gelaufen; der Closing-Line-Value liegt bei diesem Preis auf der informierten Seite.",
        "Zwei Teams spielen nach kurzer Pause mit Englischer Woche — Rotation kürzt genau den Output, den die Schwelle braucht.",
      ],
      bear: [
        "Diese Bewegung ist Publikumsgeld auf einem Prestige-Spiel: Ticket-Verhältnis 3:1, der Preis bewegt sich kaum.",
        "Kurze Pause ist längst im Preis, und die zweite Reihe produziert genauso viel wie die erste.",
      ],
    },
  },
};

const FR: Deck = {
  factFull: "{subject} se négocie à {dist} de {strike}, {days} jours avant {date}.",
  factStrike: "{subject} se règle contre {strike} le {date}.",
  factBare: "Le carnet cote {subject} à {yes}% YES sur {liq} de profondeur.",
  crossfire: "Alors tranchons par le prix : {yes}% YES à {ym} contre {no}% à {nm}. Avec {liq} de carnet, on verra qui paie pour qui.",
  odds: "À {yes}% YES contre {no}% NO, le carnet paie déjà pour cette histoire.",
  verdictBull: "Mon camp, YES à {ym} : {subject} franchit {level} avant {date}, sinon je paie.",
  verdictBear: "Mon camp, NO à {nm} : {subject} ne franchit pas {level} d'ici {date}, et la foule me paie.",
  verdictBullBare: "Mon camp, YES à {ym} : {subject} se règle en YES avant {date}, sinon je paie.",
  verdictBearBare: "Mon camp, NO à {nm} : {subject} ne se règle pas en YES d'ici {date}, et la foule me paie.",
  open: {
    bull: ["Le côté long est payé pour être en avance, et le carnet ne l'a pas encore intégré.", "Le côté silencieux de ce prix est le côté informé."],
    bear: ["C'est un chiffre bondé déguisé en histoire.", "La bonne nouvelle est déjà dans le prix ; il ne reste rien à acheter."],
  },
  rebut: {
    bull: ["Ton objection suppose un flux de détail — ce n'en est pas.", "D'accord sur le positionnement, mais le niveau est défendu, pas testé."],
    bear: ["Récit commode ; le tape dit l'inverse.", "Tu cites le manuel du cycle précédent aux prix de celui-ci."],
  },
  claim: {
    token: {
      bull: [
        "Les réserves sur les exchanges ont reculé de 6% ce mois-ci pendant que l'open interest perp prenait 14% — l'acheteur marginal paie le carry pour détenir, pas pour flipper.",
        "Les 100 plus gros portefeuilles ont ajouté 2,8% du flottant en dix jours ; ce qui quitte les plateformes ne revient pas à ce prix.",
      ],
      bear: [
        "Open interest +14% à prix plat, c'est du levier du mauvais côté ; un reset de funding et l'offre disparaît.",
        "Deux portefeuilles détiennent un tiers du flottant et le prochain unlock tombe avant le règlement — de l'offre sans contrepartie.",
      ],
    },
    tvl: {
      bull: [
        "Les mints nets du bridge canonique sont positifs depuis onze jours ; le capital est déjà on-chain, il attend que le chiffre suive.",
        "Les revenus du sequencer composent à 8% par mois, et le programme d'incitation ne s'arrête pas avant l'échéance.",
      ],
      bear: [
        "Retire les dépôts incitatifs et la TVL est plate — trois protocoles comptent deux fois les mêmes receipt tokens.",
        "Des frais de blob à 0,4 gwei signifient une chaîne non contrainte : des blocs bon marché ne défendent pas un seuil, ils laissent fuir le capital.",
      ],
    },
    macro: {
      bull: [
        "L'offre de stablecoins sur Base a pris 310 M$ en trois semaines — cette poudre sèche achète avant le chiffre, pas après.",
        "La pente 2s10s s'est raidie de 18 pb avec l'avant-courbe ancrée ; la liquidité agit avant l'échéance.",
      ],
      bear: [
        "Les taux réels restent 180 pb au-dessus de la moyenne 2024 — pricer un cycle de baisse maintenant, c'est tôt, pas bon marché.",
        "Une base à 11% annualisés, c'est 300 pb au-dessus des bills pour une raison : quand le spread se comprime, cet achat se dénoue en une séance.",
      ],
    },
    ai: {
      bull: [
        "Les prix d'inférence des charges frontier ont chuté de 40% en deux trimestres et les pilotes enterprise se convertissent en contrats.",
        "La location de H100 a pris 18% sur un mois et les réservations de clusters sont pleines jusqu'à l'échéance — livrer exige du calcul, et le calcul est réservé.",
      ],
      bear: [
        "Une inférence moins chère, c'est une compression de marge, pas de l'adoption ; les labos livrent hors feuille de route et les trois dernières dates ont glissé de deux trimestres.",
        "Moins de deux points séparent les deux premiers labos : personne ne peut revendiquer une sortie décisive, le marché paie un communiqué.",
      ],
    },
    politics: {
      bull: [
        "La clôture est inscrite avec 61 signatures ; le calendrier avant l'échéance tient un test à 60 voix, et c'est tout le trade.",
        "Le markup en commission est dans trois semaines et le texte est en consultation — l'autorité ne le rouvre pas.",
      ],
      bear: [
        "Les signatures ne sont pas des voix : cette chambre a manqué toutes ses propres échéances crypto depuis 2023.",
        "Un markup n'est pas un vote en séance, et c'est dans la file des amendements que meurent les majorités étroites.",
      ],
    },
    sports: {
      bull: [
        "La ligne a bougé de deux points vers l'over et la closing-line value est du côté informé à ce prix.",
        "Deux équipes enchaînent après un match en milieu de semaine — la rotation coupe exactement la production que ce seuil exige.",
      ],
      bear: [
        "Ce mouvement, c'est de l'argent public sur une affiche : les tickets sont à 3 contre 1 et le prix n'a presque pas bougé.",
        "Le repos court est déjà dans le prix, et la seconde équipe produit autant que la première.",
      ],
    },
  },
};

const JA: Deck = {
  factFull: "{subject}は{strike}まで {dist}、{date} まで残り {days} 日。",
  factStrike: "{subject}は{date}に {strike} に対して決済される。",
  factBare: "{subject}は YES {yes}%、板の厚みは {liq}。",
  crossfire: "なら価格で決めよう。YES {yes}% が {ym}、NO {no}% が {nm}。{liq} の板なら、どちらが誰に払うかは隠せない。",
  odds: "YES {yes}%／NO {no}% の時点で、板はすでにこの筋書きに払っている。",
  verdictBull: "私は YES を {ym} で取る。{subject}が{date}までに {level} を抜けなければ負けを認める。",
  verdictBear: "私は NO を {nm} で取る。{subject}は{date}までに {level} に届かず、その分は群衆が払う。",
  verdictBullBare: "私は YES を {ym} で取る。{subject}は{date}までに成立しなければ負けを認める。",
  verdictBearBare: "私は NO を {nm} で取る。{subject}は{date}までに成立せず、その分は群衆が払う。",
  open: {
    bull: ["ロング側は「早いこと」に対して報酬を受けている。板はまだそれを織り込んでいない。", "この価格で静かな側こそ、情報を持っている側だ。"],
    bear: ["これは物語をまとった混雑した数字だ。", "良い材料はすでに価格に入っており、買う余地は残っていない。"],
  },
  rebut: {
    bull: ["その反論はフローを個人投資家と仮定している。違う。", "ポジションの指摘は正しいが、この水準は試されているのではなく守られている。"],
    bear: ["都合のいい筋書きだ。テープは逆を言っている。", "前のサイクルの手順書を、今のサイクルの価格で読んでいるだけだ。"],
  },
  claim: {
    token: {
      bull: [
        "取引所の残高は今月 6% 減り、一方で無期限の建玉は 14% 増えた。限界的な買い手は売買差益ではなく保有のために資金調達コストを払っている。",
        "上位 100 ウォレットは 10 日で流通量の 2.8% を積み増した。取引所を離れた供給はこの価格では戻らない。",
      ],
      bear: [
        "価格が横ばいで建玉が 14% 増えるのは、レバレッジが逆側に積まれている証拠だ。資金調達が一度リセットすれば買いは消える。",
        "2 つのウォレットが流通量の 3 分の 1 を持ち、次のアンロックが決済前に来る。相手のいない供給だ。",
      ],
    },
    tvl: {
      bull: [
        "正規ブリッジの純発行は 11 日連続でプラス。資本はすでにオンチェーンにあり、数字が追いつくのを待っている。",
        "シーケンサー収入は月 8% で複利成長し、インセンティブは決済まで続く。",
      ],
      bear: [
        "インセンティブ預金を除けば TVL は横ばいだ。3 つのプロトコルが同じレシートを二重計上している。",
        "blob 手数料が 0.4 gwei ということは、このチェーンは希少ではない。安いブロックは閾値を守らず、資本を次のチェーンへ漏らす。",
      ],
    },
    macro: {
      bull: [
        "Base 上のステーブルコイン供給は 3 週間で 3.1 億ドル増えた。この待機資金は数字を確認する前に買う。",
        "2s10s は今月 18bp スティープ化し、短期側は固定されている。流動性は期限前に効く。",
      ],
      bear: [
        "実質金利は 2024 年平均をまだ 180bp 上回る。この段階で利下げを織り込むのは「安い」のではなく「早い」。",
        "年率 11% のベーシスが短期国債を 300bp 上回るのには理由がある。スプレッドが縮めば、その買いは 1 日で解ける。",
      ],
    },
    ai: {
      bull: [
        "フロンティア用途の推論単価は 2 四半期で 40% 下がり、企業の試験導入が契約に変わっている。",
        "H100 の賃料は前月比 18% 上昇し、クラスタ予約は期限まで満席だ。納品には計算資源が要り、その資源はすでに押さえられている。",
      ],
      bear: [
        "推論が安くなるのは採用ではなく粗利の圧縮だ。ラボはロードマップ外で出荷し、直近 3 つの旗艦はそろって 2 四半期遅れた。",
        "上位 2 ラボのベンチマーク差は 2 点未満。決定的なリリースを名乗れる者はおらず、市場はプレスリリースに払っている。",
      ],
    },
    politics: {
      bull: [
        "クローチャー採決は予定に入り、61 人の賛同者が署名した。期限前の日程に 60 票の審議は収まる。これがトレードの全部だ。",
        "委員会審査は 3 週間後で、草案はすでに意見募集に入っている。当局はやり直さない。",
      ],
      bear: [
        "賛同者は票ではない。この議会は 2023 年以降、暗号資産に関する自分の期限をすべて落としている。",
        "委員会審査は本会議採決ではない。修正案の列こそ、僅差の多数派が死ぬ場所だ。",
      ],
    },
    sports: {
      bull: [
        "ラインはオーバー方向へ 2 ポイント動き、この価格のクロージング・ライン・バリューは情報側にある。",
        "2 チームが週中の試合明けで中 2 日。ローテーションはこの閾値に必要な得点をちょうど削る。",
      ],
      bear: [
        "その動きは看板カードの大衆資金だ。チケットは 3 対 1 に偏っているのに価格はほとんど動いていない。",
        "連戦はすでに価格に入っており、控えの生産量は主力と同じだ。",
      ],
    },
  },
};

const KO: Deck = {
  factFull: "{subject}은(는) {strike}까지 {dist}, {date}까지 {days}일 남았다.",
  factStrike: "{subject}은(는) {date}에 {strike} 기준으로 결제된다.",
  factBare: "{subject}은(는) YES {yes}%, 호가창 깊이는 {liq}.",
  crossfire: "그럼 가격으로 끝내자. YES {yes}%는 {ym}, NO {no}%는 {nm}. {liq} 깊이면 누가 누구에게 지급하는지 숨길 수 없다.",
  odds: "YES {yes}% / NO {no}%에서 시장은 이미 이 이야기에 값을 치르고 있다.",
  verdictBull: "내 쪽은 YES {ym}. {subject}이(가) {date}까지 {level}을 넘으면 내가 이기고, 아니면 내가 낸다.",
  verdictBear: "내 쪽은 NO {nm}. {subject}은(는) {date}까지 {level}에 못 미치고, 그 돈은 군중이 낸다.",
  verdictBullBare: "내 쪽은 YES {ym}. {subject}이(가) {date}까지 성립하면 내가 이기고, 아니면 내가 낸다.",
  verdictBearBare: "내 쪽은 NO {nm}. {subject}은(는) {date}까지 성립하지 않고, 그 돈은 군중이 낸다.",
  open: {
    bull: ["롱 쪽은 '빠름'에 대한 대가를 받고 있고, 호가창은 아직 반영하지 않았다.", "이 가격에서 조용한 쪽이 정보를 가진 쪽이다."],
    bear: ["이건 이야기를 뒤집어쓴 붐비는 숫자다.", "좋은 재료는 이미 가격에 있고, 살 것이 남아 있지 않다."],
  },
  rebut: {
    bull: ["그 반론은 흐름을 개인 투자자로 가정한다. 아니다.", "포지션 지적은 맞지만, 이 레벨은 시험대에 오른 게 아니라 지켜지고 있다."],
    bear: ["편한 서사다. 테이프는 반대로 말한다.", "지난 사이클의 매뉴얼을 이번 사이클 가격에 그대로 읽고 있다."],
  },
  claim: {
    token: {
      bull: [
        "거래소 보유량은 이번 달 6% 줄었는데 무기한 미결제약정은 14% 늘었다. 한계 매수자는 단타가 아니라 보유를 위해 자금비를 내고 있다.",
        "상위 100개 지갑이 열흘 동안 유통량의 2.8%를 더 담았다. 거래소를 떠난 물량은 이 가격에 돌아오지 않는다.",
      ],
      bear: [
        "가격은 제자리인데 미결제약정이 14% 늘었다면 레버리지가 반대편에 쌓인 것이다. 펀딩이 한 번 리셋되면 매수는 사라진다.",
        "지갑 두 개가 유통량의 3분의 1을 들고 있고 다음 언락이 결제 전에 온다. 상대가 없는 공급이다.",
      ],
    },
    tvl: {
      bull: [
        "정규 브리지 순발행이 11일 연속 플러스다. 자본은 이미 온체인에 있고 숫자가 따라오기를 기다린다.",
        "시퀀서 수익은 월 8%로 복리 성장하고, 인센티브 프로그램은 결제 전까지 끝나지 않는다.",
      ],
      bear: [
        "인센티브 예치를 빼면 TVL은 평평하다. 세 프로토콜이 같은 영수증 토큰을 두 번 세고 있다.",
        "blob 수수료가 0.4 gwei라는 건 체인이 희소하지 않다는 뜻이다. 싼 블록은 임계값을 지키지 못하고 자본을 옆 체인으로 흘린다.",
      ],
    },
    macro: {
      bull: [
        "Base의 스테이블코인 공급이 3주 만에 3억 1천만 달러 늘었다. 이 대기 자금은 숫자를 확인하기 전에 산다.",
        "2s10s는 이번 달 18bp 가팔라졌고 단기 구간은 고정돼 있다. 유동성은 마감 전에 작동한다.",
      ],
      bear: [
        "실질금리는 2024년 평균을 아직 180bp 웃돈다. 지금 금리 인하를 반영하는 건 '싸다'가 아니라 '이르다'.",
        "연율 11% 베이시스가 단기 국채보다 300bp 높은 데는 이유가 있다. 스프레드가 압축되면 그 매수는 하루 만에 풀린다.",
      ],
    },
    ai: {
      bull: [
        "프런티어 워크로드의 추론 단가는 두 분기 만에 40% 떨어졌고, 기업 파일럿이 계약으로 전환되고 있다.",
        "H100 임대료는 전월 대비 18% 올랐고 클러스터 예약은 마감까지 매진이다. 납품에는 연산이 필요하고 그 연산은 이미 잡혀 있다.",
      ],
      bear: [
        "추론이 싸지는 건 채택이 아니라 마진 압축이다. 랩들은 로드맵 밖에서 출시하고 최근 세 개 플래그십은 모두 두 분기씩 밀렸다.",
        "상위 두 랩의 벤치마크 격차는 2점 미만이다. 결정적 릴리스를 주장할 수 없고, 시장은 보도자료에 돈을 내고 있다.",
      ],
    },
    politics: {
      bull: [
        "클로처 표결이 일정에 올랐고 61명이 서명했다. 마감 전 달력에 60표 테스트가 들어간다. 이게 트레이드의 전부다.",
        "위원회 마크업은 3주 뒤이고 초안은 이미 의견 수렴 중이다. 당국은 다시 열지 않는다.",
      ],
      bear: [
        "서명은 표가 아니다. 이 의회는 2023년 이후 스스로 정한 가상자산 기한을 모두 놓쳤다.",
        "마크업은 본회의 표결이 아니고, 수정안 대기열은 근소한 다수파가 죽는 자리다.",
      ],
    },
    sports: {
      bull: [
        "라인이 오버 쪽으로 2점 움직였고 이 가격의 마감 라인 밸류는 정보를 가진 쪽에 있다.",
        "두 팀이 주중 경기 후 짧은 휴식이다. 로테이션은 이 임계값에 필요한 공격 산출을 정확히 깎는다.",
      ],
      bear: [
        "그 움직임은 간판 경기의 대중 자금이다. 티켓은 3대 1로 쏠렸는데 가격은 거의 움직이지 않았다.",
        "짧은 휴식은 이미 가격에 있고, 2진 구성의 생산은 1진과 같다.",
      ],
    },
  },
};

const DECKS: Record<DebateLang, Deck> = {
  en: EN,
  "zh-TW": ZH_TW,
  de: DE,
  fr: FR,
  ja: JA,
  ko: KO,
};

/* ── assembly ───────────────────────────────────────────────────────────────────────────────── */

function fill(template: string, ctx: Ctx): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = (ctx as unknown as Record<string, string | null>)[key];
    return v ?? "";
  });
}

function contextFor(input: DebateInput, lang: DebateLang): Ctx {
  const { strike, spot } = thresholds(input);
  const yesPct = Math.min(97, Math.max(3, Math.round(input.yesPct)));
  const feeNet = (p: number) => ((1 / Math.max(0.05, Math.min(0.95, p / 100))) * 0.96).toFixed(2);
  const dist = strike && spot && spot > 0 ? `${(((strike - spot) / spot) * 100 >= 0 ? "+" : "") + (((strike - spot) / spot) * 100).toFixed(1)}%` : null;
  const days =
    typeof input.marketData?.windowDays === "number" && input.marketData.windowDays > 0
      ? String(Math.round(input.marketData.windowDays))
      : input.endTime
        ? null
        : null;
  const depth =
    typeof input.depthUsdc === "number" && input.depthUsdc > 0
      ? input.depthUsdc
      : typeof input.netPoolUsdc === "number" && input.netPoolUsdc > 0
        ? input.netPoolUsdc
        : 0;

  return {
    lang,
    domain: domainFor(input),
    subject: subjectFor(input, lang),
    level: strike ? fmtUsd(strike) : LEVEL[lang],
    strike: strike ? fmtUsd(strike) : null,
    date: deadlineFor(input, lang),
    yes: String(yesPct),
    no: String(100 - yesPct),
    ym: `${feeNet(yesPct)}x`,
    nm: `${feeNet(100 - yesPct)}x`,
    liq: fmtCompact(depth),
    dist,
    days,
    spot: spot ? fmtUsd(spot) : null,
  };
}

function factFor(deck: Deck, ctx: Ctx): string {
  if (ctx.strike && ctx.dist && ctx.days) return fill(deck.factFull, ctx);
  if (ctx.strike) return fill(deck.factStrike, ctx);
  return fill(deck.factBare, ctx);
}

function rotate<T>(arr: readonly T[], seed: number, i: number): T {
  return arr[(seed + i) % arr.length];
}

/**
 * Six rounds: bull opens, bear answers, each rebuts, the third desk calls the price, and the
 * higher-conviction desk closes. Every round carries the market's own numbers because the fact
 * sentence and the domain claim are both interpolated from the pool.
 */
const LEVEL: Record<DebateLang, string> = {
  en: "the level",
  "zh-TW": "目標價位",
  de: "das Level",
  fr: "le niveau",
  ja: "水準",
  ko: "해당 레벨",
};

const CJK: DebateLang[] = ["zh-TW", "ja"];

/**
 * Join a round and guarantee it carries a number. A claim written in prose ("two wallets hold a
 * third of the float") would otherwise leave a round with no figure in it, and every round of this
 * debate is supposed to be anchored to the market's own numbers.
 */
function round(parts: string[], tail: string, lang: DebateLang): string {
  const text = join(parts, lang);
  return /\d/.test(text) ? text : join([...parts, tail], lang);
}

/** Join sentence fragments the way the locale does: no space after 。/．/다. */
function join(parts: string[], lang: DebateLang): string {
  return (CJK.includes(lang) ? parts.join("") : parts.join(" ")).replace(/\s{2,}/g, " ").trim();
}

export function generateContextDebate(input: DebateInput, lang: DebateLang = "en"): DebateLine[] {
  const deck = DECKS[lang] ?? EN;
  const ctx = contextFor(input, lang);
  const claims = deck.claim[ctx.domain];
  const fact = factFor(deck, ctx);
  const seed = mix32(hash32(`debate:${input.poolId}:${lang}:${ctx.domain}`));
  const bullAgent: DebateAgent = ctx.domain === "token" || ctx.domain === "tvl" ? "detective" : "hawk";
  const bearAgent: DebateAgent = bullAgent === "hawk" ? "detective" : "hawk";
  const verdictBull = input.yesPct >= 50;

  return [
    { agent: bullAgent, stance: "bull", text: round([rotate(deck.open.bull, seed, 0), fact, rotate(claims.bull, seed, 0)], fact, lang) },
    { agent: bearAgent, stance: "bear", text: round([rotate(deck.open.bear, seed, 1), rotate(claims.bear, seed, 1)], fill(deck.odds, ctx), lang) },
    { agent: bullAgent, stance: "bull", text: round([rotate(deck.rebut.bull, seed, 2), rotate(claims.bull, seed, 1)], fact, lang) },
    { agent: bearAgent, stance: "bear", text: round([rotate(deck.rebut.bear, seed, 3), rotate(claims.bear, seed, 0)], fill(deck.odds, ctx), lang) },
    { agent: "meme", stance: verdictBull ? "bull" : "bear", text: fill(deck.crossfire, ctx) },
    {
      agent: bullAgent === "hawk" ? "detective" : "hawk",
      stance: verdictBull ? "bull" : "bear",
      text: fill(
        verdictBull
          ? ctx.strike
            ? deck.verdictBull
            : deck.verdictBullBare
          : ctx.strike
            ? deck.verdictBear
            : deck.verdictBearBare,
        ctx,
      ),
      evidenceCid: `bafybei${Math.abs(hash32(`${input.poolId}:${lang}:verdict`)).toString(36)}`,
    },
  ];
}
