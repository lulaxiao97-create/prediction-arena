# Prediction Arena — 安全审计白皮书

| 项 | 值 |
|---|---|
| 审计对象 | `contracts/PredictionArena.sol`（538 行）+ `contracts/mocks/MockUSDC.sol` |
| 链上实例 | Base Mainnet `0x96c0333657c684Ac125A54a0858471e1c8267355`（已 Basescan 验证） |
| 编译器 | solc 0.8.20+commit.a1b79de6，optimizer 200 runs，evmVersion paris |
| 运行时字节码 | 9,901 bytes（EIP-170 上限 24,576） |
| 审计日期 | 2026-10-21 |
| 方法 | Slither 0.11.6（102 detectors）· Hardhat 23 tests · solidity-coverage · 人工逐行复核 · 两个可执行 PoC |
| 结论摘要 | 工程性漏洞（重入 / 整数 / 访问控制遗漏）**0 项**；风险全部集中在**特权角色**：3 项 High 及以上，均有可量化 PoC |

> 说明：任务描述里的 `placeBet` / `settlePool` 在本合约中实际名为 `bet` / `settle`，本文按真实符号审计。

## 0. 补丁状态（2026-10-21 晚，重构后）

| 发现 | 原严重度 | 修复方式 | 验证 |
|---|---|---|---|
| F-01 Owner 可下注 | Critical | `bet()` 首行 `if (msg.sender == owner()) revert OwnerCannotBet()` | 单测 + 红队 R1；**残留**：owner 用全新钱包（sybil）仍可下注 → 需去中心化预言机，红队 R13 已如实标记 |
| F-02 取消盘保留抽水 | High | 抽水改为**按盘口托管**（`pool.rakeAdmin` / `poolReferral`），`settle()` 才释放；取消时托管不释放，`claimRefund` 退还 100% gross | 单测 4 例 + 红队 R8/R9/R10：受害者 100 → 退 100，平台 0 |
| F-03 无兜底退款 | High | 新增无权限 `emergencyRefund(poolId)`：`Open` 且 `endTime + 30 days` 后可被任何人调用，置为 Canceled 并解锁 100% 退款 | 单测 4 例 + 红队 R7/R11/R12 |

附带行为变更：KOL 返佣从"全局 `referralFees(addr)` 立即可提"改为"**按盘口 `poolReferral(poolId, kol)`，仅该盘口结算后可提**"；`withdrawReferralFees(poolId)`。这是保证"取消盘 100% 退款"偿付能力的必要前提（钱在盘口结算前必须留在合约里）。

> 旧主网合约 `0x96c0333657c684Ac125A54a0858471e1c8267355` 已标记 deprecated，TVL = 0，未受影响；加固版需重新部署并重新验证。

---

## 1. 静态扫描（Slither）

```
slither . --filter-paths "node_modules|test|frontend|scripts"
→ analyzed (15 contracts with 102 detectors), 6 result(s) found
```

| # | Detector | 位置 | 判定 |
|---|---|---|---|
| 1 | `divide-before-multiply` | `bet()` L310/L320：`fee = received*400/10000`，`referralCut = fee*3000/10000` | **误报（设计如此）**。返佣定义为"抽水的 30%"，必须先把抽水取整再分成；先乘后除会得到 1.2% of stake 而偏离"30% of fee"。每笔最多损失 <1 wei 且由 `adminCut = fee - referralCut` 吸收，平台不吃亏、用户不吃亏 |
| 2 | 同上 | `previewBet()` L480/L481 | **误报**，与 `bet()` 同公式，保证前端预览与链上一致 |
| 3 | `incorrect-equality` | `_pullUsdc()` L526 `received == 0` | **误报**。这是防御性断言：fee-on-transfer 代币若把金额吃光，立刻 revert，而不是记一笔 0 头寸 |
| 4-6 | `timestamp` | `createPool` L203、`settle` L256、`_openPool` L509 | **可接受**。关盘/结算时序本来就依赖区块时间；矿工可漂移 ±数秒，影响仅是"早几秒关盘"，无资金风险 |

**Slither 未报出**：reentrancy-eth / reentrancy-no-eth / arbitrary-send / controlled-delegatecall / unchecked-transfer / shadowing / uninitialized-state / tx.origin。

---

## 2. 测试与覆盖率

```
bun run test        → 23 passing (4s)
hardhat coverage    → 23 passing, EXIT=0
```

| 文件 | % Stmts | % Branch | % Funcs | % Lines |
|---|---|---|---|---|
| **PredictionArena.sol** | **90.82** | **63.57** | **95.45** | **93.57** |
| MockUSDC.sol | 50.00 | 100.00 | 66.67 | 50.00 |

