import type { SignerLike } from "../src";
import { type BaseWallet, type JsonRpcSigner, type Signer, type Wallet, type BrowserProvider } from "ethers";
import { OrderBuilder, ChainId } from "../src";

/**
 * Compile-time assertions for the accepted `OrderBuilder` signer type.
 *
 * This function is never invoked; it documents and pins the typing contract.
 *
 * NOTE: `ts-jest` is configured transpile-only here, so `jest` does NOT fail on
 * type errors. These assertions are enforced by `tsc`, e.g.:
 *   `npx tsc -p tsconfig.test.json --noEmit`
 * With this file in its intended state `tsc` reports no error here; removing the
 * `@ts-expect-error` below surfaces `TS2769`, proving generic `Signer` stays
 * rejected. The `describe` block below guards the runtime path (which `jest`
 * does cover).
 */

async function __signerTypeChecks(
  wallet: Wallet,
  baseWallet: BaseWallet,
  browserSigner: JsonRpcSigner,
  genericSigner: Signer,
  browserProvider: BrowserProvider,
): Promise<void> {
  // Private-key wallets still accepted (unchanged behaviour).
  void OrderBuilder.make(ChainId.BnbMainnet, wallet);
  void OrderBuilder.make(ChainId.BnbMainnet, baseWallet);

  // Injected/browser wallet from `BrowserProvider.getSigner()` is now accepted.
  void OrderBuilder.make(ChainId.BnbMainnet, browserSigner);

  // Exact scenario reported by integrators using a browser environment.
  const signerFromBrowser = await browserProvider.getSigner();
  void OrderBuilder.make(ChainId.BnbMainnet, signerFromBrowser);

  // The exported `SignerLike` alias accepts both signer kinds.
  const _a: SignerLike = wallet;
  const _b: SignerLike = browserSigner;
  void _a;
  void _b;

  // A generic ethers `Signer` is intentionally NOT accepted: the SDK relies on
  // a synchronous `.address`, which only `BaseWallet`/`JsonRpcSigner` expose.
  // @ts-expect-error - generic Signer must remain rejected
  void OrderBuilder.make(ChainId.BnbMainnet, genericSigner);
}

// A `JsonRpcSigner`-shaped mock (no provider, like a freshly created signer)
// to exercise the runtime path with the widened type, mirroring the existing
// mock pattern used in FastCheck.test.ts.
const mockBrowserSigner = {
  provider: undefined,
  address: "0x0000000000000000000000000000000000000001",
  connect: jest.fn().mockReturnValue({
    signTypedData: jest.fn().mockResolvedValue("0xmocksignature"),
  }),
} as unknown as JsonRpcSigner;

describe("OrderBuilder signer typing", () => {
  it("accepts a JsonRpcSigner at runtime and resolves to an OrderBuilder", async () => {
    const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, mockBrowserSigner, {
      generateSalt: () => "1234",
    });

    expect(orderBuilder).toBeInstanceOf(OrderBuilder);
  });
});
