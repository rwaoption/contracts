# ChaiYaoNFT (ERC721) 前端调用说明

RWA 支撑的单枚 NFT，owner 才能铸造/更新。使用 tokenURI 存储。

## 合约信息
- 名称 / 符号：`Chai Kiln Physical Asset` / `CHAIYAO`
- 基础 URI：`baseTokenURI()`
- 下一个 tokenId：`nextTokenId()`
- 是否已铸造：`minted()`
- 关联分割 ERC20：`fragmentToken()`

## 关键只读
- `owner()` → 合约 owner。
- `tokenURI(tokenId)` → 元数据 URI。
- `assetMetadata(tokenId)` → `{ assetTag, mintedAt }`。
- `deviceSigner()` / `deviceUID()` / `deviceProofAt(tokenId)` → 真实性绑定。

## Owner 写入
- `mintAsset(to, tokenURI, assetTag)` → 铸造唯一 NFT。
- `updateTokenURI(tokenId, newTokenURI)` → 刷新元数据。
- `setBaseTokenURI(newBaseURI)`
- `setFragmentToken(address)` → 一次性绑定 CHAI 代币。
- `setDeviceSigner(address)` / `setDeviceUID(bytes32)` → 绑定真实性来源。
- `validateDeviceSignature(tokenId, digest, signature)` → 记录签名心跳。
- `recordUIDHeartbeat(tokenId, uid)` → 记录 UID 心跳。

## 前端只读示例
```ts
const nft = new ethers.Contract(NFT_ADDRESS, NFT_ABI, provider);
const minted = await nft.minted();
const uri = await nft.tokenURI(1);
const meta = await nft.assetMetadata(1);
```
