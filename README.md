A TypeScript SDK to help developers interface with the Predict's protocol.

#### Sections:

- [How to install the SDK](#how-to-install-the-sdk)
- [How to set approvals](#how-to-set-approvals)
- [How to set scoped approvals (per-operation)](#how-to-set-scoped-approvals-per-operation)
- [How to use a Predict account](#how-to-use-a-predict-account)
- [How to create a LIMIT order _(recommended)_](#how-to-create-a-limit-order-recommended)
- [How to create a MARKET order](#how-to-create-a-market-order)
- [How to apply slippage](#how-to-apply-slippage)
- [How to redeem positions](#how-to-redeem-positions)
- [How to merge positions](#how-to-merge-positions)
- [How to convert positions](#how-to-convert-positions)
- [How to check USDT balance](#how-to-check-usdt-balance)
- [How to interface with contracts](#how-to-interface-with-contracts)
- [How to cancel orders](#how-to-cancel-orders)
- [License](#license)

## How to install the SDK

This package has [ethers v6](https://docs.ethers.io/v6/) as a peer dependency.

```bash
yarn add @predictdotfun/sdk ethers
```

```bash
npm install @predictdotfun/sdk ethers
```

See the [`OrderBuilder`](./src/OrderBuilder.ts) class for more in-depth details on each function.

**Tip (faster confirmations):** ethers' default provider polling interval is `4000ms`, so every `tx.wait()` the SDK does internally (in `setApprovals`, `runApprovals`, `cancelOrders`, `redeemPositions`, etc.) can take up to ~4s to notice a mined transaction. On a fast chain like BNB, lower it to ~`300ms` so confirmations feel near-instant:

```typescript
import { JsonRpcProvider, Wallet } from "ethers";

const provider = new JsonRpcProvider(process.env.RPC_PROVIDER_URL);
provider.pollingInterval = 300; // default is 4000ms

const signer = new Wallet(process.env.WALLET_PRIVATE_KEY, provider);
```

The interval lives on the provider, so set it on whatever provider you pass in, including a `BrowserProvider` (e.g. MetaMask): `provider.pollingInterval = 300`.

## Predict Account

Predict supports interacting with the protocol using either a traditional Externally Owned Account (EOA) or a Smart Wallet ("Predict Account"). If you use the web app, a Smart Wallet is automatically created for you. To interact with your Smart Wallet programmatically using the SDK, follow the example shown in [How to use a Predict account](#how-to-use-a-predict-account).

## How to set approvals

Before trading, you need to set approvals for ERC-1155 (`ConditionalTokens`) and ERC-20 (`USDT`). This can be achieved by sending a transaction to the respective contracts (see the [Contracts](#contracts) section) and approving both the `CTF_EXCHANGE` and the `NEG_RISK_CTF_EXCHANGE` or via the SDK utils.

**Contracts**: The current deployed contracts can be found either in the [`Constants.ts`](./src/Constants.ts#32) file or in the [Deployed Contracts](https://docs.predict.fun/developers/deployed-contracts) documentation.

The following example demonstrates how to set the necessary approvals using the SDK utils.

```typescript
import { Wallet, MaxInt256 } from "ethers";
import { OrderBuilder, ChainId, Side } from "@predictdotfun/sdk";

// Create a wallet to send the approvals transactions (must be the orders' `maker`)
const signer = new Wallet(process.env.WALLET_PRIVATE_KEY);

// The main function which initiates the OrderBuilder (only once per signer) and then provides it as dependency to other util functions
async function main() {
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  // Call an helper function to set the approvals and provide the OrderBuilder instance.
  await setApprovals(orderBuilder);
}

async function setApprovals(orderBuilder: OrderBuilder) {
  // Set all the approval needed within the protocol
  const result = await orderBuilder.setApprovals();

  // Check if the approvals were set successfully
  if (!result.success) {
    throw new Error("Failed to set approvals.");
  }
}
```

## How to set scoped approvals (per-operation)

`setApprovals()` sets every approval for every market type in a single call. For most apps the scoped-approvals API is the better fit, and is the recommended approach whenever you build an approval UI. It returns only the approvals a given operation needs, as a list of plain, self-describing steps you can render as a checklist, pre-check, run with live progress, and gate on user confirmation.

The mental model is simple: **everything produces steps, and one runner runs steps.**

1. Describe what the user is about to do with an `ApprovalScope` (`operation`, plus `isNegRisk` / `isYieldBearing`, and an optional `side` to narrow a `TRADE`).
2. Turn it into an ordered `ApprovalStep[]` with `getApprovalSteps` (one operation) or `getAllApprovalSteps` (everything). Both are pure (no signer, no network access), so you can render the checklist before the wallet is connected.
3. Run the steps with `runApprovals`, or drive them yourself with `checkApprovals` / `setApproval`.

`isNegRisk` and `isYieldBearing` describe the market and can be fetched from the `GET /markets` (or `GET /categories`) endpoint.

`getApprovalSteps` returns the minimal, ordered set for the operation. The labels below are the SDK's default copy (they match the Predict web app). Operations that need no approval return an empty array. |

A `TRADE` scope covers both order directions by default. Pass `side: Side.BUY` for just the collateral allowance, or `side: Side.SELL` for just the ERC-1155 approval. `CONVERT` is neg-risk only and throws `InvalidApprovalOperationError` for a standard market.

### The `ApprovalStep` shape

Each step is plain data, safe to render and serialize:

```typescript
{
  id: "ERC1155_APPROVAL:CTF_EXCHANGE", // stable identifier: `${type}:${spenderKey}`
  type: "ERC1155_APPROVAL",            // or "ERC20_ALLOWANCE"
  spender: "0x8BC0...B689",            // the contract being granted permission
  token: "0x22DA...d244",              // the token contract (conditional tokens for ERC-1155, USDT for ERC-20)
  label: "Approve Exchange",           // default copy
  description: "Allows you to interact with the exchange.",
}
```

The `label`/`description` are sensible English defaults. For custom wording or i18n, key your own copy off the stable `id` and ignore them.

### Build the steps

You'll typically build the steps from the same signer-backed `OrderBuilder` you use to check and run them.

```typescript
import { OrderBuilder, ChainId, Side } from "@predictdotfun/sdk";

const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

// For a single operation on a market:
const steps = builder.getApprovalSteps({
  operation: "TRADE",
  isNegRisk: true,
  isYieldBearing: false,
  // side: Side.BUY, // optional TRADE narrowing
});

// For onboarding, every approval across both market types (and, by default, both tracks):
const allSteps = builder.getAllApprovalSteps(); // or { isYieldBearing: false } to limit to one track
```

`getApprovalSteps` and `getAllApprovalSteps` don't touch the chain, so you _can_ also call them on a signer-less builder (`OrderBuilder.make(ChainId.BnbMainnet)`) to render the checklist before the wallet is connected. You'll need a signer for everything after (`checkApprovals`, `setApproval`, `runApprovals`).

### Run them with progress reporting

`runApprovals(steps, opts)` runs the steps in order, deduplicating by `id` (so you can safely pass a union of scopes or a curated subset). Options:

- `skipSatisfied` (default `true`): pre-check each step on-chain and skip the ones already in place.
- `stopOnError` (default `true`): stop after the first failed step.
- `onProgress`: a callback invoked as each step transitions, receiving `{ step, status, transaction? }`.

```typescript
const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);
const steps = builder.getApprovalSteps({ operation: "TRADE", isNegRisk: true, isYieldBearing: false });

const report = await builder.runApprovals(steps, {
  skipSatisfied: true, // default
  stopOnError: true, // default
  onProgress: ({ step, status }) => updateUI(step.id, status),
});
```

`onProgress` reports each step through this lifecycle:

| Status       | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `checking`   | reading on-chain whether it's already approved (only when `skipSatisfied`) |
| `skipped`    | already in place, nothing sent                                             |
| `submitting` | transaction sent, awaiting confirmation                                    |
| `confirmed`  | the transaction succeeded                                                  |
| `failed`     | the transaction reverted or failed                                         |

The returned report is `{ success, steps }`, where each entry is `{ step, status: "skipped" | "confirmed" | "failed", transaction? }` (the `transaction` carries the receipt for submitted steps):

```typescript
if (!report.success) {
  const failed = report.steps.filter((s) => s.status === "failed");
  throw new Error(`Approvals failed: ${failed.map((s) => s.step.id).join(", ")}`);
}
```

### Render a live checklist (the typical UI flow)

This is the flow behind an in-app "Approvals" modal: render the steps, mark the ones already done, then run the rest with live updates.

```typescript
const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

// 1. Build the plan.
const steps = builder.getApprovalSteps({ operation: "TRADE", isNegRisk, isYieldBearing });

// 2. Render the checklist, marking which are already satisfied (one batched multicall read).
for (const { step, satisfied } of await builder.checkApprovals(steps)) {
  addRow(step.id, step.label, step.description, satisfied ? "done" : "pending");
}

// 3. Run the remaining steps, updating each row as it progresses.
const report = await builder.runApprovals(steps, {
  onProgress: ({ step, status }) => setRowStatus(step.id, status),
});
```

For first-time onboarding, swap `getApprovalSteps(scope)` for `getAllApprovalSteps()` to approve everything the protocol could need in one pass. That is the per-step, progress-reportable equivalent of `setApprovals()` (and a slight superset, since it also includes the split allowances).

### Or drive each step yourself

For full control (e.g. gating each step on a user confirmation), use the per-step primitives. `checkApprovals` batches the on-chain reads (via multicall) so you can render the initial state in one round-trip.

```typescript
const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);
const steps = builder.getApprovalSteps({ operation: "SPLIT", isNegRisk: false, isYieldBearing: false });

// Batched pre-check to mark which steps are already done.
const checks = await builder.checkApprovals(steps);

for (const { step, satisfied } of checks) {
  if (satisfied) continue; // already approved
  // setApproval is a raw send: ERC-20 defaults to MaxUint256, ERC-1155 to `approved: true`.
  // Pass `{ approved: false }` to revoke, or `{ amount }` to cap an allowance.
  const result = await builder.setApproval(step);
  if (!result.success) break; // you decide whether to continue
}
```

### Notes

- **Compose freely.** Union step lists to cover several operations at once, e.g. to make a market both trade-ready and splittable: `runApprovals([...tradeSteps, ...splitSteps])` (duplicates are removed automatically).
- **Predict accounts** (smart wallets) are supported transparently: every step routes through `Kernel.execute` when a `predictAccount` is configured.
- **Signer requirements.** `getApprovalSteps` and `getAllApprovalSteps` are pure and need no signer. `checkApproval` / `checkApprovals`, `setApproval`, and `runApprovals` require one and throw `MissingSignerError` otherwise.
- **`setApprovals()` still exists** for the fire-and-forget "approve everything" case where you don't need per-step control or reporting.

## How to use a Predict account

Here's an example of how to use a Predict account to create/cancel orders and set approvals.

1. **Initiate the Privy Wallet**: The wallet is needed to sign orders. Can be found in the [account settings](https://predict.fun/account/settings).
2. **Ensure the Privy Wallet has funds**: You will need to add some ETH to be able to set approvals and cancel orders, if needed.
3. **Initialize `OrderBuilder`**: Instantiate the `OrderBuilder` class by calling `OrderBuilder.make`.
   - NOTE: Include the `predictAccount` address, which is also known as the deposit address.
4. **Set Approvals**: Ensure the necessary approvals are set (refer to [Set Approvals](#set-approvals)).
5. **Determine Order Amounts**: Use `getLimitOrderAmounts` to calculate order amounts.
6. **Build Order**: Use `buildOrder` to generate a `LIMIT` strategy order.
   - NOTE: Fetch the `feeRateBps` via the `GET /markets` endpoint on the REST API
   - NOTE: Set the `signer` and `maker` to the `predictAccount` address, **NOT** the signer/privy wallet address.
7. **Generate Typed Data**: Call `buildTypedData` to generate typed data for the order.
8. **Sign Order**: Obtain a `SignedOrder` object by calling `signTypedDataOrder`.
9. **Compute Order Hash**: Compute the order hash using `buildTypedDataHash`.

```typescript
import { Wallet } from "ethers";
import { OrderBuilder, ChainId, Side } from "@predictdotfun/sdk";

// Create a wallet to send the approvals transactions (must be the orders' `maker`)
const signer = new Wallet(process.env.PRIVY_WALLET_PRIVATE_KEY);

// The main function which initiates the OrderBuilder (only once per signer) and then provides it as dependency to other util functions
async function main() {
  // Create a new instance of the OrderBuilder class with the predictAccount option
  // Note: This should only be done once per signer
  const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, signer, {
    predictAccount: "PREDICT_ACCOUNT_ADDRESS", // Your deposit address from account settings
  });

  // Call an helper function to create the order and provide the OrderBuilder instance
  await createOrder(orderBuilder);
}

async function createOrder(orderBuilder: OrderBuilder) {
  // Step 1. Set approvals and define the order params as usual

  // Step 2. Create the order (maker and signer are automatically set to the predictAccount)
  const order = orderBuilder.buildOrder("LIMIT", {
    side: Side.BUY, // Equivalent to 0
    tokenId: "OUTCOME_ON_CHAIN_ID", // This can be fetched via the API or on-chain
    makerAmount, // 0.4 USDT * 10 shares (in wei)
    takerAmount, // 10 shares (in wei)
    nonce: 0n,
    feeRateBps: 0, // Should be fetched via the `GET /markets` endpoint
  });

  // Step 3. Sign and submit the order as usual
}
```

This will allow you to perform operations via your Predict Account (via the smart wallet).

## How to create a LIMIT order _(recommended)_

Here's an example of how to use the OrderBuilder to create and sign a `LIMIT` strategy buy order:

1. **Create Wallet**: The wallet is needed to sign orders.
2. **Initialize `OrderBuilder`**: Instantiate the `OrderBuilder` class by calling `OrderBuilder.make`.
3. **Set Approvals**: Ensure the necessary approvals are set (refer to [Set Approvals](#set-approvals)).
4. **Determine Order Amounts**: Use `getLimitOrderAmounts` to calculate order amounts.
5. **Build Order**: Use `buildOrder` to generate a `LIMIT` strategy order.
   - NOTE: Fetch the `feeRateBps` via the `GET /markets` endpoint on the REST API
6. **Generate Typed Data**: Call `buildTypedData` to generate typed data for the order.
7. **Sign Order**: Obtain a `SignedOrder` object by calling `signTypedDataOrder`.
8. **Compute Order Hash**: Compute the order hash using `buildTypedDataHash`.

```typescript
import { Wallet } from "ethers";
import { OrderBuilder, ChainId, Side } from "@predictdotfun/sdk";

// Create a wallet for signing orders
const signer = new Wallet(process.env.WALLET_PRIVATE_KEY);

// The main function which initiates the OrderBuilder (only once per signer) and then provides it as dependency to other util functions
async function main() {
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  // Call an helper function to create the order and provide the OrderBuilder instance
  await createOrder(orderBuilder);
}

async function createOrder(orderBuilder: OrderBuilder) {
  /**
   * NOTE: You can also call `setApprovals` once per wallet.
   */

  // Set all the approval needed within the protocol (if needed)
  const result = await orderBuilder.setApprovals();

  // Check if the approvals were set successfully
  if (!result.success) {
    throw new Error("Failed to set approvals.");
  }

  // Simple helper function to calculate the amounts for a `LIMIT` order
  const { lastPrice, pricePerShare, makerAmount, takerAmount } = orderBuilder.getLimitOrderAmounts({
    side: Side.BUY,
    pricePerShareWei: 400000000000000000n, // 0.4 USDT (in wei)
    quantityWei: 10000000000000000000n, // 10 shares (in wei)
  });

  // Build a limit order (if you are using a Predict account replace `signer.address` with your deposit address)
  const order = orderBuilder.buildOrder("LIMIT", {
    maker: signer.address,
    signer: signer.address,
    side: Side.BUY, // Equivalent to 0
    tokenId: "OUTCOME_ON_CHAIN_ID", // This can be fetched via the API or on-chain
    makerAmount, // 0.4 USDT * 10 shares (in wei)
    takerAmount, // 10 shares (in wei)
    nonce: 0n,
    feeRateBps: 0, // Should be fetched via the `GET /markets` endpoint
  });

  // Build typed data for the order (isNegRisk and isYieldBearing can be fetched via the API)
  const typedData = orderBuilder.buildTypedData(order, { isNegRisk: true, isYieldBearing: true });

  // Sign the order by providing the typedData of the order
  const signedOrder = await orderBuilder.signTypedDataOrder(typedData);

  // Compute the order's hash
  const hash = orderBuilder.buildTypedDataHash(typedData);

  // Example structure required to create an order via Predict's API
  const createOrderBody = {
    data: {
      order: { ...signedOrder, hash },
      pricePerShare,
      strategy: "LIMIT",
    },
  };
}
```

## How to create a MARKET order

Similarly to the above, here's the flow to create a `MARKET` sell order:

1. **Create Wallet**: The wallet is needed to sign orders.
2. **Initialize `OrderBuilder`**: Instantiate the `OrderBuilder` class by calling `OrderBuilder.make`.
3. **Set Approvals**: Ensure the necessary approvals are set (refer to [Set Approvals](#set-approvals)).
4. **Fetch Orderbook**: Query the Predict API for the latest orderbook for the market.
5. **Determine Order Amounts**: Use `getMarketOrderAmounts` to calculate order amounts.
6. **Build Order**: Call `buildOrder` to generate a `MARKET` strategy order.
   - NOTE: Fetch the `feeRateBps` via the `GET /markets` endpoint on the REST API
7. **Generate Typed Data**: Use `buildTypedData` to create typed data for the order.
8. **Sign Order**: Obtain a `SignedOrder` object by calling `signTypedDataOrder`.
9. **Compute Order Hash**: Compute the order hash using `buildTypedDataHash`.

```typescript
import { Wallet } from "ethers";
import { OrderBuilder, ChainId, Side } from "@predictdotfun/sdk";

// Create a wallet for signing orders
const signer = new Wallet(process.env.WALLET_PRIVATE_KEY);

// The main function which initiates the OrderBuilder (only once per signer) and then provides it as dependency to other util functions
async function main() {
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  // Call an helper function to create the order and provide the OrderBuilder instance
  await createOrder(orderBuilder);
}

async function createOrder(orderBuilder: OrderBuilder) {
  // Fetch the orderbook for the specific market via `GET /markets/{marketId}/orderbook`
  const book = {};

  /**
   * NOTE: You can also call `setApprovals` once per wallet.
   */

  // Set all the approval needed within the protocol (if needed)
  const result = await orderBuilder.setApprovals();

  // Check if the approvals were set successfully
  if (!result.success) {
    throw new Error("Failed to set approvals.");
  }

  // Helper function to calculate the amounts for a `MARKET` order
  const {
    lastPrice,
    pricePerShare,
    makerAmount,
    takerAmount,
    amount, // Non-deflated share quantity (differs from takerAmount when isMinAmountOut is true)
    // Only needed if you set a slippage tolerance in the input
    slippageBps,
    isMinAmountOut, // Whether the alternative slippage model was used
  } = orderBuilder.getMarketOrderAmounts(
    {
      side: Side.SELL,
      quantityWei: 10000000000000000000n, // 10 shares (in wei) e.g. parseEther("10")
      slippageBps: 100n, // E.g. 1% slippage tolerance (100 bps)
    },
    book, // It's recommended to re-fetch the orderbook regularly to avoid issues
  );

  // Build a limit order (if you are using a Predict account replace `signer.address` with your deposit address)
  const order = orderBuilder.buildOrder("MARKET", {
    maker: signer.address,
    signer: signer.address,
    side: Side.SELL, // Equivalent to 1
    tokenId: "OUTCOME_ON_CHAIN_ID", // This can be fetched via the API or on-chain
    makerAmount, // 10 shares (in wei)
    takerAmount, // 0.4 USDT * 10 shares (in wei)
    nonce: 0n,
    feeRateBps: 0, // Should be fetched via the `GET /markets` endpoint
  });

  // Build typed data for the order (isNegRisk and isYieldBearing can be fetched via the API)
  const typedData = orderBuilder.buildTypedData(order, { isNegRisk: false, isYieldBearing: false });

  // Sign the order by providing the typedData of the order
  const signedOrder = await orderBuilder.signTypedDataOrder(typedData);

  // Compute the order's hash
  const hash = orderBuilder.buildTypedDataHash(typedData);

  // Example structure required to create an order via Predict's API
  const createOrderBody = {
    data: {
      order: { ...signedOrder, hash },
      pricePerShare,
      strategy: "MARKET",
      slippageBps,
    },
  };
}
```

### How to apply slippage

By default, no additional slippage is applied to the order maker/taker amounts. You can specify a slippage tolerance in basis points (1 bps = 0.01%) to adjust the amounts:

- **BUY orders**: set `isMinAmountOut: true` so that slippage decreases the `takerAmount` (minimum shares out), while `makerAmount` equals the expected cost (avg price × shares). This avoids inflating the USD commitment, allowing you to spend your full wallet balance.
- **SELL orders**: slippage decreases the `takerAmount` (you're willing to receive less collateral)

```typescript
// Market order with 1% slippage (100 bps)
const amounts = orderBuilder.getMarketOrderAmounts(
  {
    side: Side.BUY,
    quantityWei: 10000000000000000000n, // 10 shares (in wei)
    slippageBps: 100n, // 1% slippage tolerance
    isMinAmountOut: true,
  },
  book,
);

// makerAmount is the expected cost, takerAmount is deflated by slippage
console.log(`Maker Amount: ${amounts.makerAmount}`); // Expected cost (not inflated)
console.log(`Taker Amount: ${amounts.takerAmount}`); // Deflated by slippage
console.log(`Amount: ${amounts.amount}`); // Original share quantity
console.log(`Price Per Share: ${amounts.pricePerShare}`);
console.log(`Slippage Applied: ${amounts.slippageBps} bps`); // 100n

// Value-based market order with slippage
const valueAmounts = orderBuilder.getMarketOrderAmounts(
  {
    side: Side.BUY,
    valueWei: 5000000000000000000n, // 5 USDT (in wei)
    slippageBps: 50n, // 0.5% slippage tolerance
    isMinAmountOut: true,
  },
  book,
);
```

**Note:** Slippage will only be applied if you provide the `slippageBps` and `isMinAmountOut` values when submitting your order to the REST API.

## How to redeem positions

The `OrderBuilder` class provides the `redeemPositions` method to redeem your positions on the Predict protocol. The method supports all market types through the `isNegRisk` and `isYieldBearing` options.

1. **Create a Wallet**: Initialize a wallet that will be used to sign the redemption transaction.
2. **Initialize `OrderBuilder`**: Instantiate the `OrderBuilder` class by calling the static `make` method.
3. **Redeem Positions**: Call the `redeemPositions` method with the appropriate options.

The `conditionId` and `indexSet` can be fetched from the `GET /positions` endpoint.

```typescript
import { Wallet } from "ethers";
import { OrderBuilder, ChainId } from "@predictdotfun/sdk";

// Initialize the wallet with your private key
const signer = new Wallet(process.env.WALLET_PRIVATE_KEY);

// The main function initiates the OrderBuilder (only once per signer)
// Then provides it as dependency to other functions
async function main() {
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  // Redeem positions for a standard market
  await redeemStandardPositions(orderBuilder);

  // Redeem positions for a NegRisk market
  await redeemNegRiskPositions(orderBuilder);
}

async function redeemStandardPositions(orderBuilder: OrderBuilder) {
  const conditionId = "CONDITION_ID_FROM_API"; // A hash string
  const indexSet = "INDEX_SET_FROM_API"; // 1 or 2 based on the position you want to redeem

  const result = await orderBuilder.redeemPositions({
    conditionId,
    indexSet,
    isNegRisk: false,
    isYieldBearing: true, // Set based on market type
  });

  if (result.success) {
    console.log("Positions redeemed successfully:", result.receipt);
  } else {
    console.error("Failed to redeem positions:", result.cause);
  }
}

async function redeemNegRiskPositions(orderBuilder: OrderBuilder) {
  const conditionId = "CONDITION_ID_FROM_API"; // A hash string
  const indexSet = "INDEX_SET_FROM_API"; // 1 or 2 based on the position you want to redeem
  const amount = "POSITION_AMOUNT_FROM_API"; // The amount to redeem, usually the max

  const result = await orderBuilder.redeemPositions({
    conditionId,
    indexSet,
    amount,
    isNegRisk: true,
    isYieldBearing: true, // Set based on market type
  });

  if (result.success) {
    console.log("Positions redeemed successfully:", result.receipt);
  } else {
    console.error("Failed to redeem positions:", result.cause);
  }
}
```

## How to merge positions

The `OrderBuilder` class provides the `mergePositions` method to combine both outcome tokens back into collateral (USDT). This is useful when you hold equal amounts of both YES and NO positions.

1. **Create a Wallet**: Initialize a wallet that will be used to sign the merge transaction.
2. **Initialize `OrderBuilder`**: Instantiate the `OrderBuilder` class by calling the static `make` method.
3. **Merge Positions**: Call the `mergePositions` method with the appropriate options.

The `conditionId` can be fetched from the `GET /positions` endpoint.

```typescript
import { Wallet } from "ethers";
import { OrderBuilder, ChainId } from "@predictdotfun/sdk";

// Initialize the wallet with your private key
const signer = new Wallet(process.env.WALLET_PRIVATE_KEY);

async function main() {
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  await mergePositions(orderBuilder);
}

async function mergePositions(orderBuilder: OrderBuilder) {
  const conditionId = "CONDITION_ID_FROM_API";
  const amount = 10000000000000000000n; // 10 tokens (in wei)

  const result = await orderBuilder.mergePositions({
    conditionId,
    amount,
    isNegRisk: false,
    isYieldBearing: true, // Set based on market type
  });

  if (result.success) {
    console.log("Positions merged successfully:", result.receipt);
  } else {
    console.error("Failed to merge positions:", result.cause);
  }
}
```

## How to convert positions

The `OrderBuilder` class provides the `convertPositions` method to convert NO positions in a NegRisk market into the complementary YES positions plus collateral (USDT). Only NegRisk markets support conversions.

For each `amount` converted, the selected NO positions are burned and you receive:

- `amount` of the YES position for every other market in the category.
- `amount * (numberOfNoPositions - 1)` of collateral (USDT).

If the market has a fee, it is deducted from both the collateral and the YES tokens.

1. **Create a Wallet**: Initialize a wallet that will be used to sign the conversion transaction.
2. **Initialize `OrderBuilder`**: Instantiate the `OrderBuilder` class by calling the static `make` method.
3. **Convert Positions**: Call the `convertPositions` method with the appropriate options.

The `negRiskOnChainId` matches the field of the same name returned by the `GET /categories` endpoint: the category's on-chain NegRisk market ID, a 32-byte hex string. Note that this is not the numeric `id` the API uses for markets and categories. The `indexSet` is a bitmask that selects which NO positions to convert: for each one, set the bit at the market's `questionIndex` (also returned by the `GET /categories` and `GET /positions` endpoints).

Conversions move your NO tokens through the NegRisk adapter, which must be approved as an operator first. See [How to set scoped approvals (per-operation)](#how-to-set-scoped-approvals-per-operation) and use the `CONVERT` operation.

```typescript
import { Wallet } from "ethers";
import { OrderBuilder, ChainId } from "@predictdotfun/sdk";

// Initialize the wallet with your private key
const signer = new Wallet(process.env.WALLET_PRIVATE_KEY);

async function main() {
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  await convertPositions(orderBuilder);
}

async function convertPositions(orderBuilder: OrderBuilder) {
  const negRiskOnChainId = "NEG_RISK_ON_CHAIN_ID_FROM_API"; // 32-byte hex, not the numeric API id

  // Set the bit at each market's `questionIndex` to select its NO position
  const questionIndexes = [0, 2]; // e.g. convert the NO positions of the first and third questions
  const indexSet = questionIndexes.reduce((set, index) => set | (1n << BigInt(index)), 0n);

  const result = await orderBuilder.convertPositions({
    negRiskOnChainId,
    indexSet,
    amount: 10000000000000000000n, // 10 tokens (in wei) of each NO position
    isYieldBearing: true, // Set based on market type
  });

  if (result.success) {
    console.log("Positions converted successfully:", result.receipt);
  } else {
    console.error("Failed to convert positions:", result.cause);
  }
}
```

## How to check USDT balance

The method `balanceOf` allows to easily check the current USDT balance of the connected signer.

```typescript
import { Wallet } from "ethers";
import { OrderBuilder, ChainId } from "@predictdotfun/sdk";

// Initialize the wallet with your private key
const signer = new Wallet(process.env.WALLET_PRIVATE_KEY);

// The main function initiates the OrderBuilder (only once per signer)
// Then provides it as dependency to other functions
async function main() {
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  await checkBalance(orderBuilder);
}

async function checkBalance(orderBuilder: OrderBuilder) {
  // Fetch the current account/wallet balance in wei
  const balanceWei = await orderBuilder.balanceOf();

  // Example check
  if (balanceWei >= orderAmountWei) {
    console.log("Enough balance to create the order");
  } else {
    console.error("Not enough balance to create the order");
  }
}
```

## How to interface with contracts

To facilitate interactions with Predict's contracts we expose the necessary instances of each contract, including ABIs and types.

```typescript
import { OrderBuilder, ChainId } from "@predictdotfun/sdk";
import { Wallet } from "ethers";

// Create a wallet to interact with on-chain contracts
const signer = new Wallet(process.env.WALLET_PRIVATE_KEY);

// The main function initiates the OrderBuilder (only once per signer)
// Then provides it as dependency to other functions
async function main() {
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  await callContracts(orderBuilder);
}

async function callContracts(orderBuilder: OrderBuilder) {
  // If the signer is not provided within `OrderBuilder.make` the contracts won't be initiated
  if (!orderBuilder.contracts) {
    throw new Error("The signer was not provided during the OrderBuilder init.");
  }

  // You can now call contract functions (the actual contract instance is within `contract`)
  // The `codec` property contains the ethers Interface, useful to encode and decode data
  const balance = await orderBuilder.contracts["USDT"].contract.balanceOf(signer.address);
}
```

Some other useful utils, ABIs and types exposed by the SDK.

```typescript
import {
  // Supported Chains
  ChainId,

  // Addresses
  AddressesByChainId,

  // Contract Interfaces
  CTFExchange,
  ConditionalTokens,
  YieldBearingConditionalTokens,
  NegRiskAdapter,
  NegRiskCtfExchange,
  ERC20,

  // ABIs
  CTFExchangeAbi,
  NegRiskCtfExchangeAbi,
  NegRiskAdapterAbi,
  ConditionalTokensAbi,
  YieldBearingConditionalTokensAbi,
  ERC20Abi,

  // Order builder
  OrderBuilder,
} from "@predictdotfun/sdk";
```

## How to cancel orders

Here's an example on how to cancel orders via the SDK

1. **Fetch Orders**: Retrieve your open orders using `GET /orders`.
2. **Group by `isNegRisk` and `isYieldBearing`**: Separate orders based on the `isNegRisk` and `isYieldBearing` properties.
3. **Cancel Orders**: Call the cancel function and provide the orders to cancel and the `isNegRisk` and `isYieldBearing` properties.
4. **Check Transaction Success**: Check to confirm the transaction was successful.

```typescript
import { Wallet } from "ethers";
import { OrderBuilder, ChainId, Side } from "@predictdotfun/sdk";

// Create a new JsonRpcProvider instance
const provider = new JsonRpcProvider(process.env.RPC_PROVIDER_URL);

// Create a wallet to send the cancel transactions on-chain
const signer = new Wallet(process.env.WALLET_PRIVATE_KEY).connect(provider);

// The main function which initiates the OrderBuilder (only once per signer) and then provides it as dependency to other util functions
async function main() {
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const orderBuilder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  // Call a helper function to cancel orders and provide the OrderBuilder instance
  await cancelOrdersHelper(orderBuilder);
}

async function cancelOrdersHelper(orderBuilder: OrderBuilder) {
  // Fetch your open orders from the `GET /orders` endpoint
  const apiResponse = [
    // There are more fields, but for cancellations we only care about `order`, `isNegRisk` and `isYieldBearing`
    { order: {}, isNegRisk: true, isYieldBearing: true },
    { order: {}, isNegRisk: true, isYieldBearing: false },
    { order: {}, isNegRisk: false, isYieldBearing: true },
    { order: {}, isNegRisk: false, isYieldBearing: false },
  ];

  // Determine which orders you want to cancel
  const ordersToCancel = [
    { order: {}, isNegRisk: true, isYieldBearing: true },
    { order: {}, isNegRisk: true, isYieldBearing: false },
    { order: {}, isNegRisk: false, isYieldBearing: true },
    { order: {}, isNegRisk: false, isYieldBearing: false },
  ];

  const regularOrders: Order[] = [];
  const negRiskOrders: Order[] = [];
  const regularYieldBearingOrders: Order[] = [];
  const negRiskYieldBearingOrders: Order[] = [];

  // Group the orders by `isNegRisk` and `isYieldBearing`
  for (const { order, isNegRisk, isYieldBearing } of ordersToCancel) {
    if (isYieldBearing) {
      if (isNegRisk) {
        negRiskYieldBearingOrders.push(order);
      } else {
        regularYieldBearingOrders.push(order);
      }
    } else {
      if (isNegRisk) {
        negRiskOrders.push(order);
      } else {
        regularOrders.push(order);
      }
    }
  }

  // Call the cancel function
  const regResult = await orderBuilder.cancelOrders(regularOrders, { isNegRisk: false, isYieldBearing: false });
  const negRiskResult = await orderBuilder.cancelOrders(negRiskOrders, { isNegRisk: true, isYieldBearing: false });

  const regYieldBearingResult = await orderBuilder.cancelOrders(regularYieldBearingOrders, {
    isNegRisk: false,
    isYieldBearing: true,
  });
  const negRiskYieldBearingResult = await orderBuilder.cancelOrders(negRiskYieldBearingOrders, {
    isNegRisk: true,
    isYieldBearing: true,
  });

  // Check for the transactions success
  const success =
    regResult.success && negRiskResult.success && regYieldBearingResult.success && negRiskYieldBearingResult.success;
}
```

## License

By contributing to this project, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