未覆盖语句：`422-425`（`setFeeVault` 函数体）、`490-492`（`pendingRewards` 的已领取早退分支）、`535-536`（`rescueERC20` 的 `to == address(0)` 分支与真实的 `safeTransfer`，测试只走过"禁止救 USDC"的 revert 路径）。

未覆盖分支共 51 处，绝大多数是 `revert` 护栏（`PoolNotFound` / `InvalidOption` / `NothingToWithdraw` 等）。**这是 branch 覆盖率只有 63.57% 的真实原因：安全护栏越多，branch 分母越大。**

已覆盖的关键边界（逐条为真实断言，非"跑过"）：
- 5 USDC 门槛拒单；50 USDC 上限拒 51、放行 50；池深 >250 USDC 后 20% 百分位接管（cap 69.6）
- 22.5+22.5 种子下 `maxBetFor == 50`，5~50 USDC 全部可下（死穴回归测试）
- 无人下注侧不可结算（`NoWinningStake`）；零证据哈希拒绝结算（`ZeroDataHash`）
- 赢家比例赔付、重复领取拦截、取消盘退款、平台/KOL 提现互不越界
- 提现后偿付能力不变式：`balance ≥ Σpools + adminFees + referralFees`（单测 + E2E 双证）

**覆盖率缺口建议**（Phase 3）：`setFeeVault` 正常路径与零地址分支、`rescueERC20` 非 USDC 代币真实转账、`pendingRewards` 已领取分支、多盘口并行下的账本隔离、以及 Foundry 不变式模糊测试（见 §7）。

---

## 3. 三类高危项人工复核

### 3.1 重入（Reentrancy）

| 函数 | 外部调用 | 顺序 | 防护 | 判定 |
|---|---|---|---|---|
| `bet()` L294 | `safeTransferFrom` L307 | **Interaction → Effects**（先转账后记账） | `nonReentrant` | **安全，但顺序不理想**（F-09） |
| `seedPool()` L227 | `safeTransferFrom` L232 | Interaction → Effects | `nonReentrant` | 安全 |
| `claimRewards()` L339 | `safeTransfer` L357 | Effects → Interaction（先清零 `claimed`/`_stake`） | `nonReentrant` | 安全（标准 CEI） |
| `claimRefund()` L365 | `safeTransfer` L378 | Effects → Interaction | `nonReentrant` | 安全 |
| `withdrawAdminFees()` L391 / `withdrawReferralFees()` L407 | `safeTransfer` | Effects → Interaction（先清零账本） | `nonReentrant` | 安全 |
| `settle()` / `cancelPool()` / `setFeeVault()` | 无 | 纯状态写入 | `onlyOwner` | 无重入面 |

补充判断：USDC 是标准 ERC-20（无 transfer hook、无回调），即使去掉 guard 也无法在 `bet()` 的 `transferFrom` 里重入；`nonReentrant` 在这里是纵深防御。**结论：无重入可利用路径。**

### 3.2 访问控制

| 函数 | 修饰符 | 说明 |
|---|---|---|
| `createPool` / `seedPool` / `settle` / `cancelPool` / `setFeeVault` / `withdrawAdminFees` / `rescueERC20` | `onlyOwner` | 全部覆盖 |
| `withdrawReferralFees` | 无（**设计如此**） | 只能动 `referralFees[msg.sender]`，任何人无法替他人领取 |
| `bet` / `claimRewards` / `claimRefund` | 无（用户自助） | 正确 |

`Ownable` 构造函数对 `usdc_ / feeVault_ / initialOwner` 做了零地址校验。**工程层面无遗漏**；但 `onlyOwner` 覆盖得越全，单点权力越大 —— 这是 §4 的核心风险来源（F-01/F-02/F-03）。

### 3.3 整数精度与舍入

```
fee        = floor(A × 400  / 10000)
referral   = floor(fee × 3000 / 10000)
adminCut   = fee − referral            ← 吸收所有向下取整的余数
netStake   = A − fee
payout     = floor(stake × totalNetPool / winningPool)
```
- 抽水环节：`referral + adminCut == fee` 恒等，**平台侧零损耗**；用户侧每笔最多多付 <1 wei（即 $0.000001），可忽略。
- 赔付环节：向下取整，每个赢家最多少拿 <1 wei；残渣留在合约内且**没有 sweep 函数**，永久锁死（F-08）。上界：每个盘口 ≤ `赢家数 × 1 wei`，对 1 万人的盘口也就 1e13 wei ≈ 0.00001 USDC，不构成经济风险，但账面上"合约余额 > 应付总额"会让审计工具持续报警。
- 0.8.20 自带 checked arithmetic；`endTime` 强制 `≤ now + 365d` 后再转 `uint64`，不会截断。

---

## 4. 业务逻辑与经济模型审计

