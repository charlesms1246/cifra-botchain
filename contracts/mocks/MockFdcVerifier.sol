// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IPayment } from "@flarenetwork/flare-periphery-contracts/coston2/IPayment.sol";
import { IPaymentVerification } from "@flarenetwork/flare-periphery-contracts/coston2/IPaymentVerification.sol";
import { IReferencedPaymentNonexistence } from "@flarenetwork/flare-periphery-contracts/coston2/IReferencedPaymentNonexistence.sol";
import { IReferencedPaymentNonexistenceVerification } from "@flarenetwork/flare-periphery-contracts/coston2/IReferencedPaymentNonexistenceVerification.sol";

/// @title MockFdcVerifier
/// @notice Test-only stand-in for Flare's FDC verification contract. Returns a settable
///         verdict for both Payment and ReferencedPaymentNonexistence proofs, letting the
///         settlement tests exercise the real IPayment/IReferencedPaymentNonexistence structs
///         and the settlement contract's business logic without a live Merkle root.
///         On Coston2 the real verifier (resolved via ContractRegistry) replaces this.
contract MockFdcVerifier is IPaymentVerification, IReferencedPaymentNonexistenceVerification {
    bool public paymentValid = true;
    bool public nonexistenceValid = true;

    function setPaymentValid(bool v) external {
        paymentValid = v;
    }

    function setNonexistenceValid(bool v) external {
        nonexistenceValid = v;
    }

    function verifyPayment(IPayment.Proof calldata) external view returns (bool) {
        return paymentValid;
    }

    function verifyReferencedPaymentNonexistence(
        IReferencedPaymentNonexistence.Proof calldata
    ) external view returns (bool) {
        return nonexistenceValid;
    }
}
