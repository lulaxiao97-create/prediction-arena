# 营销期获客：不靠 X / 电报的六条线（2026-11-04）

这份是给老板看的判断，不是素材库。素材在 `GROWTH_PLAYBOOK_EXECUTION.md`，执行日志在 `GROWTH_LOG.md`。

## 0. 先看我们手里的牌（实测数字，不是估的）

| 项 | 数 | 说明 |
|---|---|---|
| 市场页 | **232 个** | 每个都有问题、实时赔率、多空 AI 论点、结算规则 —— 全部服务端渲染（抓下来 2.6KB 正文） |
| 被 Google 收录 | **0** | `site:predictionarena.online` 搜不到任何一条，只有同名的别的站 |
| sitemap / robots | **之前都不存在** | 今天补上（236 条 URL） |
| X 粉丝 | **4** | 3 → 4 用了一整天 |
| 链上 TVL | **$0** | 232 个盘建好，无人下注 |
| 积分账本 | 0 钱包 | TG bot 在线，但没人绑 |
| 积分承诺 | 42% 供应给积分持有者 | 这是我们唯一能对抗 Limitless 的叙事 |

一句话：**产品有 232 个可被搜索的页面，但搜索引擎不知道它们存在；社交从 0 粉丝起步，追不动。**
所以营销期的顺序不是"多发帖"，而是**先把已有的 232 个页面变成别人的入口**。

## 1. 学到的三件事（有外部证据）

1. **预测市场已经是一个独立的 SEO 赛道。** 2026 年已经出现专做 Kalshi / Polymarket 的 SEO 代理商；
   研究显示中期选举类查询里有一半会出现预测市场结果。这意味着"Will X happen"这类搜索正在变成入口，
   而我们的页面形状（问题 + 赔率 + 结算条件）正好是这类查询要的答案。
   来源：luvkaizen / gamblingseo.agency / 3betmedia 的赛道文章；CasinoReviews 的 140 条查询研究（2026-10-30）。
2. **程序化 SEO 的死穴是索引率，不是页面数。** iGaming 的公开复盘：371 个页面，真正被索引的很少。
   ⇒ 光有 232 页没用，必须主动提交 + 内链 + 每页有独立价值。
3. **Base 上跑出来的同类（Limitless）：** 月成交 ~$2B、6 万+ 月活，靠的是 Base 生态位 + 信息市场（Kaito/Wallchain）
   的 mindshare 活动 + 积分/空投。**没有一条是靠"发推涨粉"起来的。**
   ⇒ 我们的对应物不是发帖量，是"可被引用的数据 + 可被 farming 的积分 + 生态位露出"。

## 2. 六条线，按 ROI 排序（都不需要花钱）

| # | 线 | 为什么是我们 | 单条验收 | 谁做 |
|---|---|---|---|---|
| A | **索引化**（sitemap / robots / JSON-LD / IndexNow） | 232 页已在，缺的是"告诉爬虫" | `site:` 能搜到 ≥ 1 页；GSC 收录数上升 | 阿六（已做完基础，等部署） |
| B | **聚合器收录**（DefiLlama / DappRadar / CoinGecko / GeckoTerminal） | 免费反向链接 + 加密原生流量；DefiLlama 已有 PR #21991 | 每个站出现我们的 profile 页 | 阿六准备材料，老板给邮箱/表单 |
| C | **空投/积分聚合站**（Airdrops.io / Cryptorank / DropsTab / DefiLlama Airdrops） | 42% 供应承诺是天然钩子；积分已在跑 | 至少 2 个站收录"Prediction Arena points" | 阿六写文案，老板提交（多数要邮箱验证） |
| D | **赔率即内容**（公开 API / embed / 每日"赔率快照"） | 我们是唯一"AI 双方向辩论 + 链上结算收据"的盘口 | 1 个外部站点或 bot 引用我们的赔率 | 阿六（API 已有雏形） |
| E | **生态位露出**（Base 生态目录 / Bountycaster / Farcaster /base） | Base 官方流量入口，免费 | 出现在 base.org 生态页或 Bountycaster | 阿六发 Farcaster 需老板开 signer |
| F | **新闻劫持**（CPI / FOMC / 币价异动 / 选举） | 事件发生 30 分钟内出盘 + 结算收据 | 每个事件日新增 ≥ 1 个盘 + 1 条结算帖 | 自动化已在跑，缺的是事件日历 |

## 3. 未来 7 天的动作表（做完打勾）

- [x] D1 上午：`robots.ts` + `sitemap.ts`（236 URL）+ 市场页 JSON-LD（Question/Breadcrumb）+ 站点 WebApplication JSON-LD —— **已提交代码，等部署**
- [x] D1 上午：IndexNow key + `scripts/indexnow.ts`（236 URL 一批提交，Bing/Yandex 秒收）
- [ ] D1 下午：部署验证 `/sitemap.xml` `/robots.txt` 可访问 → 跑 IndexNow → 提交 GSC/Bing（要老板登录一次）
- [ ] D2：DefiLlama PR 跟进；写 DappRadar / CoinGecko / GeckoTerminal 三份提交材料（名称、链、合约、截图、简介）
- [ ] D3：空投站文案（三版：英文 100 词 / 中文 200 字 / 一句话 hook）+ 提交 Airdrops.io、Cryptorank
- [ ] D4：`/api/odds` 公开只读接口 + `/embed` 单盘 embed 页（给别人 iframe 用）
- [ ] D5：Base 生态目录 + Bountycaster 悬赏（"第一个引用我们赔率的 bot 得 500 分"）
- [ ] D6：事件日历自动化（CPI/FOMC/非农/大选节点提前 24h 建盘）
- [ ] D7：复盘 —— 收录数 / 外链数 /  referrals 来源 / 新增钱包绑定数

## 4. 必须老板出面的（我做不了的部分）

1. **Google Search Console + Bing Webmaster**：需要域名所有权验证（DNS TXT 或 HTML 文件），登录一次即可，之后我能用 API。
2. **CoinGecko / DappRadar / Airdrops.io 的提交表单**：都要邮箱验证，用哪个邮箱请给一句。
3. **Farcaster signer**（NEYNAR_API_KEY + NEYNAR_SIGNER_UUID）：开了 `/base` 频道就能发，不用粉丝。
4. **最小预算**（可选）：$50–100 给前 3 个盘做真实 USDC 种子。**TVL=$0 是所有聚合器拒绝收录的第一理由**，也是用户进来就走的原因。

## 5. 为什么不是"继续多发帖"

X 的冷启动是**关系图谱**问题：4 个粉丝的号发什么都只有 4 个人看到，回复截流要跟几百个号抢前排。
Farcaster 好一点（频道时间线不看粉丝数），但它需要 signer，且 Base 官方已经把重心挪回标准 web。
**唯一"内容一次生产、长期被搜到"的渠道是搜索引擎** —— 而我们已经把内容生产完了（232 页），只差把门打开。
