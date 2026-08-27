import type {
  Addresses,
  BuildOrderInput,
  EIP712TypedData,
  Order,
  OrderStrategy,
  MarketHelperInput,
  Book,
  DepthLevel,
  OrderAmounts,
  ProcessedBookAmounts,
  SignedOrder,
  LimitHelperInput,
  Erc1155Approval,
  Erc20Approval,
  Approval,
  MulticallContracts,
  TransactionResult,
  CancelOrdersOptions,
  RedeemPositionsOptions,
  MergePositionsOptions,
  SplitPositionsOptions,
  ConvertPositionsOptions,
  SetApprovalsResult,
  Address,
  MarketHelperValueInput,
  LogLevel,
  CtfIdentifier,
  SignerLike,
  ApprovalScope,
  ApprovalOperation,
  ApprovalStep,
  ApprovalStepType,
  ApprovalCheck,
  ApprovalRunReport,
  ApprovalStepResult,
  SetApprovalOptions,
  RunApprovalsOptions,
} from "./Types";
import type { AbstractProvider, BigNumberish, Interface } from "ethers";
import type { ChainId } from "./Constants";
import type {
  ConditionalTokens,
  CTFExchange,
  NegRiskAdapter,
  NegRiskCtfExchange,
  ECDSAValidator,
  ERC20,
  Kernel,
} from "./typechain";
import type { OrderStruct } from "./typechain/CTFExchange";
import type { ContractFunction, Optional } from "./internal/Types";
import {
  concat,
  hashMessage,
  hexlify,
  MaxInt256,
  MaxUint256,
  parseEther,
  randomBytes,
  toBeHex,
  TypedDataEncoder,
  ZeroAddress,
  ZeroHash,
} from "ethers";
import { MulticallWrapper } from "ethers-multicall-provider";
import { makeContract, eip712WrapHash, retainSignificantDigits } from "./internal/Utils";
import {
  FailedOrderSignError,
  FailedTypedDataEncoderError,
  InvalidApprovalOperationError,
  InvalidExpirationError,
  InvalidNegRiskConfig,
  InvalidQuantityError,
  InvalidSignerError,
  MakerSignerMismatchError,
  MissingSignerError,
} from "./Errors";
import {
  Side,
  EIP712_DOMAIN,
  ORDER_STRUCTURE,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  SignatureType,
  AddressesByChainId,
  KernelDomainByChainId,
  MAX_SALT,
  FIVE_MINUTES_SECONDS,
  ProviderByChainId,
  SPENDER_ROLE_BY_KEY,
  APPROVAL_STEP_COPY,
} from "./Constants";
import {
  ConditionalTokensAbi,
  YieldBearingConditionalTokensAbi,
  CTFExchangeAbi,
  NegRiskAdapterAbi,
  NegRiskCtfExchangeAbi,
  ECDSAValidatorAbi,
  ERC20Abi,
  KernelAbi,
} from "./abis";
import { Logger } from "./Logger";

/**
 * @remarks The precision represents the number of decimals supported. By default, it's set to 18 (for wei).
 * @remarks When defining a `predictAccount` address the `OrderBuilder` signer must be the Privy exported wallet, from the account's settings.
 */
interface OrderBuilderOptions {
  addresses?: Addresses;
  precision?: number;
  /**
   * When defining a `predictAccount` address the `OrderBuilder` signer must be the Privy exported wallet, from the account's settings.
   */
  predictAccount?: Address;
  generateSalt?: () => string;
  logLevel?: LogLevel;
}

/**
 * Generate an unpredictable salt for an order.
 *
 * Rejection sampling avoids the modulo bias that would otherwise be introduced
 * when a 32-bit random value is reduced to the protocol's salt range.
 *
 * @returns A cryptographically random numeric string value for the salt.
 */
export const generateOrderSalt = (): string => {
  const saltRange = BigInt(MAX_SALT) + 1n;
  const randomRange = 1n << 32n;
  const maxAccepted = randomRange - (randomRange % saltRange);

  let sample: bigint;
  do {
    sample = BigInt(hexlify(randomBytes(4)));
  } while (sample >= maxAccepted);

  return String(sample % saltRange);
};

/**
 * Helper class to build orders.
 *
 * To create a new instance of the `OrderBuilder` class, call the async `make` method.
 */
export class OrderBuilder {
  private readonly executionMode = ZeroHash;

