// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev The canonical wrapped-native token (WBOT on BOT Chain) — the WETH9 surface.
interface IWrappedNative is IERC20 {
    function deposit() external payable;

    function withdraw(uint256 amount) external;
}

/// @title CifraNativeDepositHelper
/// @notice One-transaction native-BOT entry and exit for a Cifra tranche vault.
///
///         `CifraTrancheController` holds a single `IERC20`, so the native book is denominated
///         in **WBOT**, not BOT. Without this helper every funder would have to wrap manually
///         before depositing and unwrap after withdrawing — a two-step cliff on the asset that
///         is supposed to take precedence in the UI. This contract collapses each direction to
///         one call.
///
///         It is deliberately stateless and holds no funds between transactions: it wraps,
///         deposits, and forwards shares in `depositNative`; it pulls shares, redeems, unwraps
///         and forwards native in `redeemToNative`. Any dust that somehow lands here is
///         recoverable by anyone via `sweep`, because it can never legitimately belong to the
///         contract.
///
///         TRUST: none required. The helper is not privileged anywhere in the protocol — it is
///         an ordinary caller of the ERC-4626 vault. A user may always bypass it and wrap/deposit
///         by hand.
contract CifraNativeDepositHelper is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The wrapped-native token this helper wraps into (WBOT).
    IWrappedNative public immutable WRAPPED;

    event DepositedNative(
        address indexed caller,
        address indexed vault,
        address indexed receiver,
        uint256 assets,
        uint256 shares
    );
    event RedeemedToNative(
        address indexed caller,
        address indexed vault,
        address indexed receiver,
        uint256 shares,
        uint256 assets
    );

    error ZeroAddress();
    error ZeroAmount();
    error VaultAssetMismatch();
    error NativeTransferFailed();
    error UnexpectedNative();

    constructor(IWrappedNative wrapped_) {
        if (
            address(wrapped_) == address(0) ||
            address(wrapped_).code.length == 0
        ) revert ZeroAddress();
        WRAPPED = wrapped_;
    }

    /// @notice Wrap the sent native BOT and deposit it into `vault` in one transaction.
    /// @param vault The tranche vault to deposit into. Its `asset()` must be `WRAPPED`.
    /// @param receiver Who receives the tranche shares.
    /// @return shares Shares minted to `receiver`.
    function depositNative(
        IERC4626 vault,
        address receiver
    ) external payable nonReentrant returns (uint256 shares) {
        if (msg.value == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        // Guard against pointing the helper at a vault denominated in something else, which
        // would otherwise wrap the caller's BOT and then revert deep inside the vault.
        if (vault.asset() != address(WRAPPED)) revert VaultAssetMismatch();

        WRAPPED.deposit{value: msg.value}();
        IERC20(address(WRAPPED)).forceApprove(address(vault), msg.value);

        shares = vault.deposit(msg.value, receiver);
        emit DepositedNative(
            msg.sender,
            address(vault),
            receiver,
            msg.value,
            shares
        );
    }

    /// @notice Redeem tranche shares and return native BOT in one transaction.
    /// @dev The caller must first `approve` this helper for `shares` on the vault — the helper
    ///      redeems as the share owner's spender, so it never needs custody beforehand.
    ///      Bounded by the controller's idle liquidity like any other withdrawal.
    /// @param vault The tranche vault to redeem from. Its `asset()` must be `WRAPPED`.
    /// @param shares Shares to burn.
    /// @param receiver Who receives the native BOT.
    /// @return assets Native BOT sent to `receiver`.
    function redeemToNative(
        IERC4626 vault,
        uint256 shares,
        address receiver
    ) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        if (vault.asset() != address(WRAPPED)) revert VaultAssetMismatch();

        // owner = msg.sender: the vault spends the caller's allowance to this helper.
        assets = vault.redeem(shares, address(this), msg.sender);

        WRAPPED.withdraw(assets);
        (bool ok, ) = receiver.call{value: assets}("");
        if (!ok) revert NativeTransferFailed();

        emit RedeemedToNative(
            msg.sender,
            address(vault),
            receiver,
            shares,
            assets
        );
    }

    /// @notice Preview the shares `depositNative` would mint for `assets` of native BOT.
    function previewDepositNative(
        IERC4626 vault,
        uint256 assets
    ) external view returns (uint256) {
        return vault.previewDeposit(assets);
    }

    /// @notice Recover stranded balances. Permissionless by design: this contract is stateless
    ///         and never has a legitimate claim to anything held at rest, so there is nothing
    ///         to gate and no owner to trust.
    function sweep(address token, address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(0)) {
            uint256 bal = address(this).balance;
            if (bal == 0) revert ZeroAmount();
            (bool ok, ) = to.call{value: bal}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal == 0) revert ZeroAmount();
            IERC20(token).safeTransfer(to, bal);
        }
    }

    /// @dev Only the wrapped-native contract may send BOT here, and only during `withdraw`.
    ///      Anything else is a mistake and is rejected rather than silently absorbed.
    receive() external payable {
        if (msg.sender != address(WRAPPED)) revert UnexpectedNative();
    }
}
