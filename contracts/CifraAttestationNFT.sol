// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { CifraInvoiceRegistry } from "./CifraInvoiceRegistry.sol";

/// @title CifraAttestationNFT
/// @notice Holds the signed risk grade for a registered invoice as an ERC-721.
///         The grade is produced off-chain by Cifra's scoring service, which runs a
///         published, reproducible model over data that never reaches the chain. This
///         contract verifies the service's signature against the registered scorer
///         identity, checks the grade was signed for THIS invoice, and records it.
///
///         TRUST MODEL — stated plainly. The signature proves the grade came from the
///         key Cifra registered here; it does NOT prove which code produced it. The
///         model source and the service's container digest are published so a grade
///         can be independently recomputed from the same inputs, but that is
///         accountability, not attestation. `setScorerAddress` is deliberately left
///         owner-settable so a hardware-attested signer can replace the current one
///         without migrating this contract or its recorded grades.
///
///         Signature scheme: the scorer signs, EIP-191, over
///           keccak256(abi.encode("CIFRA_SCORE_RESULT", chainId, resultHash))
///         where
///           resultHash = keccak256(abi.encodePacked(
///               keccak256(resultData), actionId, keccak256(bytes(submissionTag)), status))
///         Binding chainId into the payload stops a grade signed for one network being
///         replayed on another. Only successful results (status == 1) are accepted.
contract CifraAttestationNFT is ERC721 {
    /// @notice The signed risk grade recorded for an invoice.
    struct Grade {
        bytes32 grade; // bytes32("A" | "B" | "C" | "D")
        uint32 riskScoreBps; // 0..10000
        uint32 discountRateBps; // base + grade spread
        address scorerSigner; // the scorer identity that signed (audit); non-zero once attested
    }

    /// @dev Domain tag the scoring service prepends when signing a result.
    bytes32 private constant SCORE_RESULT_DOMAIN = bytes32("CIFRA_SCORE_RESULT");

    /// @dev Successful ActionResult status.
    uint8 private constant STATUS_SUCCESS = 1;

    /// @dev Guards against a truncating cast; a valid risk score never exceeds 100.00%.
    uint32 private constant MAX_BPS = 10000;

    CifraInvoiceRegistry public immutable REGISTRY;

    /// @notice The registered scorer identity whose signatures are accepted.
    address public scorerAddress;
    address public owner;

    /// @notice Address permitted to submit attestations (the protocol keeper).
    ///
    ///         Defence in depth (audit finding H1). The invoiceId is now bound into the
    ///         signed payload itself and enforced in `_decodeCheckedGrade`, so a grade can
    ///         no longer be re-paired with an unrelated invoice. This keeper restriction
    ///         is retained as a second gate on who may submit results at all. Set to the
    ///         owner at deploy; updatable by the owner.
    address public attester;

    /// @notice tokenId (== uint256(invoiceId)) => recorded grade.
    mapping(uint256 => Grade) public gradeOf;

    event Attested(
        bytes32 indexed invoiceId,
        uint256 indexed tokenId,
        address indexed supplier,
        bytes32 grade,
        uint32 riskScoreBps,
        uint32 discountRateBps
    );
    event ScorerAddressUpdated(address indexed previousScorer, address indexed newScorer);
    event AttesterUpdated(address indexed previousAttester, address indexed newAttester);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotAttester();
    error ZeroAddress();
    error UnknownInvoice();
    error ResultNotSuccessful();
    error BadScorerSignature();
    error AlreadyAttested();
    error ScoreOutOfRange();
    error DiscountOutOfRange();
    error InvoiceMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    modifier onlyAttester() {
        if (msg.sender != attester) revert NotAttester();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address scorerAddress_,
        CifraInvoiceRegistry registry_
    ) ERC721(name_, symbol_) {
        if (scorerAddress_ == address(0)) revert ZeroAddress();
        if (address(registry_) == address(0) || address(registry_).code.length == 0) revert ZeroAddress();
        scorerAddress = scorerAddress_;
        REGISTRY = registry_;
        owner = msg.sender;
        attester = msg.sender;
        emit ScorerAddressUpdated(address(0), scorerAddress_);
        emit AttesterUpdated(address(0), msg.sender);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Verify a signed scoring result and mint the attestation NFT to the
    ///         invoice's supplier. One attestation per invoice (re-attestation reverts).
    /// @param invoiceId The registered invoice this grade is for. Must equal the invoiceId the
    ///        scorer bound into `resultData` (audit finding H1).
    /// @param resultData ABI-encoded (bytes32 invoiceId, bytes32 grade, uint256 riskScoreBps,
    ///        uint256 discountRateBps) as produced by the scoring extension. The leading
    ///        invoiceId is echoed by the scorer so the signature binds the grade to one invoice.
    /// @param actionId The scoring result id.
    /// @param submissionTag The result submission tag (e.g. "threshold").
    /// @param status The result status (must be 1).
    /// @param signature The scorer identity's EIP-191 signature over the domain-separated payload.
    /// @return tokenId The minted token id (== uint256(invoiceId)).
    function attest(
        bytes32 invoiceId,
        bytes calldata resultData,
        bytes32 actionId,
        string calldata submissionTag,
        uint8 status,
        bytes calldata signature
    ) external onlyAttester returns (uint256 tokenId) {
        if (!REGISTRY.exists(invoiceId)) revert UnknownInvoice();
        if (status != STATUS_SUCCESS) revert ResultNotSuccessful();

        _verifyScorerSignature(resultData, actionId, submissionTag, status, signature);

        // Decode + validate the signed result (H1 binding + range checks) in a helper to keep
        // this function's stack shallow.
        (bytes32 grade, uint32 riskBps, uint32 discountBps) = _decodeCheckedGrade(invoiceId, resultData);

        tokenId = uint256(invoiceId);
        if (gradeOf[tokenId].scorerSigner != address(0)) revert AlreadyAttested();

        address supplier = REGISTRY.getInvoice(invoiceId).supplier;
        gradeOf[tokenId] = Grade({
            grade: grade,
            riskScoreBps: riskBps,
            discountRateBps: discountBps,
            scorerSigner: scorerAddress
        });
        _safeMint(supplier, tokenId);

        emit Attested(invoiceId, tokenId, supplier, grade, riskBps, discountBps);
    }

    /// @dev Decode the ABI-encoded signed result and enforce the invoice binding + ranges.
    ///      (bytes32 invoiceId, bytes32 grade, uint256 riskScoreBps, uint256 discountRateBps)
    function _decodeCheckedGrade(bytes32 invoiceId, bytes calldata resultData)
        private
        pure
        returns (bytes32 grade, uint32 riskBps, uint32 discountBps)
    {
        bytes32 boundInvoiceId;
        uint256 risk;
        uint256 discount;
        (boundInvoiceId, grade, risk, discount) = abi.decode(resultData, (bytes32, bytes32, uint256, uint256));
        // H1: the grade is only valid for the invoice the scorer signed it for.
        if (boundInvoiceId != invoiceId) revert InvoiceMismatch();
        if (risk > MAX_BPS) revert ScoreOutOfRange();
        // Bound the discount: prevents a silent uint32 truncation and an underflow in
        // CifraVault.fundInvoice (advance = face * (BPS - discountRateBps) / BPS).
        if (discount > MAX_BPS) revert DiscountOutOfRange();
        riskBps = uint32(risk);
        discountBps = uint32(discount);
    }

    /// @notice The grade recorded for an invoice (zeroed struct if not yet attested).
    function gradeForInvoice(bytes32 invoiceId) external view returns (Grade memory) {
        return gradeOf[uint256(invoiceId)];
    }

    /// @notice Whether an invoice has a recorded attestation.
    function isAttested(bytes32 invoiceId) external view returns (bool) {
        return gradeOf[uint256(invoiceId)].scorerSigner != address(0);
    }

    // --- Admin ---

    /// @notice Update the accepted scorer identity. This is the upgrade path to a
    ///         hardware-attested signer: point at the new key, no migration needed.
    function setScorerAddress(address newScorer) external onlyOwner {
        if (newScorer == address(0)) revert ZeroAddress();
        emit ScorerAddressUpdated(scorerAddress, newScorer);
        scorerAddress = newScorer;
    }

    /// @notice Update the keeper permitted to submit attestations (audit finding H1).
    function setAttester(address newAttester) external onlyOwner {
        if (newAttester == address(0)) revert ZeroAddress();
        emit AttesterUpdated(attester, newAttester);
        attester = newAttester;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // --- Internal ---

    function _verifyScorerSignature(
        bytes calldata resultData,
        bytes32 actionId,
        string calldata submissionTag,
        uint8 status,
        bytes calldata signature
    ) private view {
        bytes32 resultHash = keccak256(
            abi.encodePacked(keccak256(resultData), actionId, keccak256(bytes(submissionTag)), status)
        );
        bytes32 payload = keccak256(abi.encode(SCORE_RESULT_DOMAIN, block.chainid, resultHash));
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(payload), signature);
        if (signer != scorerAddress) revert BadScorerSignature();
    }
}
