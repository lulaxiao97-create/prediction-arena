# 链上加固版攻击测试报告

对象：PredictionArena `0x36f1bFbE3E0d0FA0941C031be278149D33f65684`（Base 主网，2026-10-22 部署）
方法：Base 主网 anvil fork（真链上字节码 + 真 USDC + 真 owner 账户），43 项检查实测
产物：`audit/onchain-attack/01..06-*.ts`（可复跑）+ `0X-results.json`

---

## 0.结论（先给钱的部分）

**非特权外部攻击者：没有可提取资金的路径。43 项实测全部被拦住，0 项失败。**

**能拿走钱的路只有 4 条，全部需要 owner 私钥或"owner 30 天不作为"这个外部条件：**

| # | 路径 | 需要什么 | 实测金额（单池示例） |
|---|---|---|---|
| 1 | owner 用 seedPool 在结算前往赢侧加注 | owner 私钥 | 投入 500 → **净赚 42.07 USDC**，全部来自诚实赢家 |
| 2 | owner 用 sybil 钱包 bet 押自己会宣布的结果 | owner 私钥 | 投入 50 → **净赚 46.00 USDC**，受害者 -50 |
| 3 | 单侧无累计下注上限，多笔 50 USDC 稀释赢家 | **预知结果** + 资金 | 投入 500 → 净赚 23.64 |
| 4 | 押错方在 owner 30 天不结算时用 emergencyRefund 保本 | owner 30 天不出手 | 输家 50 全退，赢家利润 46 蒸发 |

**当前链上合约余额 = 0.00 USDC（未充值、未开盘），所以"现在就能拿的钱" = 0。**
上表全是"池子里有钱之后"的影响量化，不是当前可提取金额。

---

## 1. 什么项目，项目是做什么的

PredictionArena：Base 主网的双向（二元）预测下注市场。用户用原生 USDC（6 位）押 YES/NO 两侧，
按注额比例分整个净池（pari-mutuel）。每笔收 4% 抽水，其中 30%（=本金的 1.2%）记给 referrer（KOL），
其余进平台利润桶。owner 同时是预言机：只有 owner 能开池、加种子、定结果（`settle`）、取消池。

规模：合约 2026-10-22 09:27 CST 部署，TVL **0.00 USDC**，未开盘（`nextPoolId` 未初始化池子）。

---

## 2. 漏洞合约（被测对象 + 源码==链上的证明）

```
地址       0x36f1bFbE3E0d0FA0941C031be278149D33f65684   (Base, chainId 8453)
runtime    11,028 bytes    部署 tx 0x4b08c458…909a9b   block 52921545
编译       solc 0.8.20, optimizer 200, evmVersion paris  (metadata 里读出)
源码       contracts/PredictionArena.sol  587 行 / 25,503 bytes
Basescan   已验证（guid 6vhwhjcwmje1x1kfeiq55tj615gdqt7qffw2nym4zuwbz4686s）
源码来源   Basescan getSourceCode 拉回 → 解包 11 个文件 → 与本地 sha256 完全一致
           (6fab08d2bc710df1a51cb2dd883139c0d04143838a64a6d5cc62a50efc536b42)

逐字节证明（04-bytecode-proof.ts）：
  链上 eth_getCode           11,028 bytes（metadata 51 B）
  本地编译产物 deployedCode  11,028 bytes（metadata 51 B）
  去 metadata 后比较区          10,975 bytes
  差异区                       10 处 × 20 字节 = 全部是 immutable usdc 槽
                               本地侧全 0、链上侧 0x8335…2913（USDC 构造参数）
  无法解释的差异              0 字节
  → 审计 contracts/PredictionArena.sol 就是在审计 0x36f1…5684，没有版本错位。
```

owner 账户附加检查：`0x436b…55Ba1` 的代码是 `0xef0100 || 0x63c0…e32b`，
即 EIP-7702 委托给 **MetaMask EIP7702StatelessDeleGator**（11,185 bytes）。实测无人可借它冒充 owner：

