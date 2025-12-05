// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title CHAIToken
 * @notice Fixed-supply ERC20 representing fractional ownership of ChaiYao assets; value dependency recorded by linking to the ChaiYao NFT.
 */
contract CHAIToken is ERC20 {
    uint256 private constant INITIAL_SUPPLY = 1_000_000_000 * 1e18;

    address public immutable chaiYaoNFT;

    event ValueDependencySet(address indexed chaiYaoNFT);

    constructor(address chaiYaoNft_) ERC20("ChaiYao Fractional Token", "CHAI") {
        require(chaiYaoNft_ != address(0), "NFT address required");
        chaiYaoNFT = chaiYaoNft_;
        _mint(msg.sender, INITIAL_SUPPLY);
        emit ValueDependencySet(chaiYaoNFT);
    }
}