  /**
   * Initializes a new instance of the OrderBuilder class.
   *
   * @param {ChainId} chainId - The chain ID for the network.
   * @param {undefined} - Do not pass a signer, no contract functionality will be available.
   * @returns {OrderBuilder} A new OrderBuilder instance without contract functionality.
   */
  static make(chainId: ChainId, signer?: undefined, options?: OrderBuilderOptions): OrderBuilder;
  /**
   * Initializes a new instance of the OrderBuilder class with contract functionality.
   *
   * @param {ChainId} chainId - The chain ID for the network.
   * @param {SignerLike} signer - Signer object for signing orders (an ethers `BaseWallet` such as
   *   `Wallet`/`HDNodeWallet`, or a `JsonRpcSigner` from `BrowserProvider.getSigner()`). This will
   *   cause the method to return a promise.
   * @param {OrderBuilderOptions} [options] - Optional order configuration options.
   * @returns {Promise<OrderBuilder>} A new OrderBuilder instance with contract functionality.
   */
  static make(chainId: ChainId, signer: SignerLike, options?: OrderBuilderOptions): Promise<OrderBuilder>;
  static make(
    chainId: ChainId,
    signer: SignerLike | undefined,
    options?: OrderBuilderOptions,
  ): OrderBuilder | Promise<OrderBuilder> {
    let contracts: MulticallContracts | undefined = undefined;
    const addresses = options?.addresses ?? AddressesByChainId[chainId];
    const generateSalt = options?.generateSalt ?? generateOrderSalt;
    const precision = options?.precision ? 10n ** BigInt(options.precision) : BigInt(1e18);
    const predictAccount = options?.predictAccount;
    const logger = new Logger(options?.logLevel);

    let signerWallet = signer;

    if (signerWallet) {
      const provider = signerWallet.provider ?? ProviderByChainId[chainId];
      const multicallProvider = MulticallWrapper.wrap(provider as AbstractProvider);

      if (!signerWallet.provider) {
        // Only reachable for provider-less `BaseWallet`s: a `JsonRpcSigner`
        // (BrowserProvider) always carries its provider, so its `connect()`
        // (which throws "cannot reconnect JsonRpcSigner") is never invoked.
        // The union's `connect()` widens the return to `Signer`, so narrow back.
        signerWallet = signerWallet.connect(provider) as SignerLike;
      }

      // yield-bearing contracts
      const yieldBearingCtfExchange = makeContract<CTFExchange>(addresses.YIELD_BEARING_CTF_EXCHANGE, CTFExchangeAbi);
      const yieldBearingNegRiskCtfExchange = makeContract<NegRiskCtfExchange>(
        addresses.YIELD_BEARING_NEG_RISK_CTF_EXCHANGE,
        NegRiskCtfExchangeAbi,
      );
      const yieldBearingNegRiskAdapter = makeContract<NegRiskAdapter>(
        addresses.YIELD_BEARING_NEG_RISK_ADAPTER,
        NegRiskAdapterAbi,
      );
      const yieldBearingConditionalTokens = makeContract<ConditionalTokens>(
        addresses.YIELD_BEARING_CONDITIONAL_TOKENS,
        YieldBearingConditionalTokensAbi,
      );
      const yieldBearingNegRiskConditionalTokens = makeContract<ConditionalTokens>(
        addresses.YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS,
        ConditionalTokensAbi,
      );

      // non yield-bearing contracts
      const ctfExchange = makeContract<CTFExchange>(addresses.CTF_EXCHANGE, CTFExchangeAbi);
      const negRiskAdapter = makeContract<NegRiskAdapter>(addresses.NEG_RISK_ADAPTER, NegRiskAdapterAbi);
      const conditionalTokens = makeContract<ConditionalTokens>(addresses.CONDITIONAL_TOKENS, ConditionalTokensAbi);
      const negRiskConditionalTokens = makeContract<ConditionalTokens>(
        addresses.NEG_RISK_CONDITIONAL_TOKENS,
        ConditionalTokensAbi,
      );
      const negRiskCtfExchange = makeContract<NegRiskCtfExchange>(
        addresses.NEG_RISK_CTF_EXCHANGE,
        NegRiskCtfExchangeAbi,
      );

      const usdt = makeContract<ERC20>(addresses.USDT, ERC20Abi);
      const kernel = makeContract<Kernel>(predictAccount ?? addresses.KERNEL, KernelAbi);
      const validator = makeContract<ECDSAValidator>(addresses.ECDSA_VALIDATOR, ECDSAValidatorAbi);

      contracts = {
        YIELD_BEARING_CTF_EXCHANGE: yieldBearingCtfExchange(signerWallet),
        YIELD_BEARING_NEG_RISK_CTF_EXCHANGE: yieldBearingNegRiskCtfExchange(signerWallet),
        YIELD_BEARING_NEG_RISK_ADAPTER: yieldBearingNegRiskAdapter(signerWallet),
        YIELD_BEARING_CONDITIONAL_TOKENS: yieldBearingConditionalTokens(signerWallet),
        YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS: yieldBearingNegRiskConditionalTokens(signerWallet),

        CTF_EXCHANGE: ctfExchange(signerWallet),
        NEG_RISK_CTF_EXCHANGE: negRiskCtfExchange(signerWallet),
        NEG_RISK_ADAPTER: negRiskAdapter(signerWallet),
        CONDITIONAL_TOKENS: conditionalTokens(signerWallet),
        NEG_RISK_CONDITIONAL_TOKENS: negRiskConditionalTokens(signerWallet),

        USDT: usdt(signerWallet),
        KERNEL: kernel(signerWallet),
        ECDSA_VALIDATOR: validator(signerWallet),
        multicall: {
          YIELD_BEARING_CTF_EXCHANGE: yieldBearingCtfExchange(multicallProvider),
          YIELD_BEARING_NEG_RISK_CTF_EXCHANGE: yieldBearingNegRiskCtfExchange(multicallProvider),
          YIELD_BEARING_NEG_RISK_ADAPTER: yieldBearingNegRiskAdapter(multicallProvider),
          YIELD_BEARING_CONDITIONAL_TOKENS: yieldBearingConditionalTokens(multicallProvider),
          YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS: yieldBearingNegRiskConditionalTokens(multicallProvider),

          CTF_EXCHANGE: ctfExchange(multicallProvider),
          NEG_RISK_CTF_EXCHANGE: negRiskCtfExchange(multicallProvider),
          NEG_RISK_ADAPTER: negRiskAdapter(multicallProvider),
          CONDITIONAL_TOKENS: conditionalTokens(multicallProvider),
          NEG_RISK_CONDITIONAL_TOKENS: negRiskConditionalTokens(multicallProvider),

          USDT: usdt(multicallProvider),
          KERNEL: kernel(multicallProvider),
          ECDSA_VALIDATOR: validator(multicallProvider),
        },
      };

      if (predictAccount) {
        const contract = contracts.ECDSA_VALIDATOR.contract;
        return contract.ecdsaValidatorStorage(predictAccount).then((owner) => {
          if (owner !== signerWallet?.address) {
            throw new InvalidSignerError();
          }

          return new OrderBuilder(
            chainId,
            precision,
            addresses,
            generateSalt,
            logger,
            signer,
            predictAccount,
            contracts,
          );
        });
      }
    }

    return new OrderBuilder(chainId, precision, addresses, generateSalt, logger, signer, predictAccount, contracts);
  }

  constructor(
    private readonly chainId: ChainId,
    private readonly precision: bigint,
    private readonly addresses: Addresses,
    private readonly generateOrderSalt: () => string,
    private readonly logger: Logger,
    private readonly signer?: SignerLike,
    private readonly predictAccount?: Address,
    readonly contracts?: MulticallContracts,
  ) {}

  /**
   * Helper function to handle transactions safely.
   *
   * @private
   * @async
   * @param {ContractFunction<T>} fn - The contract function to execute.
   * @param {...T} args - The arguments to pass to the contract function.
   * @returns {Promise<TransactionResult>} The result of the transaction.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  private async handleTransaction<T extends unknown[]>(
    fn: ContractFunction<T>,
    ...args: T
  ): Promise<TransactionResult> {
    if (this.contracts === undefined) {
      throw new MissingSignerError();
    }

    try {
      const estimatedGas = await fn.estimateGas(...args);
      const transactionArgs = [...args, { gasLimit: (estimatedGas * 125n) / 100n }] as T;

      const tx = await fn(...transactionArgs);
      const receipt = await tx.wait(1);

      return receipt?.status === 1 ? { success: true, receipt } : { success: false, receipt };
    } catch (error) {
      return { success: false, cause: error as Error };
    }
  }

  /**
   * Helper function to encode the calldata for the `execute` function.
   *
   * @private
   * @param {string} to - The address of the contract to execute the calldata on.
   * @param {string} calldata - The calldata to execute.
   * @param {bigint} [value] - The value to send with the calldata. Defaults to 0.
   * @returns {string} The encoded calldata.
   */
  private encodeExecutionCalldata(to: string, calldata: string, value: bigint = 0n): string {
    return concat([to, toBeHex(value, 32), calldata]);
  }

  /**
   * Helper function to get the exchange identifier based on isNegRisk and isYieldBearing flags.
   *
   * @private
   * @param {boolean} isNegRisk - Whether the exchange is for a neg risk market.
   * @param {boolean} isYieldBearing - Whether the exchange is for a yield-bearing market.
   * @returns {keyof Addresses} The exchange identifier key.
   */
  private getExchangeIdentifier(isNegRisk: boolean, isYieldBearing: boolean): keyof Addresses {
    if (isNegRisk) {
      return isYieldBearing ? "YIELD_BEARING_NEG_RISK_CTF_EXCHANGE" : "NEG_RISK_CTF_EXCHANGE";
    } else {
      return isYieldBearing ? "YIELD_BEARING_CTF_EXCHANGE" : "CTF_EXCHANGE";
    }
  }

  /**
   * Helper function to get the conditional tokens identifier based on isNegRisk and isYieldBearing flags.
   *
   * @private
   * @param {boolean} isNegRisk - Whether the market is a neg risk market.
   * @param {boolean} isYieldBearing - Whether the market is yield-bearing.
   * @returns The conditional tokens identifier key.
   */
  private getCtfIdentifier(isNegRisk: boolean, isYieldBearing: boolean): CtfIdentifier {
    if (isYieldBearing) {
      return isNegRisk ? "YIELD_BEARING_NEG_RISK_CONDITIONAL_TOKENS" : "YIELD_BEARING_CONDITIONAL_TOKENS";
    } else {
      return isNegRisk ? "NEG_RISK_CONDITIONAL_TOKENS" : "CONDITIONAL_TOKENS";
    }
  }

  private getApprovalOps(key: keyof Addresses, type: "ERC1155", ctfIdentifier: CtfIdentifier): Erc1155Approval;
  private getApprovalOps(key: keyof Addresses, type: "ERC20"): Erc20Approval;

