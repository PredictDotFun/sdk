import type { Addresses } from "./Types";
import type { TypedDataDomain } from "ethers";
import { JsonRpcProvider } from "ethers";

export const MAX_SALT = 2_147_483_648;
export const FIVE_MINUTES_SECONDS = 60 * 5;

export enum ChainId {
  BnbMainnet = 56,
  BnbTestnet = 97,
}

/**
 * @remarks EOA also supports EIP-1271.
 */
export enum SignatureType {
  EOA = 0,
  POLY_PROXY = 1,
  POLY_GNOSIS_SAFE = 2,
}

export enum Side {
  BUY = 0,
  SELL = 1,
}

export const KernelDomainByChainId = {
  [ChainId.BnbMainnet]: { name: "Kernel", version: "0.3.1", chainId: ChainId.BnbMainnet },
  [ChainId.BnbTestnet]: { name: "Kernel", version: "0.3.1", chainId: ChainId.BnbTestnet },
} satisfies Record<ChainId, TypedDataDomain>;

export const AddressesByChainId = {
  [ChainId.BnbMainnet]: {
    YIELD_BEARING_CTF_EXCHANGE: "0x6bEb5a40C032AFc305961162d8204CDA16DECFa5",
    YIELD_BEARING_NEG_RISK_CTF_EXCHANGE: "0x8A289d458f5a134bA40015085A8F50Ffb681B41d",
    YIELD_BEARING_NEG_RISK_ADAPTER: "0x41dCe1A4B8FB5e6327701750aF6231B7CD0B2A40",
    YIELD_BEARING_CONDITIONAL_TOKENS: "0x9400F8Ad57e9e0F352345935d6D3175975eb1d9F",
    YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS: "0xF64b0b318AAf83BD9071110af24D24445719A07F",

    CTF_EXCHANGE: "0x8BC070BEdAB741406F4B1Eb65A72bee27894B689",
    NEG_RISK_CTF_EXCHANGE: "0x365fb81bd4A24D6303cd2F19c349dE6894D8d58A",
    NEG_RISK_ADAPTER: "0xc3Cf7c252f65E0d8D88537dF96569AE94a7F1A6E",
    CONDITIONAL_TOKENS: "0x22DA1810B194ca018378464a58f6Ac2B10C9d244",
    NEG_RISK_CONDITIONAL_TOKENS: "0x22DA1810B194ca018378464a58f6Ac2B10C9d244",

    USDT: "0x55d398326f99059fF775485246999027B3197955",
    KERNEL: "0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D",
    ECDSA_VALIDATOR: "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57",
  },
  [ChainId.BnbTestnet]: {
    YIELD_BEARING_CTF_EXCHANGE: "0x8a6B4Fa700A1e310b106E7a48bAFa29111f66e89",
    YIELD_BEARING_NEG_RISK_CTF_EXCHANGE: "0x95D5113bc50eD201e319101bbca3e0E250662fCC",
    YIELD_BEARING_NEG_RISK_ADAPTER: "0xb74aea04bdeBE912Aa425bC9173F9668e6f11F99",
    YIELD_BEARING_CONDITIONAL_TOKENS: "0x38BF1cbD66d174bb5F3037d7068E708861D68D7f",
    YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS: "0x26e865CbaAe99b62fbF9D18B55c25B5E079A93D5",

    CTF_EXCHANGE: "0x2A6413639BD3d73a20ed8C95F634Ce198ABbd2d7",
    NEG_RISK_CTF_EXCHANGE: "0xd690b2bd441bE36431F6F6639D7Ad351e7B29680",
    NEG_RISK_ADAPTER: "0x285c1B939380B130D7EBd09467b93faD4BA623Ed",
    CONDITIONAL_TOKENS: "0x2827AAef52D71910E8FBad2FfeBC1B6C2DA37743",
    NEG_RISK_CONDITIONAL_TOKENS: "0x2827AAef52D71910E8FBad2FfeBC1B6C2DA37743",

    USDT: "0xB32171ecD878607FFc4F8FC0bCcE6852BB3149E0",
    KERNEL: "0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D",
    ECDSA_VALIDATOR: "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57",
  },
} satisfies Record<ChainId, Addresses>;

export const ProviderByChainId = {
  [ChainId.BnbMainnet]: new JsonRpcProvider("https://bsc-dataseed.bnbchain.org/"),
  [ChainId.BnbTestnet]: new JsonRpcProvider("https://bsc-testnet-dataseed.bnbchain.org/"),
} satisfies Record<ChainId, JsonRpcProvider>;

export const PROTOCOL_NAME = "predict.fun CTF Exchange";
export const PROTOCOL_VERSION = "1";

export const EIP712_DOMAIN = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

export const ORDER_STRUCTURE = [
  { name: "salt", type: "uint256" },
  { name: "maker", type: "address" },
  { name: "signer", type: "address" },
  { name: "taker", type: "address" },
  { name: "tokenId", type: "uint256" },
  { name: "makerAmount", type: "uint256" },
  { name: "takerAmount", type: "uint256" },
  { name: "expiration", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "feeRateBps", type: "uint256" },
  { name: "side", type: "uint8" },
  { name: "signatureType", type: "uint8" },
];
