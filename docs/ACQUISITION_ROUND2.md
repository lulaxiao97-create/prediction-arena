# 曝光推进 · 第二轮（2026-11-04 下午）

第一轮的六条线在 `ACQUISITION_2026-11.md`；这份只记录**已经落地的**和**下一批要打的**，避免重复讨论。

## 已落地（都有回执）

| 动作 | 结果 | 回执 |
|---|---|---|
| Google Search Console | 域名 `https://predictionarena.online/` 已验证（HTML 文件），站点地图已提交 | GSC → 站点地图：已成功提交 |
| Bing Webmaster | Google 账号登录成功，站点已加；Bing 自己抓到 sitemap | Known sitemaps 1 · URLs 236 · Success |
| sitemap.xml | 236 条（4 静态 + 232 市场 + /markets） | `https://predictionarena.online/sitemap.xml` 200 |
| robots.txt | 放行 + 指向 sitemap | 200 |
| 结构化数据 | 市场页 `WebPage + Question + Breadcrumb`；站点 `Organization + WebSite + WebApplication` | 页面源码 4 个 ld+json |
| IndexNow | 236 条一次性提交 | `200 OK` |
| `/markets` 爬虫枢纽 | 232 个市场全量内链（首页只链 86 个） | 部署后 200 |
| `/llms.txt` | 给 ChatGPT/Perplexity/Claude 的机器可读说明 | 部署后 200 |
| airdrops.io | 已提交（Points program 类目，邮箱 lulaxiao97@gmail.com） | 页面回执：「Your project is with our listings team」 |
| DefiLlama | PR #21991 已补评论：TVL 不再是 0（1.00 USDC 首笔） | 评论 #6623962558 + 地址更正 |
| TVL | arena 收到 1.00 USDC | tx `0x7ce9fd…95b082`，`balanceOf = 1000000` |

## 下一批（按预期曝光量排序）

1. **DappRadar**（月访问量最大的一批目录之一）
   - 卡点：它的提交页要求登录，登录走钱包/邮箱；本机 Chrome 里 MetaMask 已解锁，但 dappradar 的登录入口在他们的 JS 应用里，UIA 抓不到按钮。
   - 做法：人工点一次「Sign in → MetaMask → 签名」，之后我可以接手表单。
2. **Base 生态目录**（base.org/ecosystem，700+ 项目，官方流量）
   - 页面上没有显式提交按钮，提交入口在 Base 的开发者表单里；下一步从 docs.base.org 找当前表单链接。
3. **Dune 看板**（链上数据站，钱包登录即可）
   - 已有 `docs/DUNE_DASHBOARD.sql`；发布成公开看板后，Dune 站内搜索与外部引用都会带反链。
4. **Product Hunt / Show HN**（一次性脉冲，但会带来真实点击）
   - 角度不用「又一个预测市场」，用**可验证性**：「每个盘口在下注前就把结算规则写进链上」。
5. **Reddit**（r/Polymarket、r/BaseChain）——只回答问题、附盘口链接，不发广告帖；先潜水一周再动手。
6. **事件驱动建盘**（CPI / FOMC / 非农 / 选举）
   - 搜索需求在事件前 48 小时暴涨；现在 232 个盘里 Macro 只有 13 个，且多是价格点位。
   - 下一步：把事件日历接进 `gen-market`，提前 7 天建盘，标题按「会问的那句话」写。

## 判断依据（为什么先做 1–3 而不是继续发帖）

- 我们的 232 个页面现在**只有搜索引擎和目录站能带来"不用关注也能看到"的曝光**；X 4 个粉丝的号发什么都没分发。
- 目录站是**永久反链 + 加密原生流量**，一次提交长期有效；发帖是一次性的。
- GSC/Bing 今天才开始记曝光，1–3 天后才有第一份「有没有人看到」的数据；在那之前做的所有判断都缺证据。
