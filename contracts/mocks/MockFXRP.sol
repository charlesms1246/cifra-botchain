// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockFXRP
/// @notice Test-only ERC-20 standing in for FXRP (6 decimals, freely mintable).
///         Not deployed to any live network — used solely by the Hardhat test suite.
contract MockFXRP is ERC20 {
    constructor() ERC20("Mock FXRP", "FXRP") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
