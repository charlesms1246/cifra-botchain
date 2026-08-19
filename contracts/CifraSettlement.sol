// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { CifraTrancheController } from "./CifraTrancheController.sol";

/// @title CifraSettlement
/// @notice Closes a funded invoice: the buyer repays face value on-chain, or the invoice is
///         defaulted once it is past due. One instance per book, bound to that book's controller.
///
///         WHY THIS IS SO MUCH SMALLER THAN THE FLARE VERSION
///         On Flare the buyer paid XRP on the XRPL, so "did the buyer pay?" was an off-chain
///         fact. Answering it needed an FDC `Payment` attestation, Merkle proofs, a DA layer,
///         and — because the money arrived on a different chain — a pre-funded reserve here to
///         front the repayment plus off-chain reconciliation to top it back up. Proving the
///         *negative* for a default needed a second attestation type entirely
///         (`ReferencedPaymentNonexistence`).
///
///         Here the buyer pays in the book's own ERC-20, so this contract simply *observes the
///         payment itself*. There is no oracle, no proof, and no reserve: `payInvoice` pulls the
///         buyer's funds and hands them straight to the controller in one transaction, so the
///         contract holds a zero balance at rest. Default is a `block.timestamp` comparison that
///         anyone may call. Both guarantees are strictly stronger than the attested versions and
///         the machinery is ~60% smaller. See claude-docs/DECISIONS.md D5.
///
///         PAYMENT IS ALL-OR-NOTHING (v1). `payInvoice` transfers the full face amount or
///         reverts. Partial settlement would need per-invoice paid-to-date accounting here and a
///         partial-repayment path in the controller's waterfall; until that exists, silently
///         accepting a short payment would strand funds in this contract with the invoice still
///         Outstanding. Failing closed is the honest v1.
contract CifraSettlement {
    using SafeERC20 for IERC20;

    /// @notice The book this settlement belongs to. Repayment and default are recorded here.
    CifraTrancheController public immutable CONTROLLER;

    /// @notice The book's settlement asset. Read from the controller at construction so the two
    ///         can never disagree — a mismatch would be unrecoverable in a live book.
    IERC20 public immutable ASSET;

    /// @notice Days past `dueDate` before an invoice may be defaulted. Immutable: extending it
    ///         after funding would silently move funders' risk, and shortening it could default
    ///         an invoice a buyer was still entitled to pay.
    uint64 public immutable GRACE_PERIOD;

    address public owner;

    event Settled(bytes32 indexed invoiceId, address indexed payer, uint256 faceAmount);
    event Defaulted(bytes32 indexed invoiceId, address indexed caller, uint64 dueDate, uint64 gracePeriod);
    event Swept(address indexed token, address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();
    error NotOutstanding();
    error NotYetDefaultable(uint64 defaultableAt);
    error ShortPayment(uint256 expected, uint256 received);
    error NothingToSweep();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(CifraTrancheController controller_, uint64 gracePeriod_) {
        if (address(controller_) == address(0) || address(controller_).code.length == 0) revert ZeroAddress();
        CONTROLLER = controller_;
        ASSET = controller_.ASSET();
        GRACE_PERIOD = gracePeriod_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // --- Settlement ---

    /// @notice Repay a funded invoice in full and close it. Permissionless: the buyer normally
    ///         calls this, but anyone may settle on their behalf — who paid does not change who
    ///         is owed, and restricting it would only strand invoices whose buyer lost key access.
    /// @dev Caller must have approved this contract for the invoice's full face amount.
    ///      Atomic and balance-neutral: funds are pulled in and handed to the controller in the
    ///      same call, so this contract never holds settlement capital at rest.
    function payInvoice(bytes32 invoiceId) external {
        (, uint256 faceAmount, , , CifraTrancheController.FundingStatus status) = CONTROLLER.fundingOf(invoiceId);
        if (status != CifraTrancheController.FundingStatus.Outstanding) revert NotOutstanding();

        // Measure what actually arrived rather than trusting `faceAmount` to have been
        // delivered: a fee-on-transfer or rebasing asset would otherwise leave the controller's
        // pull to fail with an opaque balance error deeper in the stack.
        uint256 before = ASSET.balanceOf(address(this));
        ASSET.safeTransferFrom(msg.sender, address(this), faceAmount);
        uint256 received = ASSET.balanceOf(address(this)) - before;
        if (received < faceAmount) revert ShortPayment(faceAmount, received);

        ASSET.forceApprove(address(CONTROLLER), faceAmount);
        CONTROLLER.recordRepayment(invoiceId);

        emit Settled(invoiceId, msg.sender, faceAmount);
    }

    /// @notice Write off an invoice the buyer never paid. Permissionless and oracle-free: after
    ///         `dueDate + GRACE_PERIOD` the absence of a payment is directly observable, because
    ///         paying would have moved the invoice out of `Outstanding`.
    ///
    ///         The junior tranche absorbs the loss first; the controller enforces that waterfall.
    ///         If a buyer pays in the same block someone calls this, whichever transaction lands
    ///         first wins and the other reverts `NotOutstanding` — payment and default can never
    ///         both be recorded.
    function markDefault(bytes32 invoiceId) external {
        (, , , uint64 dueDate, CifraTrancheController.FundingStatus status) = CONTROLLER.fundingOf(invoiceId);
        if (status != CifraTrancheController.FundingStatus.Outstanding) revert NotOutstanding();

        uint64 deadline = dueDate + GRACE_PERIOD;
        if (block.timestamp <= deadline) revert NotYetDefaultable(deadline);

        CONTROLLER.recordDefault(invoiceId);

        emit Defaulted(invoiceId, msg.sender, dueDate, GRACE_PERIOD);
    }

    // --- Views (what a UI needs to render a buyer's payment screen) ---

    /// @notice Amount the buyer must approve and pay. Zero once the invoice is no longer owed.
    function amountDue(bytes32 invoiceId) external view returns (uint256) {
        (, uint256 faceAmount, , , CifraTrancheController.FundingStatus status) = CONTROLLER.fundingOf(invoiceId);
        return status == CifraTrancheController.FundingStatus.Outstanding ? faceAmount : 0;
    }

    /// @notice Timestamp from which `markDefault` will succeed. Zero if the invoice is not
    ///         outstanding (nothing to default).
    function defaultableAt(bytes32 invoiceId) external view returns (uint64) {
        (, , , uint64 dueDate, CifraTrancheController.FundingStatus status) = CONTROLLER.fundingOf(invoiceId);
        if (status != CifraTrancheController.FundingStatus.Outstanding) return 0;
        return dueDate + GRACE_PERIOD;
    }

    /// @notice Whether `markDefault` would succeed right now.
    function isDefaultable(bytes32 invoiceId) external view returns (bool) {
        (, , , uint64 dueDate, CifraTrancheController.FundingStatus status) = CONTROLLER.fundingOf(invoiceId);
        return status == CifraTrancheController.FundingStatus.Outstanding && block.timestamp > dueDate + GRACE_PERIOD;
    }

    // --- Admin ---

    /// @notice Recover tokens sent here by mistake. Settlement is atomic, so this contract holds
    ///         no balance at rest and anything resting here is by definition unaccounted — most
    ///         likely a buyer who transferred the asset directly instead of calling `payInvoice`.
    ///         Owner-gated (the governance Safe) because the rightful recipient is off-chain.
    function sweep(address token, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) revert NothingToSweep();
        IERC20(token).safeTransfer(to, bal);
        emit Swept(token, to, bal);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