```
W1/W2  attacker 调 execute(arena,0,setFeeVault)       → NotEntryPointOrSelf()
W3     attacker 调 executeFromExecutor                → NotDelegationManager()
W4     arena.feeVault 未被改                          → 仍是 0x9520…4fE6
W5     attacker 伪造 isValidSignature                 → ECDSAInvalidSignature()
```

---

## 3. 漏洞方式（43 项实测清单）

跑法：`anvil --fork-url https://mainnet.base.org --port 8546 --accounts 5 --balance 1000 --chain-id 8453`
每次合约都是 fork 上那份真字节码，USDC 是 Base 真 USDC（余额用 `anvil_setStorageAt` 在 slot 9 造）。

### A. 访问控制（8 项，全部拦住）
```
A1 attacker createPool                    → OwnableUnauthorizedAccount(attacker)
A2 attacker seedPool                      → OwnableUnauthorizedAccount(attacker)
A3 attacker settle                        → OwnableUnauthorizedAccount(attacker)
A4 attacker cancelPool                    → OwnableUnauthorizedAccount(attacker)
A5 attacker withdrawAdminFees             → OwnableUnauthorizedAccount(attacker)
A6 attacker rescueERC20(USDC)             → OwnableUnauthorizedAccount(attacker)
A7 owner rescueERC20(USDC)                → CannotRescueBetToken()   ← 赌注币任何人都救不走
A8 attacker bet 60 USDC (> cap 50)        → BetExceedsCap(60000000, 50000000)
```

### B. 领取状态机（12 项，全部拦住）
```
B1  输家 claimRewards                     → NothingToClaim()
B2  settle 池上调 claimRefund             → PoolNotCanceled(101)
B3  赢家 claimRewards                     → 成功，gas 82,748
B4  payout 精确 == stake×totalNet/winPool → 96.000000 USDC ✓
B5  重复领取                              → AlreadyClaimed()
B6  cancel 池上调 claimRewards            → PoolNotSettled(102)
B7  取消盘退款                            → 成功，gas 80,539
B8  退款 = 本金 100%（含 4% 手续费）        → 50.000000 USDC ✓
B9  重复退款                              → AlreadyClaimed()
B10 同一地址两侧都押，取消后退款            → 成功
B11 两侧押注退款 = 两笔本金之和             → 50.000000 USDC ✓
B12 两侧押注重复退款                       → AlreadyClaimed()
```

### C. 舍入 / 粉尘守恒（1 项）
```
C1  Σ(payout) ≤ totalNetPool
    totalNet 29.760000 | 实际付出 29.759999 | 粉尘 1 wei
    → 只会少付 1 wei 给合约，任何人都无法多拿（含 owner：USDC 救不出来）
```

### D. 手续费 / 返佣隔离（5 项）
```
D1  settle 释放 escrow，pool.rakeAdmin 归零  → accumulatedAdminFees 累计 5.240000 ✓
D2  cancel 池上 KOL 提返佣                    → PoolNotSettled(102)   ← 取消盘的返佣永久锁死
D3  settle 池上 KOL 提返佣                    → 成功，gas 55,138
D4  KOL 分到 1.2% 本金                        → 0.600000 USDC ✓
D5  KOL 重复提                                → revert（NothingToWithdraw）
```

### E. 返佣滥用（2 项）
```
E1  referrer == 下注者本人                    → 合约强制置 0，poolReferral=0 ✓（这条路封了）
E2  用第二个钱包当 referrer                   → 0.600000 USDC 真拿到
    → 任何人可把有效费率从 4% 降到 2.8%
```

### F. 全局偿付能力（1 项）
```
F1  合约余额 ≥ 所有未清偿项（10 个池混合：settle/cancel/open）
    balance 473.040002 USDC vs owed 473.040000 USDC → 盈余 2 wei
```

### G. 经济攻击（2 项，见第 6 节金额）
```
G1 滚动 50 USDC 多笔下注（无累计上限）→ 稀释诚实赢家
G2 押错方等 owner 沉默 30 天后 emergencyRefund → 全额保本
```

