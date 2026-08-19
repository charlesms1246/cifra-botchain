// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @dev Minimal FTSO reader — both Coston2's TestFtsoV2Interface and the unit-test mock
///      implement this. `getFeedByIdInWei` returns the price scaled to 18 decimals.
interface IFtsoV2Wei {
    function getFeedByIdInWei(bytes21 _feedId) external view returns (uint256 value, uint64 timestamp);
}

/// @title CifraNavOracle
/// @notice Read-only USD valuation of the FXRP-denominated CifraVault, using the FTSO
///         XRP/USD block-latency feed. The vault's own accounting stays in FXRP (shares are
///         cFXRP); this contract is a pure *view* layer that prices that FXRP NAV in USD for
///         funders and the frontend. It holds no funds and changes no state.
///
///         FXRP is the FAssets wrapper of XRP (1:1), so XRP/USD is the correct feed. The vault
///         asset (FTestXRP) uses 6 decimals. All USD outputs are scaled to 18 decimals (wei).
///
///         The FtsoV2 reader is injected (constructor) so the flow is unit-testable with a mock;
///         on Coston2 pass `ContractRegistry.getTestFtsoV2()`.
contract CifraNavOracle {
    /// @notice FTSO feed id for XRP/USD (category 0x01 crypto + "XRP/USD" padded to 21 bytes).
    bytes21 public constant XRP_USD_FEED_ID = 0x015852502f55534400000000000000000000000000;

    /// @notice Decimals of the vault's underlying FXRP asset (FTestXRP = 6).
    uint8 public constant FXRP_DECIMALS = 6;

    IERC4626 public immutable VAULT;
    IFtsoV2Wei public immutable FTSO;

    error ZeroAddress();
    error StalePrice();

    constructor(address vault_, address ftso_) {
        if (vault_ == address(0) || ftso_ == address(0)) revert ZeroAddress();
        VAULT = IERC4626(vault_);
        FTSO = IFtsoV2Wei(ftso_);
    }

    /// @notice Current XRP/USD price, scaled to 18 decimals, with its feed timestamp.
    function xrpUsdPrice() public view returns (uint256 priceWei, uint64 timestamp) {
        (priceWei, timestamp) = FTSO.getFeedByIdInWei(XRP_USD_FEED_ID);
        if (priceWei == 0) revert StalePrice();
    }

    /// @notice Total vault NAV (idle FXRP + outstanding principal) valued in USD (18 decimals).
    function navUsd() external view returns (uint256 usdWei, uint64 timestamp) {
        (uint256 price, uint64 ts) = xrpUsdPrice();
        usdWei = _fxrpToUsd(VAULT.totalAssets(), price);
        timestamp = ts;
    }

    /// @notice USD value (18 decimals) of a given amount of vault shares.
    function sharesToUsd(uint256 shares) external view returns (uint256 usdWei, uint64 timestamp) {
        (uint256 price, uint64 ts) = xrpUsdPrice();
        usdWei = _fxrpToUsd(VAULT.convertToAssets(shares), price);
        timestamp = ts;
    }

    /// @notice USD value (18 decimals) of one whole share (10**shareDecimals).
    function pricePerShareUsd() external view returns (uint256 usdWei, uint64 timestamp) {
        (uint256 price, uint64 ts) = xrpUsdPrice();
        usdWei = _fxrpToUsd(VAULT.convertToAssets(10 ** VAULT.decimals()), price);
        timestamp = ts;
    }

    /// @dev FXRP amount (FXRP_DECIMALS) × price (1e18 per whole XRP) → USD scaled to 1e18.
    ///      usd18 = fxrpAmount * priceWei / 10**FXRP_DECIMALS.
    function _fxrpToUsd(uint256 fxrpAmount, uint256 priceWei) private pure returns (uint256) {
        return (fxrpAmount * priceWei) / (10 ** FXRP_DECIMALS);
    }
}
