# AuctionPricePredictionMarket 前端调用说明（多 NFT、多价格档 Yes/No 预测）

用 CHAI 下注，价格随池子占比线性滑点（接近“越多人买越贵”）。每个市场问题：指定 NFT 的最终成交价是否 **>= priceTarget**。每个 NFT 有独立的 `closeTime` 与 `finalAuctionPrice`。

## 合约信息
- CHAI 地址：`chai()`
- 单笔最小下注：`minStake()`
- 市场总数：`marketCount()`
- 拍卖配置：`auctions(nft)` → `{ closeTime, finalAuctionPrice, finalPriceSet }`

## 市场结构 `markets(marketId)`
- `nftAsset` (address)
- `priceTarget` (uint256)
- `outcome` (`0=Undecided,1=Yes,2=No`)
- `yesShares` / `noShares`

## 用户持仓
- `yesSharesOf(marketId, user)` / `noSharesOf(marketId, user)`
- `claimed(marketId, user)`

## 主流程
1) **配置拍卖（owner，每个 NFT 一次）**：`configureAuction(nft, closeTime)`，设置该 NFT 的下注截止时间。
2) **创建价格档（owner，可多次）**：`createMarket(nft, priceTarget)`，必须在该 NFT 的 `closeTime` 前。
3) **授权**：用户对 CHAI `approve` 合约，额度 = 本次计划下注的 `amountIn`。
4) **下注**：`buyYes(marketId, amountIn, minSharesOut)` 或 `buyNo(marketId, amountIn, minSharesOut)`，需在对应 NFT 的 `closeTime` 前。
5) **录入成交价（owner）**：`setFinalAuctionPrice(nft, finalPrice)`，只能一次，需在 `closeTime` 之后。
6) **查询当前价格**：`getQuote(marketId)` 返回 yes/no 池子占比（1e18 = 100%），便于前端显示当前买价/概率。
7) **结算**：单个 `resolve(marketId)` 或一次性 `resolveAllForNFT(nft)`（遍历该 NFT 下的所有市场 ID，避免全量扫描），根据该 NFT 的 `finalAuctionPrice >= priceTarget` 判定。
8) **领取**：赢家 `claim(marketId)`，获得本金 + 失败方池子按份额分配。

## 常用写入
- Owner：`configureAuction(nft, closeTime)`，`createMarket(nft, priceTarget)`，`setFinalAuctionPrice(nft, finalPrice)`，`resolve` / `resolveAllForNFT(nft)`
- 用户：`buyYes(marketId, amountIn, minSharesOut)` / `buyNo(marketId, amountIn, minSharesOut)`，`claim(marketId)`

## 常用只读
- `auctions(nft)` → { closeTime, finalAuctionPrice, finalPriceSet }
- `markets(id)` → 市场详情
- `getQuote(id)` → { yesPrice, noPrice }（1e18 scale，占比）
- `yesSharesOf(id, user)`, `noSharesOf(id, user)`, `claimed(id, user)`
- `chai()`, `minStake()`

## 价格与滑点（线性近似）
- 当前价：`yesPrice = yesStake / (yesStake + noStake)`（1e18 精度），`noPrice = 1 - yesPrice`。
- 买入 yes 时：
  - 起始价 `p0`，结束价（把本次下注视为全加到 yes 池）`p1`；
  - 平均价 `pAvg = (p0 + p1) / 2`；
  - 铸出份额 `sharesOut = amountIn / pAvg`（都按 1e18 缩放）；`minSharesOut` 为滑点保护。
  - no 同理。

## ethers v6 示例
```ts
// 配置 NFT 拍卖
await market.configureAuction(NFT_ADDR, closeTime);

// 创建价格档
await market.createMarket(NFT_ADDR, priceTarget);

// 用户授权并下注（amountIn: 本次下注的 CHAI）
await chai.approve(MARKET_ADDR, amountIn);
await market.buyYes(marketId, amountIn, minSharesOut);

// 录入成交价并结算
await market.setFinalAuctionPrice(NFT_ADDR, finalPrice);
await market.resolveAllForNFT(NFT_ADDR);

// 领取
await market.claim(marketId);
```
