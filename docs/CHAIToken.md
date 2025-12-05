# CHAIToken (ERC20) 前端调用说明

固定供应的 CHAI 代币（18 位小数），在部署时一次性铸给部署者。

## 合约信息
- 名称 / 符号：`ChaiYao Fractional Token` / `CHAI`
- 小数位：`18`
- 初始供应：`1,000,000,000 * 1e18` 铸给部署者
- 关联 NFT 地址（只读）：`chaiYaoNFT()`

## 常用只读
- `totalSupply()` → 总供应。
- `balanceOf(address)` → 用户余额。
- `allowance(owner, spender)` → 剩余授权额度。

## 常用写入
- `approve(spender, amount)` → 设置 ERC20 授权，用于下注/交易。
- `transfer(to, amount)` → 转账。
- `transferFrom(from, to, amount)` → 通过授权扣款。

## 前端调用示例（ethers v6）
```ts
import { ethers } from "ethers";
const chai = new ethers.Contract(CHAI_ADDRESS, CHAI_ABI, signer);

// 授权 100 CHAI
await chai.approve(spender, ethers.parseUnits("100", 18));

// 读取余额
const bal = await chai.balanceOf(user);
```
