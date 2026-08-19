// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IWeb2Json } from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";

/// @notice Test-only Web2Json verifier: returns a settable validity.
contract MockWeb2JsonVerifier {
    bool public valid = true;

    function setValid(bool _valid) external {
        valid = _valid;
    }

    function verifyWeb2Json(IWeb2Json.Proof calldata) external view returns (bool) {
        return valid;
    }
}
