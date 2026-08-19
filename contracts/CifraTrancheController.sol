// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { CifraInvoiceRegistry } from "./CifraInvoiceRegistry.sol";
import { CifraAttestationNFT } from "./CifraAttestationNFT.sol";

/// @title CifraTrancheController
/// @notice The funding engine for a senior/junior tranche structure over ONE settlement asset.
///         This contract holds all pooled assets and runs the funding + repayment/default
///         waterfall; two thin ERC-4626 `CifraTrancheVault` share classes (senior + junior) sit
///         in front of it and report `totalAssets() == claimOf(vault)`. NAV is split across two
///         claims with a waterfall:
///
///           - REPAYMENT (yield = face − principal): senior takes `seniorYieldShareBps` of the
///             yield, junior takes the residual (its reward for taking first loss).
///           - DEFAULT (loss = principal): junior's claim absorbs the loss first, down to zero,
///             and only the overflow reduces senior's claim (subordination).
///
///         NAV accounting invariant (`NAV = idle assets + outstanding principal`):
///
///           ASSET.balanceOf(this) + totalDeployed  ==  assetsOf[senior] + assetsOf[junior]
///
///         Funding moves assets out of the pool into `totalDeployed` (NAV flat); repayment moves
///         them back plus yield; default removes them. The tranche vaults are the only callers
///         permitted to move the per-tranche claims via deposits/withdrawals.
///
///         SINGLE-ASSET BY DESIGN. `ASSET` is immutable and nothing here ever converts between
///         assets: an invoice is faced, funded and repaid in the same token. Cifra runs one
///         instance of this stack per settlement asset (a "book"). That is what keeps FX risk
///         out of the loan book entirely — a funder who deposits a volatile asset has chosen
///         that exposure, and no price oracle is consulted on any path where money moves.
///         See claude-docs/DECISIONS.md D3.2.
contract CifraTrancheController is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    enum FundingStatus {
        None, // 0
        Outstanding, // 1 — advanced, awaiting settlement
        Settled, // 2 — repaid in full
        Defaulted // 3 — written off
    }

    struct Funding {
        address supplier;
        uint256 faceAmount; // repayment expected at settlement
        uint256 principal; // assets advanced now (carrying value while Outstanding)
        uint64 dueDate;
        FundingStatus status;
    }

    uint256 private constant BPS = 10000;

    /// @notice The single settlement asset of this book (USDT, or WBOT for the native book).
    IERC20 public immutable ASSET;
    CifraInvoiceRegistry public immutable REGISTRY;
    CifraAttestationNFT public immutable ATTESTATION;

    /// @notice The two tranche share-class vaults. Senior is protected + lower-yield; junior is
    ///         first-loss + higher-yield. Set once by the owner after the vaults are deployed.
    address public seniorVault;
    address public juniorVault;

    /// @notice Per-tranche waterfall claim on NAV (in ASSET units). `assetsOf[vault]` is exactly
    ///         the value that tranche's `totalAssets()` returns, so its share price = claim/shares.
    mapping(address => uint256) public assetsOf;

    /// @notice Senior's share of each invoice's realized yield, in bps. Junior keeps the rest.
    uint256 public seniorYieldShareBps = 5000; // 50/50 default

    /// @notice Sum of principal on Outstanding fundings — the deployed (non-idle) NAV.
    uint256 public totalDeployed;

    mapping(bytes32 => Funding) public fundingOf;

    address public owner;
    /// @notice Address permitted to deploy capital (fundInvoice) — a keeper/EOA.
    address public operator;
    /// @notice CifraSettlement contract, permitted to record repayment/default.
    address public settlement;

    event TrancheVaultsSet(address indexed seniorVault, address indexed juniorVault);
    event SeniorYieldShareUpdated(uint256 previousBps, uint256 newBps);
    event Deposited(address indexed tranche, uint256 assets);
    event Withdrawn(address indexed tranche, address indexed receiver, uint256 assets);
    event Funded(bytes32 indexed invoiceId, address indexed supplier, uint256 principal, uint256 faceAmount);
    event Repaid(bytes32 indexed invoiceId, uint256 faceAmount, uint256 seniorYield, uint256 juniorYield);
    event Defaulted(bytes32 indexed invoiceId, uint256 juniorLoss, uint256 seniorLoss);
    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    event SettlementUpdated(address indexed previousSettlement, address indexed newSettlement);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotOperator();
    error NotSettler();
    error NotTranche();
    error ZeroAddress();
    error AlreadySet();
    error ShareOutOfRange();
    error NotRegistered();
    error NotAttested();
    error InvoiceNotFundable();
    error AlreadyFunded();
    error NotOutstanding();
    error InsufficientLiquidity();
    error NotYetDue();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }
    /// @dev Repayment/default may be recorded by the settlement contract or the operator.
    modifier onlySettler() {
        if (msg.sender != settlement && msg.sender != operator) revert NotSettler();
        _;
    }
    modifier onlyTranche() {
        if (msg.sender != seniorVault && msg.sender != juniorVault) revert NotTranche();
        _;
    }

    constructor(IERC20 asset_, CifraInvoiceRegistry registry_, CifraAttestationNFT attestation_) {
        if (address(asset_) == address(0) || address(registry_) == address(0) || address(attestation_) == address(0))
            revert ZeroAddress();
        ASSET = asset_;
        REGISTRY = registry_;
        ATTESTATION = attestation_;
        owner = msg.sender;
        operator = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        emit OperatorUpdated(address(0), msg.sender);
    }

    // --- Tranche vault hooks (only the two registered vaults) ---

    /// @notice Credit a tranche's claim after it has moved `assets` into this pool.
    /// @dev The tranche vault transfers the depositor's assets straight to this contract (the
    ///      depositor approved the vault), then calls this to record the claim. Trusting the
    ///      registered vaults is the same trust as owner-setting them; no external call here.
    function creditDeposit(uint256 assets) external onlyTranche whenNotPaused {
        assetsOf[msg.sender] += assets;
        emit Deposited(msg.sender, assets);
    }

    /// @notice Debit a tranche's claim and pay `assets` out to `receiver` on withdrawal.
    /// @dev Withdrawals are bounded by idle pool liquidity: funders cannot pull capital that is
    ///      currently advanced to invoices (`totalDeployed`). Not pausable — funders can always
    ///      exit up to available liquidity.
    function debitWithdraw(address receiver, uint256 assets) external onlyTranche nonReentrant {
        if (ASSET.balanceOf(address(this)) < assets) revert InsufficientLiquidity();
        assetsOf[msg.sender] -= assets;
        ASSET.safeTransfer(receiver, assets);
        emit Withdrawn(msg.sender, receiver, assets);
    }

    // --- Funding + waterfall ---

    /// @notice Advance discounted assets from the pool to a registered, attested invoice's supplier.
    function fundInvoice(bytes32 invoiceId) external onlyOperator nonReentrant whenNotPaused {
        if (!REGISTRY.exists(invoiceId)) revert NotRegistered();
        if (fundingOf[invoiceId].status != FundingStatus.None) revert AlreadyFunded();

        CifraInvoiceRegistry.Invoice memory inv = REGISTRY.getInvoice(invoiceId);
        if (inv.status != CifraInvoiceRegistry.Status.Registered) revert InvoiceNotFundable();

        CifraAttestationNFT.Grade memory grade = ATTESTATION.gradeForInvoice(invoiceId);
        if (grade.scorerSigner == address(0)) revert NotAttested();

        uint256 principal = (inv.faceAmount * (BPS - grade.discountRateBps)) / BPS;
        if (ASSET.balanceOf(address(this)) < principal) revert InsufficientLiquidity();

        fundingOf[invoiceId] = Funding({
            supplier: inv.supplier,
            faceAmount: inv.faceAmount,
            principal: principal,
            dueDate: inv.dueDate,
            status: FundingStatus.Outstanding
        });
        totalDeployed += principal;

        REGISTRY.setStatus(invoiceId, CifraInvoiceRegistry.Status.Funded);
        ASSET.safeTransfer(inv.supplier, principal);

        emit Funded(invoiceId, inv.supplier, principal, inv.faceAmount);
    }

    /// @notice Record repayment: the caller transfers `faceAmount` of ASSET into the pool (must have
    ///         approved it). Realizes yield = face − principal, split senior/junior by
    ///         `seniorYieldShareBps` (senior first, junior residual).
    function recordRepayment(bytes32 invoiceId) external onlySettler nonReentrant {
        Funding storage f = fundingOf[invoiceId];
        if (f.status != FundingStatus.Outstanding) revert NotOutstanding();

        f.status = FundingStatus.Settled;
        totalDeployed -= f.principal;

        REGISTRY.setStatus(invoiceId, CifraInvoiceRegistry.Status.Settled);
        ASSET.safeTransferFrom(msg.sender, address(this), f.faceAmount);

        uint256 yieldAmount = f.faceAmount - f.principal;
        uint256 seniorYield = (yieldAmount * seniorYieldShareBps) / BPS;
        uint256 juniorYield = yieldAmount - seniorYield;
        assetsOf[seniorVault] += seniorYield;
        assetsOf[juniorVault] += juniorYield;

        emit Repaid(invoiceId, f.faceAmount, seniorYield, juniorYield);
    }

    /// @notice Record a default after the due date: writes off principal. Junior's claim absorbs
    ///         the loss first; only the overflow reduces senior's claim (subordination).
    function recordDefault(bytes32 invoiceId) external onlySettler nonReentrant {
        Funding storage f = fundingOf[invoiceId];
        if (f.status != FundingStatus.Outstanding) revert NotOutstanding();
        if (block.timestamp <= f.dueDate) revert NotYetDue();

        f.status = FundingStatus.Defaulted;
        totalDeployed -= f.principal;

        REGISTRY.setStatus(invoiceId, CifraInvoiceRegistry.Status.Defaulted);

        uint256 loss = f.principal;
        uint256 juniorClaim = assetsOf[juniorVault];
        uint256 juniorLoss = loss <= juniorClaim ? loss : juniorClaim;
        assetsOf[juniorVault] = juniorClaim - juniorLoss;
        uint256 seniorLoss = loss - juniorLoss;
        if (seniorLoss > 0) assetsOf[seniorVault] -= seniorLoss;

        emit Defaulted(invoiceId, juniorLoss, seniorLoss);
    }

    // --- Views ---

    /// @notice A tranche vault's claim on NAV — the value it reports as `totalAssets()`.
    function claimOf(address tranche) external view returns (uint256) {
        return assetsOf[tranche];
    }

    /// @notice Total book NAV in ASSET units (idle pool + outstanding principal == senior + junior).
    function nav() external view returns (uint256) {
        return assetsOf[seniorVault] + assetsOf[juniorVault];
    }

    // --- Admin ---

    /// @notice Register the two tranche vaults. One-time (immutable thereafter) so the waterfall
    ///         targets can never be repointed at an attacker-controlled share class.
    function setTrancheVaults(address senior_, address junior_) external onlyOwner {
        if (seniorVault != address(0) || juniorVault != address(0)) revert AlreadySet();
        if (senior_ == address(0) || junior_ == address(0)) revert ZeroAddress();
        seniorVault = senior_;
        juniorVault = junior_;
        emit TrancheVaultsSet(senior_, junior_);
    }

    function setSeniorYieldShareBps(uint256 newBps) external onlyOwner {
        if (newBps > BPS) revert ShareOutOfRange();
        emit SeniorYieldShareUpdated(seniorYieldShareBps, newBps);
        seniorYieldShareBps = newBps;
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    function setSettlement(address newSettlement) external onlyOwner {
        if (newSettlement == address(0)) revert ZeroAddress();
        emit SettlementUpdated(settlement, newSettlement);
        settlement = newSettlement;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Emergency stop for deposits + funding (withdrawals stay open).
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
