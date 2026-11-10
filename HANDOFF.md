# HANDOFF — 2026-11-10 收工存档

## 这一轮做了什么（一句话）

**积分制度整体撤销，玩法入口重建**：广告方未准入 ⇒ 积分没有兑付来源，于是把积分/体验券/广告位/
空投那一整套从产品、接口、机器人、白皮书里删干净；换来两个能验证的新入口——无钱包免费猜（服务端真计数）
和立场 PNG 分享图。全部细节在 `docs/SESSION-2026-11-10.md`，玩法与活动全表在
`docs/PLAYBOOK-2026-11-10.md`。

## 代码状态

- `tsc --noEmit` 0 error，`bun run build` 0 error（日志 `logs/build-2026-11-10c.log`）
- `telegram-bot.ts --self-test` OK；机器人已重启到新代码（`--report` 取代 `--leaderboard`）
- crontab 两条积分任务已删（`sync-points.ts`、`--leaderboard`）

## 明天从哪接（按优先级）

1. **重写桌面推广物料**：`scripts/push-desktop-marketing.ts` 里 12 个文案块仍含积分/空投，
   脚本已 fail-closed（命中即不落盘）。改成"盘口 + 4% 费率 + 结算证据"就能全部放出来。
   先跑 `bun scripts/push-desktop-marketing.ts --dry-run | grep WITHHELD` 看清单。
2. **过期盘不要滞留**：`settle-cron.sh` 一天只跑一次（03:20）。改成每小时一次（只处理过期且零 stake 的盘），
   board 上就不会堆着昨天到期的盘。
3. **事件盘日历**：Macro 只有 16 个盘，FOMC/CPI 前一天开盘是最有搜索需求的缺口。用 `auto-gen.ts` 的
   事件模板提前 48h 建盘，当天各推一次。
4. **X 号**：`ArenaOnBaseHQ` 差一次人脸活体（要有摄像头的设备）；`Predict065` 缺 2FA 密钥。
   两条都卡在平台侧，别再重试注册。

## 别做的事

- 不要再往页面上加任何"看起来热闹"的合成数字。本轮把最后两处也清了
  （跑马灯的人数/流动性、右下角提示条的人数），`displayTraders()` 的生产使用者现在是 0。
- 不要再提积分、$ARENA、空投、1:1 兑换。白皮书已撤回，机器人会自己断言拦下，推广脚本会拒写。
- 不要把"免费猜的人数"说成"用户数"：那是 tap 计数，1 IP 每盘 1 次，重启实例会归零。
- 不要再让生成器写任何"看起来有成交"的字段（traders / liquidityUsdc / volume24hUsdc）。2026-11-10 已从
  `gen-board.ts` 删掉，`poolStats()` 对 demo 行返回 0/—/0，dashboard 的 TVL 只加链上托管。显示 `$0` 是对的。

---

# HANDOFF — 2026-11-09 深夜收工存档

## 收工时的状态（2026-11-09 03:30，老板关机前）

**代码全部已提交并推送**，最后一笔 commit `664480f`（market card 假数字清理）。CI 会在下次开机后
自己在 GitHub 上跑完，不影响。

### 这一轮做完的事（按重要性）

1. **Bluesky 全链路**：`@predictionarena.bsky.social`（头像/简介/feed 链接齐）
   - 发帖：`scripts/bluesky.ts` + `bluesky-content.ts` + `bluesky-daily.sh`，cron 09:10/15:10/21:10
   - 自定义 Feed 已上线：`at://did:plc:hn527g3nbpxkgs4c4xbwnq2y/app.bsky.feed.generator/prediction-markets`
   - Starter pack：`bsky.app/starter-pack/did:plc:hn527g3nbpxkgs4c4xbwnq2y/3mzufhxigun2r`
   - 三条真人回复（@angrydonkeynews / @crary / @qadishtujessica）
2. **网站三个真 bug**：三个板块空（category alias 缺失）、RPC 抖动整页空、CI 自 11-04 一直红
   → 全部修复，29/29 E2E 绿
3. **增长研究**：`docs/GROWTH_RESEARCH.md`（Cal AI / Halo / Lovable / Polymarket / Kalshi 的真实数据）
4. **产品改动**：hero 换成 FOMC 事件盘并加锁（不再跳盘）、QuickGuess 零门槛猜 + 结算后判对错
5. **诚实修复**：hero 和全部 247 张卡片上的 `$XXk liquidity / N traders` 是 `displayStatsFor()`
   用 id 哈希编出来的，已全部换成 "Priced by live feeds" + 结算倒计时。**这条别回退**。

### 明天（11-10）从哪接

按优先级：

1. **分享图**：`/api/share/[id]` 生成 PNG（复用 `market/[id]/opengraph-image.tsx` 的
   `ImageResponse`），带问题 + 概率 + 用户立场。QuickGuess 现在的 share 只复制文字。
2. **猜的计数**：`/api/guess`（JSON 文件 + 60s 缓存，同 `/api/board` 手法），有了真人数才有从众。
3. **检查部署**：`curl -s https://predictionarena.online/ | grep -c "Priced by live feeds"`
   应该是 247 左右；hero 应该是 "Priced by live feeds" 而不是 "$59.8K liquidity"。
4. **X 号**：`ArenaOnBaseHQ` 只差一次人脸活体（需要带摄像头的设备登录一次）。
5. **awesome list PR** 两个还开着：aarora4 #284、0xperp #60，可以隔几天去看看有没有人回。

### 别做的事

- 不要再往 hero / 卡片上加任何"看起来热闹"的合成数字（人数、成交量、流动性）。
  这是老板明确否过的方向，也是这个站点唯一不能做的事。
- 不要在没有摄像头的情况下重试 X 注册（会再次卡在人脸那步）。

---

# HANDOFF — 2026-11-04 收工存档

## 2026-11-09 重启后：X 被风控锁、66 个过期盘口清空、发布链路修复

- **X 不是封号**：`x.com/Predict065` 未登录可正常访问（og:title 正常）；浏览器停在
  `x.com/account/access`「确认你是人类 / 手机扫码」。点 Log out 后密码通过，但卡在 **2FA (TOTP)**，
  本机无密钥（Local Storage / IndexedDB / Login Data 全查过）→ **需要卖号方提供 2FA secret**。
  X 三个 daemon 已在 crontab 加前缀 `#PAUSED-X-LOCK 2026-11-09`，恢复登录后要手动去掉。
- **publish-board**：rebase 冲突（`docs/campaigns/attribution.json`，CI 也写）已修 —— 生成型数据
  冲突取本地版本继续，其他文件冲突仍然 abort。
- **settle-expired.ts 有真 bug**：用正则从 `getPools` 文本里按位置取 `option0/option1`，标题里的
  数字（`November 5 2026`、`$0.00000502`）把位置挤歪，导致每个池都判「有 stake」而 REFUSE。
  改成直接读 `optionPool(uint256,uint8)`。
- **66 个过期池已全部作废**（链上逐个核过 status=3），零用户本金（合约里只有 1.00 USDC 自测）；
  新增 `scripts/settle-cron.sh` + crontab `20 3 * * *`，每晚自动作废空池，有 stake 的仍 refuse。
- **运营钱包** `0x436b…5Ba1` 只剩 0.000333 ETH，低于 `open-pools-batch.sh` 的 0.0004 门槛 →
  开新池停摆（Base gas 才 0.006 gwei，清理不受影响）。
- 完整记录：`docs/SESSION-2026-11-09.md`。



## 2026-11-04 收工存档（老板关机前）

### 今天真正做完的（都有回执，不是"提交了"）
- **GSC**：`https://predictionarena.online/` 已验证（HTML 文件），sitemap 已提交 245 条。
- **Bing**：Google 账号登录成功，站点已加，Bing 自己抓到 sitemap：236 URL / Success。
- **TVL**：arena `0x9618…10b5` 收到 1.000000 USDC，tx `0x7ce9fdb3…95b082`（swap 走了 0.0007 WETH→1.60 USDC 再转 1.00）。
- **DefiLlama**：PR #21991 的 CI 重跑后导出 `base 1.00 / total 1.00`，reviewer 的 "non zero TVL" 条件已满足，等 merge。
- **airdrops.io**：Points program 表单已提交，回执「Your project is with our listings team」。
- **base.eco**（Base 生态目录）：DeFi 类目已提交，回执「Got it - thanks」。
- **Product Hunt**：账号已建（Google 登录，xiao Lula），产品草稿完整并 Saved（tagline / Crypto·Fintech·Web3 / Maker / 首评）。
  草稿 `producthunt.com/posts/new/WDN4GAKAULTPLBWVFQXVFBJ7QS7DPYKSO2`；**刻意未排期**，理由见 docs/ACQUISITION_ROUND2.md。
- **SEO**：`/markets` 232 条内链、`/llms.txt`、8 个 `/category/*` 落地页、sitemap 245、IndexNow 245 条 200。

### 下次开机先看这里
1. DefiLlama PR 是否 merge（`gh pr view 21991 -R DefiLlama/DefiLlama-Adapters`）；merge 后在 defillama.com 查 prediction arena 是否出现。
2. X/Telegram 种子关注量是当前唯一真瓶颈（PH 上线前至少要 100 个真关注）：先看 `data/growth.jsonl` 的 followers。
3. DappRadar 仍未提交：提交页在登录墙后，页面按钮不吃合成点击（见下条）。
4. 事件驱动建盘（CPI/FOMC 前 48 小时）：Macro 只有 13 个盘，是搜索需求最大的缺口。

### 浏览器自动化的硬规则（今天踩完才明白）
- **截图前必须把目标窗口提到最前**：`capture.ps1` 已加 `SetForegroundWindow`，否则抓到的是自己的终端窗口。
- **点击要发两次**：窗口未激活时第一次点击被窗口管理器吞掉（只负责激活）。`uia_fill.ps1` 已内置双发。
- **不要用 powershell 直接跑**：会弹控制台抢焦点、键盘打到自己窗口里。一律走
  `wscript.exe //nologo scripts/run-hidden.vbs "-File …"`。
- **Chrome 自己的 UI（Google 账号选择器、权限气泡、扩展弹窗）不吃合成鼠标点击，但实现了 InvokePattern**：
  用 `uia_invoke.ps1 -Match "继续"` 直接触发才通。今天 Product Hunt 的 Google 登录就是这么过的。
- 下拉框/标签面板里的项点不动时，用 `uia_typein.ps1 -Name "<搜索框名>" -Text "词"`（内部先 ^a 再输入再回车），
  它会把 tag 加进去；不加 ^a 会出现 "CryptoWeb3Fintech" 这种连写。

内部工作笔记（`.gitignore` 里已排除，不进公开仓库）。

## 2026-11-04：cron 的 PATH 缺 WSL interop / bun / gh → 桌面自动化静默停摆 13 小时

- 症状：11-03 21:09 之后 posts 卡在 34、following 卡在 81、intercept 一条没发、followers 只 +1。
  日志是 `slot 09 (board): due, desk busy` 和 `powershell.exe: command not found`；`llama-pr-watch` 报 `gh: ENOENT`。
- 根因：cron 默认 PATH 只有 `/usr/bin:/bin`。`desk-ready.ps1` 调不到 → `desk_ready()` 拿到空串 → 永远判 "busy"，
  内容和拦截引擎因此一条都发不出；followback 直接报 powershell 找不到。`gh`(~/local/bin)、`npx` 同理。
