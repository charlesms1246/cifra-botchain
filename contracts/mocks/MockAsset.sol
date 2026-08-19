// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockAsset
/// @notice Test-only ERC-20 with configurable decimals, freely mintable. Cifra runs one book
///         per settlement asset and those assets do NOT share a decimal count (USDT is 6,
///         WBOT is 18), so the tests must be able to instantiate either. Replaces the old
///         fixed-6-decimal MockFXRP. Not deployed to any live network.
contract MockAsset is ERC20 {
    uint8 private immutable DECIMALS;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        DECIMALS = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return DECIMALS;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
