// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title MockV3Pool
/// @notice Test-only Uniswap-V3-style pool stub exposing just the surface `CifraNavOracle`
///         reads: `token0`/`token1`, `slot0` and `observe`. Ticks accumulate linearly from a
///         settable mean tick, which is exactly what the TWAP arithmetic expects.
///         Set `historySeconds` to make `observe` revert for windows the pool is too young
///         for — the "OLD" case a real pool raises and `meanTickSafe` must swallow.
///         Not deployed to any live network.
contract MockV3Pool {
    address public token0;
    address public token1;

    int24 public meanTick;
    int24 public currentTick;
    uint32 public historySeconds = type(uint32).max;

    /// @dev When non-zero, `observe` returns a cumulative delta of exactly this value instead
    ///      of `meanTick * window`. Real pools rarely produce a delta that divides evenly by the
    ///      window, and the remainder is what forces Uniswap's round-toward-negative-infinity
    ///      rule. Without this the rounding branch in CifraNavOracle.meanTick is unreachable.
    int56 public forcedCumulativeDelta;
    bool public useForcedDelta;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function setTicks(int24 meanTick_, int24 currentTick_) external {
        meanTick = meanTick_;
        currentTick = currentTick_;
    }

    function setHistorySeconds(uint32 seconds_) external {
        historySeconds = seconds_;
    }

    /// @notice Force `observe` to report an exact cumulative delta (see `forcedCumulativeDelta`).
    function setForcedCumulativeDelta(int56 delta) external {
        forcedCumulativeDelta = delta;
        useForcedDelta = true;
    }

    function slot0()
        external
        view
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (0, currentTick, 0, 1024, 1024, 0, true);
    }

    /// @dev Cumulative tick grows by `meanTick` per second, so
    ///      (cum[now] - cum[t-ago]) / ago == meanTick.
    function observe(
        uint32[] calldata secondsAgos
    )
        external
        view
        returns (
            int56[] memory tickCumulatives,
            uint160[] memory secondsPerLiquidityCumulativeX128s
        )
    {
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);

        for (uint256 i = 0; i < secondsAgos.length; i++) {
            require(secondsAgos[i] <= historySeconds, "OLD");
            if (useForcedDelta) {
                // index 0 is the older observation, index 1 is "now": now - old == delta.
                tickCumulatives[i] = secondsAgos[i] == 0
                    ? forcedCumulativeDelta
                    : int56(0);
            } else {
                // Anchor at an arbitrary base so cumulatives are positive for typical ticks;
                // only the delta matters.
                int56 elapsed = int56(
                    uint56(
                        historySeconds == type(uint32).max
                            ? 1e6
                            : historySeconds
                    )
                ) - int56(uint56(secondsAgos[i]));
                tickCumulatives[i] = int56(meanTick) * elapsed;
            }
        }
    }
}
