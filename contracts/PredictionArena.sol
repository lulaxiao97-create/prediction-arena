// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title  PredictionArena
 * @notice Two-sided prediction betting arena settling in native USDC (Base, 6 decimals).
 *
 * ── Money flow on every bet (gross A, fee F, net N) ──────────────────────────────
 *   F  = floor(A * 400 / 10000)                 (4% rake)
 *   R  = floor(F * 3000 / 10000)                (KOL cut, 30% of the rake = 1.2% of A)
 *   Ad = F - R                                  (platform cut)
 *   N  = A - F                                  (credited to the option pool)
 *
 *   The rake is ESCROWED per pool until that pool settles:
 *     pool.rakeAdmin                += Ad
 *     poolReferral[poolId][kol]     += R
 *   Nothing is withdrawable while a pool is open, which is what makes a 100% refund on
 *   cancellation mathematically possible: the full gross stake is still sitting in the
 *   contract, untouched.
 *
 *   On settle():  accumulatedAdminFees += pool.rakeAdmin   (platform profit becomes claimable)
 *                 KOL claims its cut per pool via withdrawReferralFees(poolId)
 *   On cancel()/emergencyRefund(): the escrow is NOT released — every bettor pulls back
 *                 100% of their gross stake (net + fee) with claimRefund().
 *
 * ── Solvency invariant ───────────────────────────────────────────────────────────
 *   balance >= Σ pool.totalNetPool
 *            + Σ unpaid rake escrow (open pools)
 *            + accumulatedAdminFees
 *            + Σ poolReferral[settled pools]
 *
 * ── Security model ──────────────────────────────────────────────────────────────
 *   - ReentrancyGuard on every value-moving entry point; claims are CEI (state zeroed first).
 *   - Pull payments only: the contract never iterates over users.
 *   - The owner is the oracle (settle) but can NOT bet from the owner address (F-01 patch).
 *     NOTE: this blocks the owner address, not sybil wallets — decentralising settlement is
 *     still the only complete fix and remains on the Phase-3 roadmap.
 *   - Permissionless fallback: if the owner never settles, ANYONE can call emergencyRefund()
 *     once `endTime + EMERGENCY_REFUND_DELAY` has passed (F-03 patch).
 *   - The pause switch gates BETTING ONLY. claimRewards() and claimRefund() are never pausable:
 *     a paused arena can stop taking new risk, but it can never stop a user from exiting with
 *     money that is already theirs.
 */
