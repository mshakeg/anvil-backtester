import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import {
  type IUniswapV3Factory,
  type IUniswapV3Pool,
  IUniswapV3Pool__factory,
  type TestERC20,
  TestUniswapV3Callee,
  TickMathTest,
  type INonfungiblePositionManager
} from "../../types";
import { FeeAmount } from "./shared/constants";
import { LiquidityChangeData, LogType, SwapData, PoolLog, PoolData } from "./shared/types";
import { deployUniswapV3Fixture } from "./uniswapV3Pool.fixture";

import poolData from './data/poolData.json';
import logs100 from './data/logs100.json';

// This function checks if the relative difference between two bigint values
// is within a specified percentage tolerance.
//
// e.g.,
// 0.0001 = 0.01%
// 0.001 = 0.1%
function isWithinTolerance(expected: bigint, actual: bigint, toleranceFraction: number = 0.001): boolean {
  // Special case: both values are zero
  if (expected === 0n && actual === 0n) {
    return true;
  }

  // Calculate the absolute difference between expected and actual
  const difference = expected > actual ? expected - actual : actual - expected;

  // Get the maximum of the absolute values of expected and actual
  const maxVal = expected >= actual ? (expected >= 0n ? expected : -expected) : (actual >= 0n ? actual : -actual);

  // Ensure maxVal is not zero (already checked both values being zero, so only one can be zero now)
  if (maxVal === 0n) {
    return false;
  }

  // Calculate the relative difference
  const relativeDifference = difference * 1_000_000n / maxVal;

  // Convert toleranceFraction to a comparable BigInt scaled by multiplier
  const toleranceAsBigInt = BigInt(Math.round(toleranceFraction * 1_000_000));

  // Check if the relative difference is within the specified tolerance range
  return relativeDifference <= toleranceAsBigInt;
}

