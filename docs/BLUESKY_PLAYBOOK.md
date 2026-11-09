# Bluesky 打法（2026-11-09）

> 为什么不能把 X 那套搬过来：X 有推荐算法，发得多、发得勤、带挑衅就有机会被推给陌生人。
> Bluesky 没有这个层。它的 Discover 是弱推荐，一条帖子的天花板基本由「谁转了你」「谁回了你」
> 决定。同一份内容，在 X 是流量，在 Bluesky 是自言自语。

## 一、Bluesky 的流量从哪来（按杠杆排序）

| 杠杆 | 机制 | 我们能用的方式 |
|---|---|---|
| **1. 自定义 Feed** | 用户订阅一个 feed，里面所有帖子进入他的时间线。这是 Bluesky 独有的分发层 | 建一个 "Prediction Markets" feed，把我们 + 全网的预测市场讨论聚合进去，订户越多人越多 |
| **2. 回复大账号** | 回复会出现在原帖下面，等于借用别人的流量池 | 每天在 5–10 条加密/Base/宏观大帖下留一条有信息量的回复，不贴链接 |
| **3. Starter Pack** | 一个「关注这些人」的打包推荐，被引用一次就能带来一批关注 | 建 "Crypto Prediction Markets" starter pack，把我们放第一个，附上 Polymarket/Base 生态账号 |
| **4. 自己的关注者** | 只有真关注你的人能看到 | 初期最弱，靠 1–3 慢慢养 |
| **5. 标签** | 有，但权重极低 | 只在事件帖里用 1–2 个（#FOMC），不做标签堆砌 |

结论：**先做 2（回复），同时做 1（feed），再做 3（starter pack）**。发帖本身是维持，不是增长。

## 二、内容：三张牌，一张都不能换成"播报"

Bluesky 用户对营销腔的容忍度比 X 低得多。emoji 三连、"🚀 加入我们"这种，在这里等于自杀。
能传播的只有两种：**别人可以反驳的具体判断**，和**别人可以核验的证据**。

我们恰好有后者 —— 这是唯一比别人强的地方。

### 牌 1：错价（mismatch）
> ETH is down 4.4% today ($2,140). Our board still prices "Will Ethereum trade above $2,165 before
> November 10" at 62% YES. Either the market is slow, or it knows something the tape doesn't.

一句话、一个数字、一个可反驳的判断。这是目前唯一一条已经发出去的帖子用的格式。

### 牌 2：二选一（question）
> Two markets, two very different prices. One of them is wrong.
> · Will Solana close above $106.60 — 23% YES
> · Will a G7 country ban an AI model this year — 17% YES
> Which side would you take?

目的是**换回复**。Bluesky 上一条有 5 条回复的帖子，比 50 个赞有用得多。

### 牌 3：结算回执（settled）
> Settled on-chain: NO. "Will ETH close above $2,250 on Nov 15?" Evidence hash 0x… written to Base
> at settlement.

这是**别人发不出来的内容**。Polymarket 不会发哈希，Kalshi 是中心化的。每个结算发一条，
30 天后这个号就是「那个每次都把证据贴出来的预测市场」。这类内容不追流量，追的是可信度。

## 三、节奏：一天三条，不多

| 时间 | 内容 | 为什么是这个点 |
|---|---|---|
| 09:10 | mismatch | 美股/加密开盘前，交易者在刷 |
| 15:10 | question | 美东盘中，互动率最高的时段 |
| 21:10 | mismatch（换一个板块） | 美东收盘后复盘 |

已经落地：`scripts/bluesky-daily.sh` + crontab `10 9,15,21 * * *`。
内容全部由 `scripts/bluesky-content.ts` 从 `pools.json` / `prices.json` 算出来，没有人工编数。

## 四、30 天计划

**第 1 周：内容 + 回复**
- 每天三条按表跑，观察哪一类有回复
- 每天手动（或半自动）在 5–10 条大帖下回复：找 `prediction market`、`Base`、`FOMC` 相关的帖子
- 目标：不当哑巴，先被看见 20 次

