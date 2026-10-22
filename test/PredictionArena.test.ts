import { expect } from "chai";
import { ethers, network } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

const usdcUnits = (n: number | string) => ethers.parseUnits(String(n), 6);
const DAY = 86_400;
const EVIDENCE_HASH = ethers.keccak256(
  ethers.toUtf8Bytes("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
);

async function advanceTime(seconds: number) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine", []);
}

describe("PredictionArena (post-P0 hardening)", function () {
  let owner: any, feeVault: any, alice: any, bob: any, kol: any, other: any;
  let usdc: any, arena: any, arenaAddr: string;
  const POOL = 1n;

  async function openPool(poolId: bigint = POOL, seeds: [string, string] = ["22.5", "22.5"]) {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await arena.createPool(poolId, `pool ${poolId}`, "crypto", now + DAY);
    if (seeds[0] !== "0") await arena.seedPool(poolId, 0, usdcUnits(seeds[0]));
    if (seeds[1] !== "0") await arena.seedPool(poolId, 1, usdcUnits(seeds[1]));
  }

  beforeEach(async () => {
    [owner, feeVault, alice, bob, kol, other] = await ethers.getSigners();

    usdc = await ethers.deployContract("MockUSDC");
    await usdc.waitForDeployment();
    for (const u of [owner, alice, bob, kol, other]) {
      await usdc.mint(u.address, usdcUnits(100_000));
    }

    arena = await ethers.deployContract("PredictionArena", [
      await usdc.getAddress(),
      feeVault.address,
      owner.address,
    ]);
    await arena.waitForDeployment();
    arenaAddr = await arena.getAddress();

    for (const u of [owner, alice, bob, kol, other]) {
      await usdc.connect(u).approve(arenaAddr, ethers.MaxUint256);
    }

    await openPool();
  });

  describe("deployment & configuration", () => {
    it("binds USDC, feeVault, owner and the 4% / 30% parameters", async () => {
      expect(await arena.usdc()).to.equal(await usdc.getAddress());
      expect(await arena.feeVault()).to.equal(feeVault.address);
      expect(await arena.owner()).to.equal(owner.address);
      expect(await arena.PLATFORM_FEE_BPS()).to.equal(400n);
      expect(await arena.REFERRAL_SHARE_BPS()).to.equal(3000n);
      expect(await arena.MIN_BET()).to.equal(usdcUnits(50));
      expect(await arena.MAX_BET()).to.equal(usdcUnits(10_000));
      expect(await arena.maxBetFor(POOL)).to.equal(usdcUnits(10_000));
      expect(await arena.EMERGENCY_REFUND_DELAY()).to.equal(BigInt(30 * DAY));
    });

    it("rejects zero addresses", async () => {
      await expect(
        ethers.deployContract("PredictionArena", [ethers.ZeroAddress, feeVault.address, owner.address])
      ).to.be.revertedWithCustomError(arena, "ZeroAddress");
      await expect(
        ethers.deployContract("PredictionArena", [await usdc.getAddress(), ethers.ZeroAddress, owner.address])
      ).to.be.revertedWithCustomError(arena, "ZeroAddress");
    });

    it("previews the rake split exactly like bet()", async () => {
      const [fee, referralCut, adminCut, netStake] = await arena.previewBet(usdcUnits(100));
      expect(fee).to.equal(usdcUnits(4));
      expect(referralCut).to.equal(usdcUnits("1.2"));
      expect(adminCut).to.equal(usdcUnits("2.8"));
      expect(netStake).to.equal(usdcUnits(96));
    });
  });

  describe("createPool & seeding", () => {
    it("is owner-only and rejects duplicate ids / past end times", async () => {
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      await expect(
        arena.connect(alice).createPool(9, "q", "cat", now + DAY)
      ).to.be.revertedWithCustomError(arena, "OwnableUnauthorizedAccount");
      await expect(
        arena.createPool(POOL, "dup", "crypto", now + DAY)
      ).to.be.revertedWithCustomError(arena, "PoolAlreadyExists");
      await expect(arena.createPool(2, "past", "crypto", now - 1)).to.be.revertedWithCustomError(
        arena,
        "InvalidEndTime"
      );
    });

    it("credits 100% of the seed (no rake) as the funder's stake", async () => {
      await openPool(42n, ["22.5", "0"]);
      const pool = await arena.getPool(42n);
      expect(pool.option0Pool).to.equal(usdcUnits("22.5"));
      expect((await arena.getStake(42n, owner.address))[0]).to.equal(usdcUnits("22.5"));
      expect(await arena.accumulatedAdminFees()).to.equal(0n);
    });
  });

  describe("F-01: owner cannot bet", () => {
    it("blocks the owner address from taking a position", async () => {
      await expect(
        arena.connect(owner).bet(POOL, 1, usdcUnits(50), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(arena, "OwnerCannotBet");
    });

    it("still lets normal users bet, and keeps the owner's seed position intact", async () => {
      await arena.connect(alice).bet(POOL, 1, usdcUnits(500), ethers.ZeroAddress);
      const pool = await arena.getPool(POOL);
      expect(pool.option0Pool).to.equal(usdcUnits("22.5")); // owner seed untouched
      expect(pool.option1Pool).to.equal(usdcUnits("502.5")); // 22.5 seed + 480 net
    });
  });

  describe("rake escrow (basis for 100% refunds)", () => {
    it("escrows 4% instead of paying it out immediately", async () => {
      await arena.connect(alice).bet(POOL, 1, usdcUnits(500), kol.address);

      expect(await arena.accumulatedAdminFees()).to.equal(0n);
      expect(await arena.poolRakeAdmin(POOL)).to.equal(usdcUnits("14"));
      expect(await arena.poolReferral(POOL, kol.address)).to.equal(usdcUnits("6"));
      expect(await arena.feePaid(POOL, alice.address)).to.equal(usdcUnits(20));
      expect((await arena.getPool(POOL)).option1Pool).to.equal(usdcUnits("502.5"));
    });

    it("routes 100% of the rake to the admin escrow when there is no referrer", async () => {
      await arena.connect(alice).bet(POOL, 1, usdcUnits(500), ethers.ZeroAddress);
      expect(await arena.poolRakeAdmin(POOL)).to.equal(usdcUnits(20));
      expect(await arena.poolReferral(POOL, alice.address)).to.equal(0n);
    });

    it("ignores self-referral", async () => {
      await arena.connect(alice).bet(POOL, 1, usdcUnits(500), alice.address);
      expect(await arena.poolReferral(POOL, alice.address)).to.equal(0n);
      expect(await arena.poolRakeAdmin(POOL)).to.equal(usdcUnits(20));
    });
  });

  describe("bet limits", () => {
    beforeEach(async () => {
      await arena.seedPool(POOL, 0, usdcUnits(1_000));
    });

    it("enforces the flat v2 window: 50 USDC floor, 10,000 USDC ceiling", async () => {
      await expect(
        arena.connect(alice).bet(POOL, 1, usdcUnits("49.99"), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(arena, "BetBelowMinimum");

      expect(await arena.currentMaxBet(POOL)).to.equal(usdcUnits(10_000));
      await expect(
        arena.connect(alice).bet(POOL, 1, usdcUnits("10000.01"), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(arena, "BetExceedsCap");

      // v2 removed the 20%-of-weaker-side clamp: the cap must not move when the pool deepens
      await arena.seedPool(POOL, 1, usdcUnits(300));
      expect(await arena.currentMaxBet(POOL)).to.equal(usdcUnits(10_000));
      await arena.seedPool(POOL, 0, usdcUnits(50_000));
      expect(await arena.currentMaxBet(POOL)).to.equal(usdcUnits(10_000));

      // both edges are inclusive
      await arena.connect(alice).bet(POOL, 1, usdcUnits(50), ethers.ZeroAddress);
      await arena.connect(bob).bet(POOL, 1, usdcUnits(10_000), ethers.ZeroAddress);
    });

    it("a freshly seeded 22.5/22.5 pool still accepts the 50 USDC floor", async () => {
      await openPool(42n, ["22.5", "22.5"]);
      expect(await arena.currentMaxBet(42n)).to.equal(usdcUnits(10_000));
      await arena.connect(alice).bet(42n, 1, usdcUnits(50), ethers.ZeroAddress);
      await arena.connect(bob).bet(42n, 0, usdcUnits(50), ethers.ZeroAddress);
      const pool = await arena.getPool(42n);
      expect(pool.option0Pool).to.be.greaterThan(0n);
      expect(pool.option1Pool).to.be.greaterThan(0n);
    });

    it("rejects invalid options and closes at endTime", async () => {
      await expect(
        arena.connect(alice).bet(POOL, 2, usdcUnits(100), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(arena, "InvalidOption");

      await advanceTime(DAY + 1);
      await expect(
        arena.connect(alice).bet(POOL, 1, usdcUnits(100), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(arena, "PoolEnded");
    });
  });

  describe("settle & claim", () => {
    beforeEach(async () => {
      await arena.connect(alice).bet(POOL, 1, usdcUnits(500), kol.address);
      await arena.connect(bob).bet(POOL, 1, usdcUnits(190), ethers.ZeroAddress);
    });

    it("cannot settle before endTime or from a non-owner", async () => {
      await expect(arena.settle(POOL, 1, EVIDENCE_HASH)).to.be.revertedWithCustomError(arena, "PoolNotEnded");
      await expect(
        arena.connect(alice).settle(POOL, 1, EVIDENCE_HASH)
      ).to.be.revertedWithCustomError(arena, "OwnableUnauthorizedAccount");
    });

    it("records the oracle evidence hash and releases the escrowed rake", async () => {
      await advanceTime(DAY + 1);
      const tx = await arena.settle(POOL, 1, EVIDENCE_HASH);

      await expect(tx).to.emit(arena, "PoolSettled").withArgs(POOL, 1n, EVIDENCE_HASH, anyValue, anyValue);

      const pool = await arena.getPool(POOL);
      expect(pool.settlementHash).to.equal(EVIDENCE_HASH);
      expect(await arena.poolRakeAdmin(POOL)).to.equal(0n);
      // alice: 20 fee → 14 admin; bob: 7.6 fee → 7.6 admin
      expect(await arena.accumulatedAdminFees()).to.equal(usdcUnits("21.6"));
    });

    it("refuses to settle without an evidence hash", async () => {
      await advanceTime(DAY + 1);
      await expect(arena.settle(POOL, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(arena, "ZeroDataHash");
    });

    it("pays winners pro-rata and blocks double claims", async () => {
      await advanceTime(DAY + 1);
      await arena.settle(POOL, 1, EVIDENCE_HASH);

      const pool = await arena.getPool(POOL);
      const stake = (await arena.getStake(POOL, alice.address))[1];
      const expected = (stake * pool.totalNetPool) / pool.option1Pool;
      const before = await usdc.balanceOf(alice.address);

      await arena.connect(alice).claimRewards(POOL);
      expect((await usdc.balanceOf(alice.address)) - before).to.equal(expected);
      await expect(
        arena.connect(alice).claimRewards(POOL)
      ).to.be.revertedWithCustomError(arena, "AlreadyClaimed");
      await expect(
        arena.connect(other).claimRewards(POOL)
      ).to.be.revertedWithCustomError(arena, "NothingToClaim");
    });

    it("refuses to settle on a side nobody backed", async () => {
      await openPool(7n, ["45", "0"]);
      await advanceTime(DAY + 2);
      await expect(arena.settle(7n, 1, EVIDENCE_HASH)).to.be.revertedWithCustomError(arena, "NoWinningStake");
    });
  });

  describe("F-02: cancel refunds 100% of gross stake", () => {
    it("returns the full 500 USDC including the 4% rake", async () => {
      await arena.connect(alice).bet(POOL, 1, usdcUnits(500), kol.address); // 480 net + 20 fee
      await arena.cancelPool(POOL);

      expect(await arena.pendingRefund(POOL, alice.address)).to.equal(usdcUnits(500));

      const before = await usdc.balanceOf(alice.address);
      await arena.connect(alice).claimRefund(POOL);
      expect((await usdc.balanceOf(alice.address)) - before).to.equal(usdcUnits(500));
    });

    it("refunds both sides in full and blocks double refunds", async () => {
      await arena.connect(alice).bet(POOL, 0, usdcUnits(300), ethers.ZeroAddress); // 288 net
      await arena.connect(bob).bet(POOL, 1, usdcUnits(190), ethers.ZeroAddress); // 182.4 net
      await arena.cancelPool(POOL);

      const aBefore = await usdc.balanceOf(alice.address);
      await arena.connect(alice).claimRefund(POOL);
      expect((await usdc.balanceOf(alice.address)) - aBefore).to.equal(usdcUnits(300));

      const bBefore = await usdc.balanceOf(bob.address);
      await arena.connect(bob).claimRefund(POOL);
      expect((await usdc.balanceOf(bob.address)) - bBefore).to.equal(usdcUnits(190));

      await expect(
        arena.connect(bob).claimRefund(POOL)
      ).to.be.revertedWithCustomError(arena, "AlreadyClaimed");
    });

    it("leaves the platform with zero rake and zero referral on a canceled pool", async () => {
      await arena.connect(alice).bet(POOL, 1, usdcUnits(500), kol.address);
      await arena.cancelPool(POOL);

      expect(await arena.accumulatedAdminFees()).to.equal(0n);
      expect(await arena.poolRakeAdmin(POOL)).to.equal(0n);
      // KOL can never claim referral money from a canceled pool
      await expect(
        arena.connect(kol).withdrawReferralFees(POOL)
      ).to.be.revertedWithCustomError(arena, "PoolNotSettled");
    });

    it("cannot settle after cancel, and cannot refund before cancel", async () => {
      await arena.connect(alice).bet(POOL, 1, usdcUnits(500), ethers.ZeroAddress);
      await expect(
        arena.connect(alice).claimRefund(POOL)
      ).to.be.revertedWithCustomError(arena, "PoolNotCanceled");

      await arena.cancelPool(POOL);
      await expect(arena.settle(POOL, 1, EVIDENCE_HASH)).to.be.revertedWithCustomError(
        arena,
        "PoolNotOpen"
      );
    });
  });

  describe("F-03: permissionless emergency refund", () => {
    it("reverts before endTime + 30 days", async () => {
      await arena.connect(alice).bet(POOL, 1, usdcUnits(500), ethers.ZeroAddress);

      const pool = await arena.getPool(POOL);
      const eligibleAt = BigInt(pool.endTime) + BigInt(30 * DAY);
      await expect(arena.connect(other).emergencyRefund(POOL))
        .to.be.revertedWithCustomError(arena, "EmergencyTooEarly")
        .withArgs(eligibleAt);

      await advanceTime(29 * DAY);
      await expect(
        arena.connect(other).emergencyRefund(POOL)
      ).to.be.revertedWithCustomError(arena, "EmergencyTooEarly");
    });

    it("lets ANY address void the pool after the grace period", async () => {
      await arena.connect(alice).bet(POOL, 1, usdcUnits(500), ethers.ZeroAddress);

      await advanceTime(DAY + 30 * DAY + 1);
      await expect(arena.connect(other).emergencyRefund(POOL))
        .to.emit(arena, "EmergencyRefund")
        .withArgs(POOL, other.address, anyValue);

      expect((await arena.getPool(POOL)).status).to.equal(3n); // Canceled
      expect(await arena.pendingRefund(POOL, alice.address)).to.equal(usdcUnits(500));

      const before = await usdc.balanceOf(alice.address);
      await arena.connect(alice).claimRefund(POOL);
      expect((await usdc.balanceOf(alice.address)) - before).to.equal(usdcUnits(500));
    });

    it("cannot be used on settled or already canceled pools", async () => {
      await arena.connect(alice).bet(POOL, 1, usdcUnits(500), ethers.ZeroAddress);
      await advanceTime(DAY + 1);
      await arena.settle(POOL, 1, EVIDENCE_HASH);
      await advanceTime(31 * DAY);
      await expect(
        arena.connect(other).emergencyRefund(POOL)
      ).to.be.revertedWithCustomError(arena, "PoolNotOpen");

      await openPool(5n, ["22.5", "22.5"]);
      await arena.connect(bob).bet(5n, 0, usdcUnits(100), ethers.ZeroAddress);
      await arena.cancelPool(5n);
      await advanceTime(31 * DAY);
      await expect(
        arena.connect(other).emergencyRefund(5n)
      ).to.be.revertedWithCustomError(arena, "PoolNotOpen");
    });
  });

  describe("fee isolation across pools", () => {
    it("only released (settled) rake can be withdrawn", async () => {
      await arena.connect(alice).bet(POOL, 1, usdcUnits(500), kol.address);

      // open pool: nothing is withdrawable, not even as owner
      await expect(arena.withdrawAdminFees()).to.be.revertedWithCustomError(arena, "NothingToWithdraw");
      await expect(
        arena.connect(kol).withdrawReferralFees(POOL)
      ).to.be.revertedWithCustomError(arena, "PoolNotSettled");

      await advanceTime(DAY + 1);
      await arena.settle(POOL, 1, EVIDENCE_HASH);
      expect(await arena.accumulatedAdminFees()).to.equal(usdcUnits("14"));

      // a second, still-open pool must not be touchable by that withdrawal
      await openPool(2n, ["22.5", "22.5"]);
      await arena.connect(bob).bet(2n, 0, usdcUnits(500), ethers.ZeroAddress);
      const vaultBefore = await usdc.balanceOf(feeVault.address);
      await arena.withdrawAdminFees();
      expect((await usdc.balanceOf(feeVault.address)) - vaultBefore).to.equal(usdcUnits("14"));
      expect(await arena.poolRakeAdmin(2n)).to.equal(usdcUnits(20));

      // KOL claims its settled cut
      const kolBefore = await usdc.balanceOf(kol.address);
      await arena.connect(kol).withdrawReferralFees(POOL);
      expect((await usdc.balanceOf(kol.address)) - kolBefore).to.equal(usdcUnits("6"));

      const balance = await arena.contractBalance();
      const owed = (await arena.accumulatedAdminFees()) + (await arena.poolRakeAdmin(2n));
      expect(balance).to.be.greaterThanOrEqual(owed);
    });

    it("cannot rescue USDC but can rescue stray tokens", async () => {
      await expect(
        arena.rescueERC20(await usdc.getAddress(), other.address, 1)
      ).to.be.revertedWithCustomError(arena, "CannotRescueBetToken");
    });
  });
});
