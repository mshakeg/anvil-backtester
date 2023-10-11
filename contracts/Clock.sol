// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.6;
pragma abicoder v2;

contract Clock {

    // @dev for some reason this file fails to compile if the functions are named time, block, timestamp
    function latestBlock() public view returns (uint256) {
        return block.number;
    }

    function latestTime() public view returns (uint256) {
        return block.timestamp;
    }
}
