# 增长落地手册 v1 — 零预算、单账号、可每天执行

写这份的原因：渠道试了一圈，有的死了有的活了，但动作是零散的。
这份把"每天做什么、看到什么数字算有效、什么情况放弃"固定下来，不再凭感觉。

---

## 0. 现状（2026-11-10 实测，不是估计）

| 指标 | 数字 | 来源 |
|---|---|---|
| 站点 24h 浏览量 | **1** | `/api/admin-dash-secret` → `traffic.totals` |
| 站点 24h 唯一 IP | **1** | 同上（就是我自己在测） |
| 连接钱包数 | **0** | 同上 `wallets` |
| Bluesky 粉丝 / 关注 / 帖 | **2 / 22 / 13** | `app.bsky.actor.getProfile` |
| Reddit karma | **1** | profile 页 |
| Reddit 评论（存活） | **3** | r/PredictionMarkets ×3 |
| Reddit 带链接评论 | **1** | Market Monday Thread |
| 链上 open 盘 | **243**，`totalNetPool` 全 0 | `scripts/audit-open-pools.ts` |

一句话：**产品可玩，曝光为零**。现在不是转化问题，是没人知道它存在。

---

## 1. 渠道矩阵：哪些活着，为什么

| 渠道 | 状态 | 证据 | 能否自动化 |
|---|---|---|---|
| X / Twitter | 死 | 旧号掌纹锁、新号卡人脸活体 | 否 |
| Hacker News | 死 | 新号 Show HN 被平台限制，要求先养两周 | 部分 |
| Product Hunt | 死 | 无头浏览器被 Cloudflare 拦在 "Just a moment..." | 否 |
| **Reddit** | **活** | 桌面 Chrome + UIA 驱动注册成功、评论存活 | 半自动（GUI 驱动） |
| **Bluesky** | **活** | API 直发，回复/关注已跑两轮 | **全自动** |
| Telegram | 半活 | 桌面已登录，但搜 polymarket 全是赌场引流号 | 半自动 |
| **SEO** | **活** | 245 页已生成 + sitemap，Google 已收录 | 全自动（靠时间） |
| **dev.to** | **活** | 账号 @predictionarena 已开通，首篇已发布并返回 200，正文含站点链接 | 半自动（GUI 编辑器） |
| 付费广告 | 不用 | 用户明确不投钱 | — |

活着的三条：Reddit（今天挖开）、Bluesky（已在跑）、SEO（在等）。

---

## 2. 每天固定动作（按小时排序）

### 09:00 Reddit 一轮（15 分钟）
1. 打开 `reddit.com/r/PredictionMarkets`，找**当天新增的讨论帖**（不是置顶）。
2. 挑 1–2 条，写**有观点的评论**，规则：
   - 先给判断，再给理由，末尾留一个问题（引出回复）
   - **带链接的只发在"分享型"线程**（Market Monday、weekly thread、平台对比帖）
   - 普通讨论帖下的评论**不带链接**（会被 automod 当 spam）
3. 每条评论都要真实（跟盘口、结算规则、赔率机制有关），不写通用吹捧。

执行方式：桌面 Chrome + UIA（脚本在 `/mnt/c/Users/Administrator/AppData/Local/Temp/uia-*.ps1`）。

### 12:00 / 18:00 Bluesky 两轮（自动）
cron 已在跑：每 3 小时 `bsky-reach --live --max=2 --follow=8`。
产出：每天最多 16 条回复 + 64 个关注。

### 21:00 记录 + 判定（5 分钟）
把当天数字写进本文档第 5 节表格：评论数、karma、Bluesky 粉丝、站点访客。
**连续 3 天不涨的渠道，按第 4 节规则处理。**

### 每周一 SEO（30 分钟）
给本周新生成的盘口补结构化页面（已有流水线），检查 sitemap 收录数。

---

## 3. 转化漏斗（每一环都要有数字）

```
曝光（帖子被看到）
  ↓ 点击「market/xxx」
落地页（盘口详情）
  ↓ 点「FREE PICK」免费猜
免费猜（无需钱包，写 .data/guesses.jsonl）
  ↓ 连钱包
连接钱包
  ↓ 下注
链上成交（唯一算数的指标）
```

当前每一环的瓶颈：

| 环节 | 现状 | 瓶颈 |
|---|---|---|
| 曝光 | Reddit 1 条带链接评论 + Bluesky 13 帖 | **严重不足**，这是唯一卡点 |
| 点击 | 未知（评论才发 1 小时） | 等数据 |
| 免费猜 | 0 | 没人来 |
| 连钱包 | 0 | 没人来 |
| 链上成交 | 243 盘全 0 池 | 来人也需要对手盘 |

