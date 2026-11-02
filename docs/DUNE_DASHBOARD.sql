-- ─────────────────────────────────────────────────────────────────────────────
-- Prediction Arena · Dune dashboard queries (Base, chainId 8453)
--
-- Paste each block into its own Dune query and pin the three to one dashboard.
-- Table: base.logs (Dune v2 / Trino). `data` is varbinary and 1-indexed for substring().
--
-- Event topics (keccak256 of the signature — computed with `cast keccak`, not guessed):
--   BetPlaced(uint256,address,uint8,uint256,uint256,uint256,address,uint256)
--     0x33f1b9f9435ae14c581d5d96823b44073c36b2992ec64e3f3a5a54801286628e
--   PoolCreated(uint256,string,string,uint64,address)
--     0xc271dda8ee99c326b5dd786a682cab5fc2d20969efc761912fe7a5a74617adf6
--   PoolSettled(uint256,uint8,bytes32,uint256,uint256)
--     0x56ecf608c7baf843d5d2612db12102b33177948e77f804285b711af71ea3e27c
--
-- Contract: 0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5  (all 232 markets are poolIds inside it)
-- USDC:     0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  (6 decimals)
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1) Daily prediction volume
--    gross = what the bettor paid, net = what entered the pool, fee = the 4% rake.
--    One row per day, newest first — plot `gross_usdc` as bars and `fees_usdc` on the right axis.
-- ═════════════════════════════════════════════════════════════════════════════
WITH bets AS (
  SELECT
    block_time,
    tx_hash,
    bytearray_to_uint256(substring(data,  1, 32)) / 1e6 AS gross_usdc,
    bytearray_to_uint256(substring(data, 33, 32)) / 1e6 AS net_usdc,
    bytearray_to_uint256(substring(data, 65, 32)) / 1e6 AS fee_usdc
  FROM base.logs
  WHERE contract_address = 0x961872d75ea6e7a2859b9b04c6c7b1c73cf510b5
    AND topic0 = 0x33f1b9f9435ae14c581d5d96823b44073c36b2992ec64e3f3a5a54801286628e
    AND block_time >= TIMESTAMP '2026-01-01'
)
SELECT
  date_trunc('day', block_time) AS day,
  count(*)                      AS bets,
  count(DISTINCT tx_hash)       AS txs,
  sum(gross_usdc)               AS gross_usdc,
  sum(net_usdc)                 AS net_staked_usdc,
  sum(fee_usdc)                 AS fee_usdc
FROM bets
GROUP BY 1
ORDER BY 1 DESC;


-- ═════════════════════════════════════════════════════════════════════════════
-- 2) Arena Points — the on-chain part of the replay
--
--    IMPORTANT, and the reason this query is split in two: the exact score is
--      10 × netStake × (1 + 2·|p−0.5|, capped ×2) × (1.5 if ≤48h, 1.2 if ≤10d, else 1)
--    The base term is on-chain (netStake is in the log). The other two are not:
--      · p (the YES share at the moment of the bet) is not stored per bet by the contract;
--      · the deadline lives in PoolCreated, whose strings are dynamic-length and not
--        reliably sliceable in SQL.
--    Both live in the replayed ledger we publish (frontend/public/points.json). So: query 2a is
--    exact for the base term, 2b adds the horizon multiplier once you upload the pool deadlines
--    as a Dune table (CSV upload: pool_id, end_time — generated from pools.json).
--    Do not present 2a as "total points"; label it "base points (10/pt)".
-- ═════════════════════════════════════════════════════════════════════════════

-- 2a — base points, exact, straight from logs
WITH bets AS (
  SELECT
    block_time,
    bytearray_to_uint256(substring(data, 33, 32)) / 1e6 AS net_usdc
  FROM base.logs
  WHERE contract_address = 0x961872d75ea6e7a2859b9b04c6c7b1c73cf510b5
    AND topic0 = 0x33f1b9f9435ae14c581d5d96823b44073c36b2992ec64e3f3a5a54801286628e
    AND block_time >= TIMESTAMP '2026-01-01'
)
SELECT
  date_trunc('day', block_time)           AS day,
  sum(net_usdc) * 10                      AS base_points,
  sum(net_usdc) * 10 * 1.2                AS base_points_with_mid_bonus_estimate
FROM bets
GROUP BY 1
ORDER BY 1 DESC;

-- 2b — horizon multiplier, needs dune.<your_schema>.arena_pools (pool_id BIGINT, end_time TIMESTAMP)
-- SELECT
--   date_trunc('day', l.block_time) AS day,
--   sum(
--     (bytearray_to_uint256(substring(l.data, 33, 32)) / 1e6) * 10 *
--     CASE
--       WHEN p.end_time - l.block_time <= INTERVAL '48' HOUR THEN 1.5
--       WHEN p.end_time - l.block_time <= INTERVAL '10' DAY  THEN 1.2
--       ELSE 1
--     END
--   ) AS points_10pt_times_horizon
-- FROM base.logs l
-- JOIN dune.<your_schema>.arena_pools p
--   ON p.pool_id = bytearray_to_uint256(l.topic1)          -- poolId is the first indexed arg
-- WHERE l.contract_address = 0x961872d75ea6e7a2859b9b04c6c7b1c73cf510b5
--   AND l.topic0 = 0x33f1b9f9435ae14c581d5d96823b44073c36b2992ec64e3f3a5a54801286628e
-- GROUP BY 1 ORDER BY 1 DESC;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3) Buyback & burn tracker  (returns zero rows until $ARENA exists — that is correct)
--
--    There is no token contract yet. The mechanism is designed, not deployed: 1.5% of the 4% fee is
--    meant to buy ARENA on Aerodrome weekly and send it to 0x…dEaD. Until a token address exists,
--    this query must show an empty chart rather than a fabricated one.
--
--    When the token launches:
--      · set the parameter `arena_token` (Dune → query settings → parameters), and
--      · replace the burn sink if the design changes.
-- ═════════════════════════════════════════════════════════════════════════════
SELECT
  date_trunc('week', block_time)                                        AS week,
  sum(bytearray_to_uint256(data) / 1e18)                                AS burned_arena,
  count(*)                                                              AS burn_txs
FROM base.logs
WHERE contract_address = {{arena_token}}                                 -- ARENA ERC-20 address
  AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef  -- Transfer
  AND substring(topic2, 13, 20) = 0x000000000000000000000000000000000000dead          -- to 0x…dEaD
  AND block_time >= TIMESTAMP '2027-01-01'
GROUP BY 1
ORDER BY 1 DESC;