### H. 重入（本地恶意 token，6 项）
```
R1 transferFrom 里重入 bet()                 → ReentrancyGuardReentrantCall()
R2 放款转账里重入 claimRewards()              → ReentrancyGuardReentrantCall()
R3 解除武装后正常领取                         → 成功，96.0 hUSDC
R4 claimRewards 里重入 claimRefund（跨函数）   → ReentrancyGuardReentrantCall()
R5 解除武装后正常领取                         → 成功，96.0 hUSDC
R6 退款转账里重入 claimRefund()               → ReentrancyGuardReentrantCall()
```

### I. 手续费伪造（1 项）
```
seed-only 池（owner 两侧各种 22.5，无真实用户）settle 后：
  accumulatedAdminFees 增量 = 0.000000 USDC
  owner 领回 45.000000（自己的钱）
  → 不能凭空造出可提手续费
```

---

## 4. 合约资金

**现在：0.00 USDC**（`contractBalance()` = 0，`accumulatedAdminFees()` = 0，无池子）。

下面的金额都是"按典型池子规模"的影响量化，不是当前可拿的钱：

| 场景 | 池内总额 | 输侧净额 | 说明 |
|---|---|---|---|
| 45 USDC 种子（22.5/22.5）+ 双侧各 50 | 145 USDC | 70.5 USDC | 本报告所有示例用的池子 |
| 同结构放大 100 倍 | 14,500 USDC | 7,050 USDC | 收益按比例放大（见 §6 公式） |

---

## 5. 攻击者成本（实测 gas，不是估算）

Base 实测 gasPrice = 0.006 gwei（`eth_gasPrice` = 0x5b8d80）。逐笔实测：

| 动作 | gas | 成本 (ETH) | 成本 (USD @ $3,000) |
|---|---|---|---|
| bet | 149,068 | 0.000000894 | ~$0.0027 |
| claimRewards | 82,748 | 0.000000496 | ~$0.0015 |
| claimRefund | 80,539 | 0.000000483 | ~$0.0014 |
| withdrawReferralFees | 55,138 | 0.000000331 | ~$0.0010 |
| seedPool | 82,743 | 0.000000496 | ~$0.0015 |
| settle | 68,420 | 0.000000411 | ~$0.0012 |

**外部攻击者**：拦在访问控制/状态机/重入上，收益 0，成本 ≥ 上面每笔的 gas → **净亏**。

**owner 路径**：需要本金（seedPool 500 或 sybil 50）+ gas 几美分。

---

## 6. 攻击者获利

### 6.1 owner 用 seedPool 抢赢家利润（最有效率的一条）

`seedPool()` 是 onlyOwner、不收 4% 手续费、且不受单笔上限约束（上限按弱侧算，而种子是豁免的）。
owner 是预言机，知道结果，可以在 settle 前把大额种子押到会赢的一侧。

实测（pool 301，基线 pool 300 完全同构）：
```
基线：诚实赢家 A 押 50 → payout 96.00（净 +46.00）
      owner 两侧各种 22.5 → 领回 45.00（净 0）

攻击：owner 在 settle 前再往赢侧 seed 500
      诚实赢家 A：96.00 → 53.93   （A 的利润少 42.07）
      owner    ：投入 545（含两侧种子）→ 领回 587.07 → 净 +42.07
      输家 B    ：-50.00（按规则亏）
```
**owner 的 +42.07 与 A 的 -42.07 完全相等 —— 钱是从赢家账上转过去的。**

公式：owner 加注 s，原赢侧净池 W，诚实赢家净注 X → owner 利润 = **s·X/(W+s)**，上限 = X（吃光赢家全部净注）。

### 6.2 owner 用 sybil 钱包下注（F-01 的已知残余）

`msg.sender == owner()` 只挡 owner 地址，换个新钱包即可。实测：
```
victim 押 50 → payout 0      （-50.00）
attacker 押 50 → payout 96   （+46.00）
平台 rake 释放 4.00 USDC
```
与 6.1 的差别：要付 4% 手续费，且受 cap 限制（需多笔）。

### 6.3 单侧无累计上限（G1，需预知结果）

