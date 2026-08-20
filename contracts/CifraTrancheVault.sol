// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { CifraTrancheController } from "./CifraTrancheController.sol";
import { CifraFunderRegistry } from "./CifraFunderRegistry.sol";

/// @title CifraTrancheVault
/// @notice A single ERC-4626 tranche share class (senior or junior) over the shared asset pool
///         held by `CifraTrancheController`. Funders deposit the book's asset and receive tranche
///         shares; the underlying assets live in the controller, so this vault holds no funds —
///         its `totalAssets()` is the controller's waterfall claim for this tranche, which makes
///         the share price move as the waterfall realizes yield (repayment) or loss (default).
///
///         Two instances are deployed (senior + junior) and registered on the controller. The
///         difference between them is purely the waterfall the controller applies to each claim.
///
///         PARTICIPATION MAY BE RESTRICTED. When a `CifraFunderRegistry` is set, deposits and
///         share transfers are limited to allowlisted addresses — tranche shares are plausibly
///         securities, and a permissionless ERC-4626 cannot express "professional investors
///         only". Redemption is deliberately NEVER gated: a funder removed from the list must
///         still be able to exit, because a compliance control that traps capital is a worse
///         problem than the one it solves. Pass `address(0)` for an unrestricted vault.
contract CifraTrancheVault is ERC4626 {
    using SafeERC20 for IERC20;

    CifraTrancheController public immutable CONTROLLER;

    /// @notice Allowlist consulted on deposit and transfer. Zero means unrestricted.
    CifraFunderRegistry public immutable FUNDER_REGISTRY;

    error ZeroAddress();
    error NotAllowedToHold(address account);

    constructor(
        IERC20 asset_,
        CifraTrancheController controller_,
        string memory name_,
        string memory symbol_,
        CifraFunderRegistry funderRegistry_
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        if (address(controller_) == address(0)) revert ZeroAddress();
        CONTROLLER = controller_;
        FUNDER_REGISTRY = funderRegistry_;
    }

    /// @notice Whether `account` may currently hold this tranche's shares.
    function canHold(address account) public view returns (bool) {
        return address(FUNDER_REGISTRY) == address(0) || FUNDER_REGISTRY.canHold(account);
    }

    /// @notice This tranche's NAV = its waterfall claim held by the controller.
    function totalAssets() public view override returns (uint256) {
        return CONTROLLER.claimOf(address(this));
    }

    /// @dev Inflation-attack mitigation for a fresh deploy (virtual shares scale by 10**offset).
    ///      Share decimals become asset decimals + offset, so this is decimals-agnostic: a USDT
    ///      book (6) yields 9-decimal shares, a WBOT book (18) yields 21.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 3;
    }

    /// @dev Route the deposit's assets straight into the controller pool (the depositor approved
    ///      THIS vault), then record the tranche claim. Pausing is enforced controller-side in
    ///      `creditDeposit`, so an emergency stop covers both tranches at once.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        // Gate the RECEIVER only — they are the one who ends up holding the position, and
        // "who holds the security" is the question this control exists to answer.
        //
        // The payer is deliberately NOT gated. Gating them would buy no real assurance (anyone
        // can transfer the asset to an allowlisted address, who then deposits it themselves)
        // while breaking every legitimate contract that deposits on a user's behalf — starting
        // with CifraNativeDepositHelper, whose whole job is to wrap and deposit in one call.
        // Source-of-funds is an off-chain AML control, not something this check can provide.
        if (!canHold(receiver)) revert NotAllowedToHold(receiver);

        IERC20(asset()).safeTransferFrom(caller, address(CONTROLLER), assets);
        CONTROLLER.creditDeposit(assets);
        _mint(receiver, shares);
        emit Deposit(caller, receiver, assets, shares);
    }

    /// @dev Burn shares, then have the controller pay the assets out of the pool to `receiver`
    ///      (bounded by idle liquidity — advanced capital can't be withdrawn until it returns).
    /// @dev Restrict share TRANSFERS to allowlisted holders, so the deposit gate cannot be
    ///      sidestepped by depositing and then sending the shares onward. Mints and burns pass
    ///      through untouched — minting is already checked in `_deposit`, and burning is
    ///      redemption, which must always remain open. Note `from` is deliberately unchecked: a
    ///      de-listed holder can still redeem, they just cannot pass the position to someone else.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && !canHold(to)) revert NotAllowedToHold(to);
        super._update(from, to, value);
    }

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
