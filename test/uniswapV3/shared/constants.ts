export const MaxUint128 = 2n ** 128n - 1n;

export enum FeeAmount {
  LOW = 500,
  MEDIUM = 3000,
  HIGH = 10000,
}

export const TICK_SPACINGS: { [amount in FeeAmount]: number } = {
  [FeeAmount.LOW]: 10,
  [FeeAmount.MEDIUM]: 60,
  [FeeAmount.HIGH]: 200,
};

export const Ticks = {
  MIN_TICK: -887272,
  MAX_TICK: 887272,
}

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
