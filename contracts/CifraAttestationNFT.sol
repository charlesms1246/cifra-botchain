// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { CifraInvoiceRegistry } from "./CifraInvoiceRegistry.sol";

/// @title CifraAttestationNFT
/// @notice Holds the TEE-signed risk grade for a registered invoice as an ERC-721.
///         The grade is produced privately inside the Cifra Compute Extension; only
///         the signed result reaches the chain. This contract verifies that signature
///         against the registered TEE identity and records the grade — it is the
///         on-chain consumer of the scoring extension's output.
///
///         Signature scheme matches the tee-node exactly (see Flare's fce-weather-insurance
///         `settle()`): the node signs, EIP-191, over
///           keccak256(abi.encode("TEE_ACTION_RESULT", chainId, resultHash))
///         where
///           resultHash = keccak256(abi.encodePacked(
///               keccak256(resultData), actionId, keccak256(bytes(submissionTag)), status))
///         Only successful results (status == 1) are accepted.
contract CifraAttestationNFT is ERC721 {
    /// @notice The signed risk grade recorded for an invoice.
    struct Grade {
        bytes32 grade; // bytes32("A" | "B" | "C" | "D")
        uint32 riskScoreBps; // 0..10000
        uint32 discountRateBps; // base + grade spread
        address teeSigner; // the TEE identity that signed (audit); non-zero once attested
    }

    /// @dev Domain tag the tee-node prepends when signing an ActionResult.
    bytes32 private constant TEE_ACTION_RESULT = bytes32("TEE_ACTION_RESULT");

    /// @dev Successful ActionResult status.
    uint8 private constant STATUS_SUCCESS = 1;

    /// @dev Guards against a truncating cast; a valid risk score never exceeds 100.00%.
    uint32 private constant MAX_BPS = 10000;

    CifraInvoiceRegistry public immutable REGISTRY;

    /// @notice The registered TEE identity whose signatures are accepted.
    address public teeAddress;
    address public owner;

    /// @notice Address permitted to submit attestations (the protocol keeper).
    ///
    ///         INTERIM binding control (audit finding H1): the TEE signs over the scoring
    ///         result but not the invoiceId, so a validly-signed grade could otherwise be
    ///         paired with an unrelated invoice. Until the invoiceId is bound into the
    ///         signed payload itself, `attest` is restricted to this keeper, which is
    ///         responsible for matching each result to its invoice. Set to the owner at
    ///         deploy; updatable by the owner.
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
    event TeeAddressUpdated(address indexed previousTee, address indexed newTee);
    event AttesterUpdated(address indexed previousAttester, address indexed newAttester);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotAttester();
    error ZeroAddress();
    error UnknownInvoice();
    error ResultNotSuccessful();
    error BadTeeSignature();
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
        address teeAddress_,
        CifraInvoiceRegistry registry_
    ) ERC721(name_, symbol_) {
        if (teeAddress_ == address(0)) revert ZeroAddress();
        if (address(registry_) == address(0) || address(registry_).code.length == 0) revert ZeroAddress();
        teeAddress = teeAddress_;
        REGISTRY = registry_;
        owner = msg.sender;
        attester = msg.sender;
        emit TeeAddressUpdated(address(0), teeAddress_);
        emit AttesterUpdated(address(0), msg.sender);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Verify a TEE-signed scoring result and mint the attestation NFT to the
    ///         invoice's supplier. One attestation per invoice (re-attestation reverts).
    /// @param invoiceId The registered invoice this grade is for. Must equal the invoiceId the
    ///        TEE bound into `resultData` (audit finding H1).
    /// @param resultData ABI-encoded (bytes32 invoiceId, bytes32 grade, uint256 riskScoreBps,
    ///        uint256 discountRateBps) as produced by the scoring extension. The leading
    ///        invoiceId is echoed by the enclave so the signature binds the grade to one invoice.
    /// @param actionId The TEE ActionResult id.
    /// @param submissionTag The ActionResult submission tag (e.g. "threshold").
    /// @param status The ActionResult status (must be 1).
    /// @param signature The TEE identity's EIP-191 signature over the domain-separated payload.
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

        _verifyTeeSignature(resultData, actionId, submissionTag, status, signature);

        // Decode + validate the signed result (H1 binding + range checks) in a helper to keep
        // this function's stack shallow.
        (bytes32 grade, uint32 riskBps, uint32 discountBps) = _decodeCheckedGrade(invoiceId, resultData);

        tokenId = uint256(invoiceId);
        if (gradeOf[tokenId].teeSigner != address(0)) revert AlreadyAttested();

        address supplier = REGISTRY.getInvoice(invoiceId).supplier;
        gradeOf[tokenId] = Grade({
            grade: grade,
            riskScoreBps: riskBps,
            discountRateBps: discountBps,
            teeSigner: teeAddress
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
        // H1: the grade is only valid for the invoice the TEE signed it for.
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
        return gradeOf[uint256(invoiceId)].teeSigner != address(0);
    }

    // --- Admin ---

    /// @notice Update the accepted TEE identity (e.g. after the machine re-registers).
    function setTeeAddress(address newTee) external onlyOwner {
        if (newTee == address(0)) revert ZeroAddress();
        emit TeeAddressUpdated(teeAddress, newTee);
        teeAddress = newTee;
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

    function _verifyTeeSignature(
        bytes calldata resultData,
        bytes32 actionId,
        string calldata submissionTag,
        uint8 status,
        bytes calldata signature
    ) private view {
        bytes32 resultHash = keccak256(
            abi.encodePacked(keccak256(resultData), actionId, keccak256(bytes(submissionTag)), status)
        );
        bytes32 payload = keccak256(abi.encode(TEE_ACTION_RESULT, block.chainid, resultHash));
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(payload), signature);
        if (signer != teeAddress) revert BadTeeSignature();
    }
}
