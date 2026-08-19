// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @dev Minimal reader for a Uniswap-V3-style pool (BOT Chain's BDEX is a V3 fork).
///      Only the views needed for a time-weighted price are declared.
interface IUniswapV3PoolLike {
    /// @notice Cumulative tick values at each `secondsAgos[i]` before the current block.
    function observe(
        uint32[] calldata secondsAgos
    ) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function token0() external view returns (address);

    function token1() external view returns (address);
}

/// @title CifraNavOracle
/// @notice Read-only valuation helper for one Cifra book's tranche vault. Reports the vault's
///         NAV in its own asset units, plus a time-weighted mean tick from a DEX pool so a
///         caller can express that NAV in a quote asset (e.g. BOT -> USDT).
///
///         DISPLAY ONLY — THIS IS LOAD-BEARING, NOT A DISCLAIMER.
///         Nothing in Cifra's economics consults this contract. Each book is denominated in a
///         single asset and an invoice is faced, funded and repaid in that same asset, so no
///         funding, settlement, default or withdrawal path ever needs a price. This oracle
///         exists so a dashboard can print "$X". A manipulated reading is therefore a wrong
///         number on a screen for a few blocks — not an exploit. It must stay that way: do not
///         wire this into `CifraTrancheController` or `CifraSettlement`.
///         See claude-docs/DECISIONS.md D3.2/D3.3.
///
///         The USDT book does not deploy this at all — NAV in USDT is already the USD figure.
///
///         WHY NO ON-CHAIN PRICE MATH. Converting a tick to a price needs Uniswap's `TickMath`,
///         which is GPL-2.0-or-later and would infect this MIT codebase. Since the result is
///         only ever displayed, this contract returns the raw mean tick plus the decimals needed
///         to interpret it, and the frontend computes `1.0001 ** tick` in TypeScript. That keeps
///         the licence clean and drops ~150 lines of vendored bit-magic for zero loss of
///         function.
contract CifraNavOracle {
    /// @notice The tranche vault being valued.
    IERC4626 public immutable VAULT;

    /// @notice DEX pool quoting the vault asset against `QUOTE_TOKEN`.
    IUniswapV3PoolLike public immutable POOL;

    /// @notice TWAP window in seconds. Deliberately long: a wide window costs nothing for a
    ///         number that is never economically load-bearing, and makes moving it dear.
    uint32 public immutable TWAP_WINDOW;

    /// @notice The vault's underlying asset (the token NAV is denominated in).
    address public immutable BASE_TOKEN;
    /// @notice The token NAV is *quoted* into for display (the pool's other side).
    address public immutable QUOTE_TOKEN;

    /// @notice True when `BASE_TOKEN` is the pool's token0. Ticks are always token1-per-token0,
    ///         so the caller must invert the derived price when this is false.
    bool public immutable BASE_IS_TOKEN0;

    uint8 public immutable BASE_DECIMALS;
    uint8 public immutable QUOTE_DECIMALS;

    error ZeroAddress();
    error ZeroWindow();
    error AssetNotInPool();

    constructor(address vault_, address pool_, uint32 twapWindow_) {
        if (vault_ == address(0) || pool_ == address(0)) revert ZeroAddress();
        if (twapWindow_ == 0) revert ZeroWindow();

        VAULT = IERC4626(vault_);
        POOL = IUniswapV3PoolLike(pool_);
        TWAP_WINDOW = twapWindow_;

        address base = IERC4626(vault_).asset();
        address t0 = IUniswapV3PoolLike(pool_).token0();
        address t1 = IUniswapV3PoolLike(pool_).token1();

        // Fail at deploy rather than silently reporting a price for the wrong pair.
        if (base != t0 && base != t1) revert AssetNotInPool();

        BASE_TOKEN = base;
        BASE_IS_TOKEN0 = (base == t0);
        QUOTE_TOKEN = (base == t0) ? t1 : t0;
        BASE_DECIMALS = IERC20Metadata(base).decimals();
        QUOTE_DECIMALS = IERC20Metadata((base == t0) ? t1 : t0).decimals();
    }

    // --- NAV, in the book's own asset (no oracle involved) ---

    /// @notice The tranche's NAV in asset units. This is the honest, oracle-free figure and is
    ///         what the protocol itself uses everywhere.
    function navAssets() public view returns (uint256) {
        return VAULT.totalAssets();
    }

    /// @notice Assets backing one whole share, in asset units. Zero-supply safe.
    function pricePerShareAssets() public view returns (uint256) {
        return VAULT.convertToAssets(10 ** VAULT.decimals());
    }

    // --- TWAP inputs (interpreted by the caller) ---

    /// @notice Arithmetic-mean tick over `secondsAgo`, per Uniswap's TWAP definition.
    /// @dev Reverts inside the pool ("OLD") if the window predates its oldest observation;
    ///      use `meanTickSafe` when that must not bubble up.
    function meanTick(uint32 secondsAgo) public view returns (int24) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = secondsAgo;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives, ) = POOL.observe(secondsAgos);
        int56 delta = tickCumulatives[1] - tickCumulatives[0];

        int24 tick = int24(delta / int56(uint56(secondsAgo)));
        // Solidity truncates toward zero; Uniswap defines the mean tick as rounded toward
        // negative infinity, so a negative delta with a remainder must step down one tick.
        if (delta < 0 && (delta % int56(uint56(secondsAgo)) != 0)) tick--;
        return tick;
    }

    /// @notice `meanTick(TWAP_WINDOW)`, never reverting. `ok == false` means the pool lacks
    ///         enough observation history for the window and the tick must not be trusted.
    function meanTickSafe() public view returns (int24 tick, bool ok) {
        try this.meanTick(TWAP_WINDOW) returns (int24 t) {
            return (t, true);
        } catch {
            return (0, false);
        }
    }

    /// @notice Current pool tick from `slot0` — spot, trivially manipulable within a block.
    ///         Exposed only so a UI can show how far spot has drifted from the TWAP.
    function spotTick() external view returns (int24 tick) {
        (, tick, , , , , ) = POOL.slot0();
    }

    /// @notice Everything a caller needs to render NAV in the quote asset, in one call.
    /// @return nav Vault NAV in base-asset units.
    /// @return sharePrice Assets per whole share, in base-asset units.
    /// @return tick TWAP mean tick over `TWAP_WINDOW` (token1 per token0).
    /// @return tickOk False if the pool lacks history for the window — ignore `tick`.
    /// @return baseIsToken0 Invert the tick-derived price when false.
    /// @return baseDecimals Decimals of the base (vault) asset.
    /// @return quoteDecimals Decimals of the quote asset.
    function quote()
        external
        view
        returns (
            uint256 nav,
            uint256 sharePrice,
            int24 tick,
            bool tickOk,
            bool baseIsToken0,
            uint8 baseDecimals,
            uint8 quoteDecimals
        )
    {
        (tick, tickOk) = meanTickSafe();
        return (navAssets(), pricePerShareAssets(), tick, tickOk, BASE_IS_TOKEN0, BASE_DECIMALS, QUOTE_DECIMALS);
    }
}
