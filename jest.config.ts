import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
  testRegex: ".*\\.test\\.ts$",
  collectCoverageFrom: ["**/*.ts"],
  coverageDirectory: "./coverage",
  testEnvironment: "node",
};

export default config;
