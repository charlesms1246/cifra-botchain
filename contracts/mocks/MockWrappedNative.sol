// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockWrappedNative
/// @notice Test-only WETH9-surface wrapper (18 decimals) standing in for WBOT, so
///         `CifraNativeDepositHelper` can be exercised without a live network.
///         Deliberately omits WETH9's bare-transfer `receive()`: the helper always calls
///         `deposit()` explicitly, so that path would be untested surface.
///         Not deployed to any live network.
contract MockWrappedNative is ERC20 {
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    constructor() ERC20("Mock Wrapped BOT", "WBOT") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) external {
        _burn(msg.sender, wad);
        (bool ok, ) = msg.sender.call{value: wad}("");
        require(ok, "native transfer failed");
        emit Withdrawal(msg.sender, wad);
    }
}
