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
  SetApprovalsResult,
  Address,
  MarketHelperValueInput,
  LogLevel,
} from "./Types";
import type { AbstractProvider, BaseWallet, BigNumberish, Interface } from "ethers";
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
  MaxInt256,
  MaxUint256,
  parseEther,
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
 * Default function to generate a random salt for the order.
 *
 * @returns {string} A random numeric string value for the salt.
 */
export const generateOrderSalt = (): string => {
  return String(Math.round(Math.random() * MAX_SALT));
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
   * @param {BaseWallet} signer - Signer object for signing orders. This will cause the method to return a promise.
   * @param {OrderBuilderOptions} [options] - Optional order configuration options.
   * @returns {Promise<OrderBuilder>} A new OrderBuilder instance with contract functionality.
   */
  static make(chainId: ChainId, signer: BaseWallet, options?: OrderBuilderOptions): Promise<OrderBuilder>;
  static make(
    chainId: ChainId,
    signer: BaseWallet | undefined,
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
        signerWallet = signerWallet.connect(provider);
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
    private readonly signer?: BaseWallet,
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

  private getApprovalOps(key: keyof Addresses, type: "ERC1155"): Erc1155Approval;
  private getApprovalOps(key: keyof Addresses, type: "ERC20"): Erc20Approval;

  /**
   * Helper function to get the approval operations for the given contract and type.
   *
   * @private
   * @param {keyof Addresses} key - The key of the contract in the `Addresses` object.
   * @param {"ERC1155" | "ERC20"} type - The type of approval to get.
   * @returns {Approval} The approval operations for the given contract and type.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  private getApprovalOps(key: keyof Addresses, type: "ERC1155" | "ERC20"): Approval {
    const address = this.addresses[key];

    if (this.contracts === undefined) {
      throw new MissingSignerError();
    }

    if (this.predictAccount) {
      const kernel = this.contracts.KERNEL.contract;

      switch (type) {
        case "ERC1155": {
          const { contract, codec } = this.contracts.CONDITIONAL_TOKENS;

          return {
            isApprovedForAll: () => contract.isApprovedForAll(this.predictAccount!, address),
            setApprovalForAll: (approved: boolean = true) => {
              const encoded = codec.encodeFunctionData("setApprovalForAll", [address, approved]);
              const calldata = this.encodeExecutionCalldata(this.addresses.CONDITIONAL_TOKENS, encoded);

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
          const contract = this.contracts.CONDITIONAL_TOKENS.contract;

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

      return remainingQtyWei < qtyWei
        ? {
            quantityWei: acc.quantityWei + remainingQtyWei,
            priceWei: acc.priceWei + (priceWei * remainingQtyWei) / this.precision,
            lastPriceWei: priceWei,
          }
        : {
            quantityWei: acc.quantityWei + qtyWei,
            priceWei: acc.priceWei + (priceWei * qtyWei) / this.precision,
            lastPriceWei: priceWei,
          };
    }, reduceInit);
  }

  private getMarketOrderAmountsByQuantity(data: MarketHelperInput, book: Optional<Book, "marketId">): OrderAmounts {
    const { updateTimestampMs, asks, bids } = book;

    if (Date.now() - updateTimestampMs > FIVE_MINUTES_SECONDS * 1000) {
      this.logger.warn("[WARN]: Order book is potentially stale. Consider using a more recent one.");
    }

    const qty = retainSignificantDigits(data.quantityWei, 5);

    if (qty !== data.quantityWei) {
      this.logger.debug("[DEBUG]: getMarketOrderAmountsByQuantity truncated quantityWei to 5 significant digits");
    }

    if (qty < BigInt(1e16)) {
      throw new InvalidQuantityError();
    }

    switch (data.side) {
      case Side.BUY: {
        const { priceWei, quantityWei, lastPriceWei } = this.processBook(asks, qty);
        return {
          lastPrice: lastPriceWei,
          pricePerShare: quantityWei > 0n ? (priceWei * this.precision) / quantityWei : 0n,
          makerAmount: (lastPriceWei * quantityWei) / this.precision,
          takerAmount: quantityWei,
        };
      }
      case Side.SELL: {
        const { priceWei, quantityWei, lastPriceWei } = this.processBook(bids, qty);
        return {
          lastPrice: lastPriceWei,
          pricePerShare: quantityWei > 0n ? (priceWei * this.precision) / quantityWei : 0n,
          makerAmount: quantityWei,
          takerAmount: (lastPriceWei * quantityWei) / this.precision,
        };
      }
    }
  }

  private getMarketOrderAmountsByValue(data: MarketHelperValueInput, book: Optional<Book, "marketId">): OrderAmounts {
    const { updateTimestampMs, asks } = book;

    if (Date.now() - updateTimestampMs > FIVE_MINUTES_SECONDS * 1000) {
      this.logger.warn("[WARN]: Order book is potentially stale. Consider using a more recent one.");
    }

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
    const amounts = this.getMarketOrderAmountsByQuantity({ side: data.side, quantityWei: roundedShares }, book);
    const { lastPrice, pricePerShare } = amounts;

    return {
      pricePerShare,
      makerAmount: (lastPrice * roundedShares) / this.precision, // max user can spend (signed against highest asl)
      takerAmount: roundedShares, // min shares they should get for their spend
      lastPrice,
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
   * Redeems positions for a given condition ID and index set for non-NegRisk markets.
   *
   * @param {string} conditionId - The condition ID to redeem positions for.
   * @param {1 | 2} indexSet - The index set to redeem positions for.
   * @returns {Promise<TransactionResult>} A promise that resolves to a `TransactionResult` object.
   */
  async redeemPositions(conditionId: string, indexSet: 1 | 2): Promise<TransactionResult> {
    if (!this.contracts) {
      throw new MissingSignerError();
    }

    const { contract, codec } = this.contracts.CONDITIONAL_TOKENS;
    const amounts = [BigInt(indexSet)];

    if (this.predictAccount) {
      const kernel = this.contracts.KERNEL.contract;

      const args = [this.addresses.USDT, ZeroHash, conditionId, amounts];
      const encoded = codec.encodeFunctionData("redeemPositions", args);
      const calldata = this.encodeExecutionCalldata(this.addresses.CONDITIONAL_TOKENS, encoded);

      return this.handleTransaction(kernel.execute, this.executionMode, calldata);
    } else {
      return this.handleTransaction(contract.redeemPositions, this.addresses.USDT, ZeroHash, conditionId, amounts);
    }
  }

  /**
   * Redeems positions for a given condition ID, index set and amount for NegRisk markets.
   *
   * @param {string} conditionId - The condition ID to redeem positions for.
   * @param {1 | 2} indexSet - The index set to redeem positions for.
   * @param {string | bigint} amount - The amount of tokens for a given position to redeem.
   * @returns {Promise<TransactionResult>} A promise that resolves to a `TransactionResult` object.
   */
  async redeemNegRiskPositions(conditionId: string, indexSet: 1 | 2, amount: BigNumberish): Promise<TransactionResult> {
    if (!this.contracts) {
      throw new MissingSignerError();
    }

    const { contract, codec } = this.contracts["NEG_RISK_ADAPTER"];
    const amounts = indexSet === 1 ? [amount, 0n] : [0n, amount];

    if (this.predictAccount) {
      const kernel = this.contracts.KERNEL.contract;

      const args = [conditionId, amounts];
      const encoded = codec.encodeFunctionData("redeemPositions", args);
      const calldata = this.encodeExecutionCalldata(this.addresses.NEG_RISK_ADAPTER, encoded);

      return this.handleTransaction(kernel.execute, this.executionMode, calldata);
    } else {
      return this.handleTransaction(contract.redeemPositions, conditionId, amounts);
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
          lastPrice: price,
        };
      }
      case Side.SELL: {
        return {
          pricePerShare: price,
          makerAmount: qty,
          takerAmount: (price * qty) / this.precision,
          lastPrice: price,
        };
      }
    }
  }

  /**
   * Helper function to calculate the amounts for a MARKET strategy order.
   * @remarks The order book should be retrieved from the `GET /orderbook/{marketId}` endpoint.
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

    const signer = data?.signer ?? this.signer!.address;
    if (data?.maker && signer !== data.maker) {
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
   * @param {boolean} [isNegRisk=false] - Whether to set approval for the Neg Risk CTF Exchange.
   * @param {boolean} [isYieldBearing=false] - Whether to set approval for the yield-bearing exchange.
   * @param {boolean} [approved=true] - Whether to approve the CTF Exchange to transfer the Conditional Tokens.
   * @returns {Promise<TransactionResult>} The result of the approval transaction.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  async setCtfExchangeApproval(
    isNegRisk: boolean = false,
    isYieldBearing: boolean = false,
    approved: boolean = true,
  ): Promise<TransactionResult> {
    const identifier = this.getExchangeIdentifier(isNegRisk, isYieldBearing);
    const { isApprovedForAll, setApprovalForAll } = this.getApprovalOps(identifier, "ERC1155");

    const isApproved = await isApprovedForAll();

    if (isApproved !== approved) {
      return setApprovalForAll(approved);
    }

    return { success: true };
  }

  /**
   * Check and manage the approval for the Neg Risk Adapter to transfer the Conditional Tokens.
   *
   * @param {boolean} [isYieldBearing] - Whether to set approval for the yield-bearing neg risk adapter.
   * @param {boolean} [approved=true] - Whether to approve the Neg Risk Adapter to transfer the Conditional Tokens.
   * @returns {Promise<TransactionResult>} The result of the approval transaction.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  async setNegRiskAdapterApproval(isYieldBearing: boolean, approved: boolean = true): Promise<TransactionResult> {
    const identifier = isYieldBearing ? "YIELD_BEARING_NEG_RISK_ADAPTER" : "NEG_RISK_ADAPTER";
    const { isApprovedForAll, setApprovalForAll } = this.getApprovalOps(identifier, "ERC1155");

    const isApproved = await isApprovedForAll();

    if (isApproved !== approved) {
      return setApprovalForAll(approved);
    }

    return { success: true };
  }

  /**
   * Check and manage the approval for the CTF Exchange to transfer the USDT collateral.
   *
   * @param {boolean} [isNegRisk=false] - Whether to set approval for the Neg Risk CTF Exchange.
   * @param {boolean} [isYieldBearing=false] - Whether to set approval for the yield-bearing exchange.
   * @param {bigint} [minAmount=MaxInt256] - The minimum amount of USDT tokens to approve for.
   * @param {bigint} [maxAmount=MaxUint256] - The maximum amount of USDT tokens to approve for.
   * @returns {Promise<TransactionResult>} The result of the approval transaction.
   *
   * @throws {MissingSignerError} If a `signer` was not provided when instantiating the `OrderBuilder`.
   */
  async setCtfExchangeAllowance(
    isNegRisk: boolean = false,
    isYieldBearing: boolean = false,
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
