// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockVault4626
/// @notice Test-only plain ERC-4626 over an asset (totalAssets == held balance). Lets the
///         CifraNavOracle tests exercise USD pricing over any IERC4626 without depending on a
///         specific production vault. Not deployed to any live network.
contract MockVault4626 is ERC4626 {
    constructor(IERC20 asset_) ERC20("Mock Vault", "mVLT") ERC4626(asset_) {}
}