  /**
   * Helper function to get the approval operations for the given contract and type.
   *
   * @private
   * @param {keyof Addresses} key - The key of the contract in the `Addresses` object.
   * @param {"ERC1155" | "ERC20"} type - The type of approval to get.
   * @param {CtfIdentifier} [ctfIdentifier] - The conditional tokens contract identifier (only required for ERC1155).
   * @returns {Approval} The approval operations for the given contract and type.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  private getApprovalOps(key: keyof Addresses, type: "ERC1155" | "ERC20", ctfIdentifier?: CtfIdentifier): Approval {
    const address = this.addresses[key];

    if (this.contracts === undefined) {
      throw new MissingSignerError();
    }

    if (this.predictAccount) {
      const kernel = this.contracts.KERNEL.contract;

      switch (type) {
        case "ERC1155": {
          if (ctfIdentifier === undefined) {
            throw new Error("ctfIdentifier is required for ERC1155 approvals");
          }

          const { contract, codec } = this.contracts[ctfIdentifier];

          return {
            isApprovedForAll: () => contract.isApprovedForAll(this.predictAccount!, address),
            setApprovalForAll: (approved: boolean = true) => {
              const encoded = codec.encodeFunctionData("setApprovalForAll", [address, approved]);
              const calldata = this.encodeExecutionCalldata(this.addresses[ctfIdentifier], encoded);

              return this.handleTransaction(kernel.execute, this.executionMode, calldata);
            },
          };
        }
        case "ERC20": {
          const { contract, codec } = this.contracts.USDT;

          return {
            allowance: () => contract.allowance(this.predictAccount!, address),
            approve: (amount: bigint = MaxUint256) => {
              const encoded = codec.encodeFunctionData("approve", [address, amount]);
              const calldata = this.encodeExecutionCalldata(this.addresses.USDT, encoded);

              return this.handleTransaction(kernel.execute, this.executionMode, calldata);
            },
          };
        }
      }
    } else {
      switch (type) {
        case "ERC1155": {
          if (ctfIdentifier === undefined) {
            throw new Error("ctfIdentifier is required for ERC1155 approvals");
          }

          const contract = this.contracts[ctfIdentifier].contract;

          return {
            isApprovedForAll: () => contract.isApprovedForAll(this.signer!.address, address),
            setApprovalForAll: (approved: boolean = true) =>
              this.handleTransaction(contract.setApprovalForAll, address, approved),
          };
        }
        case "ERC20": {
          const contract = this.contracts.USDT.contract;

          return {
            allowance: () => contract.allowance(this.signer!.address, address),
            approve: (amount: bigint = MaxUint256) => this.handleTransaction(contract.approve, address, amount),
          };
        }
      }
    }
  }

  /**
   * Returns the minimum of two bigint values.
   */
  private min(a: bigint, b: bigint): bigint {
    return a < b ? a : b;
  }

  /**
   * Returns the maximum of two bigint values.
   */
  private max(a: bigint, b: bigint): bigint {
    return a > b ? a : b;
  }

  /**
   * Processes the order book to help derive the average price and last price to be used for a MARKET strategy order.
   *
   * @private
   * @param {DepthLevel[]} depths - Array of price levels and their quantities, sorted by price in ascending order.
   * @param {bigint} quantityWei - The total quantity of shares being bought or sold in wei.
   * @returns {ProcessedBookAmounts} An object containing the total quantity, total cost, and last price.
   */
  private processBook(depths: DepthLevel[], quantityWei: bigint): ProcessedBookAmounts {
    const reduceInit = { quantityWei: 0n, priceWei: 0n, lastPriceWei: 0n };

    return depths.reduce((acc, [price, qty]) => {
      const remainingQtyWei = quantityWei - acc.quantityWei;
      const priceWei = parseEther(price.toString());
      const qtyWei = parseEther(qty.toString());

      if (remainingQtyWei <= 0n) {
        return acc;
      }

      // Accumulate price * qty without intermediate division to preserve precision.
      // The final pricePerShare calculation will divide by quantity only.
      return remainingQtyWei < qtyWei
        ? {
            quantityWei: acc.quantityWei + remainingQtyWei,
            priceWei: acc.priceWei + priceWei * remainingQtyWei,
            lastPriceWei: priceWei,
          }
        : {
            quantityWei: acc.quantityWei + qtyWei,
            priceWei: acc.priceWei + priceWei * qtyWei,
            lastPriceWei: priceWei,
          };
    }, reduceInit);
  }

  private getMarketOrderAmountsByQuantity(data: MarketHelperInput, book: Optional<Book, "marketId">): OrderAmounts {
    const { asks, bids } = book;

    const qty = retainSignificantDigits(data.quantityWei, 5);

    if (qty !== data.quantityWei) {
      this.logger.debug("[DEBUG]: getMarketOrderAmountsByQuantity truncated quantityWei to 5 significant digits");
    }

    if (qty < BigInt(1e16)) {
      throw new InvalidQuantityError();
    }

    const slippageBps = data.slippageBps ?? 0n;

    switch (data.side) {
      case Side.BUY: {
        const { priceWei, quantityWei, lastPriceWei } = this.processBook(asks, qty);
        // default to false if not provided
        const isMinAmountOut = data.isMinAmountOut === true;

        if (isMinAmountOut) {
          // makerAmount = expected cost (avg price * shares), not worstTierPrice * shares.
          // the signed ratio makerAmount/takerAmount equals worstTierPrice/(1-slippage),
          // which enables SPLIT (mint) matches at all book price levels while minimising
          // the USD commitment so users can spend their full wallet balance.
          const makerAmount = priceWei / this.precision;
          // signedShares = expectedCost / worstTierPrice. fewer than actual shares,
          // but the OB fills up to `amount` (actual shares), constrained by the USD budget.
          const signedShares = lastPriceWei > 0n ? priceWei / lastPriceWei : 0n;
          const takerAmount =
            slippageBps > 0n ? this.max((signedShares * (10_000n - slippageBps)) / 10_000n, 0n) : signedShares;
          return {
            lastPrice: lastPriceWei,
            // priceWei now contains sum of (price * qty) without division,
            // so divide by quantity only to get weighted average price
            pricePerShare: quantityWei > 0n ? priceWei / quantityWei : 0n,
            makerAmount,
            takerAmount,
            amount: quantityWei,
            slippageBps,
            isMinAmountOut,
          };
        }

        // default: makerAmount = worstTierPrice * shares, inflated by slippage.
        // takerAmount = shares (unchanged).
        const baseMakerAmount = (lastPriceWei * quantityWei) / this.precision;
        // Clamp at $1/share (makerAmount ≤ takerAmount)
        const makerAmount =
          slippageBps > 0n
            ? this.min((baseMakerAmount * (10_000n + slippageBps)) / 10_000n, quantityWei)
            : baseMakerAmount;
        return {
          lastPrice: lastPriceWei,
          // priceWei now contains sum of (price * qty) without division,
          // so divide by quantity only to get weighted average price
          pricePerShare: quantityWei > 0n ? priceWei / quantityWei : 0n,
          makerAmount,
          takerAmount: quantityWei,
          amount: quantityWei,
          slippageBps,
          isMinAmountOut,
        };
      }
      case Side.SELL: {
        const { priceWei, quantityWei, lastPriceWei } = this.processBook(bids, qty);
        const baseTakerAmount = (lastPriceWei * quantityWei) / this.precision;
        // Floor at 0 to prevent underflow
        const takerAmount =
          slippageBps > 0n ? this.max((baseTakerAmount * (10_000n - slippageBps)) / 10_000n, 0n) : baseTakerAmount;
        return {
          lastPrice: lastPriceWei,
          // priceWei now contains sum of (price * qty) without division,
          // so divide by quantity only to get weighted average price
          pricePerShare: quantityWei > 0n ? priceWei / quantityWei : 0n,
          makerAmount: quantityWei,
          takerAmount,
          amount: quantityWei,
          slippageBps,
          isMinAmountOut: false,
        };
      }
    }
  }

