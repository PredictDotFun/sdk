import type { Side, SignatureType } from "./Constants";
import type {
  ConditionalTokens,
  CTFExchange,
  NegRiskAdapter,
  NegRiskCtfExchange,
  ECDSAValidator,
  ERC20,
  Kernel,
} from "./typechain";
import type { ContractTransactionReceipt, Interface } from "ethers";

export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG";

export type BigIntString = string;
export type Address = string;

export type Currency = "USDT";
export type OrderStrategy = "MARKET" | "LIMIT";
/** true represents an Ask, while false a Bid */
export type QuoteType = boolean;

/**
 * Order Amounts Helper
 */

export interface MarketHelperInput {
  side: Side;
  /**
   * The quantity of shares you would like to trace.
   *
   * This can only be used for SELL or BUY orders, however is most
   * commonly used for SELL orders.
   */
  quantityWei: bigint;
}

export interface MarketHelperValueInput {
  side: Side.BUY;

  /**
   * The total maximum value to spend on the order.
   * This is only used for BUY orders.
   */
  valueWei: bigint;
}

export interface ProcessedBookAmounts {
  quantityWei: bigint;
  priceWei: bigint;
  lastPriceWei: bigint;
}

export interface LimitHelperInput {
  side: Side;
  pricePerShareWei: bigint;
  quantityWei: bigint;
}

export interface OrderAmounts {
  lastPrice: bigint;
  pricePerShare: bigint;
  makerAmount: bigint;
  takerAmount: bigint;
}

/**
 * Configuration
 */

export interface Addresses {
  YIELD_BEARING_CTF_EXCHANGE: Address;
  YIELD_BEARING_NEG_RISK_CTF_EXCHANGE: Address;
  YIELD_BEARING_NEG_RISK_ADAPTER: Address;
  YIELD_BEARING_CONDITIONAL_TOKENS: Address;
  YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS: Address;

  CTF_EXCHANGE: Address;
  NEG_RISK_CTF_EXCHANGE: Address;
  NEG_RISK_ADAPTER: Address;
  CONDITIONAL_TOKENS: Address;
  NEG_RISK_CONDITIONAL_TOKENS: Address;

  USDT: Address;
  KERNEL: Address;
  ECDSA_VALIDATOR: Address;
}

export type CtfIdentifier = Extract<keyof Addresses, `${string}CONDITIONAL_TOKENS`>;

/**
 * Order
 */

export interface Order {
  /**
   * A unique salt to ensure entropy
   */
  salt: BigIntString;

  /**
   * The maker of the order, e.g. the order's signer
   */
  maker: string;

  /**
   * The signer of the order
   */
  signer: string;

  /**
   * The address of the order taker. The zero address is used to indicate a public order
   */
  taker: string;

  /**
   * The token ID of the CTF ERC-1155 asset to be bought or sold.
   */
  tokenId: BigIntString;

  /**
   * The maker amount
   *
   * For a BUY order, this represents the total `(price per asset * assets quantity)` collateral (e.g. USDT) being offered.
   * For a SELL order, this represents the total amount of CTF assets being offered.
   */
  makerAmount: BigIntString;

  /**
   * The taker amount
   *
   * For a BUY order, this represents the total amount of CTF assets to be received.
   * For a SELL order, this represents the total `(price per asset * assets quantity)` amount of collateral (e.g. USDT) to be received.
   */
  takerAmount: BigIntString;

  /**
   * The timestamp in seconds after which the order is expired
   */
  expiration: BigIntString;

  /**
   * The nonce used for on-chain cancellations
   */
  nonce: BigIntString;

  /**
   * The fee rate, in basis points
   */
  feeRateBps: BigIntString;

  /**
   * The side of the order, BUY (Bid) or SELL (Ask)
   */
  side: Side;

  /**
   * Signature type used by the Order (EOA also supports EIP-1271)
   */
  signatureType: SignatureType;
}

export interface OrderWithHash extends Order {
  /**
   * The order hash
   */
  hash: string;
}

export interface SignedOrder extends Order {
  /**
   * The order hash
   */
  hash?: string;

  /**
   * The order signature
   */
  signature: string;
}

export interface BuildOrderInput {
  side: Order["side"];
  tokenId: Order["tokenId"] | bigint;
  makerAmount: Order["makerAmount"] | bigint;
  takerAmount: Order["takerAmount"] | bigint;
  /* The current fee rate should be fetched via the `GET /markets` endpoint */
  feeRateBps: Order["feeRateBps"] | bigint | number;
  signer?: Order["signer"];
  nonce?: Order["nonce"] | bigint;
  salt?: Order["salt"] | bigint;
  maker?: Order["maker"];
  taker?: Order["taker"];
  signatureType?: Order["signatureType"];
  expiresAt?: Date;
}