### 4.1 三账本隔离

账本分三类，互不挪用：

```
optionPool[pool][0/1]     玩家本金（税后净额）
accumulatedAdminFees      平台纯利（70% 抽水，或无推荐人时 100%）
referralFees[kol]         KOL 返佣（30% 抽水）
```

- `bet()` 用 gross 金额拆账：`netStake` 只进 `optionPool`，抽水**从不**混入彩池 —— 这是"物理隔离"的实质。
- `withdrawAdminFees()` 只减 `accumulatedAdminFees`，`withdrawReferralFees()` 只减自己的 `referralFees`，两条路径都无法触达 `optionPool`。
- 单测 `admin can only move its own ledger, never player money` 实测：提现后合约余额 = 玩家池 1048 + 待付 KOL 0.6 = 1048.6，玩家资金分毫未动。
- 偿付不变式在单测与 E2E 中各验一次：E2E 输出 `balance 41.043957 ≥ remaining pool 41.043957`。

**唯一的表述修正**：`seedPool()` 的种子**不是**独立账本，它被记成 owner 在该选项上的 stake（`_stake[pool][owner][option]`），因此**与玩家资金同风险**（押错就输给对面）。这是设计意图（种子就是做市），但白皮书不应把它说成"隔离的第四本账"。真正的隔离边界是：**手续费 vs 彩池**。

### 4.2 闪电贷 / MEV

- 合约是**纯粹彩池（pari-mutuel）**：没有 AMM 曲线、没有份额代币、下注后无法赎回、`cancelPool` 需要 owner。因此"同一区块内拉盘—砸盘—套利"的经典闪电贷路径**不存在**：借来的钱一旦下注就被锁到结算，无法在同一笔交易里退出。
- 单笔 50 USDC 的硬地板 + 20% 弱势侧限制，使"用一笔巨款瞬间扭曲赔率"的成本被显式抬高；且扭曲赔率本身不产生可提取利润（赔率只决定分账比例，不能买卖）。
- **真实存在的 MEV 面**是"最后一块"：`bet()` 一直开到 `endTime`，没有任何截止缓冲。若链下事件已经揭晓（例如比分已出）而链上还没到 `endTime`，掌握信息的一方可以在最后一个区块下注确定性结果（F-06）。这不是闪电贷，而是**预言机延迟套利**。
- 由于 `settle()` 只能由 owner 在 `endTime` 之后调用，且下注窗口与结算窗口不重叠（`_openPool` 在 `block.timestamp >= endTime` 时 `PoolEnded`），不存在"边下注边结算"的竞态。

### 4.3 退款安全（AI 结算流产时）

现状：`cancelPool()` **只有 owner 能调用**，且退款是"用户自取"（`claimRefund`），每人一笔、原子生效。

- 会计上是安全的：`claimRefund` 把 `_stake[pool][user][0..1]` 清零后转账，重复领取被 `refunded` 标记拦住；只要合约里有 USDC，用户一定拿得回 96%。
- 但**流程上不具去中心化兜底**：如果 owner 私钥丢失、跑路或拒绝操作，用户在 `endTime` 之后**没有任何自助退款入口**，本金永久冻结（F-03，High）。这不是"代码 bug"，是缺失的应急路径。
- 另一处不公平：取消盘仍保留 4% 抽水（F-02），而平台在取消场景下并未提供服务。

---

## 5. 发现清单

| ID | 严重度 | 标题 | 影响 | 状态 |
|---|---|---|---|---|
| F-01 | **Critical（特权）** | Owner 既是预言机又可下注 → 内幕结算 | 可无风险吃掉对手盘本金 | 未修复，需架构改造 |
| F-02 | **High（特权）** | `cancelPool()` 保留 4% 抽水 | 可 void 掉即将输的盘，仍赚 4% | 未修复 |
| F-03 | **High（可用性）** | 结算流产后无 permissionless 退款 | owner 失联即永久冻结本金 | 未修复 |
| F-04 | Medium | `seedPool()` 可在关盘前任意加注 | owner 稀释某侧赔付（自身有本金风险） | 未修复 |
| F-05 | Medium | 证据哈希仅"留痕"不"验真" | owner 可提交任意 bytes32 | 设计限制 |
| F-06 | Medium | 无下注截止缓冲 / commit-reveal | 最后一块的预言机延迟套利 | 未修复 |
| F-07 | Low | 自推荐（alt 钱包）套 1.2% 返佣 | 收入泄漏 | 可接受/需 KOL 白名单 |
| F-08 | Low | 赔付取整残渣无 sweep | 尘埃锁死，<1 wei/赢家 | 未修复 |
| F-09 | Low | `bet()` Interaction 先于 Effects | 仅靠 guard 兜底（USDC 无回调） | 建议调整顺序 |
| F-10 | Info | 已取消盘 `getPool().totalNetPool` 不归零 | 前端可能显示错误池深 | 需 UI 判 status |
| F-11 | Info | 无暂停开关；`feeVault` 可被改 | 事故时只能逐盘 cancel | 建议加 pause(bet only) |

