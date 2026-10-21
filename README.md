# Prediction Arena — AI 预测对赌竞技场

二元预测盘口 / Base 原生 USDC 结算 / AI 三智囊辩论 / IPFS 判决留痕。

```
prediction-arena/
├── contracts/
│   ├── PredictionArena.sol          # 核心合约（Ownable + ReentrancyGuard + SafeERC20）
│   └── mocks/MockUSDC.sol           # 仅本地/测试网用 6 位 USDC
├── scripts/
│   ├── deploy.ts                    # 部署 + 可选 Safe 所有权移交
│   ├── auto-create-pool.ts          # 原子化开盘：createPool + 双边种子 + 失败回滚
│   ├── settle-pool.ts               # 带证据哈希的结算（sha256 → bytes32）
│   └── export-abi.ts                # 编译产物 ABI 导出到前端
├── test/PredictionArena.test.ts     # 23 个用例
├── frontend/                        # Next 16 + Tailwind v4 + wagmi v2 + RainbowKit
├── hardhat.config.ts                # solc 0.8.20, optimizer 200, evmVersion paris
├── .env.example
└── README.md
```

## 部署记录（Base Mainnet）

| 项 | 值 |
|---|---|
| 合约 | `PredictionArena` |
| 地址 | `0x96c0333657c684Ac125A54a0858471e1c8267355` |
| 交易 | `0x84e5794b408c3d59e56b2bc0402d1038ed968df78a418e1245e18e0c535e631f` |
| 区块 | 52896032 |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`（Base 原生，6 位） |
| feeVault | `0x9520269b506e02c357a712160979a3237C404fE6` |
| Owner | `0x436b9d5e6fBd40eC93E881263bE53e59F8755Ba1`（EIP-7702 委托账户） |
| Gas | 2,268,327 @ 7.338564 gwei = 0.000016646 ETH |
| 源码验证 | ✅ Basescan 已验证（solc 0.8.20 / 200 runs / paris） |
| 状态 | ⚠️ **deprecated** —— 已由加固版源码取代（F-01/F-02/F-03 修复），待重新部署 |

完整机读记录见 `deployments/base-mainnet.json`。

## 资金模型（每笔下注 A）

| 项目 | 公式 | 100 USDC（带 KOL） |
|---|---|---|
| 平台抽水 | A × 400 / 10000 | 4.00 |
| KOL 返佣 | 抽水 × 3000 / 10000（= A 的 1.2%） | 1.20 |
| 平台纯利 | 抽水 − 返佣 | 2.80 |
| 进彩池 | A − 抽水 | 96.00 |

账本不变式（三本账物理隔离，任何提现都碰不到别人的钱）：

```
balance ≥ Σ pool.totalNetPool + accumulatedAdminFees + Σ referralFees[kol]
```

## Phase 2 补丁

### 1. 死穴一：结算留痕

`settle(poolId, winningOption, bytes32 ipfsDataHash)`

- 证据哈希同时写入 `Pool.settlementHash`（storage）与 `PoolSettled` 事件（indexed），
  可永久追溯、可按哈希过滤日志。
- 零哈希直接 revert（`ZeroDataHash`）：没有证据就不许判决。
- `scripts/settle-pool.ts` 对证据文件做 sha256 生成 bytes32，结算后回读校验一致。
- `scripts/deploy.ts` 支持 `SAFE_ADDRESS`：部署后 `transferOwnership(safe)` 并链上回读确认。

### 2. 死穴二：种子流动性防锁死

原规则「单笔 ≤ 弱势侧 20%」在两池各 22.5 USDC 种子时算出 4.5 USDC < 5 USDC 门槛，
**开盘即锁死**。修复（合约层，不是脚本层绕）：

```solidity
uint256 public constant BOOTSTRAP_MAX_BET = 50e6;      // 硬编码 50 USDC
cap = max(weakerSide * 2000 / 10000, BOOTSTRAP_MAX_BET);
```

- 池深 < 250 USDC 时，单笔上限恒为 50 USDC → 5~50 USDC 散户单全部可过。
- 池深 ≥ 250 USDC 后百分位保护自动接管（cap = weaker/5），巨鲸仍被夹住。
- `scripts/auto-create-pool.ts`：createPool → approve → seed(0) → seed(1)，任一种子腿失败自动
  `cancelPool()` 回滚，绝不留下单边空盘；结束前校验两侧余额 > 0 且 cap ≥ 5 USDC。

## 前端（frontend/）

- Next 16 App Router + Tailwind v4 + TypeScript
- wagmi v2 / viem / RainbowKit（Base 8453 + Base Sepolia 84532）
- `src/providers/Web3Provider.tsx`：链、RPC、WalletConnect、黑金主题
- `src/hooks/usePredictionArena.ts`：`usePools / usePool / useMaxBet / useStake / useBet / useApproveUsdc / useClaimRewards`
  - `useBet` 自动判定 allowance：不足先 `approve`，确认后再 `bet`，一步到位
  - 自定义错误翻译成中文（BetExceedsCap / BetBelowMinimum / AlreadyClaimed …）
- 组件：`Navbar`（分类 Tab + 黑金 ConnectButton）、`AIAgentsDebate`（打字机辩论 + IPFS 校验）、
  `ArenaCard`（倒计时 / 赔率 / 双向彩池 / 挤压 Banner）、`BetModal`（5 USDC 门槛 + 20% 上限实时提示 + 打包下注）
- 未配置 `NEXT_PUBLIC_ARENA_ADDRESS` 时自动进入演示模式（本地样例盘口），配置后读链上真实数据。

## 安全审计

- 白皮书：[`audit/SECURITY-AUDIT-2026-10-21.md`](audit/SECURITY-AUDIT-2026-10-21.md)
- 复现特权风险 PoC：`bunx hardhat run scripts/audit/poc-owner-privilege.ts`
- 扫描/测试：`slither .` · `bun run test`（23 passing）· `hardhat coverage`（91% stmt / 94% line）

## 命令

```bash
# 合约
bun install
bun run compile
bun run test                     # 23 passing
bun run e2e:local                # 一体化 E2E：下注→结算→领奖→提现，6/6 断言（用编译产物 ABI）
bun run deploy:base-sepolia
bun run deploy:base
bun run abi:export               # 编译 → frontend/src/lib/contracts/PredictionArena.json

