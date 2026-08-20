// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IWeb2Json } from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import { IWeb2JsonVerification } from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2JsonVerification.sol";

/// @title CifraJurisdictionOracle
/// @notice On-chain jurisdiction-risk table sourced from a real public API via FDC Web2Json.
///         A country's region is fetched from a public country-info API, verified on-chain
///         (`verifyWeb2Json`), and stored; a transparent, governance-set region→risk table then
///         yields the jurisdiction risk (bps) used by Cifra's scoring model.
///
///         This is the ONE scoring input that is NOT buyer-private (a country's region is public),
///         which is why it is the only term that can be sourced on-chain at all. The
///         buyer-private inputs never leave the scoring service; only this public jurisdiction
///         signal is attested here.
///
///         NOT DEPLOYED ON BOT CHAIN. This is the last contract still importing the
///         flare-periphery package, and it depends on FDC Web2Json, which BOT Chain lacks. See
///         contracts/README.md and claude-docs/PORTING_ANALYSIS.md §6.1 for the open decision
///         on whether to delete it outright.
///
///         The FDC verifier is injected (constructor) for unit-testability; on Coston2 pass the
///         address from `ContractRegistry.getFdcVerification()`.
contract CifraJurisdictionOracle {
    /// @dev DTO the Web2Json postProcessJq produces (matches the abiSignature in the request):
    ///      { string countryCode, string region }.
    struct JurisdictionData {
        string countryCode;
        string region;
    }

    IWeb2JsonVerification public immutable VERIFIER;
    address public owner;

    /// @notice keccak256(countryCode) => region (verifiably sourced via Web2Json).
    mapping(bytes32 => string) public regionOf;
    /// @notice keccak256(region) => jurisdiction risk in bps (governance-set, transparent table).
    mapping(bytes32 => uint32) public regionRiskBps;
    /// @notice Fallback risk for a country whose region has no configured entry.
    uint32 public defaultRiskBps = 5000;

    event JurisdictionUpdated(string countryCode, string region);
    event RegionRiskSet(string region, uint32 riskBps);
    event DefaultRiskSet(uint32 riskBps);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();
    error InvalidProof();
    error UnknownCountry();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address verifier_) {
        if (verifier_ == address(0)) revert ZeroAddress();
        VERIFIER = IWeb2JsonVerification(verifier_);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Ingest a country's region from a verified Web2Json proof. Permissionless —
    ///         only a genuinely FDC-verified proof is accepted.
    function updateFromProof(IWeb2Json.Proof calldata proof) external {
        if (!VERIFIER.verifyWeb2Json(proof)) revert InvalidProof();
        JurisdictionData memory d = abi.decode(proof.data.responseBody.abiEncodedData, (JurisdictionData));
        regionOf[keccak256(bytes(d.countryCode))] = d.region;
        emit JurisdictionUpdated(d.countryCode, d.region);
    }

    /// @notice Jurisdiction risk (bps) for a country: its verifiably-sourced region mapped through
    ///         the transparent region-risk table (falls back to `defaultRiskBps`).
    function jurisdictionRiskBps(string calldata countryCode) external view returns (uint32) {
        string memory region = regionOf[keccak256(bytes(countryCode))];
        if (bytes(region).length == 0) revert UnknownCountry();
        uint32 risk = regionRiskBps[keccak256(bytes(region))];
        return risk == 0 ? defaultRiskBps : risk;
    }

    // --- Admin (transparent risk table) ---

    function setRegionRisk(string calldata region, uint32 riskBps) external onlyOwner {
        regionRiskBps[keccak256(bytes(region))] = riskBps;
        emit RegionRiskSet(region, riskBps);
    }

    function setDefaultRisk(uint32 riskBps) external onlyOwner {
        defaultRiskBps = riskBps;
        emit DefaultRiskSet(riskBps);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
