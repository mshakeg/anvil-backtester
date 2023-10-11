import {
  abi as NON_FUNGIBLE_POSITION_MANAGER_ABI,
  bytecode as NON_FUNGIBLE_POSITION_MANAGER_BYTECODE,
} from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import {
  abi as NFT_POSITION_DESCRIPTOR_ABI,
  bytecode as NFT_POSITION_DESCRIPTOR_BYTECODE,
} from "@uniswap/v3-periphery/artifacts/contracts/NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json";
import {
  abi as NFT_DESCRIPTOR_ABI,
  bytecode as NFT_DESCRIPTOR_BYTECODE,
} from "@uniswap/v3-periphery/artifacts/contracts/libraries/NFTDescriptor.sol/NFTDescriptor.json";
import { solidityPackedKeccak256 } from "ethers";
import { ethers } from "hardhat";

import type {
  INonfungiblePositionManager,
  INonfungibleTokenPositionDescriptor,
  TestERC20,
  TestUniswapV3Callee,
  TickMathTest,
  LiquidityAmountsTest,
  FullMathTest,
  TickTest,
  Clock
} from "../../../types";
import { getAdmin, v3RouterFixture } from "./externalFixtures";
import { linkLibraries } from "./linkLibraries";

function linkLibrary(
  bytecode: string,
  libraries: {
    [name: string]: string;
  } = {},
): string {
  let linkedBytecode = bytecode;
  for (const [name, address] of Object.entries(libraries)) {
    const placeholder = `__\$${solidityPackedKeccak256(["string"], [name]).slice(2, 36)}\$__`;
    const formattedAddress = ethers.getAddress(address).toLowerCase().replace("0x", "");
    if (linkedBytecode.indexOf(placeholder) === -1) {
      throw new Error(`Unable to find placeholder for library ${name}`);
    }
    while (linkedBytecode.indexOf(placeholder) !== -1) {
      linkedBytecode = linkedBytecode.replace(placeholder, formattedAddress);
    }
  }
  return linkedBytecode;
}

async function sortTokens(tokens: TestERC20[]) {
  const addresses = await Promise.all(tokens.map((token) => token.getAddress()));
  tokens.sort((a, b) => {
    const addressA = addresses[tokens.indexOf(a)].toLowerCase();
    const addressB = addresses[tokens.indexOf(b)].toLowerCase();
    return addressA < addressB ? -1 : 1;
  });
}

const completeFixture = async (adminIndex: number = 0) => {
  const admin = await getAdmin(adminIndex);

  const { weth9, factory, router } = await v3RouterFixture(adminIndex);

  const halfMax = ethers.MaxUint256 / 2n;

  const testUniswapV3CalleeFactory = await ethers.getContractFactory("TestUniswapV3Callee");
  const testUniswapV3Callee = (await testUniswapV3CalleeFactory.connect(admin).deploy()) as TestUniswapV3Callee;

  const testUniswapV3CalleeExtra = (await testUniswapV3CalleeFactory.connect(admin).deploy()) as TestUniswapV3Callee;

  const tickMathTestFactory = await ethers.getContractFactory("TickMathTest");
  const tickMathTest = (await tickMathTestFactory.connect(admin).deploy()) as TickMathTest;

  const liquidityAmountsTestFactory = await ethers.getContractFactory("LiquidityAmountsTest");
  const liquidityAmountsTest = (await liquidityAmountsTestFactory.connect(admin).deploy()) as LiquidityAmountsTest;

  const fullMathTestFactory = await ethers.getContractFactory("FullMathTest");
  const fullMathTest = (await fullMathTestFactory.connect(admin).deploy()) as FullMathTest;

  const tickTestFactory = await ethers.getContractFactory("TickTest");
  const tickTest = (await tickTestFactory.connect(admin).deploy()) as TickTest;

  const clockFactory = await ethers.getContractFactory("Clock");
  const clock = (await clockFactory.connect(admin).deploy()) as Clock;

  const tokenFactory = await ethers.getContractFactory("TestERC20");
  const tokens: [TestERC20, TestERC20, TestERC20] = [
    (await tokenFactory.connect(admin).deploy(halfMax)) as TestERC20, // do not use maxu256 to avoid overflowing
    (await tokenFactory.connect(admin).deploy(halfMax)) as TestERC20,
    (await tokenFactory.connect(admin).deploy(halfMax)) as TestERC20,
  ];

  const nftDescriptorLibraryFactory = new ethers.ContractFactory(NFT_DESCRIPTOR_ABI, NFT_DESCRIPTOR_BYTECODE, admin);
  const nftDescriptorLibrary = await nftDescriptorLibraryFactory.connect(admin).deploy();

  const linkedBytecode = linkLibrary(NFT_POSITION_DESCRIPTOR_BYTECODE, {
    "contracts/libraries/NFTDescriptor.sol:NFTDescriptor": await nftDescriptorLibrary.getAddress(),
  });

  const positionDescriptorFactory = new ethers.ContractFactory(NFT_POSITION_DESCRIPTOR_ABI, linkedBytecode, admin);

  const nftDescriptor = (await positionDescriptorFactory.connect(admin).deploy(
    await tokens[0].getAddress(),
    // 'ETH' as a bytes32 string
    "0x4554480000000000000000000000000000000000000000000000000000000000",
  )) as INonfungibleTokenPositionDescriptor;

  const positionManagerFactory = new ethers.ContractFactory(
    NON_FUNGIBLE_POSITION_MANAGER_ABI,
    NON_FUNGIBLE_POSITION_MANAGER_BYTECODE,
    admin,
  );
  const nft = (await positionManagerFactory.connect(admin).deploy(
    factory.getAddress(),
    weth9.getAddress(),
    nftDescriptor.getAddress(),
  )) as INonfungiblePositionManager;

  sortTokens(tokens);

  return {
    weth9,
    factory,
    router,
    tokens,
    nft,
    nftDescriptor,
    testUniswapV3Callee,
    testUniswapV3CalleeExtra,
    tickMathTest,
    liquidityAmountsTest,
    fullMathTest,
    tickTest,
    clock
  };
};

export default completeFixture;
