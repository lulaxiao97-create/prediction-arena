// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Hostile 6-decimal token used ONLY by audit/onchain-attack/03-reentrancy-local.ts.
///         It calls back into a target contract from inside `_update`, i.e. exactly where the
///         arena executes `safeTransfer` / `safeTransferFrom`. Real USDC never does this — the
///         point is to prove the arena's ReentrancyGuard actually holds if it ever did.
contract ReentrantUSDC is ERC20 {
    address public target;
    bytes public payload;
    bool public armed;
    uint256 public reentryReverts;

    constructor() ERC20("Hostile USD Coin", "hUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && target != address(0)) {
            armed = false; // single shot, no infinite recursion
            (bool ok, bytes memory ret) = target.call(payload);
            if (!ok) {
                reentryReverts++;
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }
}