/**
 * Typed Data
 */

export declare type EIP712ObjectValue = string | number | EIP712Object;

export interface EIP712Object {
  [key: string]: EIP712ObjectValue;
}

export interface EIP712Types {
  [key: string]: EIP712Parameter[];
}

export interface EIP712Parameter {
  name: string;
  type: string;
}

export interface EIP712TypedData {
  types: EIP712Types;
  domain: EIP712Object;
  message: EIP712Object;
  primaryType: string;
}

/**
 * Orderbook
 */

export type DepthLevel = [number, number];

export interface Book {
  marketId: number;
  updateTimestampMs: number;
  asks: DepthLevel[];
  bids: DepthLevel[];
}

/**
 * Contracts
 */

export interface Contracts {
  YIELD_BEARING_CTF_EXCHANGE: { contract: CTFExchange; codec: Interface };
  YIELD_BEARING_NEG_RISK_CTF_EXCHANGE: { contract: NegRiskCtfExchange; codec: Interface };
  YIELD_BEARING_NEG_RISK_ADAPTER: { contract: NegRiskAdapter; codec: Interface };
  YIELD_BEARING_CONDITIONAL_TOKENS: { contract: ConditionalTokens; codec: Interface };
  YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS: { contract: ConditionalTokens; codec: Interface };

  CTF_EXCHANGE: { contract: CTFExchange; codec: Interface };
  NEG_RISK_CTF_EXCHANGE: { contract: NegRiskCtfExchange; codec: Interface };
  NEG_RISK_ADAPTER: { contract: NegRiskAdapter; codec: Interface };
  CONDITIONAL_TOKENS: { contract: ConditionalTokens; codec: Interface };
  NEG_RISK_CONDITIONAL_TOKENS: { contract: ConditionalTokens; codec: Interface };

  USDT: { contract: ERC20; codec: Interface };
  KERNEL: { contract: Kernel; codec: Interface };
  ECDSA_VALIDATOR: { contract: ECDSAValidator; codec: Interface };
}

export interface MulticallContracts extends Contracts {
  multicall: Contracts;
}

export interface Erc1155Approval {
  /**
   * Check if the contract is approved to transfer the Conditional Tokens.
   *
   * @returns {Promise<boolean>} Whether the contract is approved for all
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  isApprovedForAll: () => Promise<boolean>;

  /**
   * Approve the contract to transfer the Conditional Tokens.
   *
   * @param {Promise<boolean>} approved - Whether to approve the contract to transfer the Conditional Tokens, defaults to `true`.
   * @returns {Promise<TransactionResult>} The transaction result.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  setApprovalForAll: (approved?: boolean) => Promise<TransactionResult>;
}

export interface Erc20Approval {
  /**
   * Check the allowance of the contract for the USDT tokens.
   *
   * @returns {Promise<bigint>} The allowance of the contract for the USDT tokens.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  allowance: () => Promise<bigint>;

  /**
   * Approve the contract to transfer the USDT tokens.
   *
   * @param {bigint} amount - The amount of USDT tokens to approve for, defaults to `MaxUint256`.
   * @returns {Promise<TransactionResult>} The transaction result.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  approve: (amount?: bigint) => Promise<TransactionResult>;
}

export type Approval = Erc1155Approval | Erc20Approval;

/**
 * Represents the result of setting approvals for trading on the Predict protocol.
 *
 * @property {boolean} success - Indicates if all approvals were successful.
 * @property {TransactionResult[]} transactions - Array of transaction results for each approval operation.
 */
export interface SetApprovalsResult {
  success: boolean;
  transactions: TransactionResult[];
}

/**
 * Transaction Result
 */

export type TransactionSuccess = {
  success: true;
  receipt?: ContractTransactionReceipt;
};

export type TransactionFail = {
  success: false;
  cause?: Error;
  receipt?: ContractTransactionReceipt | null;
};

export type TransactionResult = TransactionSuccess | TransactionFail;

/**
 * Cancel Order
 */

export interface CancelOrdersInput {
  orders: SignedOrder[];
  isNegRisk: boolean;
}

export interface CancelOrdersOptions {
  isYieldBearing: boolean;
  isNegRisk: boolean;
  /** Default: true */
  withValidation?: boolean;
}

export interface RedeemPositionsOptions {
  conditionId: string;
  indexSet: 1 | 2;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  /** Required when isNegRisk is true */
  amount?: bigint;
}

export interface MergePositionsOptions {
  conditionId: string;
  amount: bigint;
  isNegRisk: boolean;
  isYieldBearing: boolean;
}
