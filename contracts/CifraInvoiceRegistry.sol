// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title CifraInvoiceRegistry
/// @notice On-chain registry of factored invoices. Records only the facts needed
///         to fund and settle an invoice — never the buyer's identity or financials,
///         which stay private inside the TEE. The buyer is represented on-chain by
///         an opaque `buyerCommitment` (a hash), so nothing here deanonymizes them.
///
///         This contract is intentionally minimal: registration, dedupe, and
///         authorized status transitions. Scoring lives in the TEE extension; the
///         signed grade is held by CifraAttestationNFT; funding by CifraVault;
///         closing by CifraSettlement. Those contracts drive the status transitions
///         through the authorized-updater hook.
contract CifraInvoiceRegistry {
    /// @notice Lifecycle of a factored invoice.
    enum Status {
        None, // 0 — never registered (default for unknown ids)
        Registered, // 1 — recorded, awaiting funding
        Funded, // 2 — a funder has advanced FXRP to the supplier
        Settled, // 3 — buyer paid; funders repaid
        Defaulted // 4 — due date + grace passed without payment
    }

    struct Invoice {
        address supplier; // who registered / receives the advance
        bytes32 buyerCommitment; // opaque hash of buyer identity — private
        uint256 faceAmount; // face value in FXRP smallest units
        uint64 dueDate; // unix timestamp the buyer must pay by
        Status status;
    }

    /// @notice invoiceId => Invoice. invoiceId is deterministic (see registerInvoice) so
    ///         the same invoice cannot be registered twice.
    mapping(bytes32 => Invoice) private _invoices;

    /// @notice The owner may authorize contracts (vault, settlement) to advance status.
    address public owner;

    /// @notice Addresses allowed to call setStatus (e.g. CifraVault, CifraSettlement).
    mapping(address => bool) public isStatusUpdater;

    event InvoiceRegistered(
        bytes32 indexed invoiceId,
        address indexed supplier,
        bytes32 indexed buyerCommitment,
        uint256 faceAmount,
        uint64 dueDate
    );
    event StatusChanged(bytes32 indexed invoiceId, Status previousStatus, Status newStatus);
    event StatusUpdaterSet(address indexed updater, bool allowed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotStatusUpdater();
    error AlreadyRegistered();
    error InvalidAmount();
    error DueDateInPast();
    error UnknownInvoice();
    error InvalidStatusTransition(Status from, Status to);
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Register a new invoice. The id is derived from the invoice's fields plus
    ///         a caller-supplied `ref`, so re-registering identical data reverts (dedupe).
    /// @param buyerCommitment Opaque hash of the buyer's identity (kept private off-chain).
    /// @param faceAmount Face value in FXRP smallest units. Must be > 0.
    /// @param dueDate Unix timestamp by which the buyer must pay. Must be in the future.
    /// @param ref Caller-chosen salt/reference (e.g. invoice number hash) that distinguishes
    ///        otherwise-identical invoices and lets the supplier control the id.
    /// @return invoiceId The deterministic id assigned to this invoice.
    function registerInvoice(
        bytes32 buyerCommitment,
        uint256 faceAmount,
        uint64 dueDate,
        bytes32 ref
    ) external returns (bytes32 invoiceId) {
        if (faceAmount == 0) revert InvalidAmount();
        if (dueDate <= block.timestamp) revert DueDateInPast();

        invoiceId = keccak256(abi.encode(msg.sender, buyerCommitment, faceAmount, dueDate, ref));
        if (_invoices[invoiceId].status != Status.None) revert AlreadyRegistered();

        _invoices[invoiceId] = Invoice({
            supplier: msg.sender,
            buyerCommitment: buyerCommitment,
            faceAmount: faceAmount,
            dueDate: dueDate,
            status: Status.Registered
        });

        emit InvoiceRegistered(invoiceId, msg.sender, buyerCommitment, faceAmount, dueDate);
    }

    /// @notice Advance an invoice's status. Callable only by authorized updaters
    ///         (the vault and settlement contracts). Enforces the legal transition graph.
    function setStatus(bytes32 invoiceId, Status newStatus) external {
        if (!isStatusUpdater[msg.sender]) revert NotStatusUpdater();

        Invoice storage inv = _invoices[invoiceId];
        Status current = inv.status;
        if (current == Status.None) revert UnknownInvoice();
        if (!_isValidTransition(current, newStatus)) revert InvalidStatusTransition(current, newStatus);

        inv.status = newStatus;
        emit StatusChanged(invoiceId, current, newStatus);
    }

    /// @notice Read an invoice. Reverts if it was never registered.
    function getInvoice(bytes32 invoiceId) external view returns (Invoice memory) {
        Invoice memory inv = _invoices[invoiceId];
        if (inv.status == Status.None) revert UnknownInvoice();
        return inv;
    }

    /// @notice Whether an invoice id has been registered.
    function exists(bytes32 invoiceId) external view returns (bool) {
        return _invoices[invoiceId].status != Status.None;
    }

    /// @notice Preview the id that registerInvoice would assign for these fields.
    function computeInvoiceId(
        address supplier,
        bytes32 buyerCommitment,
        uint256 faceAmount,
        uint64 dueDate,
        bytes32 ref
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(supplier, buyerCommitment, faceAmount, dueDate, ref));
    }

    // --- Admin ---

    function setStatusUpdater(address updater, bool allowed) external onlyOwner {
        if (updater == address(0)) revert ZeroAddress();
        isStatusUpdater[updater] = allowed;
        emit StatusUpdaterSet(updater, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // --- Internal ---

    /// @dev Allowed transitions: Registered→Funded, Registered→Defaulted,
    ///      Funded→Settled, Funded→Defaulted. Terminal states (Settled/Defaulted)
    ///      cannot change. This mirrors the invoice lifecycle in CLAUDE.md.
    function _isValidTransition(Status from, Status to) private pure returns (bool) {
        if (from == Status.Registered) {
            return to == Status.Funded || to == Status.Defaulted;
        }
        if (from == Status.Funded) {
            return to == Status.Settled || to == Status.Defaulted;
        }
        return false;
    }
}