- 修法（三层，缺一不可）：
  1. `crontab` 顶部加 `PATH=`（含 `~/.local/bin`、`~/.bun/bin`、`/mnt/c/Windows/System32/WindowsPowerShell/v1.0`、
     `/mnt/c/Windows/system32`）—— gh / node / bun / powershell 一次全解决；改前备份在 `/tmp/cron.bak`。
  2. `x-content-daemon.sh`、`x-intercept-daemon.sh`、`x-followback-daemon.sh`、`x-post.sh`、`x-daemon.sh`
     在 `cd "$ROOT"` 之后 `export PATH="$PATH:/mnt/c/Windows/System32/WindowsPowerShell/v1.0:..."`（脚本级兜底）。
  3. 改完必须**重启 daemon** 才生效：`kill -9 <pid>`（TERM 会被 trap 拦在 sleep 里），再重新起；
     若日志出现 `already running`，是**孤儿 sleep 还占着 flock**：`fuser .data/followback.lock` 找 pid，kill 掉那个 sleep。
- 验证：`10:47 seed @jessepollak: followed 6 — done followed=6 attempted=6` ⇒ UIA 链路恢复。
  内容槽位照旧等 desk idle ≥120s；09:00 槽的窗口到 11:00，错过就跳过（不补发）。
- 教训：任何"desk busy"连刷超过 4 次，先跑一次 `desk-ready.ps1` 看是不是**空输出**——空输出=命令没找到，不是老板在用电脑。

## 2026-11-03：ops tier 卡死修复（踩过的坑，别再犯）

- `ops-refresh.ts` 对 **232 个池子逐个 `queryFilter(BetPlaced)`**，每个都被公共 RPC 429，ethers 退避重试 → 一次 tick 跑不完一小时，cron 只会不停叠新 tick。现在 `totalNetPool == 0n` 的池直接跳过 getLogs（余额为 0 就不可能有下注），日志窗口从 45k 块收到 2k 块。整 tick 从 **>68 分钟（挂死）降到 2 分钟**。
- `ops-daemon.sh` 加了 `flock`（一次只跑一个 tick）和 `HARDHAT_TIMEOUT=900`，并把 `$HARDHAT` 放在 `timeout` 后面（不加引号，`npx --no-install hardhat` 的回退路径才能分词）。
- `.env` 的 `BASE_RPC_URL` 从 `https://mainnet.base.org`（eth_getLogs 全被 -32011 限流）换成 `https://base-rpc.publicnode.com`。**注意 hardhat.config.ts 会 `delete process.env[...]` 再 `dotenv override`**，所以命令行里临时 `BASE_RPC_URL=... hardhat run` 是无效的，只能改 `.env`。
- 另外：WSL 里 `pkill -f "<脚本名>"` 会匹配到自己这条 bash 命令行，把自己 SIGTERM 掉（今天连中两次）。杀进程用 `pgrep -f '^bash scripts/xxx\.sh'` 或按 PID。

## 2026-11-03：TTL 垃圾回收 + 文案统一 + PR 值守

- `scripts/clean-expired-queues.ts`（新）：用 `logs/ops-refresh.json`（链上 endTime/status，权威）+ manifest 兜底算出"死盘"，然后清四类东西：reply 队列（>2h 或指向死盘）、`daily-funnel*.txt`、推广包的 `01-main-tweet*`、`hot.json`；并产出 `.data/hot-3.json`（永远的 top 3 活盘）。24h 未结算的单列告警，不静默。
- `hot-board.ts` 之前**只按 status 过滤**，已结束未结算的盘会以"ends in -28h"被推上热榜——现在同时要求 `endTimeUtc > now`。
- 文案统一到 `scripts/lib/genesis-copy.ts`：日推、回复、包文案共用一套（42% / $0 TVL / 零团队预留 / 三步 / +500 分）。预算逻辑改成"按优先级贪心加行"（pitch → 社会证明 → 赔率），而不是模板全有或全无——旧写法一旦超 280 就掉到四行残句，把最强的钩子丢了。
- **不写的三件事**（写了会被截图打脸）：`$ARENA airdrop is LIVE`（代币还不存在）、`USDC seed grants`（产品里没有这个计划）、`@PredictionArena`（是别人的号，我们是 @Predict065）。
- `scripts/llama-pr-watch.ts`（新）：每 30 分钟看 PR #21991，**只有真人**（排除 coderabbit/github-actions/dependabot）问出带问号的 TVL/零/空 问题时，才用 `cast balanceOf` + Transfer 日志扫描 + `node test.js` 输出自动回一条澄清；已回过的 comment id 记在 `.data/llama/replied.json`，不重复。
- 节奏收紧：拦截扫描 180s→60s，空闲门禁 300s→120s（x-daemon 与拦截守护进程），发帖上限仍是 240s/条、6 条/小时、20 条/天。

## 2026-11-03（下午）：公域冷启动拦截引擎

- **读 X 的唯一活路**：`x.com` 对本机 403，nitter 大部分死。可用路径是 `nitter.kareem.one/<handle>/rss`（备用 `twiiit.com/<handle>/rss`，会随机转到别的实例）。`api.fxtwitter.com` 只能按 id 取单条推文，不能取时间线——所以“发现新推”只能靠 RSS，别再去试 X API（没有 token，也没有配额）。
- `scripts/x-intercept-monitor.ts`（新）：扫 targets 的 RSS，过滤 `RT by @`/`R to @`（转推和回复都不是好位置），只取 45 分钟内、比上次新、没回过的推文，生成 `.data/intercept/reply-queue/*.json`。它不碰桌面。
- `scripts/x-reply.ps1`（新）：UIA 打开推文 → 点推文自己的 Reply → 在弹窗里粘贴 → 提交那个**位于编辑器下方**的 Reply 按钮（页面里同名按钮很多，靠 y 坐标相对编辑器过滤）。
- `scripts/x-intercept-daemon.sh`（新）：180s 一轮，桌面空闲 ≥300s 才动手，节奏 240s/条、6 条/小时、20 条/天。**每条都回读推文的 reply 数验证**（fxtwitter），没涨就当失败，最多重试一次——`posted_attempted` 不算成功。
- 账号事实：我们自己的号是 **@Predict065**；`@PredictionArena` 是别人的号，文案里一律不许出现。
- 机器人：钱包绑定现在真的发 `+500` 分（`bind:wallet`，`grantPoints()` 按 reason 前缀去重，`--self-test` 不写账本），并直接吐 ref 链接 + 20% 团长算力 + 30%→50% 链上抽水的说明。
- `package.json` 补了 `build` / `test:e2e` / `intercept:sweep` / `intercept:cold`，根部即可 `bun run build`、`bun run test:e2e`。

## 铁律：自动化截图 / 生成物不许落桌面（2026-11-03 老板下的令）

- 桌面（`C:\Users\Administrator\Desktop`）只放老板自己的东西。脚本产出的截图、图像识别缓存、推广包一律进项目目录。
- 截图唯一入口：`scripts/capture.ps1 -Name <名字> [-Process chrome]` → 写到 `<repo>/tmp/shots/`，把返回的绝对路径接过来用；跑完 `rm -rf tmp/shots/*`，`tmp/` 已在 `.gitignore`。
- 推广包从 `Desktop/PredictionArena_Marketing` 挪到 `<repo>/marketing/PredictionArena_Marketing`（`push-desktop-marketing.ts` / `generate-marketing-image.ts` 的 `packDir()` 已改；`MARKETING_DIR` 仍可覆盖；`marketing/` 已加进 `.gitignore`）。
- 桌面曾出现的 `a1..z2.png`、`og-*.png`、`x_*.png`、`prof*.png`、`bio.txt`、`x_tweet_2.txt` 已清掉。以后再有，说明有人绕过了 `capture.ps1`。

## 2026-11-03：DefiLlama PR + 漏斗文案自动化

- `projects/prediction-arena/index.js`（TVL = `usdc.balanceOf(arena)`，Base `0x9618…10b5`）已提 PR：<https://github.com/DefiLlama/DefiLlama-Adapters/pull/21991>，CI `test` 绿。注意链上真实 TVL 是 **0**：部署块 53150166 至今 USDC 转入/转出日志都是空的，232 个 pool 只是建好了没人下注，PR 正文里写明了这一点。
- `scripts/funnel-copy.ts`（新）：按老板定的三步法（关注 @Predict065 → 评论区留 Base 地址 → 进 t.me/predictionarena_hq = 创世空投）生成 `.data/daily-funnel.txt`（EN，X 加权 ≤280，强制带 market 链接）和 `-cn.txt`。marketing-daemon 每轮 hot-board 之后都会重写它，X 守护进程不会再重复发同一段文案。
- `marketing-daemon.sh`：启动时若锁被「孤儿 sleep」占着会自动回收（之前 kill 掉守护进程后，继承 fd 的 `sleep 900` 会把锁一直占住，cron 每小时都 print `already running` 但什么都不跑），并加了 `trap` 在退出时清子进程。


## 一句话状态

线上跑的是 `d9c04de`（2026-10-26 02:32 UTC 部署，Render dep-dbfbm7qjnfac738posrg = live）。这一版加了 Hero Slogan、修掉手机端 668px 横向溢出、移动端 Tab/交易抽屉的触控与滚动问题、活动流 provenance 气泡。CI（contracts / frontend / deploy）三绿。

## 2026-10-26 这一轮做了什么

- `components/HeroMasthead.tsx`（新）：slogan + kicker + 三条证据 chip，六语言（`i18n-extra.ts` 的 `slogan` 组）。手机 390px 下标题 66px 高，说明段 <640px 隐藏，Featured 盘口仍在首屏。
- 手机溢出根因：主 grid 只有 `xl:grid-cols`，单列隐式轨道按最宽 min-content（2 列统计卡标签）撑到 668px。现在 `grid-cols-1` + 子项 `min-w-0` + Stat 标签可截断。320/360/390/430 实测 `scrollWidth == innerWidth`。
- 分类 Tab：40px 触控高度、snap 滚动、选中项自动居中、右缘渐隐；手机端隐藏页内那一排重复 Tab。锚点 `scroll-mt` 96→136px（sticky header 现在 126px）。
- 移动交易抽屉：TradePanel 的 `sticky top-[86px]` 改成 prop（桌面才开），否则抽屉里会空 86px；`dvh` 尺寸；关闭态 `invisible`；打开时 focus 进 dialog。
- 活动流：i 图标 → provenance 气泡（sample / on-chain 两套文案，点外部/Esc 关）；sample 行改成 0x 形状地址、每行不同盘口、新→旧排序、长尾金额；徽标 aria-live + 过渡。
- `detail.ends` 这个不存在的 key（页面上直显 "DETAIL.ENDS"）改用 `card.ends`。
- 站点 metadata / OG / Twitter 文案与 slogan 对齐。

## 2026-10-26 第二轮：盘口主题图片系统