  private getMarketOrderAmountsByValue(data: MarketHelperValueInput, book: Optional<Book, "marketId">): OrderAmounts {
    const { asks } = book;

    if (data.valueWei < BigInt(1e18)) {
      throw new InvalidQuantityError();
    }

    const currencyAmountWei = data.valueWei;
    const { numberOfShares } = asks.reduce(
      (acc, [_price, _qty]) => {
        const priceWei = parseEther(_price.toString());
        const qtyWei = parseEther(_qty.toString());

        const remainingSpend = currencyAmountWei - acc.totalPrice;

        if (remainingSpend <= 0n) {
          return acc;
        }

        const tierTotalPrice = (priceWei * qtyWei) / this.precision;

        // check if the market buy can consume this entire price tier
        // and consume it all if so.
        if (tierTotalPrice <= remainingSpend) {
          acc.numberOfShares += qtyWei;
          acc.totalPrice += (priceWei * qtyWei) / this.precision;

          return acc;
        }

        // consume as much as we can
        const fractionalShareAmount = priceWei > 0n ? (remainingSpend * this.precision) / priceWei : 0n;

        acc.numberOfShares += fractionalShareAmount;
        acc.totalPrice += (priceWei * fractionalShareAmount) / this.precision;

        return acc;
      },
      {
        numberOfShares: 0n,
        totalPrice: 0n,
      },
    );

    const roundedShares = retainSignificantDigits(numberOfShares, 5);
    const amounts = this.getMarketOrderAmountsByQuantity(
      {
        side: data.side,
        quantityWei: roundedShares,
        slippageBps: data.slippageBps,
        isMinAmountOut: data.isMinAmountOut,
      },
      book,
    );

    return {
      pricePerShare: amounts.pricePerShare,
      makerAmount: amounts.makerAmount,
      takerAmount: amounts.takerAmount,
      amount: roundedShares,
      lastPrice: amounts.lastPrice,
      slippageBps: amounts.slippageBps,
      isMinAmountOut: amounts.isMinAmountOut,
    };
  }

  /**
   * Fetches the USDT balance of the connected account or a specific address.
   *
   * @param {"USDT"} [token="USDT"] - The token to fetch the balance for.
   * @param {string | undefined} address - The address to fetch the balance for.
   * @returns {Promise<bigint>} The USDT balance for the signer or address.
   */
  async balanceOf(token: "USDT" = "USDT", address?: string): Promise<bigint> {
    if (!this.contracts) {
      throw new MissingSignerError();
    }

    const { contract } = this.contracts[token];
    const signer = this.predictAccount ?? this.signer!.address;

    return contract.balanceOf(address ?? signer);
  }

  /**
   * Redeems positions for a given condition ID and index set.
   *
   * @param {RedeemPositionsOptions} options - The options for redeeming positions.
   * @param {string} options.conditionId - The condition ID to redeem positions for.
   * @param {1 | 2} options.indexSet - The index set to redeem positions for.
   * @param {bigint} [options.amount] - The amount of tokens to redeem. Required for NegRisk markets.
   * @param {boolean} options.isNegRisk - Whether this is a NegRisk market.
   * @param {boolean} options.isYieldBearing - Whether this is a yield-bearing market.
   * @returns {Promise<TransactionResult>} A promise that resolves to a `TransactionResult` object.
   *
   * @throws {MissingSignerError} If a signer was not provided when instantiating the OrderBuilder.
   * @throws {Error} If amount is not provided for NegRisk markets.
   */
  async redeemPositions(options: RedeemPositionsOptions): Promise<TransactionResult> {
    const { conditionId, indexSet, amount, isNegRisk, isYieldBearing } = options;

    if (!this.contracts) {
      throw new MissingSignerError();
    }

    if (isNegRisk) {
      if (amount === undefined) {
        throw new Error("amount is required for NegRisk markets");
      }

      const identifier = isYieldBearing ? "YIELD_BEARING_NEG_RISK_ADAPTER" : "NEG_RISK_ADAPTER";
      const { contract, codec } = this.contracts[identifier];
      const amounts = indexSet === 1 ? [amount, 0n] : [0n, amount];

      if (this.predictAccount) {
        const kernel = this.contracts.KERNEL.contract;

        const args = [conditionId, amounts];
        const encoded = codec.encodeFunctionData("redeemPositions", args);
        const calldata = this.encodeExecutionCalldata(this.addresses[identifier], encoded);

        return this.handleTransaction(kernel.execute, this.executionMode, calldata);
      } else {
        return this.handleTransaction(contract.redeemPositions, conditionId, amounts);
      }
    } else {
      const identifier = isYieldBearing ? "YIELD_BEARING_CONDITIONAL_TOKENS" : "CONDITIONAL_TOKENS";
      const { contract, codec } = this.contracts[identifier];
      const amounts = [BigInt(indexSet)];

      if (this.predictAccount) {
        const kernel = this.contracts.KERNEL.contract;

        const args = [this.addresses.USDT, ZeroHash, conditionId, amounts];
        const encoded = codec.encodeFunctionData("redeemPositions", args);
        const calldata = this.encodeExecutionCalldata(this.addresses[identifier], encoded);

        return this.handleTransaction(kernel.execute, this.executionMode, calldata);
      } else {
        return this.handleTransaction(contract.redeemPositions, this.addresses.USDT, ZeroHash, conditionId, amounts);
      }
    }
  }

  /**
   * Merges positions for a given condition ID.
   *
   * This combines both outcome tokens back into the collateral token (USDT).
   * Both outcome positions must have equal amounts to merge.
   *
   * @param {MergePositionsOptions} options - The options for merging positions.
   * @param {string} options.conditionId - The condition ID to merge positions for.
   * @param {bigint} options.amount - The amount of each outcome token to merge.
   * @param {boolean} options.isNegRisk - Whether this is a NegRisk market.
   * @param {boolean} options.isYieldBearing - Whether this is a yield-bearing market.
   * @returns {Promise<TransactionResult>} A promise that resolves to a `TransactionResult` object.
   *
   * @throws {MissingSignerError} If a signer was not provided when instantiating the OrderBuilder.
   */
  async mergePositions(options: MergePositionsOptions): Promise<TransactionResult> {
    const { conditionId, amount, isNegRisk, isYieldBearing } = options;

    if (!this.contracts) {
      throw new MissingSignerError();
    }

    if (isNegRisk) {
      const identifier = isYieldBearing ? "YIELD_BEARING_NEG_RISK_ADAPTER" : "NEG_RISK_ADAPTER";
      const { contract, codec } = this.contracts[identifier];

      if (this.predictAccount) {
        const kernel = this.contracts.KERNEL.contract;
        const encoded = codec.encodeFunctionData("mergePositions(bytes32,uint256)", [conditionId, amount]);
        const calldata = this.encodeExecutionCalldata(this.addresses[identifier], encoded);

        return this.handleTransaction(kernel.execute, this.executionMode, calldata);
      } else {
        return this.handleTransaction(contract["mergePositions(bytes32,uint256)"], conditionId, amount);
      }
    } else {
      const identifier = isYieldBearing ? "YIELD_BEARING_CONDITIONAL_TOKENS" : "CONDITIONAL_TOKENS";
      const { contract, codec } = this.contracts[identifier];
      const partition = [1n, 2n];

      if (this.predictAccount) {
        const kernel = this.contracts.KERNEL.contract;

        const args = [this.addresses.USDT, ZeroHash, conditionId, partition, amount];
        const encoded = codec.encodeFunctionData("mergePositions", args);
        const calldata = this.encodeExecutionCalldata(this.addresses[identifier], encoded);

        return this.handleTransaction(kernel.execute, this.executionMode, calldata);
      } else {
        return this.handleTransaction(
          contract.mergePositions,
          this.addresses.USDT,
          ZeroHash,
          conditionId,
          partition,
          amount,
        );
      }
    }
  }

