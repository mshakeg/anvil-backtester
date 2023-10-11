export enum LogType {
  Swap = "Swap",
  Mint = "Mint",
  Burn = "Burn",
  Flash = "Flash",
}

export type LiquidityChangeData = {
  amount: string;
  amount0: string;
  amount1: string;
  tickLower: string;
  tickUpper: string;
};

export interface Block {
  __typename: "Block";
  timestamp: number;
  blockNumber: number;
}

export interface BaseLog {
  __typename: "Log";
  globalIndex: number;
  type: "Mint" | "Burn" | "Swap";
  block: Block;
}

export interface MintData {
  amount: string;
  amount0: string;
  amount1: string;
  tickLower: string;
  tickUpper: string;
}

export interface BurnData {
  amount: string;
  amount0: string;
  amount1: string;
  tickLower: string;
  tickUpper: string;
}

export interface SwapData {
  amount0: string;
  amount1: string;
  liquidity: string;
  sqrtPriceX96: string;
}

interface MintLog extends BaseLog {
  type: "Mint";
  data: MintData;
}

interface BurnLog extends BaseLog {
  type: "Burn";
  data: BurnData;
}

interface SwapLog extends BaseLog {
  type: "Swap";
  data: SwapData;
}

export type PoolLog = MintLog | BurnLog | SwapLog;

export interface PoolData {
  __typename: string;
  initSqrtPriceX96: string;
  timestamp: number;
  fee: number;
  lastIndexedBlock: number;
  lastGlobalIndex: number;
}