- `lib/covers.ts`（纯 TS，无 React/别名）同时被 `scripts/gen-board.ts` 与前端调用：按实体（币种 / 联赛 / 议院 / 实验室 / meme / 链）解析出 `visual{kind,photo,accent,entity,kicker,metric,mark}`，写进 `pools.json`；老快照走 `coverOf()` 现场兜底。
- 判定顺序踩过的坑：**分类不能进匹配串**——所有体育盘口的分类都是 "Sports & Esports"，`/esports/` 会把英超、NBA、F1 全判成电竞；现在分类只在最后兜底。结构类信号（TVL/吞吐/交易/市值）优先于币种，否则 "Ethereum TVL" 会变成 ETH 价格卡。
- 素材：14 张自托管封面（`public/covers`，1600×900 + 640×360 两档），来源 Openverse / Wikimedia，CC0 优先；`esports.jpg` 与 `eu.jpg` 是 CC BY-SA，已在 `/credits` 页署名（页脚有入口），`CREDITS.json` 与文件同目录。抓取/裁切脚本：`tools/fetch-covers*.py`、`tools/process-covers.py`。
- UI：`MarketCover` 三层（照片 → 主题色光晕 → 矢量 motif / 币种 monogram → 遮罩）；卡片顶部 112px 主题带（实体 + 真数 metric + kicker），详情页 190px hero，Featured 用 banner 变体；`opengraph-image.tsx` 把同一张封面以 base64 内嵌进分享卡，并加实体 chip。
- 顺手清掉：卡片网格上方那排重复的分类 Tab（sticky header 里已经有了）、详情页图表卡背后旧的 CategoryCover（紫色手柄图 vs 足球盘口，明显打架）。
- 线上实测（7b96c83，Render live 11:35Z）：38 张卡片图片全部 200；Sports = esports/motorsport/basketball/football，Politics = capitol/eu/gold，AI = ai-lab/neural 交替；390px 无横向溢出、图片 0 broken；OG 1200×630 带封面。

## 2026-10-26 第三轮：Watch-to-Earn 广告 + 体验券双轨

- 规则全在 `lib/rewards.ts`：看 15 秒广告 +10 分（UTC 每天 12 次上限）；100 分 = 1 张 $1 体验券；券按「当前隐含概率」买 `1/p` 份 $1 份额（和 USDC 的 pari-mutuel 同一套数学）；只有**已结算**盘口的已实现利润 ≥ $10 才解锁提现申请。
- 后端 `app/api/rewards`（一个路由 5 个动作）+ `lib/rewards-server.ts`：**没有数据库**，账本放在 httpOnly 的 HMAC 签名 cookie 里。加分只认「ad-start 时服务端签发的凭据」——必须 ≥14 秒、未用过、当日在额度内；券的入场概率由清单算，不信客户端。`REWARDS_SECRET` 已写进 Render 环境变量，不是仓库里的 fallback。
- 前端：`AdModal`（15 秒倒计时 + 10 格进度 + 单次完成）、`RewardsPanel`（积分/券/已实现利润 + 券仓位按市价估值 + 提现闸门说明）、`TradePanel` 双轨切换（USDC 链上 / Free Ticket $1，券轨不碰钱包和合约）、首页仪表盘入口条。
- 顺手修掉一个**既有布局 bug**：资产抽屉渲染在 `<header>` 里，而 header 的 `backdrop-filter` 会成为 `position: fixed` 的包含块，导致 `inset-y-0` 按 125px 的 header 计算，抽屉整个塌成一条——现在 portal 到 `document.body`。
- 线上实测（fc3e4ba/287be94，Render live 12:27Z）：生产环境跑满 10 条广告 → 100 分 → 换 1 张券 → 在 700001 以 27.7% 进场 → 开仓 $1.00，`adsLeft 12→2`；立刻调提现返回 `below-threshold`（符合设计）。
- 诚实的边界：账本绑浏览器（清 cookie/换设备会重置）；提现只是「排队申请」，不是自动转账（合约没有这个能力）；已实现利润在盘口真正结算前恒为 $0；广告素材是模拟的，接 HypeLab 只是把播放器换掉，签名时间线不变。

## 2026-10-26 第四轮：去模拟化 + 真实广告接入

- **活动流**：删掉 sampleRows / 小时轮播 / 伪 0x 地址。现在只读 `BetPlaced`、`RewardsClaimed`、`PoolSettled`；没有资金池时显示「Waiting for the first on-chain event」并说明在读什么。徽标是 `waiting`，不再有 `sample`。
- **广告**：删掉假播放器与三个虚构品牌。`lib/ads.ts` 是真实适配器：按 `NEXT_PUBLIC_ADS_SCRIPT_URL` 注入联盟脚本，调 `window.HypeLab.showRewarded({placement,onReward,onError})`（或通用 `window.__paRewarded.show`），只有 `onReward` 回调后才会向 `/api/rewards` 申请入账。没有 property/placement/script 时，弹窗明说「Rewarded video is not configured」，按钮文案也改成「Ads not configured」，**不承诺 +10、不发分**。
- **文案**：全站渲染文本里 `sample` / `demo` / `mock` 归零（首页实测 0/0/0）。盘口 pill 从 `DEMO` 改为 `OFF-CHAIN`，横幅说明「价格来自实时行情，USDC 池未充值所以 USDC 交易关闭，免费券可用」。两条 AI 辩论文案里的 "sample"（统计意义）也改写。内部 `source: "demo"` 枚举保留——那是清单的来源标记，不是给用户看的文案。
- **配置入口**：`frontend/.env.local`、`.env.local.example`、`render.yaml`（注释）都有 `NEXT_PUBLIC_ADS_PROVIDER` / `NEXT_PUBLIC_ADS_SCRIPT_URL` / `NEXT_PUBLIC_HYPELAB_PROPERTY_ID` / `NEXT_PUBLIC_HYPELAB_PLACEMENT_ID`。
- **线上实测**（f4861d7，live 06:08Z）：首页 0 处 sample/demo/mock；活动流 waiting；广告弹窗 unconfigured；市场页 OFF-CHAIN + 券轨可用。
- **必须知道的两件事**：
  1. 真实广告位需要 HypeLab 后台的 property + rewarded placement + 发布商 script URL。没有凭据时无法播放任何真实广告——按「不模拟」的原则，此时按钮就是禁用的，而不是放个假视频发真积分。
  2. 38 个盘口里，10 个带结构化 `marketData`（Binance 现货/执行价），其余 28 个是事件命题（体育/政治/AI/meme），没有可拉取的「实时价格」这种东西，它们的门槛来自规则而不是行情；这些盘口的可信度靠的是写明的结算来源（英超官方比分、congress.gov、FEC 等）。别对外说「38 个全部由实时 API 生成」，那不成立。

## 已知遗留

- fee wallet 仍未充值 ⇒ 没有链上盘口 ⇒ 活动流恒为 `sample`，首页 `24H VOLUME $0.00`、`SETTLED 0` 也是真的（不是 bug，别改成假数）。
- 深链直接打开 `/#markets` 时浏览器按加载瞬间的布局落点，可能偏上；点页内「Browse markets」跳转是正确的（section top = 136px）。
- 桌面 Hero 卡与右栏等高，内容垂直居中，宽屏下上下留白较大；如果以后想收紧，可考虑把活动流移出右栏，但别让右栏留空洞。

## 线上

| 项 | 值 |
|---|---|
| 站点 | https://predictionarena.online（`www` 301 → apex） |
| 证书 | Google Trust Services WE1，SAN 覆盖 apex 与 www，到期 2027-01-22，TLSv1.3 |
| Render 服务 | `srv-dbdcjf4s728c73bffgcg`（free / oregon），自定义域名 two 个，均 verified |
| 旧地址 | https://prediction-arena-81d9.onrender.com 仍可用（旧链接不断） |
| 合约 | `0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5`（Base 8453） |
| Reown | 项目 `41ec…33d9`，已 allowlist 两个域名 |

## 本机在跑什么

```
0 * * * *   scripts/ops-daemon.sh      # 完整 tick：行情→盘口→链上 refresh→生成→开盘→辩论缓存
*/30 * * *  scripts/refresh-board.sh    # 行情 + 重建 38 个盘口（清过期）
5 * * * *   scripts/publish-board.sh    # 有变化才 commit+push（45 分钟节流）→ CI → Render
```

- crontab 在 `yolanda528` 用户下；`/etc/wsl.conf` 有 `systemd=true`，`cron` 是 enabled，所以 WSL 起来后 cron 会自动跑。
- **关机期间没有本地 cron**：线上保持最后一次发布的盘口（渲染时的行情快照），不会自己变。开机后第一条 cron 会把盘口刷到最新并发布。

## 凭据（都在 ~/.hermes，600）

- `.gh_token_predictionarena` — GitHub device-flow token（repo/workflow/read:org）
- `.render_api_key` — Render API key（服务/部署/域名）
- `.env`（仓库根，gitignored）多了 `HTTPS_PROXY=http://172.17.240.1:16781`，数据抓取靠它出网

## 已完成（这几轮）

1. **自定义域名**：Cloudflare zone 重建（原 zone 不存在，权威 NS 回 REFUSED）；阿里云 NS 改为 kristina/yew；apex + www CNAME → onrender（DNS only）；Render 绑定并 verified；Reown allowlist。
2. **实时数据**：`scripts/fetch-prices.ts`（Binance 24h ticker / CoinGecko simple+global / DefiLlama chains）→ `frontend/public/prices.json`（逐行记 source + asOf）。
3. **盘口生成**：`scripts/gen-board.ts` 从快照重算 38 个盘口，执行价=现价上方圆整位，赔率用数字期权模型，绝对 UTC 截止，过期即消失；快照超 3 小时拒绝生成。
4. **7 大板块**：Crypto & Macro / DeFi & L2 / AI & Web3 Tech / Memes & Culture / Sports & Esports / Politics & Policy / Base Ecosystem（6 语言 i18n 齐）。
5. **搜索/排序**：搜索覆盖标题+板块+tag+描述+resolution+数据源；排序 Ending Soon（24-72h 优先）/ Highest Yield（冷门边赔付倍数）/ Newest；卡片显示 `N.N×`。
6. **分享**：`marketData` 结构化字段贯穿 manifest→视图→推文→OG；推文含实时现价/概率/赔付倍数/数据源；OG 卡片底部「REAL-TIME FEED: BINANCE|COINGECKO|DEFILLAMA VERIFICATION」角标。
7. **活动流**：读 BetPlaced/RewardsClaimed/PoolSettled（5400 区块≈3h），无链上盘口时不发请求、走标注 `sample` 的确定性热度流。
8. **Hero 修复**：任意 Tab 都渲染真实盘口（特色盘口不在本板块时取该分类第一条，chip 标 TOP MARKET）；宣传黑块已删除。

## 已知边界（对外汇报口径）

- 合约里目前**没有链上盘口**（fee wallet 未充值），所以活动流是 `sample` 状态；一旦有真实交易会自动切 `on-chain` 徽标。
- 体育/政治/AI 三类是**编辑类盘口**，没有免费实时 API；resolution 写了可核查来源（Premier League 官方比分、congress.gov、FEC、L2Beat 等），不含编造数字。
- PWA `manifest.json` 用相对路径（故意的：同一份清单要在预览域和正式域都能装，绝对路径会让预览装出来的图标指向线上）。
- Render free 实例会睡：GitHub Actions 每 10 分钟 ping（`keepalive.yml`，先 ping 正式域名再回退 origin）。

## 后天回来要做的（他说"还需要修改一些内容，然后准备营销"）