  /**
   * Splits collateral (USDT) into outcome tokens for a given condition ID.
   *
   * This splits the collateral token into both outcome tokens for a condition.
   * The amount specified will be converted into equal amounts of each outcome token.
   *
   * @param {SplitPositionsOptions} options - The options for splitting positions.
   * @param {string} options.conditionId - The condition ID to split positions for.
   * @param {bigint} options.amount - The amount of collateral to split into outcome tokens.
   * @param {boolean} options.isNegRisk - Whether this is a NegRisk market.
   * @param {boolean} options.isYieldBearing - Whether this is a yield-bearing market.
   * @returns {Promise<TransactionResult>} A promise that resolves to a `TransactionResult` object.
   *
   * @throws {MissingSignerError} If a signer was not provided when instantiating the OrderBuilder.
   */
  async splitPositions(options: SplitPositionsOptions): Promise<TransactionResult> {
    const { conditionId, amount, isNegRisk, isYieldBearing } = options;

    if (!this.contracts) {
      throw new MissingSignerError();
    }

    if (isNegRisk) {
      const identifier = isYieldBearing ? "YIELD_BEARING_NEG_RISK_ADAPTER" : "NEG_RISK_ADAPTER";
      const { contract, codec } = this.contracts[identifier];

      if (this.predictAccount) {
        const kernel = this.contracts.KERNEL.contract;
        const encoded = codec.encodeFunctionData("splitPosition(bytes32,uint256)", [conditionId, amount]);
        const calldata = this.encodeExecutionCalldata(this.addresses[identifier], encoded);

        return this.handleTransaction(kernel.execute, this.executionMode, calldata);
      } else {
        return this.handleTransaction(contract["splitPosition(bytes32,uint256)"], conditionId, amount);
      }
    } else {
      const identifier = isYieldBearing ? "YIELD_BEARING_CONDITIONAL_TOKENS" : "CONDITIONAL_TOKENS";
      const { contract, codec } = this.contracts[identifier];
      const partition = [1n, 2n];

      if (this.predictAccount) {
        const kernel = this.contracts.KERNEL.contract;

        const args = [this.addresses.USDT, ZeroHash, conditionId, partition, amount];
        const encoded = codec.encodeFunctionData("splitPosition", args);
        const calldata = this.encodeExecutionCalldata(this.addresses[identifier], encoded);

        return this.handleTransaction(kernel.execute, this.executionMode, calldata);
      } else {
        return this.handleTransaction(
          contract.splitPosition,
          this.addresses.USDT,
          ZeroHash,
          conditionId,
          partition,
          amount,
        );
      }
    }
  }

  /**
   * Converts a set of NO positions in a NegRisk market.
   *
   * Burns the given amount of each NO position in the index set and returns the same amount
   * of each complementary YES position, plus collateral (USDT) proportional to the number of
   * NO positions converted minus one. If the market has a fee, it is taken from both the
   * collateral and the YES tokens. Only NegRisk markets support conversions.
   *
   * @param {ConvertPositionsOptions} options - The options for converting positions.
   * @param {string} options.negRiskOnChainId - The category's on-chain NegRisk market ID (32-byte hex), as returned by the API. Not the numeric API id of a market or category.
   * @param {bigint} options.indexSet - Bitmask of the NO positions to convert, where bit `n` is the market's question at index `n`.
   * @param {bigint} options.amount - The amount of each NO position to convert.
   * @param {boolean} options.isYieldBearing - Whether this is a yield-bearing market.
   * @returns {Promise<TransactionResult>} A promise that resolves to a `TransactionResult` object.
   *
   * @throws {MissingSignerError} If a signer was not provided when instantiating the OrderBuilder.
   */
  async convertPositions(options: ConvertPositionsOptions): Promise<TransactionResult> {
    const { negRiskOnChainId, indexSet, amount, isYieldBearing } = options;

    if (!this.contracts) {
      throw new MissingSignerError();
    }

    const identifier = isYieldBearing ? "YIELD_BEARING_NEG_RISK_ADAPTER" : "NEG_RISK_ADAPTER";
    const { contract, codec } = this.contracts[identifier];

    if (this.predictAccount) {
      const kernel = this.contracts.KERNEL.contract;
      const encoded = codec.encodeFunctionData("convertPositions", [negRiskOnChainId, indexSet, amount]);
      const calldata = this.encodeExecutionCalldata(this.addresses[identifier], encoded);

      return this.handleTransaction(kernel.execute, this.executionMode, calldata);
    } else {
      return this.handleTransaction(contract.convertPositions, negRiskOnChainId, indexSet, amount);
    }
  }

  /**
   * Helper function to sign a message for a Predict account.
   *
   * @private
   * @async
   * @param {string} message - The message to sign.
   * @returns {Promise<string>} The signed message.
   *
   * @throws {MissingSignerError} If a `signer` or `predictAccount` was not provided when instantiating the `OrderBuilder`.
   */
  async signPredictAccountMessage(message: string | { raw: string }): Promise<string> {
    if (!this.signer || !this.predictAccount) {
      throw new MissingSignerError();
    }

    const validatorAddress = this.addresses.ECDSA_VALIDATOR;
    const kernelDomain = KernelDomainByChainId[this.chainId];

    const messageHash = typeof message === "string" ? hashMessage(message) : message.raw;
    const digest = eip712WrapHash(messageHash, { ...kernelDomain, verifyingContract: this.predictAccount });

    const messageBuffer = Buffer.from(digest.slice(2), "hex");
    const signedMessage = await this.signer!.signMessage(messageBuffer);

    return concat([concat(["0x01", validatorAddress]), signedMessage]);
  }

  /**
   * Helper function to calculate the amounts for a LIMIT strategy order.
   *
   * @param {LimitHelperInput} data - The data required to calculate the amounts.
   * @returns {OrderAmounts} An object containing the price per share (as per input), maker amount, and taker amount.
   *
   * @throws {InvalidQuantityError} quantityWei must be greater than 1e18.
   */
  getLimitOrderAmounts(data: LimitHelperInput): OrderAmounts {
    if (data.quantityWei < BigInt(1e16)) {
      throw new InvalidQuantityError();
    }

    // Truncate to 3 significant digits for price, and 5 for quantity
    // This helps avoid precision loss when calculating the amounts.
    const price = retainSignificantDigits(data.pricePerShareWei, 3);
    const qty = retainSignificantDigits(data.quantityWei, 5);

    if (price !== data.pricePerShareWei) {
      this.logger.debug("[DEBUG]: getLimitOrderAmounts truncated pricePerShareWei to 3 significant digits");
    }

    if (qty !== data.quantityWei) {
      this.logger.debug("[DEBUG]: getLimitOrderAmounts truncated quantityWei to 5 significant digits");
    }

    switch (data.side) {
      case Side.BUY: {
        return {
          pricePerShare: price,
          makerAmount: (price * qty) / this.precision,
          takerAmount: qty,
          amount: qty,
          lastPrice: price,
          slippageBps: 0n,
          isMinAmountOut: false,
        };
      }
      case Side.SELL: {
        return {
          pricePerShare: price,
          makerAmount: qty,
          takerAmount: (price * qty) / this.precision,
          amount: qty,
          lastPrice: price,
          slippageBps: 0n,
          isMinAmountOut: false,
        };
      }
    }
  }

  /**
   * Helper function to calculate the amounts for a MARKET strategy order.
   * @remarks The order book should be retrieved from the `GET /markets/{marketId}/orderbook` endpoint.
   *
   * @param {MarketHelperInput | MarketHelperValueInput} data - The data required to calculate the amounts. Quantity represents value for
   *                                   a market buy, and share quantity for a market sell.
   * @param {Book} book - The order book to use for the calculation. The depth levels sorted by price in ascending order.
   * @returns {OrderAmounts} An object containing the average price per share, maker amount, and taker amount.
   *
   * @throws {InvalidQuantityError} quantityWei must be greater than 1e16.
   */
  getMarketOrderAmounts(
    data: MarketHelperInput | MarketHelperValueInput,
    book: Optional<Book, "marketId">,
  ): OrderAmounts {
    if (data.side === Side.BUY && "valueWei" in data) {
      return this.getMarketOrderAmountsByValue(data, book);
    }

    return this.getMarketOrderAmountsByQuantity(data, book);
  }

