import type { BaseContract, BaseWallet, InterfaceAbi, Provider, TypedDataDomain } from "ethers";
import { AbiCoder, concat, Contract, hexlify, Interface, keccak256, TypedDataEncoder } from "ethers";

export function makeContract<T extends BaseContract>(address: string, abi: InterfaceAbi) {
  return (signerOrProvider: BaseWallet | Provider): { contract: T; codec: Interface } => {
    const codec = new Interface(abi);
    const contract = new Contract(address, codec).connect(signerOrProvider) as T;

    return { contract, codec };
  };
}

export function hashKernelMessage(messageHash: string) {
  const codec = new AbiCoder();
  const encoder = new TextEncoder();

  const value = encoder.encode("Kernel(bytes32 hash)");
  return keccak256(codec.encode(["bytes32", "bytes32"], [keccak256(hexlify(value)), messageHash]));
}

export function eip712WrapHash(messageHash: string, domain: TypedDataDomain) {
  const domainSeparator = TypedDataEncoder.hashDomain(domain);
  const finalMessageHash = hashKernelMessage(messageHash);

  return keccak256(concat(["0x1901", domainSeparator, finalMessageHash]));
}

/**
 * Retains the specified number of significant digits.
 *
 * In the case of negative numbers, the significant digits are retained as
 * expected without the
 *
 *
 * @param num - The bigint number to truncate.
 * @param significantDigits - The number of significant digits to retain.
 *
 * @returns The bigint number with the specified significant digits retained.
 */
export function retainSignificantDigits(num: bigint, significantDigits: number): bigint {
  if (num === BigInt(0)) return BigInt(0);

  const isNegative = num < BigInt(0); // Check if the number is negative
  const absNum = isNegative ? -num : num; // Work with the absolute value

  // Convert to string to find magnitude (length before trailing zeros)
  const str = absNum.toString();
  const magnitude = str.length;

  // Calculate divisor to remove excess digits
  const excess = magnitude - significantDigits;
  if (excess <= 0) return num; // Return original number if no truncation is needed

  const divisor = BigInt(10) ** BigInt(excess);

  // Divide then multiply to truncate, and restore the sign
  return isNegative ? -(absNum / divisor) * divisor : (absNum / divisor) * divisor;
}