contract PredictionArena is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum PoolStatus {
        None, // 0 - does not exist
        Open, // 1 - accepting bets
        Settled, // 2 - winning option fixed, winners can claim
        Canceled // 3 - voided, everyone refunds 100% of gross stake
    }

    struct Pool {
        string title;
        string category;
        uint64 endTime;
        uint8 winningOption;
        PoolStatus status;
        uint256 totalNetPool; // optionPool[0] + optionPool[1], fees excluded
        bytes32 settlementHash; // IPFS CID (multihash) of the oracle evidence bundle
        uint256 rakeAdmin; // platform part of the rake, escrowed until settle
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant PLATFORM_FEE_BPS = 400; // 4.00% of every stake
    uint256 public constant REFERRAL_SHARE_BPS = 3_000; // 30% of the rake == 1.2% of stake
    /// @notice v2 ticket window. A flat 50–10,000 USDC band replaced the old
    ///         20%-of-the-weaker-side clamp so a single ticket can carry desk size.
    /// @dev    Removing the proportional guard does not change solvency: every payout is drawn
    ///         from the same net pool (pari-mutuel), so a large one-sided ticket can only hurt
    ///         itself by moving the odds against everyone else. What it does change is who can
    ///         dominate a thin pool — that is a product trade-off, not a fund-safety one.
    uint256 public constant MIN_BET = 50e6; // 50 USDC
    uint256 public constant MAX_BET = 10_000e6; // 10,000 USDC
    uint8 public constant OPTION_COUNT = 2;
    uint256 public constant MAX_POOL_DURATION = 365 days;
    uint256 public constant MAX_TITLE_LENGTH = 128;
    uint256 public constant MAX_CATEGORY_LENGTH = 32;

    /// @notice Grace period after endTime before anyone may force a canceled pool (F-03).
    uint256 public constant EMERGENCY_REFUND_DELAY = 30 days;

    // ---------------------------------------------------------------------
    // Immutable / configuration
    // ---------------------------------------------------------------------

    /// @notice Betting token (native USDC on Base).
    IERC20 public immutable usdc;

    /// @notice Platform profit receiver. Owner may rotate it.
    address public feeVault;

    /// @notice Claimable platform profit (released from settled pools only).
    uint256 public accumulatedAdminFees;

    /// @notice Pending KOL cut per pool. Only claimable once that pool is Settled.
    mapping(uint256 => mapping(address => uint256)) public poolReferral;

    mapping(uint256 => Pool) private _pools;
    mapping(uint256 => mapping(uint8 => uint256)) public optionPool;

    // stake is stored NET of the rake, which is exactly what the payout formula uses
    mapping(uint256 => mapping(address => uint256[2])) private _stake;
    // gross fee paid per user per pool — needed for the 100% refund path
    mapping(uint256 => mapping(address => uint256)) private _feePaid;

    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(uint256 => mapping(address => bool)) public refunded;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event PoolCreated(
        uint256 indexed poolId,
        string title,
        string category,
        uint64 endTime,
        address indexed creator
    );
    event PoolSeeded(uint256 indexed poolId, uint8 indexed option, uint256 amount, address indexed funder);
    event BetPlaced(
        uint256 indexed poolId,
        address indexed bettor,
        uint8 indexed option,
        uint256 grossAmount,
        uint256 netStake,
        uint256 fee,
        address referrer,
        uint256 referralCut
    );
    event PoolSettled(
        uint256 indexed poolId,
        uint8 indexed winningOption,
        bytes32 indexed ipfsDataHash,
        uint256 totalNetPool,
        uint256 settledAt
    );
    event PoolCanceled(uint256 indexed poolId, uint256 canceledAt);
    event EmergencyRefund(uint256 indexed poolId, address indexed caller, uint256 at);
    event RewardsClaimed(uint256 indexed poolId, address indexed user, uint256 stake, uint256 payout);
    event RefundClaimed(uint256 indexed poolId, address indexed user, uint256 refund);
    event AdminFeesWithdrawn(address indexed to, uint256 amount);
    event ReferralFeesWithdrawn(uint256 indexed poolId, address indexed referrer, uint256 amount);
    event RakeReleased(uint256 indexed poolId, uint256 adminCut);
    event FeeVaultUpdated(address indexed previousVault, address indexed newVault);
    event ArenaPaused(address indexed by, uint256 at);
    event ArenaUnpaused(address indexed by, uint256 at);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error InvalidPoolId();
    error InvalidOption(uint8 option);
    error InvalidEndTime();
    error InvalidTitle();
    error InvalidCategory();
    error PoolAlreadyExists(uint256 poolId);
    error PoolNotFound(uint256 poolId);
    error PoolNotOpen(uint256 poolId);
    error PoolEnded(uint256 poolId);
    error PoolNotEnded(uint256 poolId);
    error PoolNotSettled(uint256 poolId);
    error PoolNotCanceled(uint256 poolId);
    error BetBelowMinimum(uint256 amount, uint256 minimum);
    error BetExceedsCap(uint256 amount, uint256 cap);
    error NoWinningStake(uint8 option);
    error ZeroDataHash();
    error NothingToClaim();
    error AlreadyClaimed();
    error NothingToWithdraw();
    error FeeVaultNotSet();
    error CannotRescueBetToken();
    error OwnerCannotBet();
    error EmergencyTooEarly(uint256 eligibleAt);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address usdc_, address feeVault_, address initialOwner) Ownable(initialOwner) {
        if (usdc_ == address(0) || feeVault_ == address(0) || initialOwner == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        feeVault = feeVault_;
        emit FeeVaultUpdated(address(0), feeVault_);
    }

    // ---------------------------------------------------------------------
    // Admin: pool lifecycle
    // ---------------------------------------------------------------------

    function createPool(uint256 poolId, string calldata title, string calldata category, uint256 endTime)
        external
        onlyOwner
    {
        if (poolId == 0) revert InvalidPoolId();
        if (_pools[poolId].status != PoolStatus.None) revert PoolAlreadyExists(poolId);

        uint256 titleLength = bytes(title).length;
        if (titleLength == 0 || titleLength > MAX_TITLE_LENGTH) revert InvalidTitle();
        uint256 categoryLength = bytes(category).length;
        if (categoryLength == 0 || categoryLength > MAX_CATEGORY_LENGTH) revert InvalidCategory();

        if (endTime <= block.timestamp || endTime > block.timestamp + MAX_POOL_DURATION) {
            revert InvalidEndTime();
        }

        _pools[poolId] = Pool({
            title: title,
            category: category,
            endTime: uint64(endTime),
            winningOption: 0,
            status: PoolStatus.Open,
            totalNetPool: 0,
            settlementHash: bytes32(0),
            rakeAdmin: 0
        });

        emit PoolCreated(poolId, title, category, uint64(endTime), msg.sender);
    }

    /**
     * @notice Injects seed liquidity so a fresh pool is never empty on both sides.
     * @dev Seed money is NOT charged the rake and is booked as the funder's own stake, so it is
     *      paid out (or lost to the other side) exactly like a normal bet. Seeds bypass the cap
     *      by design: they are the cap's reference liquidity.
     */
    function seedPool(uint256 poolId, uint8 option, uint256 amount) external onlyOwner nonReentrant {
        Pool storage pool = _openPool(poolId);
        if (option >= OPTION_COUNT) revert InvalidOption(option);
        if (amount == 0) revert ZeroAmount();

        uint256 received = _pullUsdc(msg.sender, amount);

        optionPool[poolId][option] += received;
        pool.totalNetPool += received;
        _stake[poolId][msg.sender][option] += received;

        emit PoolSeeded(poolId, option, received, msg.sender);
    }

    /**
     * @notice Locks a pool, fixes the winning option, records the evidence hash and releases
     *         the escrowed platform rake into the withdrawable profit bucket.
     */
    function settle(uint256 poolId, uint8 winningOption, bytes32 ipfsDataHash) external onlyOwner nonReentrant {
        Pool storage pool = _pools[poolId];
        if (pool.status == PoolStatus.None) revert PoolNotFound(poolId);
        if (pool.status != PoolStatus.Open) revert PoolNotOpen(poolId);
        if (block.timestamp < pool.endTime) revert PoolNotEnded(poolId);
        if (winningOption >= OPTION_COUNT) revert InvalidOption(winningOption);
        if (ipfsDataHash == bytes32(0)) revert ZeroDataHash();
        if (optionPool[poolId][winningOption] == 0) revert NoWinningStake(winningOption);

        pool.status = PoolStatus.Settled;
        pool.winningOption = winningOption;
        pool.settlementHash = ipfsDataHash;

        uint256 released = pool.rakeAdmin;
        if (released > 0) {
            pool.rakeAdmin = 0;
            accumulatedAdminFees += released;
            emit RakeReleased(poolId, released);
        }

        emit PoolSettled(poolId, winningOption, ipfsDataHash, pool.totalNetPool, block.timestamp);
    }

    /**
     * @notice Voids a pool. The escrowed rake is NOT released, so every bettor gets 100% back.
     */
    function cancelPool(uint256 poolId) external onlyOwner {
        _cancel(poolId);
    }

    /**
     * @notice Permissionless safety valve (F-03): if the owner never settles, anyone can void
     *         the pool once `endTime + EMERGENCY_REFUND_DELAY` has elapsed, unlocking 100%
     *         refunds. Without this, a lost owner key freezes user principal forever.
     */
    function emergencyRefund(uint256 poolId) external {
        Pool storage pool = _pools[poolId];
        if (pool.status == PoolStatus.None) revert PoolNotFound(poolId);
        if (pool.status != PoolStatus.Open) revert PoolNotOpen(poolId);

        uint256 eligibleAt = uint256(pool.endTime) + EMERGENCY_REFUND_DELAY;
        if (block.timestamp < eligibleAt) revert EmergencyTooEarly(eligibleAt);

        _cancel(poolId);
        emit EmergencyRefund(poolId, msg.sender, block.timestamp);
    }

    function _cancel(uint256 poolId) private {
        Pool storage pool = _pools[poolId];
        if (pool.status == PoolStatus.None) revert PoolNotFound(poolId);
        if (pool.status != PoolStatus.Open) revert PoolNotOpen(poolId);

        pool.status = PoolStatus.Canceled;
        // Rake stays in the contract and is refunded to bettors with the principal.
        pool.rakeAdmin = 0;

        emit PoolCanceled(poolId, block.timestamp);
    }

    // ---------------------------------------------------------------------
    // Users: bet / claim
    // ---------------------------------------------------------------------

    /**
     * @notice Places a bet on one side of a pool.
     * @dev F-01 patch: the owner address may not bet. It is the oracle, so letting it take
     *      positions against users is a guaranteed-profit conflict of interest.
     */
    function bet(uint256 poolId, uint8 option, uint256 amount, address referrer)
        external
        nonReentrant
        whenNotPaused
    {
        if (msg.sender == owner()) revert OwnerCannotBet();

        Pool storage pool = _openPool(poolId);
        if (option >= OPTION_COUNT) revert InvalidOption(option);
        if (amount < MIN_BET) revert BetBelowMinimum(amount, MIN_BET);

        uint256 cap = maxBetFor(poolId);
        if (amount > cap) revert BetExceedsCap(amount, cap);

        uint256 received = _pullUsdc(msg.sender, amount);
        if (received < MIN_BET) revert BetBelowMinimum(received, MIN_BET);

        uint256 fee = (received * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netStake = received - fee;

        address ref = referrer;
        if (ref == msg.sender || ref == address(0) || ref == address(this) || ref == feeVault) {
            ref = address(0);
        }

        uint256 referralCut = 0;
        if (ref != address(0)) {
            referralCut = (fee * REFERRAL_SHARE_BPS) / BPS_DENOMINATOR;
            poolReferral[poolId][ref] += referralCut; // escrowed, claimable after settle
        }
        uint256 adminCut = fee - referralCut;
        if (adminCut > 0) pool.rakeAdmin += adminCut; // escrowed, released at settle

        optionPool[poolId][option] += netStake;
        pool.totalNetPool += netStake;
        _stake[poolId][msg.sender][option] += netStake;
        _feePaid[poolId][msg.sender] += fee;

        emit BetPlaced(poolId, msg.sender, option, amount, netStake, fee, ref, referralCut);
    }

    /**
     * @notice Winning side claims its share of the whole net pool.
     * @dev payout = netStake * totalNetPool / winningOptionPool; CEI + nonReentrant.
     */
    function claimRewards(uint256 poolId) external nonReentrant returns (uint256 payout) {
        Pool storage pool = _pools[poolId];
        if (pool.status == PoolStatus.None) revert PoolNotFound(poolId);
        if (pool.status != PoolStatus.Settled) revert PoolNotSettled(poolId);
        if (claimed[poolId][msg.sender]) revert AlreadyClaimed();

        uint8 winner = pool.winningOption;
        uint256 stake = _stake[poolId][msg.sender][winner];
        if (stake == 0) revert NothingToClaim();

        uint256 winningPool = optionPool[poolId][winner];
        payout = (stake * pool.totalNetPool) / winningPool;
        if (payout == 0) revert NothingToClaim();

        claimed[poolId][msg.sender] = true;
        _stake[poolId][msg.sender][winner] = 0;

        usdc.safeTransfer(msg.sender, payout);

        emit RewardsClaimed(poolId, msg.sender, stake, payout);
    }

    /**
     * @notice Pulls back 100% of the gross stake from a canceled pool (net + the 4% rake).
     * @dev F-02 patch: the rake never left the contract while the pool was open, so this is
     *      fully funded without dipping into platform profit or other pools.
     */
    function claimRefund(uint256 poolId) external nonReentrant returns (uint256 refund) {
        Pool storage pool = _pools[poolId];
        if (pool.status == PoolStatus.None) revert PoolNotFound(poolId);
        if (pool.status != PoolStatus.Canceled) revert PoolNotCanceled(poolId);
        if (refunded[poolId][msg.sender]) revert AlreadyClaimed();

        refund = _stake[poolId][msg.sender][0] + _stake[poolId][msg.sender][1] + _feePaid[poolId][msg.sender];
        if (refund == 0) revert NothingToClaim();

        refunded[poolId][msg.sender] = true;
        _stake[poolId][msg.sender][0] = 0;
        _stake[poolId][msg.sender][1] = 0;
        _feePaid[poolId][msg.sender] = 0;

        usdc.safeTransfer(msg.sender, refund);

        emit RefundClaimed(poolId, msg.sender, refund);
    }

    // ---------------------------------------------------------------------
    // Fee withdrawal (still isolated from player funds)
    // ---------------------------------------------------------------------

    /**
     * @notice Sends ALL released platform profit to the configured feeVault.
     * @dev Only settled pools release their rake, so this can never consume money that still
     *      belongs to open or canceled pools.
     */
    function withdrawAdminFees() external onlyOwner nonReentrant returns (uint256 amount) {
        amount = accumulatedAdminFees;
        if (amount == 0) revert NothingToWithdraw();

        address to = feeVault;
        if (to == address(0)) revert FeeVaultNotSet();

        accumulatedAdminFees = 0;
        usdc.safeTransfer(to, amount);

        emit AdminFeesWithdrawn(to, amount);
    }

    /**
     * @notice KOL pulls its cut for one settled pool. Canceled pools never release referral money.
     */
    function withdrawReferralFees(uint256 poolId) external nonReentrant returns (uint256 amount) {
        Pool storage pool = _pools[poolId];
        if (pool.status == PoolStatus.None) revert PoolNotFound(poolId);
        if (pool.status != PoolStatus.Settled) revert PoolNotSettled(poolId);

        amount = poolReferral[poolId][msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        poolReferral[poolId][msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit ReferralFeesWithdrawn(poolId, msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Owner configuration
    // ---------------------------------------------------------------------

    function setFeeVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert ZeroAddress();
        address previous = feeVault;
        feeVault = newVault;
        emit FeeVaultUpdated(previous, newVault);
    }

    // ---------------------------------------------------------------------
    // Circuit breaker
    // ---------------------------------------------------------------------

    /**
     * @notice Stops new bets. Claims stay open by design — pausing must never trap user funds.
     */
    function pause() external onlyOwner {
        _pause();
        emit ArenaPaused(msg.sender, block.timestamp);
    }

    /**
     * @notice Re-opens betting.
     */
    function unpause() external onlyOwner {
        _unpause();
        emit ArenaUnpaused(msg.sender, block.timestamp);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    struct PoolView {
        string title;
        string category;
        uint64 endTime;
        uint8 winningOption;
        uint8 status;
        uint256 totalNetPool;
        uint256 option0Pool;
        uint256 option1Pool;
        bytes32 settlementHash;
    }

    function getPool(uint256 poolId) external view returns (PoolView memory view_) {
        return _viewPool(poolId);
    }

    /**
     * @notice Batched read for a whole board in one eth_call.
     * @dev Reverts like getPool() if any id is unknown, so a partial board can never be read as a
     *      full one. Callers that want tolerance pass only ids they know exist.
     */
    function getPools(uint256[] calldata poolIds) external view returns (PoolView[] memory views_) {
        uint256 n = poolIds.length;
        views_ = new PoolView[](n);
        for (uint256 i = 0; i < n; ++i) {
            views_[i] = _viewPool(poolIds[i]);
        }
    }

    function _viewPool(uint256 poolId) internal view returns (PoolView memory view_) {
        Pool storage pool = _pools[poolId];
        if (pool.status == PoolStatus.None) revert PoolNotFound(poolId);

        view_.title = pool.title;
        view_.category = pool.category;
        view_.endTime = pool.endTime;
        view_.winningOption = pool.winningOption;
        view_.status = uint8(pool.status);
        view_.totalNetPool = pool.totalNetPool;
        view_.option0Pool = optionPool[poolId][0];
        view_.option1Pool = optionPool[poolId][1];
        view_.settlementHash = pool.settlementHash;
    }

    function getStake(uint256 poolId, address user) external view returns (uint256[2] memory) {
        return _stake[poolId][user];
    }

    function feePaid(uint256 poolId, address user) external view returns (uint256) {
        return _feePaid[poolId][user];
    }

    /// @notice Platform rake still escrowed for this pool (released only by settle()).
    function poolRakeAdmin(uint256 poolId) external view returns (uint256) {
        return _pools[poolId].rakeAdmin;
    }

    /// @notice What the user would get back right now if the pool were canceled (100% of gross).
    function pendingRefund(uint256 poolId, address user) external view returns (uint256) {
        if (refunded[poolId][user]) return 0;
        return _stake[poolId][user][0] + _stake[poolId][user][1] + _feePaid[poolId][user];
    }

    /// @notice Per-ticket ceiling. Flat in v2: MAX_BET for every pool, no proportional clamp.
    /// @dev The poolId argument is retained so the ABI (frontend, cron, monitors) keeps working.
    function maxBetFor(uint256 /* poolId */) public view returns (uint256) {
        return MAX_BET;
    }

    /// @notice Alias kept for the frontend / ops tooling.
    function currentMaxBet(uint256 poolId) external view returns (uint256) {
        return maxBetFor(poolId);
    }

    /// @notice Preview of the rake split for a gross amount, exactly as bet() computes it.
    function previewBet(uint256 amount)
        external
        pure
        returns (uint256 fee, uint256 referralCut, uint256 adminCut, uint256 netStake)
    {
        fee = (amount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        referralCut = (fee * REFERRAL_SHARE_BPS) / BPS_DENOMINATOR;
        adminCut = fee - referralCut;
        netStake = amount - fee;
    }

    /// @notice What a winner would receive right now (0 if not settled / no stake).
    function pendingRewards(uint256 poolId, address user) external view returns (uint256) {
        Pool storage pool = _pools[poolId];
        if (pool.status != PoolStatus.Settled || claimed[poolId][user]) return 0;
        uint256 winningPool = optionPool[poolId][pool.winningOption];
        if (winningPool == 0) return 0;
        return (_stake[poolId][user][pool.winningOption] * pool.totalNetPool) / winningPool;
    }

    /// @notice Contract USDC balance, for off-chain invariant monitoring.
    function contractBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _openPool(uint256 poolId) private view returns (Pool storage pool) {
        pool = _pools[poolId];
        if (pool.status == PoolStatus.None) revert PoolNotFound(poolId);
        if (pool.status != PoolStatus.Open) revert PoolNotOpen(poolId);
        if (block.timestamp >= pool.endTime) revert PoolEnded(poolId);
    }

    /**
     * @dev Pulls `amount` of USDC and returns what actually arrived, so a fee-on-transfer
     *      token can never make the internal ledger exceed the real balance.
     */
    function _pullUsdc(address from, uint256 amount) private returns (uint256 received) {
        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(from, address(this), amount);
        received = usdc.balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert ZeroAmount();
    }

    // ---------------------------------------------------------------------
    // Emergency rescue (bet token can never be rescued)
    // ---------------------------------------------------------------------

    function rescueERC20(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (address(token) == address(usdc)) revert CannotRescueBetToken();
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
    }
}
