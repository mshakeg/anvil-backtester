import {
  abi as FACTORY_ABI,
  bytecode as FACTORY_BYTECODE,
} from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import {
  abi as SWAP_ROUTER_ABI,
  bytecode as SWAP_ROUTER_BYTECODE,
} from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import { ethers } from "hardhat";

import type { ISwapRouter, IUniswapV3Factory, IWETH9 } from "../../../types";
import WETH9 from "../contracts/WETH9.json";

export const getAdmin = async (adminIndex: number = 0) => {
  const signers = await ethers.getSigners();
  return signers[adminIndex];
};

const wethFixture = async (adminIndex: number = 0) => {
  const admin = await getAdmin(adminIndex);

  const WETH9Factory = new ethers.ContractFactory(WETH9.abi, WETH9.bytecode, admin);

  const weth9 = (await WETH9Factory.connect(admin).deploy()) as IWETH9;

  return { weth9 };
};

const v3CoreFactoryFixture = async (adminIndex: number = 0) => {
  const admin = await getAdmin(adminIndex);

  const UniswapV3FactoryFactory = new ethers.ContractFactory(FACTORY_ABI, FACTORY_BYTECODE, admin);

  return (await UniswapV3FactoryFactory.connect(admin).deploy()) as IUniswapV3Factory;
};

export const v3RouterFixture = async (adminIndex: number = 0) => {
  const { weth9 } = await wethFixture(adminIndex);
  const factory = await v3CoreFactoryFixture(adminIndex);
  const admin = await getAdmin(adminIndex);
  const SwapRouterFactory = new ethers.ContractFactory(SWAP_ROUTER_ABI, SWAP_ROUTER_BYTECODE, admin);
  const factoryAddress = await factory.getAddress();
  const weth9Address = await weth9.getAddress();
  const router = (await SwapRouterFactory.connect(admin).deploy(factoryAddress, weth9Address)) as ISwapRouter;
  return { factory, weth9, router };
};
