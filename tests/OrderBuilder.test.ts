import type { BaseWallet } from "ethers";
import type { Book } from "../src/Types";
import { parseEther, ZeroAddress } from "ethers";
import { OrderBuilder } from "../src/OrderBuilder";
import { ChainId, Side, SignatureType } from "../src/Constants";
import { InvalidQuantityError, InvalidExpirationError, MissingSignerError } from "../src/Errors";

const mockSigner = {
  provider: {
    _isMulticallProvider: true,
  },
  signTypedData: jest.fn().mockResolvedValue("0xmocksignature"),
  connect: jest.fn().mockReturnValue({
    signTypedData: jest.fn().mockResolvedValue("0xmocksignature"),
  }),
} as unknown as BaseWallet;

const toWei = (amount: number) => parseEther(amount.toString());
const generateSalt = () => "1234";

describe("OrderBuilder", () => {
  let orderBuilder: OrderBuilder;

  beforeAll(async () => {
    orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner, { generateSalt });
  });

  describe("getLimitOrderAmounts", () => {
    it("should calculate correct amounts for BUY order", () => {
      const result = orderBuilder.getLimitOrderAmounts({
        side: Side.BUY,
        pricePerShareWei: toWei(2),
        quantityWei: toWei(5),
      });

      expect(result.pricePerShare).toBe(toWei(2));
      expect(result.makerAmount).toBe(toWei(10));
      expect(result.takerAmount).toBe(toWei(5));
    });

    it("should calculate correct amounts for BUY order by rounding up", () => {
      const result = orderBuilder.getLimitOrderAmounts({
        side: Side.BUY,
        pricePerShareWei: 381_000_000_000_000_000n,
        quantityWei: 18_001_999_999_999_999_475_712n,
      });

      expect(result.pricePerShare).toBe(381_000_000_000_000_000n);
      expect(result.makerAmount).toBe(6_858_381_000_000_000_000_000n);
      expect(result.takerAmount).toBe(18_001_000_000_000_000_000_000n);
    });

    it("should calculate correct amounts for SELL order", () => {
      const result = orderBuilder.getLimitOrderAmounts({
        side: Side.SELL,
        pricePerShareWei: toWei(2),
        quantityWei: toWei(5),
      });

      expect(result.pricePerShare).toBe(toWei(2));
      expect(result.makerAmount).toBe(toWei(5));
      expect(result.takerAmount).toBe(toWei(10));
    });

    it("should calculate correct amounts for SELL order by rounding up", () => {
      const result = orderBuilder.getLimitOrderAmounts({
        side: Side.SELL,
        pricePerShareWei: 381_000_000_000_000_000n,
        quantityWei: 18_001_999_999_999_999_475_712n,
      });

      expect(result.pricePerShare).toBe(381_000_000_000_000_000n);
      expect(result.makerAmount).toBe(18_001_000_000_000_000_000_000n);
      expect(result.takerAmount).toBe(6_858_381_000_000_000_000_000n);
    });

    it("should throw InvalidQuantityError for small quantity", () => {
      expect(() =>
        orderBuilder.getLimitOrderAmounts({
          side: Side.BUY,
          pricePerShareWei: toWei(2),
          quantityWei: toWei(0.001),
        }),
      ).toThrow(InvalidQuantityError);
    });
  });

  describe("getMarketOrderAmounts", () => {
    const mockBook = {
      updateTimestampMs: Date.now(),
      asks: [
        [0.5, 3],
        [0.88, 4],
      ],
      bids: [
        [0.9, 2],
        [0.5, 3],
      ],
    } as Book;

    it("should calculate correct amounts for BUY order by value", () => {
      const result = orderBuilder.getMarketOrderAmounts({ side: Side.BUY, valueWei: toWei(1) }, mockBook);

      expect(result.makerAmount).toBe(toWei(1)); // 1 usdt offered
      expect(result.pricePerShare).toBe(toWei(0.5)); // 0.5 usdt per share
      expect(result.takerAmount).toBe(toWei(2)); // 2 shares consumed
    });

    it("should calculate correct amounts for BUY order by value across levels", () => {
      const result = orderBuilder.getMarketOrderAmounts({ side: Side.BUY, valueWei: toWei(2) }, {
        updateTimestampMs: Date.now(),
        asks: [
          [0.25, 2],
          [0.75, 2],
        ],
      } as Book);

      expect(result.makerAmount).toBe(toWei(3));
      expect(result.pricePerShare).toBe(toWei(0.5));
      expect(result.takerAmount).toBe(toWei(4));

      const maxPriceWillingToPay = (result.makerAmount * BigInt(1e18)) / result.takerAmount;

      expect(maxPriceWillingToPay).toBe(toWei(0.75));
    });

    it("should calculate correct amounts for BUY order", () => {
      const result = orderBuilder.getMarketOrderAmounts({ side: Side.BUY, quantityWei: toWei(5) }, mockBook);

      expect(result.pricePerShare).toBe(toWei(0.652));
      expect(result.makerAmount).toBe(toWei(0.88 * 5));
      expect(result.takerAmount).toBe(toWei(5));
    });

    it("should calculate correct amounts for BUY order with max price", () => {
      const result = orderBuilder.getMarketOrderAmounts(
        {
          side: Side.BUY,
          quantityWei: 3_000_000_000_000_000_000n,
        },
        {
          updateTimestampMs: Date.now(),
          asks: [
            [0.746, 0.9],
            [0.75, 20_000],
          ],
          bids: [],
        },
      );

      expect(result.pricePerShare).toBe(748_800_000_000_000_000n);
      expect(result.makerAmount).toBe(2_250_000_000_000_000_000n);
      expect(result.takerAmount).toBe(3_000_000_000_000_000_000n);

      const maxPriceWillingToPay = (result.makerAmount * BigInt(1e18)) / result.takerAmount;

      expect(maxPriceWillingToPay).toBe(750_000_000_000_000_000n);
    });

    it("should calculate correct amounts for BUY with full precision", () => {
      const result = orderBuilder.getMarketOrderAmounts(
        {
          side: Side.BUY,
          quantityWei: 1_000_000_000_000_000_000n, // 1 usdt
        },
        {
          updateTimestampMs: Date.now(),
          asks: [[0.3, 100_000]],
          bids: [],
        },
      );

      expect(result.pricePerShare).toBe(300_000_000_000_000_000n);
      expect(result.makerAmount).toBe(300_000_000_000_000_000n);
      expect(result.takerAmount).toBe(1_000_000_000_000_000_000n);

      const maxPriceWillingToPay = (result.makerAmount * BigInt(1e18)) / result.takerAmount;

      expect(maxPriceWillingToPay).toBe(300_000_000_000_000_000n);
    });

    it("should calculate correct amounts for SELL order", () => {
      const result = orderBuilder.getMarketOrderAmounts({ side: Side.SELL, quantityWei: toWei(5) }, mockBook);

      expect(result.pricePerShare).toBe(toWei(0.66));
      expect(result.makerAmount).toBe(toWei(5));
      // With bids [0.9, 2], [0.5, 3]: worst tier = 0.5, takerAmount = worstTier * qty
      expect(result.takerAmount).toBe(toWei(0.5 * 5));
    });

    it("should throw InvalidQuantityError for small quantity", () => {
      expect(() => orderBuilder.getMarketOrderAmounts({ side: Side.BUY, quantityWei: toWei(0.001) }, mockBook)).toThrow(
        InvalidQuantityError,
      );
    });

    describe("slippage", () => {
      const slippageBook = {
        updateTimestampMs: Date.now(),
        asks: [
          [0.27, 100],
          [0.3, 200],
        ],
        bids: [
          [0.27, 100],
          [0.25, 200],
        ],
      } as Book;

      it("should inflate makerAmount for BUY by quantity with slippage", () => {
        const withoutSlippage = orderBuilder.getMarketOrderAmounts(
          { side: Side.BUY, quantityWei: toWei(100) },
          slippageBook,
        );
        const withSlippage = orderBuilder.getMarketOrderAmounts(
          { side: Side.BUY, quantityWei: toWei(100), slippageBps: 500n },
          slippageBook,
        );

        const expected = (withoutSlippage.makerAmount * 10_500n) / 10_000n;
        expect(withSlippage.makerAmount).toBe(expected);
        expect(withSlippage.takerAmount).toBe(withoutSlippage.takerAmount);
        expect(withSlippage.pricePerShare).toBe(withoutSlippage.pricePerShare);
        expect(withSlippage.lastPrice).toBe(withoutSlippage.lastPrice);
        expect(withSlippage.slippageBps).toBe(500n);
      });

      it("should deflate takerAmount for SELL by quantity with slippage", () => {
        const withoutSlippage = orderBuilder.getMarketOrderAmounts(
          { side: Side.SELL, quantityWei: toWei(100) },
          slippageBook,
        );
        const withSlippage = orderBuilder.getMarketOrderAmounts(
          { side: Side.SELL, quantityWei: toWei(100), slippageBps: 500n },
          slippageBook,
        );

        const expected = (withoutSlippage.takerAmount * 9500n) / 10_000n;
        expect(withSlippage.takerAmount).toBe(expected);
        expect(withSlippage.makerAmount).toBe(withoutSlippage.makerAmount);
        expect(withSlippage.pricePerShare).toBe(withoutSlippage.pricePerShare);
        expect(withSlippage.lastPrice).toBe(withoutSlippage.lastPrice);
        expect(withSlippage.slippageBps).toBe(500n);
      });

      it("should inflate makerAmount for BUY by value with slippage", () => {
        const withoutSlippage = orderBuilder.getMarketOrderAmounts(
          { side: Side.BUY, valueWei: toWei(10) },
          slippageBook,
        );
        const withSlippage = orderBuilder.getMarketOrderAmounts(
          { side: Side.BUY, valueWei: toWei(10), slippageBps: 500n },
          slippageBook,
        );

        const expected = (withoutSlippage.makerAmount * 10_500n) / 10_000n;
        expect(withSlippage.makerAmount).toBe(expected);
        expect(withSlippage.takerAmount).toBe(withoutSlippage.takerAmount);
        expect(withSlippage.slippageBps).toBe(500n);
      });

      it("should not apply slippage when slippageBps is omitted", () => {
        const result = orderBuilder.getMarketOrderAmounts({ side: Side.BUY, quantityWei: toWei(100) }, slippageBook);

        // makerAmount should equal lastPrice * qty / 1e18 (no slippage)
        const expectedMaker = (result.lastPrice * toWei(100)) / BigInt(1e18);
        expect(result.makerAmount).toBe(expectedMaker);
        expect(result.slippageBps).toBe(0n);
      });

      it("should not apply slippage when slippageBps is 0n", () => {
        const withDefault = orderBuilder.getMarketOrderAmounts(
          { side: Side.BUY, quantityWei: toWei(100) },
          slippageBook,
        );
        const withZero = orderBuilder.getMarketOrderAmounts(
          { side: Side.BUY, quantityWei: toWei(100), slippageBps: 0n },
          slippageBook,
        );

        expect(withZero.makerAmount).toBe(withDefault.makerAmount);
        expect(withZero.takerAmount).toBe(withDefault.takerAmount);
        expect(withZero.slippageBps).toBe(0n);
      });

      it("should clamp BUY makerAmount at $1/share when slippage pushes price above $1", () => {
        const highPriceBook = {
          updateTimestampMs: Date.now(),
          asks: [[0.97, 100]],
          bids: [[0.96, 100]],
        } as Book;

        const result = orderBuilder.getMarketOrderAmounts(
          { side: Side.BUY, quantityWei: toWei(100), slippageBps: 500n }, // 5% on 0.97 = 1.0185
          highPriceBook,
        );

        // makerAmount should be clamped to takerAmount (shares), i.e. $1/share
        expect(result.makerAmount).toBe(result.takerAmount);
      });

      it("should floor SELL takerAmount at 0 with extreme slippage", () => {
        const result = orderBuilder.getMarketOrderAmounts(
          { side: Side.SELL, quantityWei: toWei(100), slippageBps: 10_001n },
          slippageBook,
        );

        expect(result.takerAmount).toBe(0n);
      });

      describe("deep book (avg ≠ worst tier)", () => {
        // avg = (0.25*50 + 0.27*30 + 0.30*20) / 100 = 0.266
        // worst = 0.30 (highest ask for BUY)
        const deepAskBook = {
          updateTimestampMs: Date.now(),
          asks: [
            [0.25, 50],
            [0.27, 30],
            [0.3, 20],
          ],
          bids: [
            [0.3, 50],
            [0.27, 30],
            [0.25, 20],
          ],
        } as Book;

        it("BUY: slippage applies to worst tier price", () => {
          const withoutSlippage = orderBuilder.getMarketOrderAmounts(
            { side: Side.BUY, quantityWei: toWei(100) },
            deepAskBook,
          );
          const withSlippage = orderBuilder.getMarketOrderAmounts(
            { side: Side.BUY, quantityWei: toWei(100), slippageBps: 500n },
            deepAskBook,
          );

          // worstTier = 0.30, 5% buffer: 0.30 * 100 * 1.05 = 31.5
          const expected = (withoutSlippage.makerAmount * 10_500n) / 10_000n;
          expect(withSlippage.makerAmount).toBe(expected);
          expect(withSlippage.lastPrice).toBe(toWei(0.3));
        });

        it("SELL: slippage applies to worst tier price", () => {
          const withoutSlippage = orderBuilder.getMarketOrderAmounts(
            { side: Side.SELL, quantityWei: toWei(100) },
            deepAskBook,
          );
          const withSlippage = orderBuilder.getMarketOrderAmounts(
            { side: Side.SELL, quantityWei: toWei(100), slippageBps: 500n },
            deepAskBook,
          );

          // worstTier = 0.25, 5% buffer: 0.25 * 100 * 0.95 = 23.75
          const expected = (withoutSlippage.takerAmount * 9500n) / 10_000n;
          expect(withSlippage.takerAmount).toBe(expected);
          expect(withSlippage.lastPrice).toBe(toWei(0.25));
        });
      });
    });
  });

  describe("buildOrder", () => {
    it("should build a LIMIT order correctly", () => {
      const order = orderBuilder.buildOrder("LIMIT", {
        side: Side.BUY,
        signer: "0xsigner",
        tokenId: "123",
        makerAmount: toWei(10),
        takerAmount: toWei(5),
        feeRateBps: 0,
      });

      expect(order.salt).toBe("1234");
      expect(order.side).toBe(Side.BUY);
      expect(order.nonce).toBe("0");
      expect(order.maker).toBe("0xsigner");
      expect(order.signer).toBe("0xsigner");
      expect(order.taker).toBe(ZeroAddress);
      expect(order.tokenId).toBe("123");
      expect(order.makerAmount).toBe(toWei(10).toString());
      expect(order.takerAmount).toBe(toWei(5).toString());
      expect(order.expiration).toBe("4102444800");
      expect(order.signatureType).toBe(SignatureType.EOA);
    });

    it("should build a MARKET order correctly", () => {
      const order = orderBuilder.buildOrder("MARKET", {
        side: Side.SELL,
        nonce: "2",
        signer: "0xsigner",
        tokenId: "456",
        makerAmount: toWei(5),
        takerAmount: toWei(10),
        feeRateBps: 0,
      });

      expect(order.salt).toBe("1234");
      expect(order.side).toBe(Side.SELL);
      expect(order.nonce).toBe("2");
      expect(order.maker).toBe("0xsigner");
      expect(order.signer).toBe("0xsigner");
      expect(order.taker).toBe(ZeroAddress);
      expect(order.tokenId).toBe("456");
      expect(order.makerAmount).toBe(toWei(5).toString());
      expect(order.takerAmount).toBe(toWei(10).toString());
      expect(Number(order.expiration)).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(Number(order.expiration)).toBeLessThan(Math.floor(Date.now() / 1000) + 6 * 60);
      expect(order.signatureType).toBe(SignatureType.EOA);
    });

    it("should throw InvalidExpirationError for invalid expiration", () => {
      expect(() =>
        orderBuilder.buildOrder("LIMIT", {
          side: Side.BUY,
          nonce: "1",
          signer: "0xsigner",
          tokenId: "123",
          makerAmount: toWei(10),
          takerAmount: toWei(5),
          expiresAt: new Date("2024-01-01T00:00:00Z"),
          feeRateBps: 0,
        }),
      ).toThrow(InvalidExpirationError);
    });
  });

  const _correctTypedDataTest = (isNegRisk: boolean, isYieldBearing: boolean) => {
    const order = orderBuilder.buildOrder("LIMIT", {
      side: Side.BUY,
      nonce: "1",
      signer: ZeroAddress,
      tokenId: "123",
      makerAmount: toWei(10),
      takerAmount: toWei(5),
      feeRateBps: 0,
    });

    const typedData = orderBuilder.buildTypedData(order, { isNegRisk, isYieldBearing });

    const verifyingContract = isNegRisk
      ? isYieldBearing
        ? "0x8A289d458f5a134bA40015085A8F50Ffb681B41d"
        : "0x365fb81bd4A24D6303cd2F19c349dE6894D8d58A"
      : isYieldBearing
        ? "0x6bEb5a40C032AFc305961162d8204CDA16DECFa5"
        : "0x8BC070BEdAB741406F4B1Eb65A72bee27894B689";

    expect(typedData.primaryType).toBe("Order");
    expect(typedData.domain.name).toBe("predict.fun CTF Exchange");
    expect(typedData.domain.verifyingContract).toBe(verifyingContract);
    expect(typedData.domain.chainId).toBe(ChainId.BnbMainnet);
    expect(typedData.message).toEqual(expect.objectContaining(order));
  };

  describe("buildTypedData", () => {
    it("should build typed data correctly (neg risk, yield bearing)", () => {
      _correctTypedDataTest(true, true);
    });

    it("should build typed data correctly (neg risk, non-yield bearing)", () => {
      _correctTypedDataTest(true, false);
    });

    it("should build typed data correctly (non neg risk, yield bearing)", () => {
      _correctTypedDataTest(false, true);
    });

    it("should build typed data correctly (non neg risk, non-yield bearing)", () => {
      _correctTypedDataTest(false, false);
    });
  });

  const _signerIsNotProvidedTest = async (isNegRisk: boolean, isYieldBearing: boolean) => {
    const orderBuilderWithoutSigner = await OrderBuilder.make(ChainId.BnbMainnet);
    const order = orderBuilderWithoutSigner.buildOrder("LIMIT", {
      side: Side.BUY,
      nonce: "1",
      signer: ZeroAddress,
      tokenId: "123",
      makerAmount: toWei(10),
      takerAmount: toWei(5),
      feeRateBps: 0,
    });

    const typedData = orderBuilderWithoutSigner.buildTypedData(order, { isNegRisk, isYieldBearing });

    await expect(orderBuilderWithoutSigner.signTypedDataOrder(typedData)).rejects.toThrow(MissingSignerError);
  };

  describe("signTypedDataOrder", () => {
    it("should sign the order correctly", async () => {
      const order = orderBuilder.buildOrder("LIMIT", {
        side: Side.BUY,
        nonce: "1",
        signer: ZeroAddress,
        tokenId: "123",
        makerAmount: toWei(10),
        takerAmount: toWei(5),
        feeRateBps: 0,
      });

      const typedData = orderBuilder.buildTypedData(order, { isNegRisk: false, isYieldBearing: false });
      const signedOrder = await orderBuilder.signTypedDataOrder(typedData);

      expect(signedOrder).toEqual({
        ...order,
        signature: "0xmocksignature",
      });
    });

    it("should throw MissingSignerError if signer is not provided (neg risk, yield bearing)", async () => {
      _signerIsNotProvidedTest(true, true);
    });

    it("should throw MissingSignerError if signer is not provided neg risk, non-yield bearing)", async () => {
      _signerIsNotProvidedTest(true, false);
    });

    it("should throw MissingSignerError if signer is not provided (non neg risk, yield bearing)", async () => {
      _signerIsNotProvidedTest(false, true);
    });

    it("should throw MissingSignerError if signer is not provided (non neg risk, non-yield bearing)", async () => {
      _signerIsNotProvidedTest(false, false);
    });
  });

  const _correctTypedDataHashTest = (isNegRisk: boolean, isYieldBearing: boolean) => {
    const order = orderBuilder.buildOrder("LIMIT", {
      side: Side.BUY,
      nonce: "1",
      signer: ZeroAddress,
      tokenId: "123",
      makerAmount: toWei(10),
      takerAmount: toWei(5),
      feeRateBps: 0,
    });

    const typedData = orderBuilder.buildTypedData(order, { isNegRisk, isYieldBearing });
    const hash = orderBuilder.buildTypedDataHash(typedData);

    expect(typeof hash).toBe("string");
    expect(hash.startsWith("0x")).toBe(true);
    expect(hash.length).toBe(66); // 32 bytes + '0x'
  };

  describe("buildTypedDataHash", () => {
    it("should build the typed data hash correctly (neg risk, yield bearing)", () => {
      _correctTypedDataHashTest(true, true);
    });

    it("should build the typed data hash correctly (neg risk, non-yield bearing)", () => {
      _correctTypedDataHashTest(true, false);
    });

    it("should build the typed data hash correctly (non neg risk, yield bearing)", () => {
      _correctTypedDataHashTest(false, true);
    });

    it("should build the typed data hash correctly (non neg risk, non-yield bearing)", () => {
      _correctTypedDataHashTest(false, false);
    });
  });

  describe("Floating-point precision", () => {
    it("should handle 0.777 price without precision loss", () => {
      const result = orderBuilder.getMarketOrderAmounts({ side: Side.BUY, quantityWei: 62_430_861_279_963_832_320n }, {
        updateTimestampMs: Date.now(),
        asks: [
          [0.777, 3.876_954_397_904_989_4],
          [0.777, 411.860_378_183_376_4],
        ],
        bids: [
          [0.69, 143.265_205_755_273_68],
          [0.51, 214.469_725_737_179_37],
        ],
      } as Book);
      // Should be exactly 777000000000000000n, not 776999999999999999n
      expect(result.pricePerShare).toBe(777_000_000_000_000_000n);
      expect(result.lastPrice).toBe(777_000_000_000_000_000n);
    });

    it("should handle original bug case (0.46, 0.48 prices)", () => {
      const result = orderBuilder.getMarketOrderAmounts(
        { side: Side.SELL, quantityWei: 100_000_000_000_000_000_000n },
        {
          updateTimestampMs: Date.now(),
          asks: [
            [0.46, 18.208],
            [0.48, 442.3],
            [0.48, 187.3],
          ],
          bids: [
            [0.44, 36.77],
            [0.41, 474.1],
            [0.38, 328.03],
          ],
        } as Book,
      );
      // Should be exactly 421031000000000000n, not 421031000000000001n
      expect(result.pricePerShare).toBe(421_031_000_000_000_000n);
    });

    it("should handle 0.07 price exactly", () => {
      const result = orderBuilder.getMarketOrderAmounts({ side: Side.BUY, quantityWei: 10_000_000_000_000_000_000n }, {
        updateTimestampMs: Date.now(),
        marketId: 1,
        asks: [[0.07, 100]],
        bids: [],
      } as Book);
      expect(result.lastPrice).toBe(70_000_000_000_000_000n);
    });

    it("should handle 0.009 price exactly", () => {
      const result = orderBuilder.getMarketOrderAmounts({ side: Side.BUY, quantityWei: 10_000_000_000_000_000_000n }, {
        updateTimestampMs: Date.now(),
        marketId: 1,
        asks: [[0.009, 500]],
        bids: [],
      } as Book);
      expect(result.lastPrice).toBe(9_000_000_000_000_000n);
    });

    it("should handle problematic decimals correctly", () => {
      const problematicPrices: [number, bigint][] = [
        [0.01, 10_000_000_000_000_000n],
        [0.03, 30_000_000_000_000_000n],
        [0.11, 110_000_000_000_000_000n],
        [0.13, 130_000_000_000_000_000n],
        [0.17, 170_000_000_000_000_000n],
        [0.19, 190_000_000_000_000_000n],
        [0.23, 230_000_000_000_000_000n],
        [0.29, 290_000_000_000_000_000n],
        [0.31, 310_000_000_000_000_000n],
        [0.33, 330_000_000_000_000_000n],
        [0.37, 370_000_000_000_000_000n],
        [0.41, 410_000_000_000_000_000n],
        [0.43, 430_000_000_000_000_000n],
        [0.46, 460_000_000_000_000_000n],
        [0.47, 470_000_000_000_000_000n],
      ];

      for (const [price, expectedWei] of problematicPrices) {
        const result = orderBuilder.getMarketOrderAmounts(
          { side: Side.BUY, quantityWei: 10_000_000_000_000_000_000n },
          {
            updateTimestampMs: Date.now(),
            marketId: 1,
            asks: [[price, 100]],
            bids: [],
          } as Book,
        );
        expect(result.lastPrice).toBe(expectedWei);
      }
    });
  });
});