先确认环境：
```bash
cd /mnt/c/Users/Administrator/prediction-arena && git pull
crontab -l | head            # 三条应在
pgrep -x cron || sudo service cron start
cd frontend && bun run build # 确认基线绿
```

营销前建议过一遍：
- [ ] fee wallet 充值（没有它就没有真实链上盘口，"Live Activity" 只能是 sample）
- [ ] X 账号 @PredictionArena 是否真实存在（推文里 @ 了它）
- [ ] 首屏文案/Hero 的营销口径（现在是市场驱动，没有 slogan）
- [ ] 分享链接在 X 上的卡片预览实拍（用 Twitterbot UA 抓过，但没在真 X 上发过）
- [ ] 活动流一旦有真实交易，确认 `on-chain` 徽标与轮播重置表现

## 常用命令

```bash
bash scripts/refresh-board.sh          # 抓行情 + 重建盘口（本地）
FORCE=1 bash scripts/publish-board.sh  # 立即发布（跳过 45 分钟节流）
python3 tools/verify_domain.py --proxy http://172.17.240.1:16781
```

## 2026-10-26 第五轮：HypeLab 真实凭据接入（结果：SDK 接通，广告位被网盟拒绝）

**做法**：把 `lib/ads.ts` 改成对标真实 bundle 的实现，先扒 `hp-sdk.js` 再写代码。

**bundle 事实**（`https://api.hypelab.com/v1/scripts/hp-sdk.js?v=0`，29,170 字节）：
- 暴露 `HypeLab.initialize({ propertySlug, environment, privacy })`、`HypeLab.setWalletAddresses`；
- 自定义元素 `<hype-banner placement="…">` / `<hype-native placement="…">`，只读 `placement` 属性；
- 事件只有 `ready` / `error`；
- **`showRewarded` / `onReward` / `reward` 出现次数 = 0**，web SDK 没有激励视频接口（激励视频只在 iOS/Android/Unity SDK）。

**现在的闭环**：签名凭据 → `mountPlacement()` 把真实广告位塞进弹窗 → 元素 `ready`（真填充）→ 屏上停留 `AD_SECONDS=10` → 兑换凭据入账 10 分。拒绝/超时/提前关闭 = 0 分，且弹窗直接显示网盟原话。

**实测（production 与 localhost 一致）**：
```
POST https://api.hypelab.com/v1/rtb_requests
{"imp":[{"ext":{"bidder":{"property_slug":"35ca344934","placement_slug":"edb201f1cf","banner":{"w":0,"h":0}}}}], …}
→ 400 {"status":"error","message":"Unable to find valid placements or properties."}
```
即：`35ca344934` / `edb201f1cf` 这一对在 HypeLab 侧查不到（slug 错、placement 已删、或 property 未激活/域名未过审）。

**要老板在 HypeLab 后台核对的**：Property 的 slug、以及一个 **Banner/Native** placement 的 slug（不是 Reward Video placement——那个 web 端渲染不了）。拿到正确 slug 后只改 `NEXT_PUBLIC_HYPELAB_PROPERTY_ID` / `_PLACEMENT_ID`，代码不用动。

**凭据存放**：`frontend/.env.local`（gitignore）+ Render env 四个变量；仓库内无明文。

## 2026-10-26 第六轮：新 Banner 版位 8673f85245（结果：版位已认，8/8 竞价无出价 204）

- 版位从 `edb201f1cf` 换成 `8673f85245`（property `35ca344934` 不变），`.env.local` + Render env 已更新。
- **400 消失**：`/rtb_requests` 不再是 "Unable to find valid placements or properties"，说明 property+placement 这对已经被 HypeLab 认。
- **但现在全是 204 No Content**：线上连发 10 次竞价（8 次探针 + 弹窗 2 次重试），10/10 都是 204，一次填充都没有 → 没有创意、没有 `ready`、不发分。
- SDK 源码细节：`buildImpression()` 里写死 `banner:{w:0,h:0}`（不是我们的尺寸 bug）；SDK 仅接受 HTTP 200，非 200 一律触发元素 `error`，所以 `ads.ts` 在 SDK 加载前包了 `fetch`，把 `/rtb_requests` 的 status 记下来区分 **204=无出价** / **400=版位无效**，弹窗分别给不同文案。
- 无出价时自动再拍一次（2.5s 后），因为 refill 常见。
- 未验证的一段：`ready → 停留 10s → 入账` 这条分支**没有用真实创意跑过**（一次填充都没有），服务端凭据兑换逻辑此前用旧流程验过。

**下一步在 HypeLab 侧**：确认 property 是否处于 Pending review / 域名是否已验证；以及该 placement 是否已挂在有需求的 ad unit 上（无流量新站通常要等 demand 打开）。

## 2026-10-26 第七轮：竞价重试 + 备用网盟入口 + 台账审计（0e3c8de，Render 08:33:30Z live）

**广告**
- `mountPlacement(host, {retries, probe})`：可见路径单发（空态 18s → 7s），重试链交给弹窗里的可取消循环。
- 204 → 弹窗进入 nofill 态：网盟原话 + 「Retry auction」按需重拍 + 每 15s 静默探针（1px 屏外，最多 3 次），探到填充立刻走可见挂载，无需关弹窗。
- `NEXT_PUBLIC_FALLBACK_ADS_SCRIPT_URL` 已接：仅在主网盟空返回后懒加载，契约 `window.PAAdFallback.mount(host,{placement})`，UI 无需改动。当前未配置备用网盟凭据，所以没有任何"备用已生效"的说法。

**审计**
- Ledger 新增 `events[]`（cookie 内封顶 40，view 给 16），ad/redeem/stake/cashout 各记一条，资产面板渲染为 LEDGER TRAIL。
- cashout 收 `wallet`（0x+40hex 校验，不推导），返回 `transfer:{network:"base",chainId:8453,asset:"USDC",amountCents,to}`；无链上 claim 入口，所以是运营划转指令，不编 tx hash。
- 本地实测：10 广告 → 100 分 → 1 券 → 700001 以 28.0% 下注 → 12 条事件，points/tickets 归零；`cashout` 仍先判 `below-threshold`。

**线上实测（430px）**：204 → nofill 面板（含 probe 1/3 倒计时）→ 点 Retry auction 产生新 `/rtb_requests`（204）；`/api/rewards` 返回 `events: []`（新访客）。

## 2026-10-26 第八轮：USDC 通道真开（38 个池上链，92e28ae，Render 09:05:37Z live）

**先查真相**：仓库里**没有** `/api/trade`；下注是前端直接 wagmi 写合约。所谓"未注资拦截"是
`TradePanel: live = hasArena && pool.source === "chain"`。而 `source` 恒为 demo 的真实原因不是"没注资"，
是**合约里根本没有池**：`getPool(700001..700038)` 全部 `PoolNotFound`，`contractBalance()=0`。

**做法（不是删守卫，是把原因去掉）**：`bet()` 不要求种子流动性（下注本身就是流动性），只要池存在且 Open。
所以用 owner key 调 `createPool(id,title,category,endTime)` 把 38 个盘口建到 Base 主网：
- 38/38 `getPool()` 现在返回 Open；gas 合计 **0.0000335 ETH**（0x436b…5Ba1 余额 0.0014969 → 0.0014634）。
- 证明：从无余额地址模拟 `bet(700001,0,50e6,0x0)` → 报 `ERC20: transfer amount exceeds allowance`
  （已越过 pool/option/min/cap 四道检查；改造前是 `PoolNotFound`）。

**代码防回归**：
- `scripts/open-pools-mainnet.sh`（幂等开池）+ `scripts/sync-opened-pools.py`（把链上真实状态写进 `scripts/opened-pools.json`）
- `scripts/gen-board.ts`：标题在链上存在 → 直接产出 `source:"chain"`（用合约的 id/endTime）；demo 行不再占用链上 id；同 id 以 chain 为准。
- cron `10,40 * * * *` 跑开池脚本 → 新生成的盘口半小时内自动上链。
- 文案：`USDC pool is not funded / USDC trading is off` 的措辞全部删除，改成"尚未在合约上开池，守护进程 30 分钟内开"。

**线上实测**：`/pools.json` 38 chain + 1 demo（09:30 新生成的，等 :10/:40 cron 开池）；`/market/700001` 徽标 `ON-CHAIN`、
DOM 里 0 处未注资文案、金额滑块 enabled、"Flat $50 – $10,000 USDC window / Max per trade $10,000"。

**硬边界**：池是空的（`totalNetPool=0`），第一笔下注者就是该边的全部流动性；38 个池的结算要 owner 逐个人工 `settle()`，
逾期未结算只能等 30 天 `emergencyRefund`。到本轮为止**没有任何 USDC 真实成交**（合约余额仍为 0），
因为手上没有带 USDC 的钱包。

## 2026-10-26 第九轮：按老板要求恢复演示数据 + 全站开放下单（fe43d43，Render 09:31:09Z live）

老板口径变了：**演示数据要保留，购买按钮无条件开放**（"你不需要管里面有没有钱，但是你要开放"）。

- `gen-board`：恢复 38 条 `source:"demo"`，带 liquidity/traders，并新增**确定性 24h 成交额**
  （`turnover24h = liquidity × 16%~66%`，按标题哈希，重建不跳变）→ 面板 24H $374.3K、TVL $964.3K。
- `useMarkets`：按 id 去重，**demo 展示值优先**（同一 id 背后的池子仍在链上）。
- `TradePanel` / `BetModal`：`live` 只决定徽标；下单门槛改成 `hasArena`（`tradable`），
  demo 卡片也能走 USDC 轨 → 写进的是真实存在的池（92e28ae 建的 38 个，空池）。
- `LiveActivityFeed`：链上有事件就读链上；没有就由盘口自身生成 7 条（5 分钟种子、$50–$10k、自轮播）。
  徽标只在真读链上日志时写 "on-chain"，否则写 "live"；行按时间倒序。
- 实测线上：24H VOLUME $374.3K / 38 markets / TVL $964.3K；feed 5 行 1m·3m·8m 递增；
  `/market/700001` 徽标 OFF-CHAIN、USDC 轨在、Yes/No 可点。

**边界（留档）**：卡片上的流动性/成交额/人名是演示数字；链上池子是空的，第一笔下注者即该边流动性。

## 2026-10-28 社媒包装（X + Telegram 全量落地）

- X 官方账号 = **@Predict065**（原 @Dina32036948 改名），头像 `docs/branding/avatar-1024.png`、背景墙新做 `docs/branding/banner-1500x500.svg/.png`；上线推文带官网 + v3 合约，首条回复补 `#Crypto #Base #PredictionMarket #Web3` 等标签，已置顶。旧的 @Pred_Arena 标记退役，全站不再引用。
- Telegram 官方频道 = **@predictionarena_hq**（新建成公开频道），盾形头像 + 简介（官网 + X）+ 置顶欢迎/防骗公告（含合约地址）。
- 前端 `social.ts` 一处改完全站：footer/header/docs/admin/share intent/JSON-LD/`twitter:site`；`e2e/social.spec.ts` 断言同步；`docs/branding/social-preview.svg` 与 `frontend/public/og.png` 里的旧 handle 一并换掉。
- 验证：`bun run build` EXIT=0、`bun run lint` 0 error、`bun run test:e2e` 7 passed。

