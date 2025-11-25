import { retainSignificantDigits } from "../src/internal/Utils";

describe("retainSignificantDigits", () => {
  test("should retain significant digits for positive numbers", () => {
    expect(retainSignificantDigits(123_456n, 3)).toBe(123_000n);
  });

  test("should retain significant digits for positive numbers", () => {
    expect(retainSignificantDigits(12n, 3)).toBe(12n);
  });

  test("should retain significant digits for negative numbers", () => {
    expect(retainSignificantDigits(-123_456n, 3)).toBe(-123_000n);
  });

  test("should handle zero correctly", () => {
    expect(retainSignificantDigits(0n, 3)).toBe(0n);
  });
});
