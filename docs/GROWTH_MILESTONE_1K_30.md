# 冲刺白皮书 — 1K 粉丝 / 100 TG 会员 / 30 真实交易者

三个目标不是同一件事：粉丝是分发，会员是留存，交易者才是收入。所以下面的顺序按"离钱最近"
排——先把 30 个真实交易者打出来，用他们的战绩去换 100 个会员，再用会员的复投去换 1K 粉丝。
反过来做，通常会得到一个热闹但没人下注的账号。

**基线（2026-10-28）**：X `@Predict065` 0 粉 · TG `@predictionarena_hq` 1 人 · 链上真实下注 0 笔。
所有数字都要能在 Basescan 或频道里当场验证——这条是硬约束，下面每个战术都遵守。

---

## 1. 30 个真实交易者（14 天）

这是唯一能自己闭环的目标，也是另外两个的燃料。

| 步骤 | 机制 | 为什么有效 |
|---|---|---|
| ① 零资金入场 | Watch-to-Earn：看一次赞助位 → 10 分，100 分 = $1 体验券，券可下注、盈利归用户 | 新人不需要先买 USDC、不需要过 KYC、不需要信任我们的提现 |
| ② 一键落地 | Farcaster Frame：信息流里看到概率 → 点 `🟢 Predict YES` → 带 `ref=fc` 直接落在预选方向的盘口页 | 少一次跳转就少一半流失；frame 的图就是盘口本身 |
| ③ 首单激励 | 首次下注后，TG 频道公示"第 N 位交易者"（地址打码） | 公开承认早期用户，比空投承诺便宜且真实 |
| ④ 复投 | 结算收据发到 X + TG，附"claim 是一笔合约调用，永不可暂停" | 让第 2 笔的门槛低于第 1 笔 |

**14 天拆解**：第 1–3 天 5 人（团队 + 朋友，全部真实下注 $1–5）· 第 4–7 天 10 人（Farcaster
`/degen` `/base` 的 frame 转化）· 第 8–14 天 15 人（X 评论区 + TG 跨群）。

**判定口径**：一个地址在合约上有 ≥1 笔 `BetPlaced`，且金额 ≥ $1。不是"连接过钱包"。

---

## 2. 100 TG 会员（21 天）

会员数只有在"进群有事发生"时才涨。频道每天两班内容（09:10 / 17:10 UTC，由 GitHub Actions
自动发），这就是"有事发生"。

| 渠道 | 动作 | 预期 |
|---|---|---|
| X 引流 | 每条推文末尾固定一行：`Daily board + settlements: t.me/predictionarena_hq` | 推文曝光 × 1–2% |
| Farcaster | 结算收据 cast 里带频道链接 | frame 点击的 5–10% |
| 站内 | 页脚 + Portfolio 抽屉的 Invite 卡都指向频道 | 站内自然流量 |
| 邀请返佣 | 每位成员的邀请链接带 `?ref=<wallet>`，被邀请人下注 → 合约从 4% 手续费分给邀请人 | 早期成员有真实动力拉人 |

**关键**：返佣不是我们掏钱，是合约的 `referralCut` 已经写好的分配。所以"拉人"和"赚钱"是同一件
事，无需预算、无需结算后台。

**21 天拆解**：第 1 周 20 人（现有渠道 + 团队）· 第 2 周 45 人（X + FG 稳定输出）· 第 3 周
100 人（成员邀请占 40%）。

---

## 3. 1K X 粉丝（30 天）

粉丝是前两个目标的结果，不是起点。用"每天两条有数字的推文"换关注。

**自动化的部分**（每天 UTC 09:10 / 17:10，GitHub Actions）：
- 09:10 — 赔率最悬殊的盘口（"crowd is paying 7.1× on one side"）
- 17:10 — 最快到期的盘口（"still 4h left to take a side"）
- 每条都带实时概率、赔付倍数、人数、`predictionarena.online` 链接 + `utm_source=x&ref=x`

**人肉的部分**（每天 20 分钟，这是涨粉真正的引擎）：
- 选 5 个 Base 生态账号（`@aerodrome_fi` `@degen_token` `@zora` `@base` `@base_ecosystem`），在
  他们发帖后 20 分钟内回复一条"带数字的观察"，不是链接广告。