### 操作真机的坑（下次直接用）
- Chrome 156 的 cookie 是 **v20 App-Bound 加密**，复制 profile 到别的 user-data-dir 后 `auth_token` 解不开（v10 的老 cookie 能解），所以「复制登录态开调试口」这条路对 X 无效；默认 profile 又禁 `--remote-debugging-port`。
- 可行路径：给真机 Chrome 加 `--force-renderer-accessibility` 启动，然后用 **UIAutomation**（`Add-Type UIAutomationClient`）直接对 DOM 按钮 Invoke（`Add avatar photo` / `Apply` / `Post` / `Save`），坐标点不动的元素也能点；文件选择器用 `#32770` + `AutomationId=System.ItemNameDisplay` 填路径。
- `SendInput`/`mouse_event` 在本机不可用（返回 2 但无效果）；**`SendMessage(WM_LBUTTONDOWN/UP)` 到 WindowFromPoint 的子窗口是有效的**，Qt/Telegram Desktop 的菜单、对话框确认按钮都靠这条。
- 锁屏会静默杀掉所有注入：每批操作前先 `Get-Process LogonUI` + `GetForegroundWindow()` 探一次；`keepalive2.ps1`（每 45s 发一次 F15）能压住空闲锁屏。
- Telegram 频道的公开 username 在「频道已创建」那一步设置，`t.me/<name>` 当时若被占用会直接提示；创建后头像在 管理 → 编辑 → 点击头像 → 图片或视频。

## 2026-10-28 关机前存档（增长线）

**HEAD = 73bec28**，工作区干净，已推 `main`。CI 三 job 绿，Render 已部署，线上 `HTTP=200`。

### 已上线
- tribal 盘口评分（`--pick=tribal` 默认）：对阵措辞 +4 / 部落代币 +3 / 击价<8% +2 / 深流动性 +1 / 宏观 −3；`tribalScore≥4` 走战斗号角文案
- Frame 按钮 `🟢 Bet YES` / `🔴 Bet NO`（`/api/frame` 与盘口页 meta 两处一致），帧 HTML 30s 内存记忆
- `?ref=` 持久化（localStorage + 30 天 cookie）、Portfolio → Invite & Earn、合约 `referrer` 已接
- `/admin` Growth attribution 面板 + `/api/growth/summary`（并行扫 6×1000 块，线上 2.5s）
- GitHub Actions `Auto marketing`（id 399328392）：09:10/17:10 UTC → 生成三端文案 → **TG 自动发** → 归档并 commit
- 文案归档在 `docs/campaigns/<date>/` 与 `docs/campaigns/<YYYY-Www>.md`

### 明天开机第一件事
1. **X 仍被 402 credits depleted 卡住**（OAuth 1.0a 签名已验证通过，纯计费问题）。充值或切 Free 套餐后：
   `gh workflow run auto-marketing.yml` 或本地 `bun scripts/auto-market.ts --send --limit=1`，把首条推文 URL 取回。
2. 可选优化：给 `/api/frame` 加 `x-frame-ms` 响应头，拆开"渲染耗时 vs 网络耗时"（现在测到 0.63–0.83s 全在网络/Render 冷路径）。
3. 数据面：链上真实下注 **0 笔**；`/api/growth/summary` 的"哪个盘口带来最多下注"要等第一笔带 `?ref=` 的下注才有信号，再回灌 tribal 权重。

### 已知边界
- $10k/月 = $250k 月交易额 ≈ 333 个有本金钱包（体验券上限 $1/张，撑不起这个量级）
- TG 频道现有 1 订阅、X 粉丝 0，自动化只能保内容不断，粉丝/会员仍需人肉渠道动作
- 本机（WSL）关机后一切本地进程停止；只有 GitHub Actions 与 Render 继续

## 2026-10-29 开机复工：帧计时头 + 归因回灌 + 发车实测

**HEAD = 91807ece**（含本轮 3 个提交 + 云端归档），已推 `main`，Render `dep-dbhc3mhsrm7s73fe3k80` **live**。

### 1. `/api/frame` 计时头（75bcc75）

- 新增响应头：`x-frame-ms`（handler 内部耗时）、`x-frame-cache`（hit|miss）、`server-timing: frame;dur=`、`cdn-cache-control: no-store`（per-request 计时不能被缓存）。
- **线上实测（predictionarena.online，2026-10-29T04Z）**：

  ```
  request 1  x-frame-ms: 3.53   x-frame-cache: miss   total=1.257s
  request 2  x-frame-ms: 0.03   x-frame-cache: hit    total=0.787s
  request 3  x-frame-ms: 0.03   x-frame-cache: hit    total=0.662s
  ```

  即：渲染逻辑 0.03–3.5ms（预算 50ms 的 1/14），端到端 0.66–1.26s 全部是网络 + Render 冷路径 + Cloudflare。以后要看"卡片慢不慢"就看 `x-frame-ms`，看总延迟没有意义。
- 400/404 也带同款头（`jsonError`），错误页不能成为盲区。
- `frontend/e2e/frame.spec.ts` 新增 2 条断言：头存在、<50ms、二次命中必须比首次便宜。**注意：这个文件原来已有 5 条 frame/ref 测试，是追加不是覆盖**（我一开始手滑整文件覆盖过，已 checkout 还原再 append）。

### 2. 归因回灌 tribalScore（1f24ba9）

- `scripts/sync-attribution.ts`（新，`bun run sync:attribution`）：拉 `/api/growth/summary` → 用 `frontend/public/pools.json` 把 poolId 映射回标题 → 按 AERO/DEGEN/TOSHI/BRETT/MOG/ZORA/HIGHER 聚合 → 写 `docs/campaigns/attribution.json`。
- `/api/growth/summary` 的 `perMarket` 增加 `volumeUsdc`（原来只有 `bets`/`referred`，压根没法算归因金额）。
- `scripts/auto-market.ts`：`tribalScore` 增加 adaptive bonus（**上限 +2**，按 leader 交易额归一，只加不减）。文件缺失 / 超过 7 天 / `bets=0` → 完全不加分。文本输出与 `--json` 都打印 `tribal {base, adaptive, total, leader}`。
- **fixture 实测**（toshi $2400 / aero $600 / degen $100）：

  ```
  无归因：700011 AERO 8 分，700034 AERO 8 分，700008 Base TVL 8 分
  有归因：700020 TOSHI 8+2=10 分 → 第一名；AERO 两档 8+0.5=8.5
  ```

- `.github/workflows/auto-marketing.yml`：`workflow_dispatch` 的 pick 增加 `tribal`（默认 tribal），并在生成前加 `Refresh tribal attribution`（best-effort，失败不阻断发车）。

### 3. 发车实测（2026-10-29T03:45Z，run 40813952421）

- `gh workflow run auto-marketing.yml -f pick=tribal` → 21 秒完成，`pick=tribal`，选中 **700011 Will AERO close above $0.7675**，tribal 8（prior 8，无归因数据）。
- **Telegram：sent** —— `t.me/predictionarena_hq/8` 已核实（含 `?ref=telegram` 链接、15% YES · 6.7×）。
- **X：仍然 402**，原话：`{"detail":"credits depleted","status":402,"title":"Payment Required","type":"https://api.x.com/2/problems/credits-depleted"}`。OAuth 1.0a 签名没问题（能到计费闸门就是证据），卡的就是账户额度。
- 结论：**没有推文 URL，因为没有任何推文发出去**。要发只能老板在 X Developer Portal 充值或把套餐切到 Free（有额度的那档），之后 `gh workflow run auto-marketing.yml -f pick=tribal` 一条命令即可。

### 4. 链上归因现状（2026-10-29T04Z）

```
GET /api/growth/summary (chunks=6, 6000 blocks, latest 53228235)
totals: bets=0 bettors=0 referredBets=0 volumeUsdc=0
perMarket: []
```

- 也就是说 **还没有第一笔真实下注**，`byTribe` 全空、`leader=null`，tribal 权重 100% 还是手调先验。attribution.json 已按 `bets:0` 落盘（这是真数据，不是占位）。
- 等第一笔带 `ref` 的 `BetPlaced` 落地后，下一次 auto-marketing 会在生成前自动跑 sync，无需人工介入。

### 本轮验证

- `bun run build`：绿（TypeScript 69s，38 条路由正常）。
- `bun run test:e2e`：**22 passed**（betting 4 / frame 7 / growth 5 / mobile 3 / social 3）。

### 新增/踩坑

- **git 推不上去**：全局 `url.https://ghfast.top/https://github.com/.insteadOf` 会把显式 github URL 也重写回 ghfast，而 ghfast 现在 TLS 握手直接断（`GnuTLS, handshake failed`）。可行写法：

  ```bash
  export HTTPS_PROXY=http://172.17.240.1:16781
  TOK=$(cat ~/.hermes/.gh_token_predictionarena)
  GIT_CONFIG_GLOBAL=/dev/null git push "https://x-access-token:${TOK}@github.com/lulaxiao97-create/prediction-arena.git" main
  ```

  `GIT_CONFIG_GLOBAL=/dev/null` 用来看掉 insteadOf，但也会掉凭据，所以 token 必须进 URL。fetch 同理。
- Render 的 push 自动部署这次没触发（autoDeploy=yes 但 10 分钟没新 deploy），手动 `POST /v1/services/<id>/deploys` 才起来。以后再遇到就照这个来。

### 5. 发布链路修好了（cron 曾经死了 2 个 tick）

- 现象：`logs/publish-board.log` 在 2026-10-28 20:05 出现 `! [rejected] main -> main (fetch first)`，之后**再也没有 publish 成功过**。原因是 `auto-marketing.yml` 也会往 main 提交归档，本地 cron 的 push 被 non-fast-forward 拒掉后脚本直接放弃。
- 修法（e2f2424）：push 失败 → `fetch` → `rebase --autostash` → 重试，最多 3 次；真冲突才 abort。
- **两个自己写错又测出来的点**（读 diff 看不出来）：
  1. `fetch main:refs/remotes/board-push/main` 的 refspec **必须带 `+`**，否则陈旧 tracking ref 会让 fetch 自己被拒，循环里三次都在推同一个注定失败的 push；
  2. 脏工作区下 rebase 直接拒绝开始，加 `--autostash` 才跑得动。
- 验证方式：给脚本加 `PUSH_REMOTE_URL` 覆盖，用临时 bare repo 造“别人先提交”的局面，跑完看 remote 历史里数据提交确实 rebase 在对方提交之上、脏文件也还在。之后又对真 remote 跑了一次 `FORCE=1 bash scripts/publish-board.sh`，成功。
- CI（run 40814720442）：Contracts 16s ✓ / Frontend lint+build 2m4s ✓ / Deploy·Render 3s ✓。**这个项目的部署真链路是 CI 里的 `Deploy · Render` job（调 Render API），仓库 webhook 的 autoDeploy 有时不生效**；所以"push 完等自动部署"这种假设不能用，要 poll CI 的 deploy job 或直接 `GET /v1/services/<id>/deploys`。

## 开工复工检查单（下次直接用）

```bash
cd /mnt/c/Users/Administrator/prediction-arena
export HTTPS_PROXY=http://172.17.240.1:16781
git fetch "https://x-access-token:$(cat ~/.hermes/.gh_token_predictionarena)@github.com/lulaxiao97-create/prediction-arena.git" main   # GIT_CONFIG_GLOBAL=/dev/null 前缀
pgrep -x cron || sudo service cron start
tail -3 logs/cron-board.log logs/publish-board.log    # 确认 cron 还活、publish 没在报错
bun scripts/sync-attribution.ts                        # 归因是否已有真实下注
gh run list -R lulaxiao97-create/prediction-arena --limit 3
```

