# AuctionPricePredictionMarket 业务流程（多 NFT，多价格档，线性滑点定价）

本流程描述用户、Owner 在一个 NFT 拍卖预测中从创建到结算的全链路，以及价格/滑点的计算方式。

## RWA NFT 概述与确权
- NFT 类型：`ChaiYaoNFT`（单枚/小规模发行，映射一件实物藏品）。
- 确权/映射：
  - 每个 NFT 对应一件物理藏品，元数据包含 `assetTag` 与 `tokenURI`（可指向 IPFS/HTTPS 的图片、报告、链上证明等）。
  - 绑定碎片化代币：`fragmentToken`（CHAI）一旦设置不可替换，记录 NFT 与代币价值锚定关系。
  - 设备/UID 选项：`deviceSigner`（签名验证）与 `deviceUID`（明文 UID），可用于上传硬件心跳或 UID 报告，时间戳记录在 `deviceProofAt`。
- 业务含义：每个 NFT 代表一件 RWA 藏品，预测市场围绕该 NFT 的下一场拍卖成交价；因此每个 NFT 拥有独立的 `closeTime` 与 `finalAuctionPrice`。

## 角色
- Owner：配置拍卖、创建价格档、录入成交价、批量结算。
- 用户：授权 CHAI给交易合约，选择价格档进行 buyYes/buyNo，下单时带滑点保护，结算后按份额领取池子中的 CHAI。

## 状态元素
- NFT 级别：
  - `closeTime`：下注截止时间（每个 NFT 独立）。
  - `finalAuctionPrice` / `finalPriceSet`：最终成交价（每个 NFT 独立，一次性设置）。
- 市场级别（每个 marketId代表不同的预测价格）：
  - `nftAsset`：归属的 NFT。
  - `priceTarget`：预测阈值（问题：最终成交价是否 >= priceTarget）。
  - `outcome`：Undecided / Yes / No。
  - `yesStake` / `noStake`：两边的 CHAI 池。
  - `yesShares` / `noShares`：两边发行的“份额”，用于结算按份额瓜分池子。
- 用户级别：
  - `yesSharesOf` / `noSharesOf`：用户在某市场的持仓份额。
  - `claimed`：是否已领取。

## 生命周期
1) Owner 配置拍卖：为某 NFT 设置 `closeTime`。
2) Owner 创建marketId：为同一 NFT 多次创建不同 marketId，每个marketId有不同的`priceTarget`；只能在该 NFT 的 `closeTime` 之前创建。
3) 用户授权：用户对市场合约授权 CHAI（amountIn）。
4) 用户下单：`buyYes` 或 `buyNo`，需在 `closeTime` 前。价格随池子占比线性变化（见下方计算）。
   - 输入：`amountIn`（本次下注 CHAI），`minSharesOut`（滑点保护）。
   - 输出：`sharesOut`（获得的份额），池子和份额累加。
5) Owner 录入成交价：`finalAuctionPrice`（一次性），需在 `closeTime` 后。
6) 结算：
   - 单个市场：`resolve(marketId)`。
   - 批量：`resolveAllForNFT(nft)` 遍历该 NFT 的市场列表。
   - 判定：`finalAuctionPrice >= priceTarget` → Yes，否则 No。
7) 领取：赢家用户按份额瓜分池子 `yesStake + noStake`。败方无法领取。

## 价格与滑点（线性近似）
记 price scale 为 1e18（100%），金额与份额均用 18 位精度。

### 下单时的价格计算
设当前池子：
- yesStake，noStake，totalStake = yesStake + noStake。

步骤：
1) 当前价格 `p0`：
   - 若 totalStake == 0，则 p0 = 0.5（PRICE_SCALE/2）。
   - 否则 p0 = yesStake / totalStake（用 1e18 缩放）。
2) 假设本次 amountIn 全加到所选边，得到新池：
   - 若买 yes：postYes = yesStake + amountIn，postTotal = totalStake + amountIn。
   - 若买 no：postYes = yesStake（不变），postTotal = totalStake + amountIn。
3) 新价格 `p1` = postYes / postTotal（1e18 缩放）。
4) 交易均价 `pAvg` = (p0 + p1) / 2。
5) 份额铸出 `sharesOut` = amountIn / pAvg（注意都在 1e18 精度下：sharesOut = amountIn * 1e18 / pAvg）。
6) 滑点保护：用户传入 `minSharesOut`，若 sharesOut < minSharesOut 则交易回滚（Slippage）。

直观理解：
- 池子占比越向某一侧倾斜，买入该侧的 p1 越高，均价 pAvg 越高，得到的 sharesOut 越少。
- 首笔下单 totalStake=0 时，p0=0.5，p1 取决于 amountIn，均价约 0.5–1.0 之间。

### 下单后的状态更新
- 选边的 stake 增加 amountIn，另一边不变。
- 选边的 shares 增加 sharesOut。
- 用户持仓 sharesOf 增加 sharesOut。

## 结算与兑付
- 先确保过了 `closeTime` 且已设置 `finalAuctionPrice`。
- 判定 outcome：finalAuctionPrice >= priceTarget → Yes，否则 No。
- 总池：pool = yesStake + noStake。
- 赢家份额总和：winnerShares = yesShares 或 noShares。
- 用户可领：userPayout = (userShares / winnerShares) * pool。
- 败方份额不可领取；已领取的用户标记 claimed，防重复。

## 风险与约束
- 价格为线性近似，不是 AMM（如 LMSR）；滑点由 p0/p1 均值决定，池子小或偏斜时波动较大。
- 建议前端：展示当前 quote（getQuote），预估 sharesOut，用 `minSharesOut` 防止被重入交易夹子。
- 首笔下注价格对均价影响大，可提示用户注意首单滑点。
