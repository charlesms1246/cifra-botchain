// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IPayment } from "@flarenetwork/flare-periphery-contracts/coston2/IPayment.sol";
import { IPaymentVerification } from "@flarenetwork/flare-periphery-contracts/coston2/IPaymentVerification.sol";
import { IReferencedPaymentNonexistence } from "@flarenetwork/flare-periphery-contracts/coston2/IReferencedPaymentNonexistence.sol";
import { IReferencedPaymentNonexistenceVerification } from "@flarenetwork/flare-periphery-contracts/coston2/IReferencedPaymentNonexistenceVerification.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { CifraInvoiceRegistry } from "./CifraInvoiceRegistry.sol";
import { CifraTrancheController } from "./CifraTrancheController.sol";

/// @title CifraSettlement
/// @notice Closes invoices from FDC attestations. A buyer's on-chain-verifiable payment
///         (`Payment` proof, referenced by the invoiceId) settles the invoice and repays
///         the vault; a `ReferencedPaymentNonexistence` proof after the due date + grace
///         defaults it. Verification uses the real FDC interfaces; the buyer's XRPL payment
///         is tied to the invoice through the standard payment reference == invoiceId.
///
///         The FDC verifier is injected so the flow is unit-testable with a mock; on Coston2
///         it is the address resolved from `ContractRegistry.getFdcVerification()`.
///
///         Units/funding assumptions (demo, disclosed):
///         - FXRP is 1:1 with XRP and both use 6 decimals, so a Payment `receivedAmount`
///           (XRP drops) compares directly against the invoice `faceAmount` (FXRP minimal units).
///
///         RESERVE MODEL (production note, audit finding M3): settlement is a *reserve*, not a
///         pass-through. The buyer pays XRP to the protocol's XRPL receiving address (off-chain);
///         `settle()` forwards `faceAmount` FXRP that THIS contract already holds to the vault to
///         repay funders. The buyer's XRP and the forwarded FXRP are therefore distinct: the
///         protocol fronts FXRP from a reserve held here and separately reconciles the received
///         XRP (converting XRP→FXRP via the FAssets direct-minting flow to replenish the reserve).
///         Consequently this contract MUST be funded with an FXRP reserve >= the invoice face
///         value at settle time. The reserve is now explicit + auditable: `reserveBalance()`,
///         `fundReserve()`/`withdrawReserve()` (evented; withdraw is Safe-governed), and `settle()`
///         reverts `InsufficientReserve(have, need)` up front instead of an opaque transferFrom
///         failure. Replenishment is a first-class on-chain action — the protocol direct-mints
///         received buyer XRP into FXRP (FAssets direct minting, see scripts/directMint.ts) and
///         calls `fundReserve`. Remaining v2: fold that direct-mint into a single buyer payment
///         bound to the invoice (blocked partly by IXRPPayment not being in the periphery package).
contract CifraSettlement {
    using SafeERC20 for IERC20;

    uint8 private constant PAYMENT_SUCCESS = 0;

    CifraInvoiceRegistry public immutable REGISTRY;
    CifraTrancheController public immutable CONTROLLER;
    IERC20 public immutable FXRP;
    IPaymentVerification public immutable PAYMENT_VERIFIER;
    IReferencedPaymentNonexistenceVerification public immutable NONEXISTENCE_VERIFIER;

    /// @notice Standard address hash of the protocol's XRPL receiving address (where buyers pay).
    ///         Owner-settable so the protocol can rotate its XRPL receiver without redeploying
    ///         and re-wiring the vault. Changing it only affects which future payments settle —
    ///         it cannot move funds out of this contract or the vault, so it is safe to govern.
    bytes32 public protocolReceiverHash;

    /// @notice Grace period after an invoice's due date before it can be defaulted.
    uint64 public immutable GRACE_PERIOD;

    address public owner;

    event Settled(bytes32 indexed invoiceId, uint256 faceAmount, bytes32 paymentReference);
    event Defaulted(bytes32 indexed invoiceId, uint64 deadlineTimestamp);
    event ProtocolReceiverHashUpdated(bytes32 indexed previousHash, bytes32 indexed newHash);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ReserveFunded(address indexed from, uint256 amount, uint256 newBalance);
    event ReserveWithdrawn(address indexed to, uint256 amount, uint256 newBalance);

    error NotOwner();
    error ZeroAddress();
    error UnknownInvoice();
    error InvoiceNotFunded();
    error InvalidProof();
    error PaymentNotSuccessful();
    error WrongPaymentReference();
    error WrongReceiver();
    error Underpaid();
    error WrongAmount();
    error DeadlineBeforeGrace();
    error InsufficientReserve(uint256 have, uint256 need);

    constructor(
        CifraInvoiceRegistry registry_,
        CifraTrancheController controller_,
        IERC20 fxrp_,
        address fdcVerifier_,
        bytes32 protocolReceiverHash_,
        uint64 gracePeriod_
    ) {
        REGISTRY = registry_;
        CONTROLLER = controller_;
        FXRP = fxrp_;
        PAYMENT_VERIFIER = IPaymentVerification(fdcVerifier_);
        NONEXISTENCE_VERIFIER = IReferencedPaymentNonexistenceVerification(fdcVerifier_);
        protocolReceiverHash = protocolReceiverHash_;
        GRACE_PERIOD = gracePeriod_;
        owner = msg.sender;
        emit ProtocolReceiverHashUpdated(bytes32(0), protocolReceiverHash_);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Settle a funded invoice from a verified buyer payment. Forwards `faceAmount`
    ///         FXRP (held by this contract) to the vault and closes the invoice.
    function settle(bytes32 invoiceId, IPayment.Proof calldata proof) external {
        CifraInvoiceRegistry.Invoice memory inv = _fundedInvoice(invoiceId);

        if (!PAYMENT_VERIFIER.verifyPayment(proof)) revert InvalidProof();

        IPayment.ResponseBody calldata rb = proof.data.responseBody;
        if (rb.status != PAYMENT_SUCCESS) revert PaymentNotSuccessful();
        if (rb.standardPaymentReference != invoiceId) revert WrongPaymentReference();
        if (rb.receivingAddressHash != protocolReceiverHash) revert WrongReceiver();
        if (rb.receivedAmount < int256(inv.faceAmount)) revert Underpaid();

        // The reserve must hold enough FXRP to front the repayment (see RESERVE MODEL above).
        // Fail with an explicit shortfall rather than an opaque transferFrom revert.
        uint256 reserve = FXRP.balanceOf(address(this));
        if (reserve < inv.faceAmount) revert InsufficientReserve(reserve, inv.faceAmount);

        FXRP.forceApprove(address(CONTROLLER), inv.faceAmount);
        CONTROLLER.recordRepayment(invoiceId);

        emit Settled(invoiceId, inv.faceAmount, rb.standardPaymentReference);
    }

    /// @notice Default a funded invoice from a verified non-payment over a window that
    ///         extends past the due date + grace period.
    function markDefault(bytes32 invoiceId, IReferencedPaymentNonexistence.Proof calldata proof) external {
        CifraInvoiceRegistry.Invoice memory inv = _fundedInvoice(invoiceId);

        if (!NONEXISTENCE_VERIFIER.verifyReferencedPaymentNonexistence(proof)) revert InvalidProof();

        IReferencedPaymentNonexistence.RequestBody calldata req = proof.data.requestBody;
        if (req.standardPaymentReference != invoiceId) revert WrongPaymentReference();
        if (req.destinationAddressHash != protocolReceiverHash) revert WrongReceiver();
        if (req.amount < inv.faceAmount) revert WrongAmount();
        // The non-payment window must reach past the due date + grace, otherwise the buyer
        // might still have paid within the allowed period.
        if (req.deadlineTimestamp < inv.dueDate + GRACE_PERIOD) revert DeadlineBeforeGrace();

        CONTROLLER.recordDefault(invoiceId);

        emit Defaulted(invoiceId, req.deadlineTimestamp);
    }

    // --- Reserve (audit finding M3) ---

    /// @notice FXRP the settlement holds to front repayments. `settle()` requires this be
    ///         >= the invoice face value (else `InsufficientReserve`). Made explicit + evented
    ///         so the fronting is auditable on-chain rather than an implicit balance.
    function reserveBalance() external view returns (uint256) {
        return FXRP.balanceOf(address(this));
    }

    /// @notice Top up the reserve. First-class + evented so replenishment (e.g. after the
    ///         protocol direct-mints received buyer XRP into FXRP) is a tracked on-chain action.
    ///         Caller must have approved `amount` FXRP to this contract.
    function fundReserve(uint256 amount) external {
        FXRP.safeTransferFrom(msg.sender, address(this), amount);
        emit ReserveFunded(msg.sender, amount, FXRP.balanceOf(address(this)));
    }

    /// @notice Withdraw surplus reserve to `to`. Owner-gated (the governance Safe) so excess
    ///         FXRP can be recovered without touching funder capital in the vault.
    function withdrawReserve(uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        FXRP.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount, FXRP.balanceOf(address(this)));
    }

    // --- Admin ---

    /// @notice Rotate the protocol's XRPL receiving-address hash (audit finding L2).
    function setProtocolReceiverHash(bytes32 newHash) external onlyOwner {
        emit ProtocolReceiverHashUpdated(protocolReceiverHash, newHash);
        protocolReceiverHash = newHash;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _fundedInvoice(bytes32 invoiceId) private view returns (CifraInvoiceRegistry.Invoice memory inv) {
        if (!REGISTRY.exists(invoiceId)) revert UnknownInvoice();
        inv = REGISTRY.getInvoice(invoiceId);
        if (inv.status != CifraInvoiceRegistry.Status.Funded) revert InvoiceNotFunded();
    }
}
