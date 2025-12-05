// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {ERC721, ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ChaiYaoNFT
 * @notice RWA-backed ERC721 for physical Chai Kiln artifacts, with owner-gated minting and immutable asset tagging.
 */
contract ChaiYaoNFT is ERC721URIStorage, Ownable {
    struct AssetMeta {
        string assetTag;
        uint64 mintedAt;
    }

    // Token supply tracking (single mint allowed).
    uint256 private _nextTokenId = 1;
    bool private _minted;

    // Metadata and URIs.
    string private _baseTokenURI;
    mapping(uint256 => AssetMeta) private _assetMetadata;

    // Linked fractional token (set once by owner).
    address private _fragmentToken;

    // Device-backed authenticity options (set once by owner).
    address private _deviceSigner; // public key address for signature-based device proofs
    bytes32 private _deviceUID; // UID for low-security tagging
    mapping(uint256 => uint64) private _deviceProofAt; // last proof/heartbeat timestamp per token

    event AssetMinted(address indexed to, uint256 indexed tokenId, string assetTag, string tokenURI);
    event BaseURIUpdated(string newBaseURI);
    event TokenURIUpdated(uint256 indexed tokenId, string newTokenURI);
    event FragmentTokenLinked(address indexed fragmentToken);
    event DeviceSignerBound(address indexed deviceSigner);
    event DeviceUIDBound(bytes32 indexed deviceUID);
    event DeviceProofAccepted(uint256 indexed tokenId, bytes32 indexed digest, uint64 verifiedAt);
    event UIDReported(uint256 indexed tokenId, bytes32 indexed deviceUID, uint64 verifiedAt);

    constructor(string memory baseURI_) ERC721("Chai Kiln Physical Asset", "CHAIYAO") Ownable(msg.sender) {
        _baseTokenURI = baseURI_;
    }

    function mintAsset(address to, string calldata tokenURI_, string calldata assetTag) external onlyOwner returns (uint256 tokenId) {
        require(to != address(0), "Mint to zero address");
        require(bytes(tokenURI_).length > 0, "Token URI required");
        require(bytes(assetTag).length > 0, "Asset tag required");
        require(!_minted, "Max supply reached");

        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI_);
        _assetMetadata[tokenId] = AssetMeta({assetTag: assetTag, mintedAt: uint64(block.timestamp)});
        _minted = true;

        emit AssetMinted(to, tokenId, assetTag, tokenURI_);
    }

    // Owner can update an existing token URI (e.g., refreshed metadata).
    function updateTokenURI(uint256 tokenId, string calldata newTokenURI) external onlyOwner {
        _requireOwned(tokenId);
        require(bytes(newTokenURI).length > 0, "Token URI required");
        _setTokenURI(tokenId, newTokenURI);
        emit TokenURIUpdated(tokenId, newTokenURI);
    }

    // Owner can set a shared base URI for tokenURI concatenation.
    function setBaseTokenURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    function baseTokenURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function assetMetadata(uint256 tokenId) external view returns (AssetMeta memory) {
        _requireOwned(tokenId);
        return _assetMetadata[tokenId];
    }

    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    function minted() external view returns (bool) {
        return _minted;
    }

    function fragmentToken() external view returns (address) {
        return _fragmentToken;
    }

    // One-time link to the fractional ERC20 that represents this NFT's value.
    function setFragmentToken(address fragmentToken_) external onlyOwner {
        require(fragmentToken_ != address(0), "Fragment token required");
        require(_fragmentToken == address(0), "Fragment token already set");
        _fragmentToken = fragmentToken_;
        emit FragmentTokenLinked(fragmentToken_);
    }

    function deviceSigner() external view returns (address) {
        return _deviceSigner;
    }

    function deviceUID() external view returns (bytes32) {
        return _deviceUID;
    }

    function deviceProofAt(uint256 tokenId) external view returns (uint64) {
        _requireOwned(tokenId);
        return _deviceProofAt[tokenId];
    }

    function setDeviceSigner(address signer) external onlyOwner {
        require(signer != address(0), "Device signer required");
        require(_deviceSigner == address(0), "Device signer already set");
        _deviceSigner = signer;
        emit DeviceSignerBound(signer);
    }

    // Bind a UID for lower-assurance tagging (no signatures).
    function setDeviceUID(bytes32 uid) external onlyOwner {
        require(uid != bytes32(0), "Device UID required");
        require(_deviceUID == bytes32(0), "Device UID already set");
        _deviceUID = uid;
        emit DeviceUIDBound(uid);
    }

    // Owner submits a device signature; digest must verify against device signer.
    function validateDeviceSignature(uint256 tokenId, bytes32 digest, bytes calldata signature) external onlyOwner {
        _requireOwned(tokenId);
        require(_deviceSigner != address(0), "Device signer not set");
        address signer = ECDSA.recover(digest, signature);
        require(signer == _deviceSigner, "Invalid device signature");
        uint64 timestamp = uint64(block.timestamp);
        _deviceProofAt[tokenId] = timestamp;
        emit DeviceProofAccepted(tokenId, digest, timestamp);
    }

    // Owner records a UID heartbeat; uid must match the bound UID.
    function recordUIDHeartbeat(uint256 tokenId, bytes32 uid) external onlyOwner {
        _requireOwned(tokenId);
        require(_deviceUID != bytes32(0), "Device UID not set");
        require(uid == _deviceUID, "UID mismatch");
        uint64 timestamp = uint64(block.timestamp);
        _deviceProofAt[tokenId] = timestamp;
        emit UIDReported(tokenId, uid, timestamp);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