describe("Anvil Memory Issue: foundry#6017", function () {
  let signers: HardhatEthersSigner[];
  const v3PoolData: PoolData = poolData;

  before(async function () {
    signers = await ethers.getSigners();
    this.loadFixture = loadFixture;
  });

  describe("UniswapV3 Transaction Replay", function () {
    let uniswapV3Factory: IUniswapV3Factory;
    let uniswapV3Pool: IUniswapV3Pool;
    let uniswapV3Callee: TestUniswapV3Callee;
    let nftManager: INonfungiblePositionManager;
    let tickMath: TickMathTest;

    let token0: TestERC20;
    let token1: TestERC20;

    let admin: HardhatEthersSigner;
    let lp1: HardhatEthersSigner;

    beforeEach(async function () {
      admin = signers[0];
      lp1 = signers[1];

      const { factory, tokens, testUniswapV3Callee, tickMathTest, nft } = network.name === "hardhat" ? await this.loadFixture(deployUniswapV3Fixture) : await deployUniswapV3Fixture();
      uniswapV3Factory = factory.connect(admin);
      uniswapV3Callee = testUniswapV3Callee.connect(admin);

      nftManager = nft.connect(admin);

      tickMath = tickMathTest;

      token0 = tokens[0].connect(admin);
      token1 = tokens[1].connect(admin);

      const adminBalance0 = await token0.balanceOf(admin);
      const adminBalance1 = await token1.balanceOf(admin);

      await token0.transfer(lp1, adminBalance0/10n);
      await token1.transfer(lp1, adminBalance1/10n);

      await token0.approve(uniswapV3Callee, ethers.MaxUint256);
      await token1.approve(uniswapV3Callee, ethers.MaxUint256);

      await token0.connect(lp1).approve(uniswapV3Callee, ethers.MaxUint256);
      await token1.connect(lp1).approve(uniswapV3Callee, ethers.MaxUint256);

      await token0.connect(lp1).approve(nftManager, ethers.MaxUint256);
      await token1.connect(lp1).approve(nftManager, ethers.MaxUint256);

      await nftManager.connect(lp1).setApprovalForAll(await nftManager.getAddress(), true);

      const creatTx = await uniswapV3Factory.createPool(token0, token1, FeeAmount.LOW);
      const createRc = await creatTx.wait();

      const poolCreatedLog = createRc?.logs[0] as any;

      uniswapV3Pool = IUniswapV3Pool__factory.connect(await admin.getAddress()).attach(
        poolCreatedLog.args.pool,
      ) as IUniswapV3Pool;
      uniswapV3Pool = uniswapV3Pool.connect(admin);

      const initSqrtPriceX96 = v3PoolData.initSqrtPriceX96;

      const tx = await uniswapV3Pool.initialize(initSqrtPriceX96);
      const rc = await tx.wait();

      const poolAddress = await uniswapV3Pool.getAddress();

      const poolLogs = logs100 as Array<PoolLog>;

      for (let index in poolLogs) {

        if (Number(index) > 0) { // we only need to mint a single position
          break;
        }

        const poolLog = poolLogs[index];

        switch (poolLog.type) {
          case LogType.Mint:
            const mintData: LiquidityChangeData = poolLog.data;
            const mintTx = await uniswapV3Callee.mint(
              poolAddress,
              admin,
              mintData.tickLower,
              mintData.tickUpper,
              mintData.amount,
            );
            const mintRc = await mintTx.wait();

            const mintCallbackEvent = mintRc?.logs[0] as any;
            expect(isWithinTolerance(BigInt(mintData.amount0), mintCallbackEvent.args[0])).to.be.true;
            expect(isWithinTolerance(BigInt(mintData.amount1), mintCallbackEvent.args[1])).to.be.true;
            break;
          case LogType.Burn:
            const burnData: LiquidityChangeData = poolLog.data;
            const burnAmount0 = BigInt(burnData.amount0);
            const burnAmount1 = BigInt(burnData.amount1);

            const burnTx = await uniswapV3Callee.burn(
              poolAddress,
              burnData.tickLower,
              burnData.tickUpper,
              burnData.amount,
            );
            const burnRc = await burnTx.wait();

            const burnEventLog = burnRc?.logs[1] as any;
            expect(isWithinTolerance(burnAmount0, burnEventLog?.args.amount0)).to.be.true;
            expect(isWithinTolerance(burnAmount1, burnEventLog?.args.amount1)).to.be.true;
            break;
          case LogType.Swap:
            const swapData: SwapData = poolLog.data;
            const amount0 = BigInt(swapData.amount0);
            const amount1 = BigInt(swapData.amount1);
            const liquidity = BigInt(swapData.liquidity);
            const sqrtPriceX96 = BigInt(swapData.sqrtPriceX96);

            let swapRc;
            if (amount0 < 0n) {
              const swapTx = await uniswapV3Callee.swapExact1For0(poolAddress, amount1, admin, 0n);
              swapRc = await swapTx.wait();
            }

            if (amount1 < 0n) {
              const swapTx = await uniswapV3Callee.swapExact0For1(poolAddress, amount0, admin, 0n);
              swapRc = await swapTx.wait();
            }

            if (!swapRc) {
              console.log(poolLog);
              throw new Error(`swapRc is unexpectedly undefined at index: ${poolLog.globalIndex}`);
            }

            let filteredLogs = swapRc?.logs.filter((log) => log.address.toLowerCase() === poolAddress.toLowerCase());

            const parsedLog = uniswapV3Pool.interface.parseLog({
              topics: [...filteredLogs[0].topics],
              data: filteredLogs[0].data,
            });

            expect(liquidity).to.be.eq(parsedLog?.args.liquidity);

            expect(
              isWithinTolerance(amount0, parsedLog?.args.amount0),
              `index: ${poolLog.globalIndex},${amount0.toString()},${parsedLog?.args.amount0.toString()}`,
            ).to.be.true;
            expect(
              isWithinTolerance(amount1, parsedLog?.args.amount1),
              `index: ${poolLog.globalIndex},${amount1.toString()},${parsedLog?.args.amount1.toString()}`,
            ).to.be.true;

            try {
              expect(isWithinTolerance(sqrtPriceX96, parsedLog?.args.sqrtPriceX96)).to.be.true;
            } catch {
              console.warn('Did not swap to expected final swap price');

              if (amount0 < 0n) {
                const swapTx = await uniswapV3Callee.swapExact1For0(poolAddress, amount1, admin, sqrtPriceX96);
                swapRc = await swapTx.wait();
              }

              if (amount1 < 0n) {
                const swapTx = await uniswapV3Callee.swapExact0For1(poolAddress, amount0, admin, sqrtPriceX96);
                swapRc = await swapTx.wait();
              }

              if (!swapRc) {
                throw new Error("swapRc is unexpectedly undefined");
              }

              filteredLogs = swapRc?.logs.filter((log) => log.address.toLowerCase() === poolAddress.toLowerCase());

              const parsedLog = uniswapV3Pool.interface.parseLog({
                topics: [...filteredLogs[0].topics],
                data: filteredLogs[0].data,
              });

              expect(liquidity).to.be.eq(parsedLog?.args.liquidity);
              expect(isWithinTolerance(sqrtPriceX96, parsedLog?.args.sqrtPriceX96)).to.be.true;
            }
            break;
        }
      }
    });

    const initLower = 191150
    const initUpper = 198080

    const testLower = 190_000;
    const testUpper = 200_000;

    async function doSwap(poolLog: any, poolAddress: string) {

      const swapData: SwapData = poolLog.data;
      const amount0 = BigInt(swapData.amount0);
      const amount1 = BigInt(swapData.amount1);
      const liquidity = BigInt(swapData.liquidity);
      const sqrtPriceX96 = BigInt(swapData.sqrtPriceX96);

      let swapRc;
      if (amount0 < 0n) {
        const swapTx = await uniswapV3Callee.swapExact1For0(poolAddress, amount1, admin, 0n);
        swapRc = await swapTx.wait();
      }

      if (amount1 < 0n) {
        const swapTx = await uniswapV3Callee.swapExact0For1(poolAddress, amount0, admin, 0n);
        swapRc = await swapTx.wait();
      }

    }

    it("should mint(burn & collect) position over both same ticks directly using UniswapV3Callee TWICE", async function () {

      console.log("- - - - Test 1 - - - -")

      const poolAddress = await uniswapV3Pool.getAddress();

      const mintAmount = 1e6;

      const mintTx1 = await uniswapV3Callee.connect(lp1).mint(
        poolAddress,
        admin,
        initLower,
        initUpper,
        mintAmount,
      );
      const mintRc1 = await mintTx1.wait();

      console.log("mintRc1:", mintRc1?.gasUsed)

      const mintTx2 = await uniswapV3Callee.connect(lp1).mint(
        poolAddress,
        admin,
        initLower,
        initUpper,
        mintAmount,
      );
      const mintRc2 = await mintTx2.wait();

      console.log("mintRc2:", mintRc2?.gasUsed)

      const poolLogs = logs100 as Array<PoolLog>;
      await doSwap(poolLogs[1], poolAddress)

      const collectTx = await uniswapV3Callee.connect(lp1).collect(
        poolAddress,
        initLower,
        initUpper
      );
      const collectRc = await collectTx.wait();

      console.log("collectRc:", collectRc?.gasUsed)

      const burnTx1 = await uniswapV3Callee.burn(
        poolAddress,
        initLower,
        initUpper,
        mintAmount,
      );
      const burnRc1 = await burnTx1.wait();

      console.log("burnRc1:", burnRc1?.gasUsed)

      const burnTx2 = await uniswapV3Callee.burn(
        poolAddress,
        initLower,
        initUpper,
        mintAmount,
      );
      const burnRc2 = await burnTx2.wait();

      console.log("burnRc2:", burnRc2?.gasUsed)

    });

    it("should mint(burn & collect) position over both same ticks via NFTManager TWICE", async function () {

      console.log("- - - - Test 2 - - - -")

      const poolAddress = await uniswapV3Pool.getAddress();
      const mintAmount = 1e6;

      const mintParams: INonfungiblePositionManager.MintParamsStruct = {
        token0: await token0.getAddress(),
        token1: await token1.getAddress(),
        fee: FeeAmount.LOW,
        tickLower: initLower,
        tickUpper: initUpper,
        amount0Desired: 1e9,
        amount1Desired: 1e9,
        amount0Min: 2,
        amount1Min: 2,
        recipient: await lp1.getAddress(),
        deadline: ethers.MaxUint256
      }

      const mintTx1 = await nftManager.connect(lp1).mint(mintParams);
      const mintRc1 = await mintTx1.wait();
      console.log("mintRc1:", mintRc1?.gasUsed)

      const mintTx2 = await nftManager.connect(lp1).mint(mintParams);
      const mintRc2 = await mintTx2.wait();
      console.log("mintRc2:", mintRc2?.gasUsed)

      const poolLogs = logs100 as Array<PoolLog>;
      await doSwap(poolLogs[1], poolAddress)

      console.log("here 1")

      // const collectParams: INonfungiblePositionManager.CollectParamsStruct = {
      //   tokenId: 1,
      //   recipient: await lp1.getAddress(),
      //   amount0Max: 0,
      //   amount1Max: 0,
      // }

      // const collectTx = await nftManager.connect(lp1).collect(collectParams);
      // const collectRc = await collectTx.wait();
      // console.log("collectRc:", collectRc?.gasUsed);

      const positionLiquidity = (await nftManager.positions(1)).liquidity;

      const burnParams: INonfungiblePositionManager.DecreaseLiquidityParamsStruct = {
        tokenId: 1,
        liquidity: positionLiquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: ethers.MaxUint256
      }

      const burnTx1 = await nftManager.connect(lp1).decreaseLiquidity(burnParams);
      const burnRc1 = await burnTx1.wait();
      console.log("burnRc1:", burnRc1?.gasUsed)

      burnParams.tokenId = 2;
      const burnTx2 = await nftManager.connect(lp1).decreaseLiquidity(burnParams);
      const burnRc2 = await burnTx2.wait();
      console.log("burnRc2:", burnRc2?.gasUsed)

    });

    it("should mint(burn & collect) position over both different ticks directly using UniswapV3Callee TWICE", async function () {

    });

    it("should mint(burn & collect) position over both different ticks directly via NFTManager TWICE", async function () {

    });

  });
});

// npx hardhat --network hardhat test test/uniswapV3/gas-test.spec.ts