### 6. /admin 加 Tribal ledger（ad079b7）

- `/api/growth/summary` 的 `perMarket` 现在带 `title`（从 manifest 读，poolId 本身不说明是哪个部落）与 `volumeUsdc`，并按**交易额**排序（原来按笔数）。
- `/admin` 的 Growth 面板从 2 列改 3 列：Top referrers / **Tribal ledger（前 5 名，标题 + 笔数 + $金额）** / Channel mix。空态写明"这笔数据同时决定每日选靶"。
- 验证：`tsc` 干净、`bun run build` 绿、`bun run lint` 0 error（20 条历史 warning）、`bun run test:e2e` **22 passed**。
- CI run 40815953674 三 job 全绿，Render `dep-dbhce2gn74is73d08bk0`（ad079b7）**live**；线上 `x-frame-ms: 2.86`（miss）。

### 本轮提交

```
e2f2424 fix(ops): the publish retry loop was itself broken in two places
5182245 fix(ops): retry the board publish after rebasing onto the other writer
ad079b7 feat(admin): tribal ledger — USDC per market, ranked by volume
1f24ba9 feat(growth): feed on-chain referral volume back into the tribal market pick
75bcc71 perf(frame): expose server-side render time in x-frame-ms
```

## 2026-10-29 第二轮：零预算四板块闭环（不充值 X）

老板拍板：**彻底放弃 X API 充值**，走「X 手动/社群 + GitHub Star + TG 团长分润 + 部族盘口转化」的零成本闭环。

### 1. 文案升级 + 一键分发（74a89e0）

- 三端文案统一改成"看得到对抗"的形态：双边赔率 + 8 格 ASCII 条形图 + 站队人数 + 剩余时间。

  ```
  🏴 Will AERO close above $0.7750 before October 31, 2026?

  YES █░░░░░░░ 15% → 6.7×
  NO  ███████░ 85% → 1.2×

  311 already picked a side. 3d left. The wrong side pays the right side.
  ```

  - 用 `█/░` 而不是 emoji：一个 cell 一个字符，8 格只吃 8 个 X 预算；emoji 每格 2 字符且字体不稳。
  - 草稿**由长到短**依次试，塞不进 275 权重就降级，长标题是"降级"不是"截断"。
  - 实测：700011 的 X 文案 216/280 权重、Farcaster 266/320。
  - 收尾句写真实机制（输的一边付给赢的一边），不是暗示白拿钱。
- TG 日报植入**团长招募令**（老板给的英文原句 + 机制补充）：

  ```
  🧑‍💼 CAPTAIN PROGRAM — copy your referral link from the portfolio drawer (Portfolio → Invite & Earn),
  share this market, and automatically earn a cut of the 4% platform fee on-chain.
  Mechanically: the arena credits the referrer 30% of that 4% rake per referred position,
  paid by the contract at settlement — not by us, and not out of anyone's stake.
  ```

  线上已核实：`t.me/predictionarena_hq/9`（run 40827220357，TG sent / X 仍 402）。
- `scripts/campaign-digest.ts`（新，`bun run campaign:digest`）：零成本分发的另一半。
  `--remote` 直接从 `raw.githubusercontent.com` 拉云端最新归档，按渠道打印**一键粘贴块**（永不自动发帖）；
  `--channel=x|cast|telegram`、`--market=`、`--md`（周历表格）、`--json`。本地/远端都实测过。

### 2. README 定位重写（5cf7857）

- 首屏加了定位块：*An autonomous 24/7 Web3 prediction-market CGO agent … zero human intervention between ticks*，
  并加 3 个徽章（Agent 24/7 autonomous / Human in the loop: none / Stars）。
- 新增 **The autonomous CGO agent** 大节：ASCII 架构图（GitHub Actions ↔ WSL cron ↔ Render ↔ Base）、
  **六条自运转回路表**（含"少了它会怎样"）、值得抄的 6 个实现（手写 OAuth1.0a、失败分级 401/402/403、
  归因回灌选靶、自己给自己计时的 frame、按平台长度预算）。
- 新增 **Verify the agent in 60 seconds**：4 条 curl，无 API key，全部本机实测通过
  （prices.json / x-frame-ms / growth summary / 云端归档 index.json）。
- 新增 **What the agent cannot do (yet)**：X 402、链上 0 笔、渠道归因拿不到、$10k/月≈333 个有本金钱包。留在明面上。
- 新增 **Build in public** 段 + Star CTA，点名 5 个值得读的文件。
- 仓库元数据（比 README 更影响被发现）：描述改为 autonomous CGO agent 定位，
  homepage 设 `predictionarena.online`，topics 扩到 16 个（ai-agents / autonomous-agents / base-mainnet /
  farcaster-frames / github-actions / oauth1 / defi / llm …）。现状：**1 star / 0 fork**。

### 3. 归因回灌全自动（cron 新增）

```
*/30 * * * *  bun scripts/sync-attribution.ts   → docs/campaigns/attribution.json   (logs/cron-attribution.log)
```

- 用 `env -i` 模拟 cron 环境跑过（PATH 里没有 bun，所以 crontab 里写绝对路径 `/home/yolanda528/.bun/bin/bun`）。
- 云端 auto-marketing 在生成前也会跑一次；两条路径都写同一个文件，谁后跑谁生效，都是真数据。
- 仍是 `bets: 0`，所以 `byTribe` 空、`leader: null`、tribal 权重 100% 手调先验 +0 自适应。

### 4. 顺手确认上一轮修的 cron 真的活了

- 13:05 的 `publish-board.sh` 成功 push（本地 HEAD 出现 `chore(data): board refresh — BTC $80,255…`），
  说明 retry+rebase 那套在无人值守下确实能过。
- 云端 auto-marketing 的归档提交照常进来，两种写入者共存不再互相打死。

### 验证

- `tsc` 干净、`bun run build` 绿、`bun run lint` 0 error（20 条历史 warning）、`bun run test:e2e` **22 passed**。
- 已推 main：74a89e0 / 5cf7857。

### 5. 部族盘口闭环升级（ac12f99 / aec0371）

- **假部落剔除**：`TRIBE_TOKENS` 里原来的 `base` / `onchain` / `higher` 会误判——
  `Will Base TVL close above $6.4B` 拿到 +3 部落分，和真正的 DEGEN/TOSHI 盘口并列前三；
  `higher` 还会命中 "closes higher than" 这种普通措辞。现在只留真社区代币：degen / toshi / brett / mog / aero / aerodrome / zora。
  改完后 `--pick=tribal --limit=8` 的前 6 名全是 AERO / DEGEN / TOSHI / BRETT（8 分），第 7 名才是非部落盘口（6 分）。
  **假部落比漏掉更糟**：选靶的意义就是找"值得站队的一边"，基础设施指标不是一边。
- **两个班次都走 tribal**：原来 09:10=movers、17:10=expiry，等于把部落王牌一天只用一次。
  现在两个 schedule 都是 `--pick=tribal`。
- **同日不重复**：`--pick=tribal` 会跳过当天归档里已有的盘口 id（`archivedToday()`），
  盘口太薄时回退到完整排序（"重复也比沉默好"）。实测：第一次发 700011，第二次输出
  `[schedule] skipped 1 market(s) already featured today` 并改发 700034。
- **顺手修的真 bug**：`archive()` 原来直接 `writeFileSync(index.json, {posts})` —— 覆盖而不是合并，
  17:10 那一班会**删掉 09:10 那一班的记录**，而"同一天不重复"正需要这份记录。现在按 id 合并 + 按 generatedAt 排序。
  实测 index.json 从 `['700011']` 变成 `['700011','700034']`。

## 2026-10-29 第三轮：全栈产品改造 + 桌面营销包

### 1. 首页常驻 Rakeback 通栏（frontend/components/RakebackBanner.tsx）

- 位置：`<main>` 第一个元素，Hero 之上，**不可关闭**（这不是限时活动，只要合约还给 referrer 分润就一直成立）。
- 文案（6 语言，`i18n-extra.ts` 的 `RAKEBACK` 表）：标题 `Earn 30% Rakeback`，正文
  `Share your referral link from Portfolio, earn automatic USDC fees on-chain.`，
  第三行 `mono` 小字**写清口径**：`30% of the 4% rake · paid by the contract at settlement`。
  只写 "earn 30%" 会被读成收益率承诺，必须带上 "of the 4% rake" 与 "paid by the contract"。
- 两个动作：`Copy my link`（`inviteLink` + `shareableRef`，没连钱包就用手柄 `predict065`）、
  `Open Portfolio`（派发 `window` 事件 `pa:open-portfolio`，Navbar 监听后开抽屉——不加 context provider）。
- e2e 新增断言：region 名 `Rakeback` 可见、标题/正文/口径三段都在、点 CTA 后 `role="dialog"` 出现。

### 2. 分享链路：钱包归属 + Farcaster（lib/share.ts / ShareActions / BetModal）

- `trackedMarketUrl(id, channel, origin?, ref?)` 增加 ref 覆盖；`ShareChannel` 增加 `farcaster`。
- **连了钱包就用自己的地址当 ref**（合约只认地址，`ref=x` 一分钱都不会给分享者）；
  没连钱包时保持 `ref=x`（渠道标签），所以匿名分享的行为跟以前一致，老 e2e 断言不用改。
- `ShareActions`：面板版 2 按钮 → 3 按钮（X / Farcaster / Copy），紧凑版 2 图标 → 3 图标；
  Farcaster 用 `https://warpcast.com/~/compose?text=&embeds[]=`（embeds 才会把 frame 卡渲染出来）。
- 下注成功弹窗（BetModal 的 `done` 分支）新增 **flex 区块**：贴出完整文案预览 + X / Farcaster / 复制三键。
  文案由 `flexText()` 生成，数字来自弹窗自己算出来的成交后隐含概率，不另算一套：
  `🏴 I'm in on YES at 3.6× — "…"` + 阵营占比 + 双边 8 格条形图。
  **不写"赢了"**——仓位还没结算，写赢了就是假数。
- 复制按钮复制的是 `ref` 版链接（`trackedMarketUrl(id,"copy",undefined,ref)`），粘到群里也能归因。

### 3. 桌面营销包（scripts/push-desktop-marketing.ts，`bun run push:marketing`）

```
Desktop/PredictionArena_Marketing/
  01-main-tweet.txt        当日旗舰推文（<280 权重，条形图 + 双边赔率 + 倒计时 + ?ref=x）
  02-alpha-reply-deck.txt  3 条截流回复（contrarian number / receipt / open challenge，各 <280）
  03-captain-pitch.txt     团长话术 EN + 中文（30% of 4% rake、零门槛、链上结算、无 KYC）
  04-calendar.md           最近 14 天已发盘口表
  meta.json                所有数字的来源与时间戳（含 prices.json 的 updatedAt / BTC）
  README.txt               怎么用（两分钟/天）+ 文案规则
  archive/<date>/          当日快照
```

- 主推文**优先直接抄当天云端归档**（`docs/campaigns/<today>/index.json`），归档没有才现生成——
  桌面包和频道不能出现两个版本的数字。
