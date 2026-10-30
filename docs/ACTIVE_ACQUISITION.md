# 主动获客与截流引擎 — 运行手册

这份文档写的是**已经跑起来的东西**和**卡住的东西**，以及每一条卡点的解锁命令。
数字全部来自真实运行日志（GitHub Actions run id 写在对应段落里），没有估算值。

---

## 1. 三条管线，各自跑在哪

| 管线 | 脚本 | 跑在哪 | 节奏 | 状态（已验证） |
|---|---|---|---|---|
| X 截流 | `scripts/active-x-interceptor.ts` | GitHub Actions（`x-interceptor.yml`） | 每 15 分钟排一个 335 分钟监听窗，窗内每 90 秒扫一次 | **读不到 X**：bearer 401、自签 bearer 402 `credits depleted` |
| TG 团长 | `scripts/telegram-bot.ts` | GitHub Actions（`captain-bot.yml`）+ 本机 crontab | 一次长轮询 55 分钟，30 分钟排下一班，无缝接力 | **在跑**：`bot @predictaing_bot polling…`（run 40992175732） |
| Farcaster | `scripts/farcaster-auto-cast.ts` | 挂在 `auto-marketing.yml` 里，每天两班 | 每班给 /base、/degen 各一条 | **compose 通过、未发布**：没有 signer |

桌面包（`scripts/push-desktop-marketing.ts`）仍是零成本分发的一环，但内容已经改成纯可粘贴格式：
`01-main-tweet.txt` 只有推文本身，`02-alpha-reply-deck.txt` 是三段各三行的对决文案，
`weight/source/ref` 这些给机器看的行全部移到 `meta.json`。

---

## 2. 一条推文从发出到能粘贴，中间发生什么

```
监听（7 个账号，90 秒一轮）
  → 只处理 5 分钟内发的（INTERCEPT_FRESH_MS，默认 300000）
  → 抓 cashtag / ticker / 部落词，匹配盘口（同分取人多的）
  → 生成三行：
       $AERO $0.6074 · 311 positions already in
       YES █░░░░░░░ 17% → 5.9× · NO ███████░ 83% → 1.2×
       2d left → predictionarena.online/market/700011?ref=x&utm_source=x
  → 写 .data/intercept/queue/<tweetId>.txt（纯文案）
    + queue.json / QUEUE.md（带“回哪条推”的 URL）
  → 进 Actions job summary + artifact（手机上可看）
  → 配了 INTERCEPT_NOTIFY_CHAT 就直接私信到那个 chat
```

已看到的推文 ID 记在 `.data/intercept/state.json`，同一分钟重跑不会重复生成。

输入有两路：7 个账号的时间线 + `$AERO / $DEGEN / $TOSHI` 的 recent search（`scripts/config/intercept-targets.json`）。
输出有两档：`--reply`（或仓库变量 `INTERCEPT_AUTO_REPLY=1`，默认开）直接用 OAuth 1.0a 把它作为
`in_reply_to_tweet_id` 的回复发出去；关掉就只落草稿，等人粘。发失败会原样打印对方的状态码
（401/402/403），不会把「没发出去」写成「已发」。

源码选择顺序（`--probe` 会逐条打印真实结果）：

1. `X_BEARER_TOKEN` —— 现值为 **401 Unauthorized**（token 已失效/被轮换）。
2. 用 `X_CONSUMER_KEY` + `X_CONSUMER_SECRET` 现场签一个 app-only bearer
   （`POST /oauth2/token`，client_credentials）—— 签发**成功**，但读时间线返回
   **402 `credits depleted`**：X 账号没有 API 额度。
3. 浏览器持久化 profile（`--login` 登录一次后复用）—— 本机与 Windows 侧访问 x.com 均为
   403/404（数据中心 IP 被拦），无法作为免费通道。
4. Nitter 镜像 —— 2026 年已全线报废：xcancel 451（服务被停）、privacyredirect 403（Gandalf）、
   lightbrd / nitter.space Cloudflare 403、ovo.si / catsarch / holo-mix 连接被关闭、
   tiekoetter / bird 返回 0 条（guest token 失效）。