# 开盘 / 结算
ARENA_ADDRESS=0x... USDC_ADDRESS=0x... TITLE="..." CATEGORY=Macro \
  bun run pool:auto --network base
POOL_ID=1 WINNING_OPTION=1 EVIDENCE_FILE=./evidence/pool-1.json \
  bun run pool:settle --network base

# 无人值守开盘（flock 防并发，日志落 logs/pool-auto-*.log，失败返回非 0）
bun run pool:auto:unattended
# crontab 示例：每小时开一个新盘
# 5 * * * * cd /mnt/c/Users/Administrator/prediction-arena && ./scripts/open-pool-unattended.sh >> logs/cron.log 2>&1

# 前端
cd frontend
cp .env.local.example .env.local
bun install
bun dev                          # http://localhost:3000
bun run build
```

## 部署检查清单

1. `cp .env.example .env`，填 `PRIVATE_KEY` / `FEE_RECEIVER` / `BASE_RPC_URL`（生产用自建 RPC）。
2. 先 `deploy:base-sepolia` 全流程走一遍（含开盘 + 下注 + 结算 + 领奖）。
3. 主网部署时设 `SAFE_ADDRESS`，让 Owner 直接落到 Gnosis Safe。
4. `bun run abi:export` → 前端 `.env.local` 填 `NEXT_PUBLIC_ARENA_ADDRESS`。
5. `bash scripts/verify-basescan.sh <ARENA>` —— 走 Etherscan V2（`hardhat verify` 2.1.3 会把 chainid 放 body 里，V2 直接拒，报错还是空的）。

## 仍然存在的中心化风险（未在本期修复）

- `settle()` 仍是 Owner 单点写结果；下一步接 UMA / Chainlink + 争议期 + 时间锁。
- `cancelPool()` 可让平台保留已抽的 4%，属于异常兜底路径，需加时间锁与事件告警。
- 盘口 option 文案（赞成/反对）存在前端，链上只有 0/1；上链 metadata 留给 Phase 3。