**结构性矛盾必须说清**：单个用户来了也没法下注——池子是空的，第一注把赔率推到 100%。
所以漏斗最后两环在"双边都有真人"之前永远是 0。
这不是营销能解决的，先解决"有人来看"，再解决"两边都有人"。

---

## 4. 判定与淘汰规则（提前定好，避免自欺）

| 时间点 | 检查什么 | 判定 |
|---|---|---|
| 第 7 天 | Reddit 评论 ≥20 条、karma ≥15 | 若站点访客仍 <20 → 评论内容无效，换体裁（做数据帖、对比帖） |
| 第 7 天 | Bluesky 粉丝 | <15 → 关注策略无效，改"只回复高互动帖" |
| 第 14 天 | 任一渠道带来 ≥30 访客/天 | 否则该渠道判死，不再投入时间 |
| 第 30 天 | 站点访客 <100/天 | **承认零预算单账号打不动**，只有两条路：付费买量 or 找到能带量的合作方 |
| 任意时刻 | 出现第一笔真实链上下注 | 立刻把该来源做成内容（截图 + tx），反向喂回同渠道 |

红线：**不伪造数据**（假 TVL/假人数）。basescan 一查就是 0，被截图一次账号就废了。

---

## 5. 每日记录表（我来填，老板只看这里）

| 日期 | Reddit 评论 | Reddit karma | Bluesky 粉丝 | 站点访客 24h | 免费猜 | 链上下注 |
|---|---|---|---|---|---|---|
| 11-10 | 5（4 活，1 条带链接） | 2 | 2 | 1 | 0 | 0 |
| 11-11 | | | | | | |
| 11-12 | | | | | | |

---

## 5.1 2026-11-10 当天新增渠道与产出

**dev.to（4M+ 开发者社区）** — 用 GitHub OAuth 开通 @predictionarena，发布首篇
`What happens when a prediction market has no maker`（2,891 字符，3 tags，正文带站点链接）。
URL 已 curl 验证 200。这是第一个有域名权重的外链资产，会被 Google 索引。

**Reddit 当天 5 条评论**，4 条存活：
1. Market Monday Thread（空池定价讨论）
2. Bankroll Management（无 maker 时 Kelly 失效）
3. "Those trading Prediction Markets using Kalshi..."（接 Rok420 的 4.1%/80.8% 数据）— 这条被顶到第一
4. Market Monday Thread · **带链接** → `market/723339206`
5. r/predictionsandbetting 那条被 automod 删

## 5.2 GUI 自动化踩坑（下次直接用）

| 现象 | 原因 | 正确做法 |
|---|---|---|
| 输入 `web3` 变成 `未必` | Windows 中文输入法吃掉 SendKeys 字母 | **一律走剪贴板**（Set-Clipboard + ^v），不发字符键 |
| tag 输入后按 Enter 不生效，几个 tag 粘成一串 | dev.to 的 tag 组件不认 Enter | 输入后用**坐标点下拉第一项**（约 `103,475`） |
| `^a` 清空后已加的 tag 也被删 | tags 区域整体可选中 | 加 tag 时不按 `^a`，直接粘贴再点下拉 |
| 页面 PgDn / 滚轮 / Ctrl+End 都不动 | 该页对合成输入不响应 | 用 UIA `ScrollItemPattern.ScrollIntoView()` 或直接找 offscreen 元素 SetFocus |
| React 按钮点了没反应 | 合成点击不过用户激活检查 | 用 UIA `InvokePattern.Invoke()` |

## 6. 已知缺口（不再重复踩）

1. **Reddit profile 站点链接没设上**——设置页的"社交链接/关于描述"行不响应合成点击，
   `social-links` 子 URL 404，old.reddit 页面滚不动。当前替代方案：链接只放在"分享型线程"的评论正文里。
2. **Telegram 没找到真群**——搜 polymarket 前 7 个结果全是赌场引流频道（9,604 人的那个正文是
   "Cafe Casino 350% Welcome Bonus"）。要找中文"预测市场"或 kalshi 相关，还没做。
3. **Reddit 新号不能发帖**——独立帖必被站点级筛选器移除，只能评论。等 karma 20+。
4. **首发保险组件默认关闭**——`NEXT_PUBLIC_FIRST_BET_INSURANCE_USDC` 未设置，因为没有资金来源。

---

## 7. 成本

现金 **0 元**。全部成本是我的执行时间：
- Reddit 一轮 15 分钟（GUI 驱动，慢）
- Bluesky 自动
- SEO 每周 30 分钟

上限也必须说清：**零预算 + 单账号 + 无粉丝基础，30 天现实区间是 50–300 访客/天，
不是"上线就爆"**。任何说能更快的方案，要么在买量，要么在造假数据。