  /**
   * Builds an order based on the provided strategy and order data.
   *
   * @remarks The current `feeRateBps` should be fetched via the `GET /markets` endpoint.
   * @remarks The expiration for market orders is ignored.
   *
   * @param {OrderStrategy} strategy - The order strategy (e.g., 'MARKET' or 'LIMIT').
   * @param {BuildOrderInput} data - The data required to build the order; some fields are optional.
   * @returns {Order} The constructed order object.
   *
   * @throws {InvalidExpirationError} If the expiration is not in the future.
   */
  buildOrder(strategy: OrderStrategy, data: BuildOrderInput): Order {
    // The fallback date is an arbitrary date to represents an order without an expiration, any date can be used.
    const expiresAt = data.expiresAt ?? new Date("2100-01-01T00:00:00Z");

    const limitExpiration = Math.floor(expiresAt.getTime() / 1000);
    const marketExpiration = Math.floor(Date.now() / 1000 + FIVE_MINUTES_SECONDS);

    if (this.predictAccount && (data?.maker || data?.signer)) {
      this.logger.warn("[WARN]: When using a Predict account the maker and signer are ignored.");
    }

    if (strategy === "MARKET" && data.expiresAt) {
      this.logger.warn("[WARN]: expiresAt for market orders is ignored.");
    }

    if (strategy !== "MARKET" && expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new InvalidExpirationError();
    }

    const signer = data?.signer ?? this.signer?.address ?? this.predictAccount;
    if (!signer) {
      throw new MissingSignerError();
    }

    if (!this.predictAccount && data?.maker && signer !== data.maker) {
      throw new MakerSignerMismatchError();
    }

    return {
      salt: String(data.salt ?? this.generateOrderSalt()),
      maker: this.predictAccount ?? data?.maker ?? signer,
      signer: this.predictAccount ?? signer,
      taker: data.taker ?? ZeroAddress,
      tokenId: String(data.tokenId),
      makerAmount: String(data.makerAmount),
      takerAmount: String(data.takerAmount),
      expiration: String(strategy === "MARKET" ? marketExpiration : limitExpiration),
      nonce: String(data.nonce ?? 0n),
      feeRateBps: String(data.feeRateBps),
      side: data.side,
      signatureType: data.signatureType ?? SignatureType.EOA,
    };
  }

  /**
   * Builds the typed data for an order.
   *
   * @remarks The param `isNegRisk` can be found via the `GET /markets` or `GET /categories` endpoints.
   *
   * @param {Order} order - The order to build the typed data for.
   * @param {boolean} options.isNegRisk - Whether the order is for a neg risk market (winner takes all).
   * @param {boolean} options.isYieldBearing - Whether the order is for a market that has yield enabled.
   * @returns {EIP712TypedData} The typed data for the order.
   */
  buildTypedData(order: Order, options: { isNegRisk: boolean; isYieldBearing: boolean }): EIP712TypedData {
    const identifier = this.getExchangeIdentifier(options.isNegRisk, options.isYieldBearing);
    const verifyingContract = this.addresses[identifier];

    return {
      primaryType: "Order",
      types: {
        EIP712Domain: EIP712_DOMAIN,
        Order: ORDER_STRUCTURE,
      },
      domain: {
        name: PROTOCOL_NAME,
        version: PROTOCOL_VERSION,
        chainId: this.chainId,
        verifyingContract,
      },
      message: {
        ...order,
      } satisfies Order,
    };
  }

  /**
   * Signs an order using the EIP-712 typed data standard.
   * @remarks The param `isNegRisk` can be found via the `GET /markets` endpoint.
   *
   * @async
   * @param {EIP712TypedData} typedData - The typed data to sign.
   * @returns {Promise<SignedOrder>} The signed order.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   * @throws {FailedOrderSignError} If ethers's `signTypedData` failed. See `cause` for more details.
   */
  async signTypedDataOrder(typedData: EIP712TypedData): Promise<SignedOrder> {
    if (!this.signer) {
      throw new MissingSignerError();
    }

    const order = typedData.message as unknown as Order;
    const { EIP712Domain: _, ...typedDataTypes } = typedData.types;

    try {
      if (this.predictAccount) {
        const hash = this.buildTypedDataHash(typedData);
        const signature = await this.signPredictAccountMessage({ raw: hash });

        return { ...order, signature };
      } else {
        const signature = await this.signer.signTypedData(typedData.domain, typedDataTypes, typedData.message);

        return { ...order, signature };
      }
    } catch (error) {
      throw new FailedOrderSignError(error as Error);
    }
  }

  /**
   * Builds the typed data hash.
   *
   * @param {EIP712TypedData} typedData - The typed data to hash.
   * @returns {string} The hash of the typed data.
   *
   * @throws {FailedTypedDataEncoderError} If ethers's `hashTypedData` failed. See `cause` for more details.
   */
  buildTypedDataHash(typedData: EIP712TypedData): string {
    const { EIP712Domain: _, ...typedDataTypes } = typedData.types;

    try {
      return TypedDataEncoder.hash(typedData.domain, typedDataTypes, typedData.message);
    } catch (error) {
      throw new FailedTypedDataEncoderError(error as Error);
    }
  }

  /**
   * Check and manage the approval for the CTF Exchange to transfer the Conditional Tokens.
   *
   * @param {boolean} isNegRisk - Whether to set approval for the Neg Risk CTF Exchange.
   * @param {boolean} isYieldBearing - Whether to set approval for the yield-bearing exchange.
   * @param {boolean} [approved=true] - Whether to approve the CTF Exchange to transfer the Conditional Tokens.
   * @returns {Promise<TransactionResult>} The result of the approval transaction.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  async setCtfExchangeApproval(
    isNegRisk: boolean,
    isYieldBearing: boolean,
    approved: boolean = true,
  ): Promise<TransactionResult> {
    const identifier = this.getExchangeIdentifier(isNegRisk, isYieldBearing);
    const ctfIdentifier = this.getCtfIdentifier(isNegRisk, isYieldBearing);
    const { isApprovedForAll, setApprovalForAll } = this.getApprovalOps(identifier, "ERC1155", ctfIdentifier);

    const isApproved = await isApprovedForAll();

    if (isApproved !== approved) {
      return setApprovalForAll(approved);
    }

    return { success: true };
  }

  /**
   * Check and manage the approval for the Neg Risk Adapter to transfer the Conditional Tokens.
   *
   * @param {boolean} isYieldBearing - Whether to set approval for the yield-bearing neg risk adapter.
   * @param {boolean} [approved=true] - Whether to approve the Neg Risk Adapter to transfer the Conditional Tokens.
   * @returns {Promise<TransactionResult>} The result of the approval transaction.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  async setNegRiskAdapterApproval(isYieldBearing: boolean, approved: boolean = true): Promise<TransactionResult> {
    const identifier = isYieldBearing ? "YIELD_BEARING_NEG_RISK_ADAPTER" : "NEG_RISK_ADAPTER";
    const ctfIdentifier = this.getCtfIdentifier(true, isYieldBearing);
    const { isApprovedForAll, setApprovalForAll } = this.getApprovalOps(identifier, "ERC1155", ctfIdentifier);

    const isApproved = await isApprovedForAll();

    if (isApproved !== approved) {
      return setApprovalForAll(approved);
    }

    return { success: true };
  }

  /**
   * Check and manage the approval for the CTF Exchange to transfer the USDT collateral.
   *
   * @param {boolean} isNegRisk - Whether to set approval for the Neg Risk CTF Exchange.
   * @param {boolean} isYieldBearing - Whether to set approval for the yield-bearing exchange.
   * @param {bigint} [minAmount=MaxInt256] - The minimum amount of USDT tokens to approve for.
   * @param {bigint} [maxAmount=MaxUint256] - The maximum amount of USDT tokens to approve for.
   * @returns {Promise<TransactionResult>} The result of the approval transaction.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  async setCtfExchangeAllowance(
    isNegRisk: boolean,
    isYieldBearing: boolean,
    minAmount: bigint = MaxInt256,
    maxAmount: bigint = MaxUint256,
  ): Promise<TransactionResult> {
    const identifier = this.getExchangeIdentifier(isNegRisk, isYieldBearing);
    const { allowance, approve } = this.getApprovalOps(identifier, "ERC20");

    const currentAllowance = await allowance();

    if (currentAllowance < minAmount) {
      return approve(maxAmount);
    }

    return { success: true };
  }

  /**
   * Sets all necessary approvals for trading on the Predict protocol.
   *
   * @returns {Promise<SetApprovalsResult>} An object containing:
   *   - success: A boolean indicating if all approvals were successful.
   *   - transactions: An array of TransactionResult objects for each approval operation.
   *
   * @throws {MissingSignerError} If a signer was not provided when instantiating the OrderBuilder.
   */