- 每天最多 8 条回复，同一线程不回两次。
- 每周 2 条 AI Debate 式推文（两个 agent 的分歧点），这类内容转发率最高。

**30 天拆解**：第 1 周 100 粉（团队 + 早期用户互关 + 评论区）· 第 2 周 300 · 第 3 周 600 ·
第 4 周 1000。每周复盘一次"哪条回复带来了 profile visit"，把有效的句式固化进
`docs/GROWTH_PLAYBOOK_EXECUTION.md`。

---

## 4. 每日/每周节奏（自动化已接管的部分标 🤖）

| 时间 (UTC) | 动作 | 谁做 |
|---|---|---|
| 09:10 | 盘口推文 + TG 日报 + 归档 | 🤖 GitHub Actions |
| 17:10 | 临期盘口推文 + TG 提醒 | 🤖 GitHub Actions |
| 每日 | 5 个 Base 账号评论区回复 | 人（20 分钟） |
| 每日 | 结算收据（有结算时） | 人 |
| 周一 | 周复盘 + 本周排期检查 | 人 |

---

## 5. 指标（每周看一次，别每天看）

| 指标 | 口径 | 30 天目标 |
|---|---|---|
| 真实交易者 | 合约 `BetPlaced` 唯一地址，≥$1 | 30 |
| TG 会员 | 频道订阅数 | 100 |
| X 粉丝 | profile 粉丝数 | 1,000 |
| Frame 转化 | frame 展示 → 带 `ref=fc` 的落地 | ≥8% |
| 邀请贡献 | 带 `ref` 地址的下注占比 | ≥15% |

`/admin` 的 **Growth attribution** 面板给的是链上那一半（下注数、经推荐人的下注、已付分润）；
渠道那一半需要接分析 sink，具体缺口写在面板里。

---

## 6. 凭据与部署现状（这一节是运维手册）

### 6.1 Telegram（已通，缺一步）

Bot `@predictaing_bot` 可正常调用 API，但**还不是频道管理员**，所以 `sendMessage` 返回 403
`bot is not a member of the channel chat`。

一次性修复（30 秒）：
1. 打开 `@predictionarena_hq` → 频道标题 → **管理 (Manage)** → **管理员 (Administrators)** → **添加管理员**
2. 搜索 `@predictaing_bot` → 选中 → 勾选 **发布消息 (Post messages)** → 保存

做完这一步，GitHub Actions 的下一次运行（09:10 / 17:10 UTC，或手动 dispatch）就会真的发出去。

### 6.2 X（凭据类型不对，需要换）

当前 `X_BEARER_TOKEN` 是 **app-only bearer**：只能读，不能发。API 明确回：

```
403 Unsupported Authentication
"Authenticating with OAuth 2.0 Application-Only is forbidden for this endpoint.
 Supported authentication types are [OAuth 1.0a User Context, OAuth 2.0 User Context]."
```

发推需要下列任一：

| 方案 | 需要什么 | 放哪里 |
|---|---|---|
| A. OAuth 1.0a（最快） | 在 X Developer Portal 的 **Keys and tokens** 里生成 *Access Token and Secret*（权限 Read and Write），连同 API Key/Secret 四项 | 四个 secret：`X_API_KEY` `X_API_SECRET` `X_ACCESS_TOKEN` `X_ACCESS_SECRET` |
| B. OAuth 2.0 User Context | 用 Client ID + PKCE 走一次授权，得到 user access token（`tweet.write` scope） | 替换 `X_BEARER_TOKEN` |

脚本已经能识别这两种失败并输出上面这段原因，不会让 workflow 变红。

---

## 7. 硬约束（违反任何一条，这个白皮书作废）

1. 不编造数字、不伪造钱包、不虚构盈利截图。链上有什么，就说什么。
2. 不承诺收益、不用 "risk-free" / "guaranteed"；4% 手续费托管、取消全退，照实说。
3. 只在官方渠道发：`@Predict065` / `@predictionarena_hq` / `predictionarena.online`。
4. 别人的社群先问管理员，被拒就换一家，不硬刷。
5. 每周把"没做到的"写进本文件的指标表——这份文档的价值在于它不撒谎。