**第 2 周：Feed**
- 建 "Prediction Markets" feed generator（AT Protocol 的 feed generator 是一个公开服务，
  按关键词 + 作者过滤，把全网的预测市场讨论聚进来）
- 我们自己的帖子天然在里面，等于给自己加了一个常驻分发位
- 这是 Bluesky 独有、X 没有的东西，值得花时间

**第 3 周：Starter Pack**
- 建 "Crypto Prediction Markets" starter pack：我们 + Polymarket 官号 + Base 生态 + 3–5 个喊单号
- 主动发给 2–3 个加密 Newsletter/KOL，请他们引用

**第 4 周：复盘**
- 看哪个格式带来回复、哪个带来关注
- 砍掉无效格式，加倍有效格式

## 五、明确不做

- **不刷标签**：Bluesky 不是 Instagram，标签堆砌只显得廉价
- **不复制 X 的看板播报**：那是给算法看的，这里没人看
- **不纯链接帖**：链接放进文末一行就够，链接当正文等于零互动
- **不 cron 轰炸**：一天超过三条就是在消耗关注者的耐心
- **不假装有交易量**：盘口赔率是我们模型给的，文案里说 "our board prices"，不说 "traders are betting"

## 六、技术底座（已落地）

- `scripts/bluesky.ts` — AT Protocol 客户端：登录（session 存 `~/.hermes/.bsky_session.json`）、
  发帖、图片上传、串推。**不走浏览器，不需要桌面解锁**，这是它比 X 那套稳的根本原因。
- `scripts/bluesky-content.ts` — 三种格式的文案生成，数据全部来自 `pools.json` / `prices.json`。
- `scripts/bluesky-daily.sh` — 按小时选格式并发布。
- 账号：`@predictionarena.bsky.social`（头像、简介、首帖已配置）。

---

## 已上线：Prediction Markets 自定义 Feed

订阅地址：

```
at://did:plc:hn527g3nbpxkgs4c4xbwnq2y/app.bsky.feed.generator/prediction-markets
```

网页入口（登录后可直接点 Add）：

```
https://bsky.app/profile/predictionarena.bsky.social/feed/prediction-markets
```

这条 feed 把全 Bluesky 上关于事件合约、赔率、Polymarket / Kalshi、forecast market 的讨论聚到一起，
由我们运营。它解决的是冷启动问题：一个 0 粉丝的账号发帖没人看，但一个「预测市场信息源」本身就
有订阅价值 —— 订阅者每次打开 Bluesky 都会看到这个 feed，而 feed 的运营者是我们。

### 怎么做的（也解释了为什么它不会挂）

- `frontend/public/.well-known/did.json` 声明 `did:web:predictionarena.online`，service 指向本站。
- `/xrpc/app.bsky.feed.getFeedSkeleton` 读 `public/feed-skeleton.json`，只做分页和缓存，不联网，
  所以不会超时。
- `scripts/bsky-feed-refresh.ts` 才是联网的那一半：八个关键词搜索、过滤回复/广告/非英文/不点名主题
  的帖子，按新鲜度+信息量+是否含数字打分排序。它在这台机器上跑（会话在这里），把结果写成文件。
- `scripts/bsky-feed-cron.sh` 每 30 分钟刷新并推送，Render 自动部署。搜索失败时保留上一版，
  feed 不会空。
- Access token 两小时过期，脚本会自动 refresh —— 否则重启后 feed 会静默冻结。

### 运营这条 feed 的价值

1. 订阅数是最诚实的指标：它衡量"有人主动要这个信息源"，不是点赞虚荣。
2. feed 里的帖子来自别人，我们只是编辑 —— 这让我们有理由去回复那些作者，而不是自说自话。
3. 等第一笔真实结算发生，"settled" 格式的帖子可以让 feed 里出现只有我们能提供的内容。