- 回复包按"一个部落一条"挑盘口（三条 AERO 的包是废包），三种角度避免同一账号复读。
- 新增 `scripts/lib/copy-kit.ts`：`auto-market.ts` 与桌面包共用 bar/赔率/倒计时/链接/格式化，
  **一处改两边同变**（这是本轮把 auto-market 里那堆本地函数抽出来的原因）。
- 实测：`MARKETING_DIR=/tmp/...` 与 `--dry-run` 都验过；桌面真机路径
  `/mnt/c/Users/Administrator/Desktop/PredictionArena_Marketing` 已生成 6 文件 + archive。
- crontab 新增 `30 17` / `30 1`（CST，对应云端 09:10 / 17:10 UTC 发车之后）各跑一次；
  用 `env -i` 模拟 cron 环境验过。

### 4. README 增加 Show HN / Product Hunt 段

- 标题 `Show HN: a 100% autonomous Web3 growth agent running a real prediction market on Base`。
- 三条"极客会喜欢的实现"：手写 OAuth 1.0a + 失败分级、归因回灌选靶（+2 上限）、
  能扛第二写入者的 cron。
- 明写当前状态：X 402、链上 0 笔、流动性是演示数字但池子真实且为空。
- 给了 30 秒验证命令与"欢迎来拆"的具体请求。

### 5. 手机端复核（3e77362）

- 390px 下通栏第三行（`30% OF THE 4% RAKE · PAID BY THE CONTRACT AT SETTLEMENT`）被 `truncate` 截成
  `…AT SETTLE…`——**口径被截断等于没有口径**，改动为允许换行。
- 改后实测（真 Chrome 390×844 device metrics）：`scrollWidth 390 == innerWidth 390`，
  tag 文本完整、`tagClipped=false`，通栏高 159px。

### 6. 本轮提交

```
2c2b89c feat(cro): a permanent rakeback banner, and shares that pay the sharer
d32c616 feat(marketing): a paste-ready desktop pack, and one copy kit behind it
4959b6c docs(readme): a Show HN / Product Hunt section that admits the state
3e77362 fix(cro): let the banner's qualifier wrap instead of truncating on mobile
```

- CI run 40833173297 三绿；Render `c05f5d5d` live；e2e 23 passed（含新增通栏断言）。
- 线上实测：首页 region `Rakeback` 可见、三段文案齐全；盘口页三个分享入口
  （Share to X / Share to Farcaster / Copy link），Farcaster intent 带 `embeds[]`，复制链接带 `ref`。
- 桌面包：`Desktop/PredictionArena_Marketing`（6 文件 + archive/2026-10-29），
  主推文 216/280、三条回复 196/181/165，团长话术 EN+中文。

## 2026-10-29 第四轮：推文配图引擎 + TG 团长机器人

### 1. 配图引擎（scripts/generate-marketing-image.ts）

- 技术选型：**Playwright 的 Chromium 直接截 1200×675 的 HTML**（e2e 已经在用同一份浏览器），
  不走 canvas/satori——渐变、模糊、混合模式、系统字体都是原生能力，且**卡片的渲染器就是测试渲染器**。
  `playwright-core` / `qrcode` 通过 `createRequire(frontend/package.json)` 解析（脚本在仓库根跑，
  依赖装在 frontend/node_modules，写死绝对路径会脆）。
- 卡片内容：`🏴 AERO vs $0.7800` 大标题、双边赔率+倍数、真实进度条（不是字符条）、
  `3D LEFT / 311 IN / $58,100 POOL / SPOT` pill、**追踪链接的二维码**（svg，2× 下不糊）、
  域名 + 两个 handle + 合约行。配色：`#05070D` 底 + 网格透视 + 青/金光晕 + 扫描线 + 四角框。
- **数字一致性（这轮最重要的设计）**：`auto-market` 归档里新增 `snapshot`（yes/traders/liquidity/
  strike/spot/endTime）。卡片**从归档快照渲染**，不读实时盘口——否则会出现「推文说 $0.7325、
  图片说 $0.7300」。来自归档时 kicker 写 `SNAPSHOT · DEGEN · AS POSTED`，不再写 `LIVE`。
  归档没有 snapshot（今天之前生成的）→ 桌面包改为**从实时盘口重新生成文案+图**并标 `generated`。
- 实测：700035 卡与 `01-main-tweet.txt` 完全一致（YES 26% → 3.8× / NO 74% → 1.4× / 183 IN / 3d）。
- 已接入 `push:marketing`（`renderCard()` 子进程，失败只报 `skipped — 原因`，不拖死文本包）；
  也有单独入口 `bun run image:card --market=<id>`；`--dry-run` 不渲染，只在 meta 里标 `generated:false`。

### 2. TG 团长机器人（scripts/telegram-bot.ts）

- 日报底部按钮：`auto-market` 发 TG 时先 `getMe` 拿 bot username，再挂
  `inline_keyboard`：`🧑‍💼 Become a Captain (Earn 30%)` → `https://t.me/<bot>?start=captain` + `🏴 Today's board`。
  **频道不能主动开私聊**，deep link 是唯一从公开帖进私聊的路；username 用 getMe 解析，换 bot 不用改配置。
  发送结果区分 `sent (captain button attached)` / `sent (no bot username — text CTA only)`。
- 对话（纯函数 `respond(text, session)`，外面套 long-poll 传输）：
  `/start captain` → 要钱包地址 → `0x…` → 返回**自己的** `?ref=<address>` 链接 + 中文群发模板 +
  英文群发模板 + 按钮；`/link` 重发、`/help`、`/markets`、`/how`；非法输入重新要地址。
- 可验证性：`bun scripts/telegram-bot.ts --self-test` 在**没有 token** 的情况下跑完
  5 步对话并断言（链接必须带自己的地址、必须说清 30%、必须给群模板）。实测通过。
- 常驻：`scripts/start-telegram-bot.sh`（pgrep 幂等、无 token 静默退出 0），crontab 加
  `@reboot` + `*/10` 守护。**当前机器上没有 bot token**（在 GitHub Secrets 里，API 读不出来），
  所以现在只会打印“no bot token”并退出——把 token 写进 `~/.hermes/.tg_bot_token` 后，
  10 分钟内自动起，不需要再动代码。

### 3. 截流文案加关注钩子

- 三条回复末尾统一追加
  `Follow @Predict065 for the on-chain odds breakdown before each settlement.`
  （权重超 275 时自动丢掉这行，不会截断正文）。
- 实测权重：272 / 257 / 241，全部 <280。
- `push:marketing` 的兜底选靶也改了：原来是“按人数取第一”，结果选出英超盘口当旗舰；
  现在**先按是否部族盘口排，再按人数**。

### 4. 已知边界

- 卡片渲染依赖 frontend/node_modules 里的 Chromium；换机器要先 `bun run test:e2e:install`，
  否则卡片会 `skipped` 而文本包照常生成（这是有意的降级）。
- bot 是 long-poll 进程，WSL 关机就停；`@reboot` + 10 分钟 tick 会在开机后自愈。
- 二维码指向带 `utm/ref` 的追踪链接，扫进来的人能被 `/admin` 归因（前提是有真实下注）。

## 2026-10-29 关机存档 · 开机后怎么做

**HEAD = 754ced8**，工作区干净，已推 `main`，CI 绿，Render live（ec284203 / 754ced8）。
桌面包已生成：`Desktop/PredictionArena_Marketing/`（含 `01-market-card.png`）。

### 开机后按这个顺序（10 分钟）

```bash
cd /mnt/c/Users/Administrator/prediction-arena
export HTTPS_PROXY=http://172.17.240.1:16781
bash scripts/refresh-board.sh                    # 1. 盘口刷到最新（关机期间不会自己变）
bash scripts/publish-board.sh                    # 2. 推上去 → CI → Render（自带重试+rebase）
bun scripts/sync-attribution.ts                   # 3. 看有没有第一笔带 ref 的下注
bun run push:marketing                            # 4. 重出桌面包 + 新卡片
```

cron 会自动接管后面的事（板刷新 */30、发布 :05、开池 :10/:40、归因 */30、桌面包 17:30/01:30、bot 10 分钟保活），
**开机只需确认三件事**：

1. `pgrep -x cron` 有输出（WSL 里 cron 是 enabled，一般自己就起来了；没有就 `sudo service cron start`）。
2. `tail -3 logs/publish-board.log` 里没有 `ERROR`；有就手动跑一次 `FORCE=1 bash scripts/publish-board.sh`。
3. 桌面包的 `meta.json` 里 `card.generated` 是 `true`（不是就 `bun run image:card --market=<id>`）。

### 只有老板能做的两件事（代码侧已就绪，不阻塞上面）

- **发推**：X 仍是 402，发不出去。打开桌面包 → `01-market-card.png` 拖进推文 + `01-main-tweet.txt` 全文粘贴 →
  发。截流回复从 `02-alpha-reply-deck.txt` 里挑一条。这是唯一会带来粉丝的动作。
- **Bot token**：把 Telegram bot token 写进 `~/.hermes/.tg_bot_token`（`chmod 600`），10 分钟内
  `*/10` 的 cron 会把 `scripts/telegram-bot.ts` 拉起来；之后频道日报的按钮就能自动走
  “/start captain → 要钱包 → 返专属 ref 链接 + 群话术”。验证：`bash scripts/start-telegram-bot.sh` 后看
  `logs/telegram-bot.log` 里出现 `bot @xxx polling…`。

### 现在的真实状态（别记错）

- 链上下注 **0 笔** → 30% 分润实际为 $0，`/admin` 的 Tribal ledger 空着，归因权重 100% 手调先验。
- 盘口流动性/成交额是演示数字，池子真实存在且为空；第一笔下注者就是该边的全部流动性。
- 所有营销现在是“素材已备好、需要人手发”的状态：卡片 + 文案 + 回复包 + 团长话术都在桌面上。

## 2026-10-31 第十轮：盘口百量化 + 多行业（本轮）

**为什么动**：38 个盘口全部在同一个月底到期 —— 1 号满盘，28 号就剩一个等死的倒计时；主题也基本只有 Base/Meme。留存和频次都被这个结构卡住。

### 现在的数字（`logs/board.json`）

- **150 个盘口**，八条 lane：Crypto & Macro 31、DeFi & L2 15、AI & Web3 Tech 21、Memes & Culture 18、Sports & Esports 16、Politics & Policy 13、Base Ecosystem 14、**Macro & Economy 22（新 tab）**。
- 期限梯度：**24h 17 个 / 3–9 天 38 个 / 10–40 天 74 个 / 40 天以上 21 个**（tier 记法 24h:17、mid:38、long:95）。
- 每天新增：8 个币的 24h touch 盘 + 3 个 meme 的 24h 盘每天滚一轮；3 天/7 天档每档一个标的只挂一个活跃盘，临期才滚。

### 数据源（全部写进 `prices.json`，标题里的数字只能来自这里）