单笔上限取 max(弱侧 20%, 50 USDC)，但**没有单地址/单池累计上限**。弱侧为 0 时上限恒为 50，
所以可以 50×N 连投。实测（10 笔 × 50）：
```
诚实赢家 A：96.00 → 52.36（-43.64）
攻击者：投入 500 → 领回 523.64 → 净 +23.64
```
前提：攻击者必须**先知道结果**（内幕/结果提前泄露），否则押错边就是 500 亏损。这不是无风险套利。

### 6.4 押错方 30 天保本（G2）

`emergencyRefund()` 在 `endTime + 30 天` 后任何人可调。实测：
```
押 50 押错的一侧 → endTime 后 30 天由自己触发 emergencyRefund → 退回 50.00（零损失）
赢家：本应 +46.00 → 只能拿回本金 50（利润归零）
```
前提：**owner 在 30 天内不 settle**。owner 正常运营时不可达；结果公布周期 >30 天的池子（赛季/长周期事件）
天然落在窗口里。

### 6.5 返佣折扣（E2，影响协议收入不影响用户资金）

任何人都能把 referrer 设成自己的第二个钱包，拿回 1.2%，有效费率 **4% → 2.8%**。
每 10,000 USDC 流水少收 12 USDC。不影响任何用户的资金安全。

---

## 7. 残余风险与建议（按优先级）

1. **owner 单点 = 预言机 + 流动性注入者**（Critical 级信任假设，不是代码漏洞）。
   最省事的缓解：`seedPool` 改为"只能在池子创建后 N 分钟内/无真实下注前调用"，
   或加 `seededAt` 时间锁 + 单向（不可在 endTime 前 1 小时内加注）。
   彻底解法仍是 Phase 3 的去中心化预言机 + 争议期。
2. **返佣无白名单**：`referrer` 任意地址即可拿 1.2%。建议 KOL 地址 owner 白名单化，否则费率实际是 2.8%。
3. **EMERGENCY_REFUND_DELAY = 30 天** 对长周期池子是硬约束。建议按池子类型配置（或 owner 可延长），
   让"结果公布窗口"与"退款窗口"分开。
4. **单侧无累计上限**：建议加 `perUserCap`（如弱侧的 20% 累计）而不是仅单笔检查。
5. **误转 USDC 永久锁死**：`rescueERC20` 明确禁止救 USDC（防止 rug 的正确设计），
   但要接受"任何人误转的 USDC 拿不回来"。建议在 UI 上避免直接 transfer 到合约。
6. **粉尘**：1–2 wei 永久留在合约（C1/F1 实测），无经济意义。
7. **owner 仍是 EOA（EIP-7702 委托账户）**：委托合约是 MetaMask 标准实现，实测无法被第三方借用；
   但私钥单点 = 全部资金单点。主网上量前应转 Gnosis Safe + timelock。

---

## 8. 复现

```bash
# 1) 起 fork（需要代理）
export HTTPS_PROXY=http://172.17.240.1:16781
anvil --fork-url https://mainnet.base.org --port 8546 --accounts 5 --balance 1000 --chain-id 8453

# 2) 源码 == 链上（不需要 fork 状态）
bun run audit/onchain-attack/04-bytecode-proof.ts

# 3) 逻辑/权限/守恒/经济攻击（31 项）
bun run audit/onchain-attack/01-attack-logic.ts

# 4) owner 的 EIP-7702 账户（5 项）
bun run audit/onchain-attack/02-owner-7702.ts

# 5) owner 特权量化（seedPool 稀释 / sybil）
bun run audit/onchain-attack/05-owner-privilege.ts

# 6) 手续费伪造
bun run audit/onchain-attack/06-fee-farming.ts

# 6b) 逐笔 gas 实测（成本表来源）
bun run audit/onchain-attack/07-gas-measure.ts

# 7) 重入（本地恶意 token，独立 anvil）
anvil --port 8547 --accounts 5 --balance 1000 --chain-id 31337
bun run audit/onchain-attack/03-reentrancy-local.ts
```
