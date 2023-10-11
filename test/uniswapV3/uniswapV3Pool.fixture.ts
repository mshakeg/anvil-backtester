import completeFixture from "./shared/completeFixture";

export async function deployUniswapV3Fixture(adminIndex: number = 0) {
  return completeFixture(adminIndex);
}
