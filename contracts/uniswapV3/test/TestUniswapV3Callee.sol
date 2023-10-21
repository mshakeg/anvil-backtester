// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.7.6;
pragma abicoder v2;

import "@uniswap/v3-core/contracts/interfaces/IERC20Minimal.sol";

import "@uniswap/v3-core/contracts/libraries/SafeCast.sol";
import "@uniswap/v3-core/contracts/libraries/TickMath.sol";

import "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3MintCallback.sol";
import "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3FlashCallback.sol";

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import { Multicall } from "../periphery/base/Multicall.sol";

contract TestUniswapV3Callee is Multicall, IUniswapV3MintCallback, IUniswapV3SwapCallback, IUniswapV3FlashCallback {
    using SafeCast for uint256;

    function adjustSqrtPriceLimitX96(
        bool zeroForOne,
        uint160 sqrtPriceLimitX96
    ) internal returns (uint160 adjustedSqrtPriceLimitX96) {
        adjustedSqrtPriceLimitX96 = sqrtPriceLimitX96 == 0
            ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
            : sqrtPriceLimitX96;
    }

    function swapExact0For1(address pool, uint256 amount0In, address recipient, uint160 sqrtPriceLimitX96) external {
        sqrtPriceLimitX96 = adjustSqrtPriceLimitX96(true, sqrtPriceLimitX96);
        IUniswapV3Pool(pool).swap(recipient, true, amount0In.toInt256(), sqrtPriceLimitX96, abi.encode(msg.sender));
    }

    function swap0ForExact1(address pool, uint256 amount1Out, address recipient, uint160 sqrtPriceLimitX96) external {
        sqrtPriceLimitX96 = adjustSqrtPriceLimitX96(true, sqrtPriceLimitX96);
        IUniswapV3Pool(pool).swap(recipient, true, -amount1Out.toInt256(), sqrtPriceLimitX96, abi.encode(msg.sender));
    }

    function swapExact1For0(address pool, uint256 amount1In, address recipient, uint160 sqrtPriceLimitX96) external {
        sqrtPriceLimitX96 = adjustSqrtPriceLimitX96(false, sqrtPriceLimitX96);
        IUniswapV3Pool(pool).swap(recipient, false, amount1In.toInt256(), sqrtPriceLimitX96, abi.encode(msg.sender));
    }

    function swap1ForExact0(address pool, uint256 amount0Out, address recipient, uint160 sqrtPriceLimitX96) external {
        sqrtPriceLimitX96 = adjustSqrtPriceLimitX96(false, sqrtPriceLimitX96);
        IUniswapV3Pool(pool).swap(recipient, false, -amount0Out.toInt256(), sqrtPriceLimitX96, abi.encode(msg.sender));
    }

    function swapToLowerSqrtPrice(address pool, uint160 sqrtPriceX96, address recipient) external {
        IUniswapV3Pool(pool).swap(recipient, true, type(int256).max, sqrtPriceX96, abi.encode(msg.sender));
    }

    function swapToHigherSqrtPrice(address pool, uint160 sqrtPriceX96, address recipient) external {
        IUniswapV3Pool(pool).swap(recipient, false, type(int256).max, sqrtPriceX96, abi.encode(msg.sender));
    }

    event SwapCallback(int256 amount0Delta, int256 amount1Delta);

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external override {
        address sender = abi.decode(data, (address));

        emit SwapCallback(amount0Delta, amount1Delta);

        if (amount0Delta > 0) {
            IERC20Minimal(IUniswapV3Pool(msg.sender).token0()).transferFrom(sender, msg.sender, uint256(amount0Delta));
        } else if (amount1Delta > 0) {
            IERC20Minimal(IUniswapV3Pool(msg.sender).token1()).transferFrom(sender, msg.sender, uint256(amount1Delta));
        } else {
            // if both are not gt 0, both must be 0.
            assert(amount0Delta == 0 && amount1Delta == 0);
        }
    }

    function mint(address pool, address recipient, int24 tickLower, int24 tickUpper, uint128 amount) external {
        recipient = address(this); // temp force recipient to be this contract so that this contract can also burn the liquidity
        IUniswapV3Pool(pool).mint(recipient, tickLower, tickUpper, amount, abi.encode(msg.sender));
    }

    event MintCallback(uint256 amount0Owed, uint256 amount1Owed);

    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external override {
        address sender = abi.decode(data, (address));

        emit MintCallback(amount0Owed, amount1Owed);
        if (amount0Owed > 0)
            IERC20Minimal(IUniswapV3Pool(msg.sender).token0()).transferFrom(sender, msg.sender, amount0Owed);
        if (amount1Owed > 0)
            IERC20Minimal(IUniswapV3Pool(msg.sender).token1()).transferFrom(sender, msg.sender, amount1Owed);
    }

    event FlashCallback(uint256 fee0, uint256 fee1);

    function flash(
        address pool,
        address recipient,
        uint256 amount0,
        uint256 amount1,
        uint256 pay0,
        uint256 pay1
    ) external {
        IUniswapV3Pool(pool).flash(recipient, amount0, amount1, abi.encode(msg.sender, pay0, pay1));
    }

    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external override {
        emit FlashCallback(fee0, fee1);

        (address sender, uint256 pay0, uint256 pay1) = abi.decode(data, (address, uint256, uint256));

        if (pay0 > 0) IERC20Minimal(IUniswapV3Pool(msg.sender).token0()).transferFrom(sender, msg.sender, pay0);
        if (pay1 > 0) IERC20Minimal(IUniswapV3Pool(msg.sender).token1()).transferFrom(sender, msg.sender, pay1);
    }

    event BurnEvent(uint256 amount0, uint256 amount1);

    // extra: add burn
    function burn(address pool, int24 tickLower, int24 tickUpper, uint128 amount) external {
        (uint256 amount0, uint256 amount1) = IUniswapV3Pool(pool).burn(tickLower, tickUpper, amount);
        emit BurnEvent(amount0, amount1);
    }

    function collect(address pool, int24 tickLower, int24 tickUpper) external {
        IUniswapV3Pool(pool).collect(
            msg.sender,
            tickLower,
            tickUpper,
            0,
            0
        );
    }
}