  async setApprovals(): Promise<SetApprovalsResult> {
    const results: TransactionResult[] = [];
    const approvals = [
      this.setCtfExchangeApproval.bind(this, false, false),
      this.setCtfExchangeApproval.bind(this, true, false),
      this.setNegRiskAdapterApproval.bind(this, false),
      this.setCtfExchangeAllowance.bind(this, false, false),
      this.setCtfExchangeAllowance.bind(this, true, false),

      this.setCtfExchangeApproval.bind(this, false, true),
      this.setCtfExchangeApproval.bind(this, true, true),
      this.setNegRiskAdapterApproval.bind(this, true),
      this.setCtfExchangeAllowance.bind(this, false, true),
      this.setCtfExchangeAllowance.bind(this, true, true),
    ];

    for (const approval of approvals) {
      const result = await approval();
      results.push(result);
    }

    const success = results.every((r) => r.success);

    return { success, transactions: results };
  }

  /**
   * Reverse-lookup an address to its `Addresses` key (case-insensitive).
   *
   * @private
   * @param {Address} address - The address to resolve.
   * @returns {keyof Addresses} The matching key.
   * @throws {Error} If the address is not a known protocol address.
   */
  private addressToKey(address: Address): keyof Addresses {
    const target = address.toLowerCase();
    const key = (Object.keys(this.addresses) as (keyof Addresses)[]).find(
      (k) => this.addresses[k].toLowerCase() === target,
    );

    if (!key) {
      throw new Error(`Unknown approval address: ${address}`);
    }

    return key;
  }

  /**
   * Builds a self-describing `ApprovalStep` from a spender/token pair.
   *
   * @private
   * @param {ApprovalStepType} type - The approval kind.
   * @param {keyof Addresses} spenderKey - The address being granted permission.
   * @param {keyof Addresses} tokenKey - The token contract the approval is set on.
   * @returns {ApprovalStep} The step descriptor with default UI copy.
   */
  private makeApprovalStep(
    type: ApprovalStepType,
    spenderKey: keyof Addresses,
    tokenKey: keyof Addresses,
  ): ApprovalStep {
    const role = SPENDER_ROLE_BY_KEY[spenderKey];
    const copy = role ? APPROVAL_STEP_COPY[`${role}:${type}`] : undefined;

    return {
      id: `${type}:${spenderKey}`,
      type,
      spender: this.addresses[spenderKey],
      token: this.addresses[tokenKey],
      label: copy?.label ?? "",
      description: copy?.description ?? "",
    };
  }

  /**
   * Returns the minimal, ordered set of approvals required for a given operation on a
   * given market type. Pure: requires no signer and performs no network calls.
   *
   * @remarks The `isNegRisk` and `isYieldBearing` flags can be fetched via the `GET /markets`
   * or `GET /categories` endpoints. Operations that need no approval (e.g. a standard `MERGE`
   * or `REDEEM`) return an empty array.
   *
   * @param {ApprovalScope} scope - The operation and market type to scope the approvals to.
   * @returns {ApprovalStep[]} The ordered approval steps.
   *
   * @throws {InvalidApprovalOperationError} If `CONVERT` is requested for a non-neg-risk market.
   */
  getApprovalSteps(scope: ApprovalScope): ApprovalStep[] {
    const { operation, isNegRisk, isYieldBearing, side } = scope;

    const exchangeKey = this.getExchangeIdentifier(isNegRisk, isYieldBearing);
    const ctfKey = this.getCtfIdentifier(isNegRisk, isYieldBearing);
    const adapterKey: keyof Addresses = isYieldBearing ? "YIELD_BEARING_NEG_RISK_ADAPTER" : "NEG_RISK_ADAPTER";

    const erc1155 = (spenderKey: keyof Addresses) => this.makeApprovalStep("ERC1155_APPROVAL", spenderKey, ctfKey);
    const erc20 = (spenderKey: keyof Addresses) => this.makeApprovalStep("ERC20_ALLOWANCE", spenderKey, "USDT");

    switch (operation) {
      case "TRADE": {
        const steps: ApprovalStep[] = [];
        const includeSell = side === undefined || side === Side.SELL;
        const includeBuy = side === undefined || side === Side.BUY;

        if (includeSell) {
          steps.push(erc1155(exchangeKey));
        }
        // Neg risk matches route minting/merging through the adapter, which moves the
        // user's conditional tokens, so the adapter must be approved regardless of side.
        if (isNegRisk) {
          steps.push(erc1155(adapterKey));
        }
        if (includeBuy) {
          steps.push(erc20(exchangeKey));
        }

        return steps;
      }
      case "SPLIT": {
        // splitPosition pulls USDT: from the adapter for neg risk, otherwise from the CT contract.
        return isNegRisk ? [erc20(adapterKey)] : [erc20(ctfKey)];
      }
      case "MERGE": {
        // Neg risk merges burn the user's tokens via the adapter; standard merges burn directly.
        return isNegRisk ? [erc1155(adapterKey)] : [];
      }
      case "REDEEM": {
        // Neg risk claims redeem via the adapter; standard redemptions burn the user's own tokens.
        return isNegRisk ? [erc1155(adapterKey)] : [];
      }
      case "CONVERT": {
        if (!isNegRisk) {
          throw new InvalidApprovalOperationError("CONVERT is only valid for neg-risk markets.");
        }
        return [erc1155(adapterKey)];
      }
    }
  }

  /**
   * Returns every approval the protocol could require, across both market types (standard and
   * neg risk) and, by default, both tracks (standard and yield-bearing), deduplicated by `id`.
   *
   * This is the per-step, progress-reportable equivalent of `setApprovals()` (and a slight
   * superset, since it also includes the split allowances). Pure: requires no signer.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.isYieldBearing] - Limit to a single track. When omitted, both the
   *   standard and yield-bearing tracks are included.
   * @returns {ApprovalStep[]} The full, deduplicated set of approval steps.
   */
  getAllApprovalSteps(opts?: { isYieldBearing?: boolean }): ApprovalStep[] {
    const tracks = opts?.isYieldBearing === undefined ? [false, true] : [opts.isYieldBearing];
    const seen = new Set<string>();
    const steps: ApprovalStep[] = [];

    for (const isYieldBearing of tracks) {
      for (const isNegRisk of [false, true]) {
        // CONVERT is neg-risk only; its single step is already covered by the others.
        const operations: ApprovalOperation[] = isNegRisk
          ? ["TRADE", "SPLIT", "MERGE", "REDEEM", "CONVERT"]
          : ["TRADE", "SPLIT", "MERGE", "REDEEM"];

        for (const operation of operations) {
          for (const step of this.getApprovalSteps({ operation, isNegRisk, isYieldBearing })) {
            if (!seen.has(step.id)) {
              seen.add(step.id);
              steps.push(step);
            }
          }
        }
      }
    }

    return steps;
  }

