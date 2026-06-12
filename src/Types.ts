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
import type { BaseWallet, ContractTransactionReceipt, Interface, JsonRpcSigner } from "ethers";

export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG";

/**
 * A signer accepted by the `OrderBuilder`.
 *
 * - `BaseWallet`: private-key wallets such as ethers' `Wallet` / `HDNodeWallet`.
 * - `JsonRpcSigner`: injected/browser wallets obtained via `BrowserProvider.getSigner()`
 *   (e.g. MetaMask through `window.ethereum`).
 *
 * Both expose a synchronous `address` and `signMessage`/`signTypedData`, which the
 * SDK relies on. The generic ethers `Signer` is intentionally not accepted because
 * it only exposes the async `getAddress()`.
 */
export type SignerLike = BaseWallet | JsonRpcSigner;

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
  /**
   * Optional slippage tolerance in basis points (1 bps = 0.01%).
   * When provided, adjusts maker/taker amounts to account for price movement:
   * - BUY with isMinAmountOut: deflates takerAmount (willing to accept fewer shares for the same USD)
   * - BUY without isMinAmountOut: inflates makerAmount (willing to pay more collateral)
   * - SELL: deflates takerAmount (willing to accept less collateral)
   * Defaults to 0 (no slippage).
   */
  slippageBps?: bigint | undefined;
  /**
   * When true, uses an alternative slippage model for BUY orders where takerAmount is deflated
   * (minimum shares out) and makerAmount equals the expected cost (avg price * shares). This allows spending the "maximum balance" of a wallet alongside enabling slippage in a way that won't cause an issue of inflating the balance.
   * Must be passed as `isMinAmountOut: true` in the REST API request body.
   *
   * When false or omitted, makerAmount is inflated by slippage instead.
   * Defaults to false.
   */
  isMinAmountOut?: boolean | undefined;
}

export interface MarketHelperValueInput {
  side: Side.BUY;

  /**
   * The total maximum value to spend on the order.
   * This is only used for BUY orders.
   */
  valueWei: bigint;
  /**
   * Optional slippage tolerance in basis points (1 bps = 0.01%).
   * When provided, adjusts maker/taker amounts to account for price movement.
   * Defaults to 0 (no slippage).
   */
  slippageBps?: bigint | undefined;
  /**
   * When true, uses an alternative slippage model where takerAmount is deflated.
   * See MarketHelperInput.isMinAmountOut for details.
   */
  isMinAmountOut?: boolean | undefined;
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
  /** The non-deflated share quantity. For BUY with isMinAmountOut and slippage, this differs from takerAmount. */
  amount: bigint;
  /** The slippage tolerance in basis points that was applied to the amounts. 0n if none. */
  slippageBps: bigint;
  /** Whether the alternative slippage model was used. Must be forwarded in the REST API request. */
  isMinAmountOut: boolean;
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

export interface SplitPositionsOptions {
  conditionId: string;
  amount: bigint;
  isNegRisk: boolean;
  isYieldBearing: boolean;
}

/**
 * Scoped Approvals
 */

/**
 * The on-chain operation a consumer is about to perform. Used to derive the
 * minimal set of approvals required for that operation on a given market type.
 */
export type ApprovalOperation = "TRADE" | "SPLIT" | "MERGE" | "REDEEM" | "CONVERT";

/** The kind of approval an `ApprovalStep` represents. */
export type ApprovalStepType = "ERC1155_APPROVAL" | "ERC20_ALLOWANCE";

/** The lifecycle status of an approval step while it is being run. */
export type ApprovalStatus = "checking" | "skipped" | "submitting" | "confirmed" | "failed";

/**
 * Describes what the consumer is about to do, so the SDK can derive the
 * minimal approvals required for it.
 */
export interface ApprovalScope {
  /** The operation being performed. */
  operation: ApprovalOperation;
  /** Whether the market is a neg risk (multi-outcome, winner-takes-all) market. */
  isNegRisk: boolean;
  /** Whether the market is yield-bearing. */
  isYieldBearing: boolean;
  /**
   * Optional narrowing for `TRADE` orders. When omitted, both directions are
   * covered (ERC-1155 approval for selling and ERC-20 allowance for buying).
   * `BUY` returns only the collateral allowance; `SELL` only the ERC-1155 approval.
   */
  side?: Side;
}

/**
 * A single, self-describing approval. Returned by `getApprovalSteps` and consumed
 * by `checkApproval` / `setApproval`. Plain data, safe to render and serialize.
 */
export interface ApprovalStep {
  /** Stable identifier in the form `${type}:${spenderAddressKey}`. Use to map your own UI copy. */
  id: string;
  /** The kind of approval (ERC-1155 operator approval or ERC-20 allowance). */
  type: ApprovalStepType;
  /** The address being granted permission (an exchange, the neg risk adapter, or the conditional tokens contract). */
  spender: Address;
  /** The token contract the approval is set on (a conditional tokens contract for ERC-1155, USDT for ERC-20). */
  token: Address;
  /** Default, human-readable label (matches the web app). Override via `id` for i18n. */
  label: string;
  /** Default, human-readable description (matches the web app). Override via `id` for i18n. */
  description: string;
}

/** The result of checking whether a single approval step is already satisfied on-chain. */
export interface ApprovalCheck {
  step: ApprovalStep;
  /** Whether the approval is already in place (ERC-1155 approved-for-all, or ERC-20 allowance ≥ MaxInt256). */
  satisfied: boolean;
}

/** Emitted by `runApprovals` via `onProgress` as each step transitions. */
export interface ApprovalProgress {
  step: ApprovalStep;
  status: ApprovalStatus;
  /** Present once the step has been submitted (`confirmed` / `failed`). */
  transaction?: TransactionResult;
}

/** The outcome of a single step within an `ApprovalRunReport`. */
export interface ApprovalStepResult {
  step: ApprovalStep;
  status: "skipped" | "confirmed" | "failed";
  /** Present when the step was submitted (i.e. not `skipped`). */
  transaction?: TransactionResult;
}

/** The report returned by `runApprovals`. */
export interface ApprovalRunReport {
  /** True when every step was either skipped or confirmed. */
  success: boolean;
  steps: ApprovalStepResult[];
}

/** Options for `setApproval`. */
export interface SetApprovalOptions {
  /** ERC-1155 only: whether to approve (default) or revoke (`false`). */
  approved?: boolean;
  /** ERC-20 only: the allowance to set. Defaults to `MaxUint256`. */
  amount?: bigint;
}

/** Options for `runApprovals`. */
export interface RunApprovalsOptions {
  /** When true (default), each step is checked first and skipped if already satisfied. */
  skipSatisfied?: boolean;
  /** When true (default), stop running further steps after the first failure. */
  stopOnError?: boolean;
  /** Called as each step transitions, for live UI updates. */
  onProgress?: (progress: ApprovalProgress) => void;
}
