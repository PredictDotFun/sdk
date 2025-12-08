import { parseEther, type BaseWallet } from "ethers";
import fc from "fast-check";
import { Side, OrderBuilder, ChainId } from "../src";

const mockSigner = {
  connect: jest.fn().mockReturnValue({
    signTypedData: jest.fn().mockResolvedValue("0xmocksignature"),
  }),
} as unknown as BaseWallet;

fc.configureGlobal({ ...fc.readConfigureGlobal(), numRuns: 10_000 });

describe("OrderBuilder", () => {
  let orderBuilder: OrderBuilder;

  beforeAll(async () => {
    orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner, { generateSalt: () => "1234" });
  });

  /**
   * Market orders
   */
  describe("getLimitOrderAmounts", () => {
    const priceQtyArb = fc.record({
      pricePerShareWei: fc.bigInt({ min: BigInt(1e15), max: BigInt(1e18) }),
      quantityWei: fc.bigInt({ min: BigInt(1e16) }),
    });

    it("should calculate buy amounts correctly with no precision loss", () => {
      fc.assert(
        fc.property(priceQtyArb, ({ pricePerShareWei, quantityWei }) => {
          const result = orderBuilder.getLimitOrderAmounts({
            side: Side.BUY,
            pricePerShareWei,
            quantityWei,
          });

          const reverseDerivedPrice = (result.makerAmount * BigInt(1e18)) / result.takerAmount;

          expect(reverseDerivedPrice).toBe(result.pricePerShare);
          expect(result.pricePerShare).toBeLessThanOrEqual(BigInt(1e18));
          expect(result.pricePerShare).toBeGreaterThanOrEqual(BigInt(1e15));
        }),
      );
    });

    it("should calculate sell amounts correctly with no precision loss", () => {
      fc.assert(
        fc.property(priceQtyArb, ({ pricePerShareWei, quantityWei }) => {
          const result = orderBuilder.getLimitOrderAmounts({
            side: Side.SELL,
            pricePerShareWei,
            quantityWei,
          });

          const reverseDerivedPrice = (result.takerAmount * BigInt(1e18)) / result.makerAmount;

          expect(reverseDerivedPrice).toBe(result.pricePerShare);
          expect(result.pricePerShare).toBeLessThanOrEqual(BigInt(1e18));
          expect(result.pricePerShare).toBeGreaterThanOrEqual(BigInt(1e15));
        }),
      );
    });
  });

  /**
   * Market orders
   */
  describe("getMarketOrderAmounts", () => {
    // Range from 0.001 to 0.999
    const zeroToOneArb = fc.integer({ min: 1, max: 999 }).map((n) => Number(n / 1000));
    // Range from 0.01 to 10 trillion
    const zeroToLargeArb = fc.integer({ min: 1, max: 1_000_000_000_000_000 }).map((n) => Number(n / 100));

    const bookArb = fc
      .record({
        updateTimestampMs: fc.integer({ min: Date.now() - 60_000, max: Date.now() }),
        asks: fc.array(fc.tuple(zeroToOneArb, zeroToLargeArb), { minLength: 1, maxLength: 50 }),
        bids: fc.array(fc.tuple(zeroToOneArb, zeroToLargeArb), { minLength: 1, maxLength: 50 }),
      })
      .chain((book) => {
        const sortedBook = {
          ...book,
          asks: book.asks.sort((a, b) => a[0] - b[0]),
          bids: book.bids.sort((a, b) => b[0] - a[0]),
        };
        return fc.constantFrom(sortedBook);
      });

    const priceQtyArb = fc.record({
      quantityWei: fc.bigInt({ min: BigInt(1e16) }),
      book: bookArb,
    });

    const valueBookArb = fc.record({
      valueWei: fc.bigInt({ min: BigInt(1e18) }),
      book: bookArb,
    });

    it("calculates BUY amounts correctly with no precision loss for Value input", () => {
      fc.assert(
        fc.property(valueBookArb, ({ valueWei, book }) => {
          const result = orderBuilder.getMarketOrderAmounts({ side: Side.BUY, valueWei }, book);

          // Expected to be positive.
          expect(result.makerAmount).toBeGreaterThanOrEqual(0n);
          expect(result.takerAmount).toBeGreaterThanOrEqual(0n);

          // Should always be between the maximum possible ranges (0.001 usdt to 1 usdt)
          expect(result.pricePerShare).toBeLessThanOrEqual(BigInt(1e18));
          expect(result.pricePerShare).toBeGreaterThanOrEqual(BigInt(1e15));

          // It's possible that the makerAmount is greater than the valueWei because its
          // signed against the highest match price, so a transfer failure due to insufficient balance
          // isn't necessarily going to happen here, even though it exceeds the "valueWei.
          //
          // Not a valid check: expect(result.makerAmount).toBeLessThanOrEqual(valueWei);

          // This is what the contract calculates as the "max price" of the order.
          // For example in this taker bid, the max price is not the average price but the highest
          // price that the order is going to consume.
          //
          // This must always be less than the max price in the order book.
          const maxPriceOrder = (result.makerAmount * BigInt(1e18)) / result.takerAmount;
          const maxPriceInBook = book.asks.at(-1)?.[0];

          // Expect the maker and taker to have a minimum of 3 trailing zeros. This is a sanity check
          // to ensure that we are not too precise, such that when we calculate the price on the contract
          // that we are going to lose precision.
          //
          // If the price is anything other than 13 zeros (5 significant digits) then we are losing precision.
          // 5 significant digits is the maximum qty precision.
          expect(maxPriceOrder.toString().slice(-13)).toBe("0000000000000");

          // Never exceed the max price in the order book.
          expect(result.lastPrice).toBeLessThanOrEqual(parseEther(maxPriceInBook!.toString()));
        }),
      );
    });

    it("calculates BUY amounts correctly with no precision loss for Qty input", () => {
      fc.assert(
        fc.property(priceQtyArb, ({ quantityWei, book }) => {
          const result = orderBuilder.getMarketOrderAmounts({ side: Side.BUY, quantityWei }, book);

          // Expected to be positive.
          expect(result.makerAmount).toBeGreaterThanOrEqual(0n);
          expect(result.takerAmount).toBeGreaterThanOrEqual(0n);

          // Should always be between the maximum possible ranges (0.001 usdt to 1 usdt)
          expect(result.pricePerShare).toBeLessThanOrEqual(BigInt(1e18));
          expect(result.pricePerShare).toBeGreaterThanOrEqual(BigInt(1e15));

          // We cannot guarantee that the takerAmount will be exactly the quantityWei.
          // Since the user may have provided too much precision.
          //
          // However we should never go above their input about.
          //
          // We can go below either from a precision round-down, or from the book not having
          // enough liquidity to fill the order, meaning we will consume the maximum available.
          expect(result.takerAmount).toBeLessThanOrEqual(quantityWei);

          // This is what the contract calculates as the "max price" of the order.
          // For example in this taker bid, the max price is not the average price but the highest
          // price that the order is going to consume.
          //
          // This must always be less than the max price in the order book.
          const maxPriceOrder = (result.makerAmount * BigInt(1e18)) / result.takerAmount;
          const maxPriceInBook = book.asks.at(-1)?.[0];

          expect(maxPriceOrder).toBeLessThanOrEqual(parseEther(maxPriceInBook!.toString()));

          // Expect the maker and taker to have a minimum of 3 trailing zeros. This is a sanity check
          // to ensure that we are not too precise, such that when we calculate the price on the contract
          // that we are going to lose precision.
          //
          // If the price is anything other than 13 zeros (5 significant digits) then we are losing precision.
          // 5 significant digits is the maximum qty precision.
          expect(maxPriceOrder.toString().slice(-13)).toBe("0000000000000");
        }),
      );
    });

    it("calculates SELL amounts correctly with no precision loss for Qty input", () => {
      fc.assert(
        fc.property(priceQtyArb, ({ quantityWei, book }) => {
          const result = orderBuilder.getMarketOrderAmounts({ side: Side.SELL, quantityWei }, book);

          // Expected to be positive.
          expect(result.makerAmount).toBeGreaterThanOrEqual(0n);
          expect(result.takerAmount).toBeGreaterThanOrEqual(0n);

          // Should always be between the maximum possible ranges (0.001 usdt to 1 usdt)
          expect(result.pricePerShare).toBeLessThanOrEqual(BigInt(1e18));
          expect(result.pricePerShare).toBeGreaterThanOrEqual(BigInt(1e15));

          // We cannot guarantee that the makerAmount will be exactly the quantityWei.
          // Since the user may have provided too much precision.
          //
          // However we should never go above their input about.
          //
          // We can go below either from a precision round-down, or from the book not having
          // enough liquidity to fill the order, meaning we will consume the maximum available.
          expect(result.makerAmount).toBeLessThanOrEqual(quantityWei);

          // This is what the contract calculates as the "max price" of the order.
          // For example in this taker bid, the max price is not the average price but the highest
          // price that the order is going to consume.
          //
          // This must always be less than the max price in the order book.
          const minPriceOrder = (result.takerAmount * BigInt(1e18)) / result.makerAmount;
          const minPriceInBook = book.bids.at(-1)?.[0];

          expect(minPriceOrder).toBeGreaterThanOrEqual(parseEther(minPriceInBook!.toString()));

          // Expect the maker and taker to have a minimum of 3 trailing zeros. This is a sanity check
          // to ensure that we are not too precise, such that when we calculate the price on the contract
          // that we are going to lose precision.
          //
          // If the price is anything other than 13 zeros (5 significant digits) then we are losing precision.
          // 5 significant digits is the maximum qty precision.
          expect(minPriceOrder.toString().slice(-13)).toBe("0000000000000");
        }),
      );
    });

    it("calculates SELL amounts correctly with no precision loss for Qty input", () => {
      fc.assert(
        fc.property(priceQtyArb, ({ quantityWei, book }) => {
          const result = orderBuilder.getMarketOrderAmounts({ side: Side.SELL, quantityWei }, book);

          // Expected to be positive.
          expect(result.makerAmount).toBeGreaterThanOrEqual(0n);
          expect(result.takerAmount).toBeGreaterThanOrEqual(0n);

          // Should always be between the maximum possible ranges (0.001 usdt to 1 usdt)
          expect(result.pricePerShare).toBeLessThanOrEqual(BigInt(1e18));
          expect(result.pricePerShare).toBeGreaterThanOrEqual(BigInt(1e15));

          // We cannot guarantee that the takerAmount will be exactly the quantityWei.
          // Since the user may have provided too much precision.
          //
          // However we should never go above their input about.
          //
          // We can go below either from a precision round-down, or from the book not having
          // enough liquidity to fill the order, meaning we will consume the maximum available.
          expect(result.takerAmount).toBeLessThanOrEqual(quantityWei);

          // This is what the contract calculates as the "max price" of the order.
          // For example in this taker bid, the max price is not the average price but the highest
          // price that the order is going to consume.
          //
          // This must always be less than the max price in the order book.
          const minPriceOrder = (result.takerAmount * BigInt(1e18)) / result.makerAmount;
          const minPriceInBook = book.bids.at(-1)?.[0];

          expect(minPriceOrder).toBeGreaterThanOrEqual(parseEther(minPriceInBook!.toString()));

          // Expect the maker and taker to have a minimum of 3 trailing zeros. This is a sanity check
          // to ensure that we are not too precise, such that when we calculate the price on the contract
          // that we are going to lose precision.
          //
          // If the price is anything other than 13 zeros (5 significant digits) then we are losing precision.
          // 5 significant digits is the maximum qty precision.
          expect(minPriceOrder.toString().slice(-13)).toBe("0000000000000");
        }),
      );
    });
  });
});