  /**
   * Checks, in a single batched multicall, whether each approval step is already satisfied on-chain.
   *
   * @async
   * @param {ApprovalStep[]} steps - The steps to check (e.g. from `getApprovalSteps`).
   * @returns {Promise<ApprovalCheck[]>} For each step, whether it is already satisfied.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  async checkApprovals(steps: ApprovalStep[]): Promise<ApprovalCheck[]> {
    if (!this.contracts) {
      throw new MissingSignerError();
    }

    const owner = this.predictAccount ?? this.signer!.address;
    const multicall = this.contracts.multicall;

    const checks = steps.map(async (step): Promise<ApprovalCheck> => {
      if (step.type === "ERC20_ALLOWANCE") {
        const allowance = await multicall.USDT.contract.allowance(owner, step.spender);
        return { step, satisfied: allowance >= MaxInt256 };
      }

      const ctfKey = this.addressToKey(step.token);
      const ctf = multicall[ctfKey] as { contract: ConditionalTokens; codec: Interface };
      const approved = await ctf.contract.isApprovedForAll(owner, step.spender);
      return { step, satisfied: approved };
    });

    return Promise.all(checks);
  }

  /**
   * Checks whether a single approval step is already satisfied on-chain.
   *
   * @async
   * @param {ApprovalStep} step - The step to check.
   * @returns {Promise<boolean>} Whether the approval is already in place.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  async checkApproval(step: ApprovalStep): Promise<boolean> {
    const [result] = await this.checkApprovals([step]);
    return result!.satisfied;
  }

  /**
   * Executes a single approval step on-chain. This is a raw send: it does not check whether the
   * approval is already in place (use `checkApproval` for that, or `runApprovals` to do both).
   *
   * @async
   * @param {ApprovalStep} step - The step to execute.
   * @param {SetApprovalOptions} [opts] - For ERC-1155: `approved` (default `true`, pass `false` to revoke).
   *   For ERC-20: `amount` (default `MaxUint256`); `approved: false` revokes by setting the allowance to `0`.
   * @returns {Promise<TransactionResult>} The transaction result.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  async setApproval(step: ApprovalStep, opts?: SetApprovalOptions): Promise<TransactionResult> {
    if (!this.contracts) {
      throw new MissingSignerError();
    }

    const approved = opts?.approved ?? true;
    const spenderKey = this.addressToKey(step.spender);

    if (step.type === "ERC1155_APPROVAL") {
      const ctfIdentifier = this.addressToKey(step.token) as CtfIdentifier;
      const { setApprovalForAll } = this.getApprovalOps(spenderKey, "ERC1155", ctfIdentifier);
      return setApprovalForAll(approved);
    }

    const { approve } = this.getApprovalOps(spenderKey, "ERC20");
    // For ERC-20, `approved: false` revokes by setting the allowance to 0.
    return approve(approved ? (opts?.amount ?? MaxUint256) : 0n);
  }

  /**
   * Runs the given approval steps in order, reporting progress for each. Duplicate steps (by `id`)
   * are removed, so you can pass a union of scopes or a curated subset.
   *
   * Produce the steps with `getApprovalSteps(scope)` (one operation) or `getAllApprovalSteps()`
   * (everything). By default, each step is first checked and skipped if already satisfied, and the
   * run stops on the first failure. Use the consumer-driven primitives (`checkApproval` +
   * `setApproval`) directly when you need finer control, e.g. gating each step on a user confirmation.
   *
   * @async
   * @param {ApprovalStep[]} steps - The steps to run (e.g. from `getApprovalSteps` / `getAllApprovalSteps`).
   * @param {RunApprovalsOptions} [opts] - `skipSatisfied` (default true), `stopOnError` (default true),
   *   and an optional `onProgress` callback invoked as each step transitions.
   * @returns {Promise<ApprovalRunReport>} The per-step report and overall success.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  async runApprovals(steps: ApprovalStep[], opts?: RunApprovalsOptions): Promise<ApprovalRunReport> {
    const skipSatisfied = opts?.skipSatisfied ?? true;
    const stopOnError = opts?.stopOnError ?? true;
    const onProgress = opts?.onProgress;

    // Dedupe by id (first occurrence wins) so unioned/curated step lists "just work".
    const seen = new Set<string>();
    const uniqueSteps = steps.filter((step) => {
      if (seen.has(step.id)) {
        return false;
      }
      seen.add(step.id);
      return true;
    });

    const results: ApprovalStepResult[] = [];
    let success = true;

    for (const step of uniqueSteps) {
      if (skipSatisfied) {
        onProgress?.({ step, status: "checking" });

        // A pre-check read failure is non-fatal: fall through to the send path (matching the
        // legacy approval helpers) rather than aborting the whole run.
        let alreadySatisfied = false;
        try {
          alreadySatisfied = await this.checkApproval(step);
        } catch {
          alreadySatisfied = false;
        }

        if (alreadySatisfied) {
          onProgress?.({ step, status: "skipped" });
          results.push({ step, status: "skipped" });
          continue;
        }
      }

      onProgress?.({ step, status: "submitting" });
      const transaction = await this.setApproval(step);
      const status = transaction.success ? "confirmed" : "failed";

      onProgress?.({ step, status, transaction });
      results.push({ step, status, transaction });

      if (!transaction.success) {
        success = false;
        if (stopOnError) {
          break;
        }
      }
    }

    return { success, steps: results };
  }

  /**
   * Validates the token IDs against the CTF Exchange or Neg Risk CTF Exchange based on the `isNegRisk` flag.
   *
   * @async
   * @param {BigNumberish[]} tokenIds - The token IDs to validate.
   * @param {boolean} isNegRisk - Whether the order is for a multi-outcome market.
   * @param {boolean} isYieldBearing - Whether the order is for a market that has yield enabled.
   * @returns {Promise<boolean>} Whether the token IDs are valid.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  async validateTokenIds(tokenIds: BigNumberish[], isNegRisk: boolean, isYieldBearing: boolean): Promise<boolean> {
    if (!this.contracts) {
      throw new MissingSignerError();
    }

    const multicall = this.contracts.multicall;
    const identifier = this.getExchangeIdentifier(isNegRisk, isYieldBearing);
    const validations = tokenIds.map((tokenId) => {
      const exchange = multicall[identifier] as { contract: CTFExchange | NegRiskCtfExchange; codec: Interface };
      return exchange.contract.validateTokenId(tokenId);
    });

    const results = await Promise.allSettled(validations);
    return results.every((result) => result.status === "fulfilled");
  }

  /**
   * Cancels orders for the CTF Exchange or Neg Risk CTF Exchange.
   *
   * @async
   * @param {Order[]} orders - The orders to cancel.
   * @param {CancelOrdersOptions} options - The options for the cancellation.
   * @returns {Promise<TransactionResult>} The result of the cancellation.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   * @throws {InvalidNegRiskConfig} If the token IDs are invalid for the selected CTF Exchange.
   */
  async cancelOrders(orders: Order[], options: CancelOrdersOptions): Promise<TransactionResult> {
    const orderStructs = orders as OrderStruct[];
    if (orderStructs.length === 0) {
      return { success: true };
    }

    if (!this.contracts) {
      throw new MissingSignerError();
    }

    if (options?.withValidation ?? true) {
      const tokenIds = orderStructs.map((order) => order.tokenId);
      const isValid = await this.validateTokenIds(tokenIds, options.isNegRisk, options.isYieldBearing);

      if (!isValid) {
        throw new InvalidNegRiskConfig();
      }
    }

    const identifier = this.getExchangeIdentifier(options.isNegRisk, options.isYieldBearing);
    const { contract, codec } = this.contracts[identifier] as {
      contract: CTFExchange | NegRiskCtfExchange;
      codec: Interface;
    };
    const address = this.addresses[identifier];

    if (this.predictAccount) {
      const kernel = this.contracts.KERNEL.contract;
      const encoded = codec.encodeFunctionData("cancelOrders", [orderStructs]);
      const calldata = this.encodeExecutionCalldata(address, encoded);

      return this.handleTransaction(kernel.execute, this.executionMode, calldata);
    } else {
      return this.handleTransaction(contract.cancelOrders, orderStructs);
    }
  }
}
