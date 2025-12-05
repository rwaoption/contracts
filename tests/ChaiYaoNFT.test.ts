import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyUint } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("ChaiYaoNFT", () => {
  async function deployFixture() {
    const [owner, user] = await ethers.getSigners();
    const baseURI = "ipfs://chai-yao/";
    const factory = await ethers.getContractFactory("ChaiYaoNFT");
    const contract = await factory.deploy(baseURI);
    await contract.waitForDeployment();

    return { contract, owner, user, baseURI };
  }

  it("initializes name, symbol, and base URI", async () => {
    const { contract, baseURI } = await loadFixture(deployFixture);
    expect(await contract.name()).to.equal("Chai Kiln Physical Asset");
    expect(await contract.symbol()).to.equal("CHAIYAO");
    expect(await contract.baseTokenURI()).to.equal(baseURI);
  });

  it("mints RWA NFT with metadata and emits event", async () => {
    const { contract, user } = await loadFixture(deployFixture);
    const expectedId = await contract.nextTokenId();

    await expect(contract.mintAsset(user.address, "asset-001.json", "CY-001"))
      .to.emit(contract, "AssetMinted")
      .withArgs(user.address, expectedId, "CY-001", "asset-001.json");

    expect(await contract.minted()).to.equal(true);
    expect(await contract.ownerOf(expectedId)).to.equal(user.address);
    expect(await contract.tokenURI(expectedId)).to.equal("ipfs://chai-yao/asset-001.json");

    const meta = await contract.assetMetadata(expectedId);
    expect(meta.assetTag).to.equal("CY-001");
    expect(meta.mintedAt).to.be.gt(0n);
  });

  it("enforces owner-only minting and URI updates", async () => {
    const { contract, user } = await loadFixture(deployFixture);
    await expect(contract.connect(user).mintAsset(user.address, "asset-002.json", "CY-002"))
      .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount")
      .withArgs(user.address);

    const tokenId = await contract.nextTokenId();
    await contract.mintAsset(user.address, "asset-003.json", "CY-003");

    await expect(contract.connect(user).updateTokenURI(tokenId, "updated.json"))
      .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });

  it("updates base URI and token URI", async () => {
    const { contract, user } = await loadFixture(deployFixture);
    const tokenId = await contract.nextTokenId();
    await contract.mintAsset(user.address, "asset-004.json", "CY-004");

    await expect(contract.setBaseTokenURI("ipfs://chai-yao-updated/"))
      .to.emit(contract, "BaseURIUpdated")
      .withArgs("ipfs://chai-yao-updated/");

    expect(await contract.tokenURI(tokenId)).to.equal("ipfs://chai-yao-updated/asset-004.json");

    await expect(contract.updateTokenURI(tokenId, "asset-004-v2.json"))
      .to.emit(contract, "TokenURIUpdated")
      .withArgs(tokenId, "asset-004-v2.json");

    expect(await contract.tokenURI(tokenId)).to.equal("ipfs://chai-yao-updated/asset-004-v2.json");
  });

  it("links a fragment token address once, owner-only", async () => {
    const { contract, user } = await loadFixture(deployFixture);
    const fragment = ethers.Wallet.createRandom().address;

    await expect(contract.setFragmentToken(fragment))
      .to.emit(contract, "FragmentTokenLinked")
      .withArgs(fragment);

    expect(await contract.fragmentToken()).to.equal(fragment);

    await expect(contract.setFragmentToken(fragment)).to.be.revertedWith("Fragment token already set");
    await expect(contract.connect(user).setFragmentToken(fragment))
      .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });

  it("binds device signer once and validates signatures owner-only", async () => {
    const { contract, user } = await loadFixture(deployFixture);
    const tokenId = await contract.nextTokenId();
    await contract.mintAsset(user.address, "asset-006.json", "CY-006");

    const device = ethers.Wallet.createRandom();
    await expect(contract.setDeviceSigner(device.address))
      .to.emit(contract, "DeviceSignerBound")
      .withArgs(device.address);

    await expect(contract.setDeviceSigner(device.address)).to.be.revertedWith("Device signer already set");
    await expect(contract.connect(user).setDeviceSigner(device.address))
      .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount")
      .withArgs(user.address);

    const message = ethers.toUtf8Bytes("heartbeat");
    const signature = await device.signMessage(message);
    const digest = ethers.hashMessage(message);

    await expect(contract.validateDeviceSignature(tokenId, digest, signature))
      .to.emit(contract, "DeviceProofAccepted")
      .withArgs(tokenId, digest, anyUint);

    const proofAt = await contract.deviceProofAt(tokenId);
    expect(proofAt).to.be.gt(0n);

    await expect(contract.connect(user).validateDeviceSignature(tokenId, digest, signature))
      .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });

  it("binds device UID once and records heartbeats owner-only", async () => {
    const { contract, user } = await loadFixture(deployFixture);
    const tokenId = await contract.nextTokenId();
    await contract.mintAsset(user.address, "asset-007.json", "CY-007");

    const uid = ethers.id("device-uid-1");
    await expect(contract.setDeviceUID(uid))
      .to.emit(contract, "DeviceUIDBound")
      .withArgs(uid);

    await expect(contract.setDeviceUID(uid)).to.be.revertedWith("Device UID already set");
    await expect(contract.connect(user).setDeviceUID(uid))
      .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount")
      .withArgs(user.address);

    await expect(contract.recordUIDHeartbeat(tokenId, uid))
      .to.emit(contract, "UIDReported")
      .withArgs(tokenId, uid, anyUint);

    await expect(contract.recordUIDHeartbeat(tokenId, ethers.id("other"))).to.be.revertedWith("UID mismatch");
    await expect(contract.connect(user).recordUIDHeartbeat(tokenId, uid))
      .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });

  it("blocks a second mint to enforce single issuance", async () => {
    const { contract, user } = await loadFixture(deployFixture);
    await contract.mintAsset(user.address, "asset-005.json", "CY-005");

    await expect(contract.mintAsset(user.address, "asset-006.json", "CY-006")).to.be.revertedWith("Max supply reached");
  });
});