- Binance：19 个（BTC/ETH/SOL/BNB/XRP/DOGE/AVAX/LINK/UNI/AAVE/ARB/OP/SUI/ENA/ONDO/TAO/HYPE/PEPE/WIF）+ PAXG。
- CoinGecko：AERO/DEGEN/BRETT/TOSHI/MOG/ZORA/USDC + 全局市值/BTC.D。
- DefiLlama：base/ethereum/solana/arbitrum/optimism/polygon/avalanche/unichain 八条链 TVL。
- **Yahoo Finance**（`query2`，`query1` 被 429）：NVDA/AAPL/MSFT/GOOGL/TSLA/META/AMD、^GSPC、^IXIC、GC=F、SI=F、CL=F、DX-Y.NYB。
- **FRED**（`fredgraph.csv`，免 key）：DGS10、DGS2、DFEDTARU、UNRATE、T10Y2Y、MORTGAGE30US；CPI/核心 CPI 的 YoY 由 CPIAUCSL/CPILFESL 算（同比，取同月去年）。

### 三条机制，别改坏

1. **执行价粘住（`.data/board-sticky.json`）**：一个盘口的执行价和截止时间在第一次生成时定死，只有临期才滚（24h<6h、3d<30h、7d<60h）。不这么做的话，每次 30 分钟重建都会按新价重打执行价 → 标题变 → id 变 → 又建一个新池，旧池全成孤儿。
2. **id = 标题哈希**（`ID_BASE=720_000_000`）：以前是位置 id，扩盘时会把链上已有池子指向完全不同的题目（旧的 700001–700038 就是这么来的）。现在注册表里同 id 但标题不同 → 直接丢弃这条生成行，绝不改写已上链的卡片。
3. **地板守卫**：`gen-board` 少于 100 个拒绝写文件；`refresh-board` 不足 100 退出 1；`publish-board` 不足 100 拒绝发布。行情源掉一个不会把产品悄悄做小。

### 开池与发布

- 新脚本 `scripts/open-pools-batch.sh`：一次读 nonce → 逐个显式 nonce `--async` 广播 → 事后并行收据（`cast` 会吃 stdin，必须 `</dev/null` 和 `3<file`，否则循环被腰斩，第一版就踩了）→ 每 tick `BATCH=30` → 写 registry → 余额低于 0.0004 ETH 直接跳过。
- cron `:10,:40` 已从 `open-pools-mainnet.sh` 换成 batch。`sync-opened-pools.py` 改成 8 线程，150 个 getPool 从 4 分钟降到 ~30 秒。
- 实测：每池 gas ≈ 0.8e-6 ETH（约 $0.002）。首轮手工测试池 715267574（题面 "Test title"）已弃用、不在盘上。

### 前端 / 营销

- 新 tab `Macro & Economy`（i18n key 六语言本来就有，只是没接进 `CATEGORY_TABS`）；`categories.ts` 的宏类别不再折进 crypto。
- 卡片用 `content-visibility:auto`，150 张一次挂载也不卡（筛选/搜索仍覆盖全盘，没做分页）。
- `push-desktop-marketing.ts` 选旗舰改成 **heat**：真实 24h 涨跌幅 × 争议度（1-|YES-0.5|*2）× 紧迫度，回复包按 lane 分散，不再选"人最多"的那张。
- 小币价格格式（MOG $9.829e-8）改成定点小数，`copy-kit.price()` 同步。

### 验证

- `gen-board` 连跑两次 id 全等（150 个，哈希稳定）；人为把一个 24h 盘口的 deadline 改到 2 小时后 → 自动滚期、总数仍 150。
- `bun run build` 绿，静态页 157 个（150 张分享卡全部预渲染），2m13s。
- `bun run test:e2e` **23/23 通过**（frame.spec / growth.spec 里写死 700001 的用例改成从 `/pools.json` 取当前 id —— 写死 id 在哈希 id 下必然失效）。
- 已 push 到 main：代码 `e676dcd`，随后 :05 的发布 cron 补了数据提交 `79ccee2`（150 markets [24h:17/long:95/mid:38]）。

### 边界（别对外吹过头）

- 24h 盘是 **touch 语义**（"期间任意时刻触及"，用 barrier 概率），不是收盘价；3 天以上才是"任意日收盘"。
- Yahoo 的股票/指数/金属是**交易所报价**，不是 7×24；周末这些盘口没有新价，yesShare 不动。
- FRED 是**发布值**（日频/月频），不是实时行情；CPI 盘口结算看 BLS 发布。
- 旧 700001–700038 的池子还在链上，只是不再出现在盘上（id 段已换），里面没有资金。
- 盘口流动性仍是展示数字；链上池子建好了但没种子资金，第一笔下注者就是那一边的全部流动性。

### 补记（同日晚些时候，开池收尾）

- **150/150 个盘口已全部上链**（`scripts/opened-pools.json` 150 条，`getPool` 逐条核对）。总花费约 0.00017 ETH（≈$0.38，$0.0025/池）。签名钱包余额 0.00122 ETH，够几十轮重建后的滚期开池。
- 收尾时踩了两个坑，都已修进 `open-pools-batch.sh` 并推 main：
  1. **并发**：手工 `BATCH=80` 和 `:10` 的 cron 同时起，两边各读一次 nonce → 重叠 → 丢了一笔广播。现在加 `flock logs/pool-batch.lock`（81a58a8）。
  2. **nonce 漂移**：读到的 pending nonce 可能在发送前被别人（或自己上一笔慢上链的交易）用掉，旧版把它当致命错误整批中断。现在本地跟踪 nonce，被拒才重读，最多重试 3 次（b74b329）。
- 另外解释一下当时满屏的 `REVERT`：那不是链上失败，是**重复发送**——第一批 80 笔里有 31 笔没被登记进 registry（收据慢），下一批又给同样的 id 发了一次，第二次自然 `PoolAlreadyExists`。用 `sync-opened-pools.py`（8 线程，30 秒）按链上真相重建 registry 后，只剩 5 个真的没建，补一批 5/5 成功、0 回滚。
- 两个孤儿池（不在盘上、里面没钱，别当 bug）：`715267574`（手工探针 "Test title"）、`722885906`（手工探针 "Probe"）。以后别再拿盘口 id 做手工 probe——要测就直接 `cast call` 模拟，不要 `cast send`。

- **运维教训**：改一个被 cron 直接调用的脚本时不要原地写文件。10:10:03 的 cron 恰好读到我在 10:09–10:11 之间半写状态的 `open-pools-batch.sh`，报 `line 117: break` / `line 120: syntax error`（脚本本身没坏，是读到了中间态）。改这类文件要 `write → mv` 原子替换，或者先 `crontab -e` 摘掉那一行再改。该次 cron 没有产生任何链上动作。

## 2026-10-31 第十一轮：19 板块 / 232 盘口 / 三旗舰营销 / GitHub 门面

- **板块 8 → 19**：Crypto Core 31、Global Stocks 26、Memes & Social 18、Sports & Gaming 16、DeFi & Yield 15、Layer 2 & Base 14、Macro Economy 13、Commodities & Metals 13、Degen Dials 13、Global Policy 11、AI Agents & Tech 8、Entertainment & Pop 8、US Politics & Policy 7、Web3 Infrastructure 7、Real World Events 7、Asia & Regional 7、Prediction Markets 6、NFTs & Digital Art 6、VC & Startup Deals 6 = **232**。
- 新增 lane 的 i18n key（nav.* + category.*）六语言都补了；`categories.ts` 的别名表重写（139 条），旧拼写不会掉进 other。导航栏本来就是横向 scroll rail，20 个 tab 不用改布局。
- 尾部赛道靠「可核查的结算源」立住：Yahoo 的股票/指数、COMEX/NYMEX 的金属原油、BLS/DefiLlama/Blur/Box Office Mojo/FATF/SFC/BOJ 这类公开口径；没有实时行情的用规则型命题，不编价格。
- **营销**：一天三旗舰，按 heat 排序且必须来自三个不同 lane；回复包按 lane 换腔调（宏观/美股/AI/大宗/meme/娱乐/预测市场/体育/政策/核心/短线），桌面出 `01/02/03-market-card.png` 三张 1200×675 + `01-main-tweets.txt` 三条推文。
- **GitHub 门面**：README 加 mermaid 闭环图（行情 → 生成器 → Base 托管 → 归因 → TG 团长 → Frame UI）+ 60 秒 Quick Start + E2E/232 市场徽章；仓库 description/topics 用 API 设好（prediction-markets、base、solidity、ai-agents…），开 Discussions。
- **验证**：`bun run build` 绿（239 静态页，232 张分享卡预渲染）；`bun run test:e2e` 23/23；`tsc --noEmit` 干净；链上 232/232（0 revert，余额 0.00115 ETH）；线上 `/api/board` 已 232 条 / 19 lane。
- **踩坑记录**：① 20 个 tab + 首屏封面图在 390px 下溢出 8px，`main` 加 `overflow-x-clip` 解决；② e2e 那 7 个失败**不是**代码问题——我在旧 dev server 还占着 3100 时重建了 `.next`，服务器读到半新半旧的 chunk，客户端没 hydrate（症状：cookie 不写、分享链接停在 fallback、弹窗不弹）。跑 e2e 前先 `pkill -f next-server` 再 build/start。

## 2026-10-31 第十二轮：Arena Points + 创世空投钩子 + 代币经济学

- **积分账本不落库**：`scripts/sync-points.ts` 重放链上 `BetPlaced` 生成 `frontend/public/points.json`（+ `docs/points/ledger.json`），规则在 `frontend/src/lib/points.ts`（10 分/$1、冷门 ×1–2、48h 内 ×1.5、团长拿团员 20%）。cron `*/30`。
- **接口**：`GET /api/points` 出规则+榜单，`?address=` 出个人分数/名次/预估创世份额；未知地址老实返回 0。线上已 200。
- **前端**：`PointsCard` 塞进 PortfolioDrawer（分数、名次、团长分润、预估 $ARENA、Top5 榜、规则一行）。
- **Bot**：绑定钱包 / `/start captain` 话术顶部加创世空投宣告；新 `--leaderboard`（每日 09:05 cron）给每个团长私信「分数 / 名次 / 团员分润 / 预估空投 / 自己的 ref 链接」。
- **营销**：推文与回复包植入 “🔥 Arena Points genesis airdrop live — bet or refer, earn $ARENA”（回复包只放第一条，避免像刷屏）；卡片新增金色 `ARENA POINTS · GENESIS AIRDROP` 徽章（已目视验收 01 卡）。
- **`docs/TOKENOMICS.md`**：10 亿总量、42% 创世空投给积分、25% Aerodrome 流动性锁 24 个月、18% 生态、10% 团队（12+36）、5% 金库；手续费 1.2% 团长 / 1.5% 回购销毁 / 1.3% 金库；团长保留 20% 积分分润需锁 50% 已赚代币 90 天；不预售、不付上币费。文首明确写「现在没有代币、不可购买、不承诺价值」。
- **验证**：build 绿（239 页，`/api/points` 已进路由表）、e2e 23/23、bot self-test OK、`--leaderboard --dry-run` 出完整战报、线上 `/api/points` 200。
- **踩坑**：① `mainnet.base.org` 的 `eth_getLogs` 直接 -32011，积分扫描默认走 publicnode；② chunk 减半写成 `Number(CHUNK)/2` 会得到非整数 → `BigInt` 抛 RangeError，必须 `Math.floor`；③ `pkill -f next-server` 会连自己这条 shell 一起杀（命令行里含同样字符串），要清端口用 `fuser -k 3100/tcp`。
- **现状**：链上 0 笔下注 → 积分榜是空的，这是真的，不是 bug。有人下第一笔，`*/30` 的 cron 就会把分数算出来。
