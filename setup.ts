import hre from "hardhat";

// This file should have setup for mocha and imported at the top of files that will be run directly with mocha
// The following is documentation taken from hardhat/docs/src/content/hardhat-runner/docs/advanced/hardhat-runtime-environment.md

// Running test directly with [Mocha](https://www.npmjs.com/package/mocha) instead of `npx hardhat test` can be done by explicitly importing the HRE in them like this:

// ```js
// const hre = require("hardhat");
// const assert = require("assert");

// describe("Hardhat Runtime Environment", function () {
//   it("should have a config field", function () {
//     assert.notEqual(hre.config, undefined);
//   });
// });
// ```

// This way, tests written for Hardhat are just normal Mocha tests. This enables you to run them from your favorite editor without the need of any Hardhat-specific plugin. For example, you can [run them from Visual Studio Code using Mocha Test Explorer](../advanced/vscode-tests.md).