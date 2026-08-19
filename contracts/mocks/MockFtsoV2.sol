// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Test-only FTSO stub: returns a settable 18-decimal price + timestamp.
contract MockFtsoV2 {
    uint256 public value;
    uint64 public ts;

    function set(uint256 _value, uint64 _ts) external {
        value = _value;
        ts = _ts;
    }

    function getFeedByIdInWei(bytes21) external view returns (uint256, uint64) {
        return (value, ts);
    }
}
