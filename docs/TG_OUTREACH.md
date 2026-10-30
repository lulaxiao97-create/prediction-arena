# 电报主动获客引擎（跑群主）

## 先说平台事实（这条决定了整个设计）

**Bot 不能主动开私信。** Telegram 的规则是：机器人只能回复先给机器人发过消息的人。
所以 `@predictaing_bot` 能做的是"接住点进来的人"（已经有），
**主动去私信频道主/群主必须用普通账号会话**（MTProto，`scripts/tg_user.py`，Telethon）。

另外一件事也一样重要：**你不能私信一个频道**。冷启动的对象是**人**（频道主、喊单员、群主），
不是频道本身。所以引擎的最后一步是"给某个人发消息"，`via` 字段记住这个人是从哪个频道捞出来的。

## 三段式

| 段 | 命令 | 要账号吗 | 干什么 |
|---|---|---|---|
| 发现 | `bun run tg:discover` | 不要 | 从 t.me 公开预览读频道：订阅数、最后发帖时间、帖子正文、话题词。活跃的留着，死了的写明原因 |
| 捞人 | 同上（同一步） | 不要 | 把活频道页面上出现的每个 `t.me/<name>` 抓下来分类：人 / 机器人 / 频道 / 群。人进队列，频道/群进下一跳 |
| 写文案 | `bun run tg:compose` | 不要 | 每人一条 DM：引用他被看到的那句话 → 用正在定价的盘口给双边数字 → 30% 口径 → 一个 30 秒动作 → 明确 opt-out |
| 发 | `bun run tg:send` | **要** | 走会话发，遵守每日上限与抖动，FloodWait 照做 |

爬取是两跳广度优先：两个活频道 → 它们页面上的人与频道 → 那些人所属的频道 → 再一轮。
账号一个都不需要，因为 `t.me/s/<name>` 就是公开网页。

## 现在的实测结果（2026-10-30 本机跑出来的）

```
discover: 73 个频道爬到 · 16 个够格（还在 10 天内发帖）· 23 个人 · 23 条待发
```

- 名单在 `.data/outreach/TARGETS.md`：每个频道带订阅数、最后发帖日、评分与"为什么跳过"。
- 文案在 `.data/outreach/QUEUE.md`：一人一条，中英按频道语言分流，链接带 bot 深链。
- 这条链现在是**每天 05:10 自动重爬、05:30 自动重写文案、每 2 小时尝试发送**（crontab 里已有三条）。

爬不快的原因也说清楚：t.me 公开预览只能顺着"页面上出现的用户名"走，Base 圈子本身不大，
一轮下来就是几十个人。**登录会话之后可以换成 `contacts.search` 按关键词直搜频道**（Telethon 一行就够），
那时名单规模是另一个量级 —— 这一段我没写进代码，因为没会话就没法测，不写没测过的东西。

## 开会话（唯一需要人的一步，约 20 秒）

```bash
bun run tg:login          # 打印二维码
```

手机 Telegram → 设置 → 设备 → 连接桌面设备 → 扫码。会话存 `~/.hermes/tg_user.session`（600），不进仓库。
扫完后 `~/.hermes/venvs/tg/bin/python scripts/tg_user.py whoami` 会打印账号。

**用哪个账号很重要**：这是给陌生人群主发第一条消息，用主号有被限流的风险。
建议单独一个"商务号"，或者接受主号的风险并把日上限调到 5 以下。

## 风控开关（都不是装饰）

- `OUTREACH_DAILY_CAP`（默认 12）：一天最多发这么多条，跨进程记在 `.data/outreach/state.json`。
- 发送间隔 90–240 秒随机抖动：等间隔连发是反垃圾系统最爱抓的形状。
- `FloodWaitError` 一到就照它说的睡，不重试。
- 每条文案都带一句"忽略这条，不会有第二次打扰"，且引擎不做自动追发。
- 只发在 Base / degen / 预测市场语境里活跃过的账号，不给无关人群发。

## 定时

```cron
10 5 * * *   cd <repo> && HTTPS_PROXY=<proxy> bun scripts/tg-outreach.ts --discover --max=80 >> logs/cron-outreach.log 2>&1
30 5 * * *   cd <repo> && bun scripts/tg-outreach.ts --compose            >> logs/cron-outreach.log 2>&1
0 */2 * * *  cd <repo> && bun scripts/tg-outreach.ts --send --limit=6     >> logs/cron-outreach.log 2>&1
```

没有会话时 `--send` 每次都只打印 `skipped — no Telegram user session` 并保留队列，不会刷屏也不会发错东西。

## 验收

```bash
bun run tg:selftest                       # 解析/筛选/捞人/分类/双语文案，全离线
bun run tg:stats                          # 频道数、人数、各状态计数、今天已发
bun run tg:send --dry-run                 # 打印今天真的会发出去的每一条
```
