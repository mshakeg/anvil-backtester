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

// foundry#6017 - memory issue - partly resolved
// foundry#7039 - block mining performance issue - unresolved
describe("Anvil Issues: foundry#6017 AND foundry#7039", function () {
  let signers: HardhatEthersSigner[];
  const v3PoolData: PoolData = poolData;

  before(async function () {
    // disable anvil node logging to help reduce time
    await network.provider.send("anvil_setLoggingEnabled", [false]);
    signers = await ethers.getSigners();
    this.loadFixture = loadFixture;
  });

  describe("UniswapV3 Transaction Replay", function () {
    let uniswapV3Factory: IUniswapV3Factory;
    let uniswapV3Pool: IUniswapV3Pool;
    let uniswapV3Callee: TestUniswapV3Callee;
    let tickMath: TickMathTest;

    let token0: TestERC20;
    let token1: TestERC20;

    let admin: HardhatEthersSigner;

    beforeEach(async function () {
      admin = signers[0];

      const { factory, tokens, testUniswapV3Callee, tickMathTest } = network.name === "hardhat" ? await this.loadFixture(deployUniswapV3Fixture) : await deployUniswapV3Fixture();
      uniswapV3Factory = factory.connect(admin);
      uniswapV3Callee = testUniswapV3Callee.connect(admin);

      tickMath = tickMathTest;

      token0 = tokens[0].connect(admin);
      token1 = tokens[1].connect(admin);

      await token0.approve(uniswapV3Callee, ethers.MaxUint256);
      await token1.approve(uniswapV3Callee, ethers.MaxUint256);

      const tx = await uniswapV3Factory.createPool(token0, token1, FeeAmount.LOW);
      const rc = await tx.wait();

      const poolCreatedLog = rc?.logs[0] as any;

      uniswapV3Pool = IUniswapV3Pool__factory.connect(await admin.getAddress()).attach(
        poolCreatedLog.args.pool,
      ) as IUniswapV3Pool;
      uniswapV3Pool = uniswapV3Pool.connect(admin);
    });

    it("should replicate the first 100 pool logs and then expand anvil memory usage", async function () {

      const initSqrtPriceX96 = v3PoolData.initSqrtPriceX96;

      const tx = await uniswapV3Pool.initialize(initSqrtPriceX96);
      const rc = await tx.wait();

      const poolAddress = await uniswapV3Pool.getAddress();

      const poolLogs = logs100 as Array<PoolLog>;

      for (let index in poolLogs) {

        if (Number(index) == poolLogs.length - 1) { // Don't process last swap log since it'll be used to construct the null block
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

      const initialSqrtPriceX96 = (await uniswapV3Pool.slot0()).sqrtPriceX96;

      const lastSwapLog = poolLogs[poolLogs.length - 1];

      const swapData = lastSwapLog.data as SwapData;
      const amount0 = BigInt(swapData.amount0);
      const amount1 = BigInt(swapData.amount1);
      const liquidity = BigInt(swapData.liquidity);
      const sqrtPriceX96 = BigInt(swapData.sqrtPriceX96);

      // NOTE nullSwapsPerBlock can be used to more accurately gauge the raw evm TPS
      // a higher value of nullSwapsPerBlock entails more time spent processing txs relative to mining blocks with those txs
      const nullSwapsPerBlock = 2000; // the number of times to create a swap in a given direction and to cancel it in the opposite direction

      // Example runs demoing how the foundry anvil node spends quite a bit of time mining blocks which could probably be improved
      // {
      //   blocksToMine: 25,
      //   nullSwapsPerBlock: 1,
      //   totalTxs: 50,
      //   executionTime: 0.084,
      //   averageTPS: 595.2380952380952,
      //   averageTimePerTx: 1.6800000000000002
      // }

      // {
      //   blocksToMine: 25,
      //   nullSwapsPerBlock: 2000,
      //   totalTxs: 100000,
      //   executionTime: 24.747,
      //   averageTPS: 4040.8938457186728,
      //   averageTimePerTx: 0.24747000000000002
      // }

      const nullBlockData: Array<string> = [];

      const adminAddress: string = await admin.getAddress();

      for (let i = 0; i < nullSwapsPerBlock; i++) {
        if (amount0 < 0n) {
          // push actual swap transaction first, then push swap to cancel the actual transaction
          nullBlockData.push(
            uniswapV3Callee.interface.encodeFunctionData("swapExact1For0", [
              poolAddress,
              amount1 * 2n, // NOTE: there's no issue overcompensating the amountIn since the worst price i.e. sqrtPriceLimitX96 is set
              adminAddress,
              sqrtPriceX96
            ])
          );

          nullBlockData.push(
            uniswapV3Callee.interface.encodeFunctionData("swapExact0For1", [
              poolAddress,
              amount0 * -2n,
              adminAddress,
              initialSqrtPriceX96
            ])
          );
        }

        if (amount1 < 0n) {
          // push actual swap transaction first, then push swap to cancel the actual transaction
          nullBlockData.push(
            uniswapV3Callee.interface.encodeFunctionData("swapExact0For1", [
              poolAddress,
              amount0 * 2n,
              adminAddress,
              sqrtPriceX96
            ])
          );

          nullBlockData.push(
            uniswapV3Callee.interface.encodeFunctionData("swapExact1For0", [
              poolAddress,
              amount1 * -2n,
              adminAddress,
              initialSqrtPriceX96
            ])
          );
        }
      }

      const blocksToMine = 10;
      const feeData = await ethers.provider.getFeeData();
      const gasPrice = feeData.gasPrice ? feeData.gasPrice.toString() : 0;

      const doMulticall = true;
      const doChecks = false;
      const sendUnsigned = true;
      const uniswapV3CalleeAddress = await uniswapV3Callee.getAddress();

      // turn of auto & interval mining and manually mining blocks
      await network.provider.send("evm_setIntervalMining", [0]);

      let timestamp = 1619830000; // 10_000s from genesis

      const swapsInNullBlock = BigInt(nullBlockData.length);

      const callGasLimit = 1e6;
      const overallStartTime = Date.now();

      for (let i = 0; i < blocksToMine; i++) {

        await network.provider.send("evm_setNextBlockTimestamp", [timestamp])

        const startTime = Date.now();

        if (doMulticall) {
          if (sendUnsigned) {
            const multicallTxCalldata = await uniswapV3Callee.interface.encodeFunctionData("multicall", [nullBlockData]);
            await network.provider.send("eth_sendUnsignedTransaction", [{
              data: multicallTxCalldata,
              from: adminAddress,
              to: uniswapV3CalleeAddress,
              gas: callGasLimit,
              gasPrice
            }]);
          } else {
            await uniswapV3Callee.multicall(nullBlockData, {
              gasLimit: BigInt(callGasLimit) * swapsInNullBlock,
              gasPrice
            });
          }
        } else {
          for (const nullBlockTxCalldata of nullBlockData) {
            if (sendUnsigned) {
              await network.provider.send("eth_sendUnsignedTransaction", [{
                data: nullBlockTxCalldata,
                from: adminAddress,
                to: uniswapV3CalleeAddress,
                gas: callGasLimit,
                gasPrice
              }]);
            } else {
              const txRequest = await admin.populateTransaction({
                data: nullBlockTxCalldata,
                from: adminAddress,
                to: uniswapV3CalleeAddress,
                gasLimit: callGasLimit,
                gasPrice
              })
              await admin.sendTransaction(txRequest);
            }
          }
        }

        await network.provider.send("evm_mine");

        if (doChecks) {
          const finalSqrtPriceX96 = (await uniswapV3Pool.slot0()).sqrtPriceX96;
          expect(isWithinTolerance(initialSqrtPriceX96, finalSqrtPriceX96)).to.be.true;
          const endTime = Date.now();
          console.log("processed nullblock", i, endTime - startTime);
        }

        timestamp += 15;
      }

      const overallEndTime = Date.now();

      const totalTxs = blocksToMine * nullSwapsPerBlock * 2; // each null swap is effectively 2 swap txs
      const executionTime = (overallEndTime - overallStartTime) / 1000; // in seconds

      const averageTPS = totalTxs / executionTime;
      const averageTimePerTx = 1000 / averageTPS; // in milliseconds

      console.log({
        blocksToMine,
        nullSwapsPerBlock,
        totalTxs,
        executionTime,
        averageTPS,
        averageTimePerTx
      });

    });
  });
});
