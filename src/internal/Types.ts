import type { ContractTransactionResponse } from "ethers";

/**
 * Type utils
 */
export type Pretty<T> = {
  [K in keyof T]: T[K];
} extends infer U
  ? U
  : never;

export type Optional<T, K extends keyof T> = Pretty<Pick<Partial<T>, K> & Omit<T, K>>;

export type NonEmptyArray<T> = [T, ...T[]];

export interface ContractFunction<Args extends unknown[]> {
  (...args: Args): Promise<ContractTransactionResponse>;
  estimateGas: (...args: Args) => Promise<bigint>;
}
