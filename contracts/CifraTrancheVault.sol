// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { CifraTrancheController } from "./CifraTrancheController.sol";

/// @title CifraTrancheVault
/// @notice A single ERC-4626 tranche share class (senior or junior) over the shared FXRP pool
///         held by `CifraTrancheController`. Funders deposit FXRP and receive tranche shares;
///         the underlying FXRP lives in the controller, so this vault holds no funds itself —
///         its `totalAssets()` is the controller's waterfall claim for this tranche, which makes
///         the share price move as the waterfall realizes yield (repayment) or loss (default).
///
///         Two instances are deployed (senior + junior) and registered on the controller. The
///         difference between them is purely the waterfall the controller applies to each claim.
contract CifraTrancheVault is ERC4626 {
    using SafeERC20 for IERC20;

    CifraTrancheController public immutable CONTROLLER;

    error ZeroAddress();

    constructor(
        IERC20 fxrp_,
        CifraTrancheController controller_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) ERC4626(fxrp_) {
        if (address(controller_) == address(0)) revert ZeroAddress();
        CONTROLLER = controller_;
    }

    /// @notice This tranche's NAV = its waterfall claim held by the controller.
    function totalAssets() public view override returns (uint256) {
        return CONTROLLER.claimOf(address(this));
    }

    /// @dev Inflation-attack mitigation for a fresh deploy (virtual shares scale by 10**offset).
    ///      Share decimals become asset decimals (6) + offset.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 3;
    }

    /// @dev Route the deposit's FXRP straight into the controller pool (the depositor approved
    ///      THIS vault), then record the tranche claim. Pausing is enforced controller-side in
    ///      `creditDeposit`, so an emergency stop covers both tranches at once.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        IERC20(asset()).safeTransferFrom(caller, address(CONTROLLER), assets);
        CONTROLLER.creditDeposit(assets);
        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
    }

    /// @dev Burn shares, then have the controller pay the FXRP out of the pool to `receiver`
    ///      (bounded by idle liquidity — advanced capital can't be withdrawn until it returns).
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (caller != owner) _spendAllowance(owner, caller, shares);
        _burn(owner, shares);
        CONTROLLER.debitWithdraw(receiver, assets);
        emit Withdraw(caller, receiver, owner, assets, shares);
    }
}
