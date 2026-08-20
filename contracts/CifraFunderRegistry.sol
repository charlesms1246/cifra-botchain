// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title CifraFunderRegistry
/// @notice The allowlist of addresses permitted to hold tranche shares.
///
///         WHY THIS EXISTS. Senior and junior tranches allocate losses by seniority and pay a
///         return derived from the protocol's own origination and servicing. In most
///         jurisdictions that is structured credit sold to passive investors — plausibly a
///         security. A permissionless ERC-4626 cannot express "professional investors only", so
///         restricting participation has to be a contract, not a sentence in a policy document.
///         See docs/REGULATORY_POSTURE.md §3.
///
///         DELIBERATE ASYMMETRY: getting IN is gated, getting OUT never is.
///         `CifraTrancheVault` checks this registry on deposit and on share transfer, but NOT on
///         withdrawal. Someone removed from the list — a failed re-screen, a sanctions hit —
///         must still be able to redeem their own capital. A compliance control that can trap
///         funds is a worse problem than the one it solves.
///
///         Verification itself happens off-chain with a KYC/KYB provider; only the outcome is
///         written here. No identity document ever touches the chain, which keeps the
///         allowlist auditable without undoing the product's privacy thesis.
contract CifraFunderRegistry {
    /// @notice When false the registry allows everyone, and the vaults behave exactly as an
    ///         ordinary ERC-4626. Intended for testnet and for a permissionless launch; flip it
    ///         on before onboarding capital that needs to be restricted.
    bool public restricted;

    /// @notice Addresses cleared to hold tranche shares.
    mapping(address => bool) public isAllowed;

    address public owner;

    /// @notice Permitted to add and remove funders without an owner (Safe) signature, so a
    ///         KYC provider's automation can keep the list current. It CANNOT flip `restricted`
    ///         or change ownership — the policy switch stays with governance.
    address public manager;

    event FunderSet(address indexed funder, bool allowed);
    event RestrictedSet(bool restricted);
    event ManagerUpdated(address indexed previousManager, address indexed newManager);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotManager();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev The owner is always a manager, so governance can act without a separate keeper.
    modifier onlyManager() {
        if (msg.sender != manager && msg.sender != owner) revert NotManager();
        _;
    }

    constructor(bool restricted_) {
        owner = msg.sender;
        manager = msg.sender;
        restricted = restricted_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit ManagerUpdated(address(0), msg.sender);
        emit RestrictedSet(restricted_);
    }

    /// @notice Whether `account` may receive tranche shares. Always true while unrestricted.
    function canHold(address account) external view returns (bool) {
        return !restricted || isAllowed[account];
    }

    // --- Manager ---

    function setFunder(address funder, bool allowed) public onlyManager {
        if (funder == address(0)) revert ZeroAddress();
        isAllowed[funder] = allowed;
        emit FunderSet(funder, allowed);
    }

    /// @notice Batch form — onboarding tends to arrive in batches, and one transaction per
    ///         funder through a multi-sig is a real operational tax.
    function setFunders(address[] calldata funders, bool allowed) external onlyManager {
        for (uint256 i = 0; i < funders.length; ++i) setFunder(funders[i], allowed);
    }

    // --- Owner (governance) ---

    /// @notice Turn the restriction on or off. Owner-only: this is the policy decision, and it
    ///         is deliberately not delegated to the operational manager key.
    function setRestricted(bool restricted_) external onlyOwner {
        restricted = restricted_;
        emit RestrictedSet(restricted_);
    }

    function setManager(address newManager) external onlyOwner {
        if (newManager == address(0)) revert ZeroAddress();
        emit ManagerUpdated(manager, newManager);
        manager = newManager;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