### F-01 六段式（按既定模板）

1. **什么项目 / 做什么**：Prediction Arena，Base 上 USDC 结算的二元预测对赌盘口，4% 抽水 + 30% 返佣。
2. **漏洞合约**：`PredictionArena` @ `0x96c0333657c684Ac125A54a0858471e1c8267355`（`settle` L252 `onlyOwner`、`bet` L294 无身份限制）。
3. **漏洞方式**：owner 用另一个地址在关盘前下注 → 自己调用 `settle()` 宣布该侧获胜 → 领取对手盘本金。链上没有任何"owner 不得下注"或"结算需争议期"的约束。
4. **合约资金**：TVL 即攻击上限（当前 0 USDC，尚未开放下注）。
5. **攻击者成本**：仅 gas（Base 上单笔 <$0.01）+ 自押本金（押中后连本带利取回）。
6. **攻击者获利**：等于对手盘净本金。PoC 实测：对手押 50 USDC，攻击者净赚 **+46.00 USDC**，平台另收 4.00 USDC 抽水；受害者净亏 **-50.00 USDC**。

### F-02 实测（同一 PoC 第二段）

```
victim staked 100 USDC → refunded 96.00 USDC (loss 4.00)
platform rake kept on cancel: 4.00 USDC
```

### PoC 复现

```
bunx hardhat run scripts/audit/poc-owner-privilege.ts
```
（无需外部节点，in-process 网络；两条路径都只用 owner key + 现有函数，不含任何"漏洞利用代码"。）

---

## 6. 修复路线（按优先级）

| 优先级 | 动作 | 对应发现 |
|---|---|---|
| P0 | `settle()` 换成 UMA / Chainlink 预言机 + 24~48h 争议期 + 提案保证金；owner 仅能"提案"不能"终裁" | F-01, F-05 |
| P0 | 增加 permissionless 兜底：`endTime + 30d` 未结算，任何人可 `emergencyRefund()` 把盘口置为 Canceled | F-03 |
| P0 | 禁止 owner / 团队地址下注（白名单或 `bet` 内拦截 `owner()` 及其登记地址） | F-01 |
| P1 | `cancelPool()` 退还 100% 本金（含已收抽水，从 `accumulatedAdminFees` 扣回；不足则由 treasury 补） | F-02 |
| P1 | 下注截止提前 5~10 分钟 + commit-reveal 或 Chainlink 定时关盘 | F-06 |
| P1 | `seedPool()` 仅在开盘窗口（`createPool` 后 N 分钟内）可用，之后冻结 | F-04 |
| P2 | Owner 换 `Ownable2Step` + Safe 多签 + 48h 时间锁（`setFeeVault`/`cancelPool` 走 timelock） | F-01..F-04 |
| P2 | 加 `pause()` 只作用于 `bet`，`claim*` 永远可用 | F-11 |
| P2 | 增加 `sweepDust()`（只能转给 feeVault，且需 `totalNetPool` 全部领取完） | F-08 |
| P3 | `bet()` 改 Effects-before-Interactions；补 `setFeeVault` / `rescueERC20` / 多盘口隔离测试；引入 Foundry 不变式测试 | F-09, 覆盖率 |

建议的 Foundry 不变式（Phase 3）：
```
invariant_solvent:  usdc.balanceOf(arena) >= Σ_pools totalNetPool + accumulatedAdminFees + Σ referralFees
invariant_sumStakes: Σ_users _stake[pool][user][0..1] == optionPool[pool][0] + optionPool[pool][1]
invariant_noDoubleClaim: claimed[pool][user] => pendingRewards(pool,user) == 0
```

---

## 7. 结论

- **代码质量层面**：无重入、无整数溢出、无访问控制遗漏、无任意转账/委托调用；三账本隔离与偿付不变式有单测 + E2E 双证；覆盖率 90.8% 语句 / 93.6% 行，未覆盖部分主要是护栏分支。
- **风险层面**：这是一个"**完全可信管理员**"模型。当前 owner 单钥同时掌握开盘、结算、取消、金库改址，且可自由下注 —— 在承接真实 TVL 前，F-01/F-02/F-03 必须先解决，否则任何"被黑"叙事都等价于"管理员作恶"，链上无法区分。
- **上线建议**：可以继续以小额种子 + 白名单内测运行（当前 TVL=0，符合该定位）；**不建议**在 P0 项完成前开放公开下注与营销导流。