---

## 3. 团长闭环（这条真的在跑）

1. 频道日报每条都挂 `🧑‍💼 Become a Captain (Earn 30%)` → `t.me/predictaing_bot?start=captain`。
2. 用户点进去：bot 立刻要收款地址 → 收到 `0x…40` → 同一条消息里给出
   **专属 `?ref=<地址>` 链接 + 中英两版群发话术**（3 秒内，因为长轮询本来就在等）。
3. 绑定写进 register（CI 里是 Actions cache，本机是 `.data/captains.json`），重启不丢。
4. bot 在服务期间每 15 分钟检查一次盘口：有新盘就**主动私信每个团长**，
   文案里带**他自己的 ref 链接**和“一键转发”按钮 —— 团长只要按下转发。
5. `/copy` 随时补发群话术，`/link` 补发链接，`/how` 解释 30% 从哪来（合约结算时从 4% 手续费里付）。

验证：`bun run bot:selftest`（26 条断言，含“注册表重启后仍在”“私信里带的是这个团长自己的 ref”）
+ CI 日志 `bot @predictaing_bot polling… (0 captains on file)`（新表，之前没有持久化，所以是 0）。

---

## 4. Farcaster

`bun run cast --plan` 现在产出：

```
/base  market 700011  189/320
$AERO $0.6074 · 17% YES pays 5.9×
YES █░░░░░░░ 17% · NO ███████░ 83%
311 in · 2d left
predictionarena.online/market/700011?ref=fc&utm_source=farcaster&…

/degen market 700035  193/320
$DEGEN $0.0008551 · 21% YES pays 4.8×
…
```

发布分支已经写好（Neynar `POST /v2/farcaster/cast`、Warpcast `POST /v2/casts`），
`--publish` 目前如实输出 `skipped — no Farcaster signer`。读取侧：`api.warpcast.com/v2/all-channels`
可免费访问（7.9 MB 正常返回），`hub-api.neynar.com` 已改为 x402 付费（402）。

---

## 5. 卡点与解锁命令（各一条）

**X 读（截流的前置条件）** — 402 是计费，不是代码：

```bash
# 充值/开通读权限后，本地即可验证：
X_BEARER_TOKEN=<新token> bun scripts/active-x-interceptor.ts --probe
```
同一条命令也会用 `X_CONSUMER_KEY/SECRET` 现场签发并试读，签出来是 402 就说明额度没到账。

**X 写（自动回帖）** — 需要 OAuth 1.0a 四件套的账号额度（同样是 402）：

```bash
X_CONSUMER_KEY=… X_CONSUMER_SECRET=… X_ACCESS_TOKEN=… X_ACCESS_SECRET=… \
  bun scripts/auto-market.ts --pick=tribal --limit=1 --send
```

**Farcaster 发布**：

```bash
gh secret set NEYNAR_API_KEY --repo lulaxiao97-create/prediction-arena
gh secret set NEYNAR_SIGNER_UUID --repo lulaxiao97-create/prediction-arena
# 下一次 auto-marketing 跑起来就会真的 cast，不需要改代码
```

**截流草稿直接进手机**（可选，配一次即可）：

```bash
gh secret set INTERCEPT_NOTIFY_CHAT --repo lulaxiao97-create/prediction-arena  # 值是一个私有 chat id
```

---

## 6. 每次改完要跑的验收

```bash
bun run intercept:selftest     # 匹配 / 5 分钟窗 / 去重 / 三行格式 / 无技术噪声
bun run cast:selftest          # 频道路由 / ≤320 / frame embed 带 ref=fc
bun run bot:selftest           # 对话闭环 + 注册表持久化 + 私信带本人 ref
bun run push:marketing --dry-run
cd frontend && bun run build && bun run test:e2e      # 23 passed（当前基线）
```

CI 侧的三个客观事实来源：`gh run view <id> --log`（监听/发帖每一步的真实输出）、
job summary（截流草稿与团长名单）、`curl -s https://predictionarena.online/og.png | md5sum`（线上资产）。
