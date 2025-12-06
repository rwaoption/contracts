# RWA Option / Prediction Markets

Monorepo for a CHAI-based RWA system:
- `ChaiYaoNFT`: RWA NFT for a physical collectible, supports authenticity hooks (device signer / UID) and links to a fractional token.
- `CHAIToken`: Fixed-supply ERC20 fractional token linked to the NFT.
- `AuctionPricePredictionMarket`: Multi-NFT, multi-price yes/no prediction market using CHAI with linear-slippage pricing.

## Contracts
- `contracts/ChaiYaoNFT.sol`: Single/small-supply NFT; owner-gated mint, updatable tokenURI, device UID/signature proofs, one-time link to CHAI.
- `contracts/CHAIToken.sol`: 1B supply to deployer; immutable link to NFT.
- `contracts/AuctionPricePredictionMarket.sol`:
  - Per NFT: `closeTime`, `finalAuctionPrice`.
  - Per market: `priceTarget`, yes/no stakes & shares, outcome, bettors count.
  - Linear slippage: price = pool ratio; trade price = avg(p0, p1) with `sharesOut = amountIn / pAvg`.
  - Buy yes/no with CHAI, slippage guard via `minSharesOut`.
  - Resolve per market or all markets for an NFT; claim splits total pool pro‑rata to winner shares.

## Setup
```bash
yarn install
npx hardhat compile
```
Environment (.env) keys typically used:
```
PRIVATE_KEY=...
PRIVATE_KEY_2=...
PRIVATE_KEY_3=...
CHAI_TOKEN_ADDRESS=...
CHAIYAO_NFT_ADDRESS=...
AUCTION_PRICE_PREDICTION_MARKET_ADDRESS=...
OPBNB_TESTNET_RPC=...
NODEREAL_API_KEY=...    # optional, for verification
MIN_STAKE=...           # optional override for market min stake
```

## Scripts
- Deploy all (NFT + CHAI + Market + link + auction config): `scripts/deploy.ts`
- Deploy only market (using existing CHAI, config auction for NFT): `scripts/deployMarketOnly.ts`
- Create price targets: `scripts/createMarkets.ts` (uses three fixed targets: 600000000, 500000000, 300000000)
- Business flow test (fund users, buy yes/no, show quotes; no resolve): `scripts/runBusinessFlow.ts`
- Verify existing contracts via NodeReal: `scripts/verifyExisting.ts`
- Sanity check code presence: `scripts/test.ts`

Run with network:
```bash
npx hardhat run scripts/deploy.ts --network opbnbTestnet
npx hardhat run scripts/runBusinessFlow.ts --network opbnbTestnet
npx hardhat run scripts/createMarkets.ts --network opbnbTestnet
```

## Tests
Unit tests (Hardhat + ethers v6):
```bash
npx hardhat test tests/AuctionPricePredictionMarket.test.ts
```
Coverage includes buy pricing, slippage guard, pro‑rata claim, resolveAllForNFT.

## Pricing & Quotes (Market)
- Quote: `getQuote(marketId)` returns yes/no ratios (1e18 = 100%), derived from yesStake/noStake. If pool is empty, returns (0,0); frontends should display “no liquidity” or 50/50.
- Trade: price uses linear slippage approximation:
  - p0 = yesStake / total (or 0.5 if total=0)
  - p1 = price after adding amountIn to the chosen side
  - pAvg = (p0 + p1) / 2
  - sharesOut = amountIn / pAvg (PRICE_SCALE=1e18)

## RWA Notes (NFT)
- Each NFT represents a physical collectible; `assetTag` + `tokenURI` store metadata (e.g., IPFS).
- Optional authenticity: `deviceSigner` (signature-based heartbeats), `deviceUID` (plaintext UID), timestamps in `deviceProofAt`.
- `fragmentToken` (CHAI) is linked once and immutable to signal value dependency.

## Common Flows
- Configure auction (per NFT): `configureAuction(nft, closeTime)`
- Create markets (per NFT): `createMarket(nft, priceTarget)` before closeTime
- Buy: `buyYes/BuyNo(marketId, amountIn, minSharesOut)`; approve CHAI first
- Set final price (per NFT): `setFinalAuctionPrice(nft, finalPrice)` after closeTime
- Resolve: `resolve(marketId)` or `resolveAllForNFT(nft)`
- Claim: winners call `claim(marketId)` to split total pool

## Notes on Gas / Wallets
- opBNB Testnet requires non-zero tip; set `maxPriorityFeePerGas` ≥ 1 gwei (or legacy `gasPrice`) if using wallets that default to 0.
- Ensure accounts have OPBNB for gas and CHAI for trades/approvals.
