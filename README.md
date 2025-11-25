A TypeScript SDK to help developers interface with the Predict's protocol.

#### Sections:

- [**How to install the SDK**](#how-to-install-the-sdk)
- [**How to set approvals**](#how-to-set-approvals)
- [**How to use a Predict account**](#how-to-use-a-predict-account)
- [**How to create an order**](#how-to-create-a-limit-order-recommended)
- [**How to redeem positions**](#how-to-redeem-positions)
- [**How to check USDB balance**](#how-to-check-usdb-balance)
- [**How to interface with contracts**](#how-to-interface-with-contracts)
- [**How to cancel orders**](#how-to-cancel-orders)
- [**License**](#license)

## How to install the SDK

This package has [ethers v6](https://docs.ethers.io/v6/) as a peer dependency.

```bash
yarn add @predictdotfun/sdk ethers
```

```bash
npm install @predictdotfun/sdk ethers
```

See the [`OrderBuilder`](./src/OrderBuilder.ts) class for more in-depth details on each function.

## How to set approvals

Before trading, you need to set approvals for ERC-1155 (`ConditionalTokens`) and ERC-20 (`USDB`). This can be achieved by sending a transaction to the respective contracts (see the [Contracts](#contracts) section) and approving both the `CTF_EXCHANGE` and the `NEG_RISK_CTF_EXCHANGE` or via the SDK utils.

**Contracts**: The current deployed contracts can be found either in the [`Constants.ts`](./src/Constants.ts#26) file or in the [Deployed Contracts](https://docs.predict.fun/developers/deployed-contracts) documentation.

The following example demonstrates how to set the necessary approvals using the SDK utils.

```typescript
import { Wallet, MaxInt256 } from "ethers";
import { OrderBuilder, ChainId, Side } from "@predictdotfun/sdk";

// Create a wallet to send the approvals transactions (must be the orders' `maker`)
const signer = new Wallet(process.env.WALLET_PRIVATE_KEY);

// The main function which initiates the OrderBuilder (only once per signer) and then provides it as dependency to other util functions
async function main() {
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  // Call an helper function to set the approvals and provide the OrderBuilder instance.
  await setApprovals(builder);
}

async function setApprovals(builder: OrderBuilder) {
  // Set all the approval needed within the protocol
  const result = await builder.setApprovals();

  // Check if the approvals were set successfully
  if (!result.success) {
    throw new Error("Failed to set approvals.");
  }
}
```

## How to use a Predict account

In the previous version of Predict, all users (including EOAs), would receive a smart wallet when interacting via the web app. In the current version, EOAs no longer receive a smart wallet account and as such, they interact with the on-chain protocol directly.

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
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  // Call an helper function to create the order and provide the OrderBuilder instance
  await createOrder(builder);
}

async function createOrder(builder: OrderBuilder) {
  // Step 1. Set approvals and define the order params as usual

  // Step 2. Create the order by using the Predict account address as both the `signer` and `maker`
  const order = builder.buildOrder("LIMIT", {
    maker: "PREDICT_ACCOUNT_ADDRESS",
    signer: "PREDICT_ACCOUNT_ADDRESS",
    side: Side.BUY, // Equivalent to 0
    tokenId: "OUTCOME_ON_CHAIN_ID", // This can be fetched via the API or on-chain
    makerAmount, // 0.4 USDB * 10 shares (in wei)
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
  const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  // Call an helper function to create the order and provide the OrderBuilder instance
  await createOrder(builder);
}

async function createOrder(builder: OrderBuilder) {
  /**
   * NOTE: You can also call `setApprovals` once per wallet.
   */

  // Set all the approval needed within the protocol (if needed)
  const result = await builder.setApprovals();

  // Check if the approvals were set successfully
  if (!result.success) {
    throw new Error("Failed to set approvals.");
  }

  // Simple helper function to calculate the amounts for a `LIMIT` order
  const { pricePerShare, makerAmount, takerAmount } = builder.getLimitOrderAmounts({
    side: Side.BUY,
    pricePerShareWei: 400000000000000000n, // 0.4 USDB (in wei)
    quantityWei: 10000000000000000000n, // 10 shares (in wei)
  });

  // Build a limit order (if you are using a Predict account replace `signer.address` with your deposit address)
  const order = builder.buildOrder("LIMIT", {
    maker: signer.address,
    signer: signer.address,
    side: Side.BUY, // Equivalent to 0
    tokenId: "OUTCOME_ON_CHAIN_ID", // This can be fetched via the API or on-chain
    makerAmount, // 0.4 USDB * 10 shares (in wei)
    takerAmount, // 10 shares (in wei)
    nonce: 0n,
    feeRateBps: 0, // Should be fetched via the `GET /markets` endpoint
  });

  // Build typed data for the order (isNegRisk can be fetched via the API)
  const typedData = builder.buildTypedData(order, { isNegRisk: true });

  // Sign the order by providing the typedData of the order
  const signedOrder = await builder.signTypedDataOrder(typedData);

  // Compute the order's hash
  const hash = builder.buildTypedDataHash(typedData);

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
  const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  // Call an helper function to create the order and provide the OrderBuilder instance
  await createOrder(builder);
}

async function createOrder(builder: OrderBuilder) {
  // Fetch the orderbook for the specific market via `GET orderbook/{marketId}`
  const book = {};

  /**
   * NOTE: You can also call `setApprovals` once per wallet.
   */

  // Set all the approval needed within the protocol (if needed)
  const result = await builder.setApprovals();

  // Check if the approvals were set successfully
  if (!result.success) {
    throw new Error("Failed to set approvals.");
  }

  // Helper function to calculate the amounts for a `MARKET` order
  const { pricePerShare, makerAmount, takerAmount } = builder.getMarketOrderAmounts(
    {
      side: Side.SELL,
      quantityWei: 10000000000000000000n, // 10 shares (in wei) e.g. parseEther("10")
    },
    book, // It's recommended to re-fetch the orderbook regularly to avoid issues
  );

  // Build a limit order (if you are using a Predict account replace `signer.address` with your deposit address)
  const order = builder.buildOrder("MARKET", {
    maker: signer.address,
    signer: signer.address,
    side: Side.SELL, // Equivalent to 1
    tokenId: "OUTCOME_ON_CHAIN_ID", // This can be fetched via the API or on-chain
    makerAmount, // 10 shares (in wei)
    takerAmount, // 0.4 USDB * 10 shares (in wei)
    nonce: 0n,
    feeRateBps: 0, // Should be fetched via the `GET /markets` endpoint
  });

  // Build typed data for the order (isNegRisk can be fetched via the API)
  const typedData = builder.buildTypedData(order, { isNegRisk: false });

  // Sign the order by providing the typedData of the order
  const signedOrder = await builder.signTypedDataOrder(typedData);

  // Compute the order's hash
  const hash = builder.buildTypedDataHash(typedData);

  // Example structure required to create an order via Predict's API
  const createOrderBody = {
    data: {
      order: { ...signedOrder, hash },
      pricePerShare,
      strategy: "MARKET",
      slippageBps: "2000", // Only used for `MARKET` orders, in this example it's 0.2%
    },
  };
}
```

## How to redeem positions

The `OrderBuilder` class provides methods to redeem your positions on the Predict protocol. Depending on the type of market you're interacting with, you can use either `redeemPositions` for standard markets or `redeemNegRiskPositions` for NegRisk markets.

1. **Create a Wallet**: Initialize a wallet that will be used to sign the redemption transaction.
2. **Initialize `OrderBuilder`**: Instantiate the `OrderBuilder` class by calling the static `make` method.
3. **Redeem Positions**: Call the `redeemPositions` method with the appropriate `conditionId` and `indexSet`.

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
  const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  await redeemPositions(builder);
  await redeemNegRiskPositions(builder);
}

async function redeemPositions(orderBuilder: OrderBuilder) {
  const conditionId = "CONDITION_ID_FROM_API"; // A hash string
  const indexSet = "INDEX_SET_FROM_API"; // 1 or 2 based on the position you want to redeem

  const result = await builder.redeemPositions(conditionId, indexSet);

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

  const result = await builder.redeemNegRiskPositions(conditionId, indexSet, amount);

  if (result.success) {
    console.log("Positions redeemed successfully:", result.receipt);
  } else {
    console.error("Failed to redeem positions:", result.cause);
  }
}
```

## How to check USDB balance

The method `balanceOf` allows to easily check the current USDB balance of the connected signer.

```typescript
import { Wallet } from "ethers";
import { OrderBuilder, ChainId } from "@predictdotfun/sdk";

// Initialize the wallet with your private key
const signer = new Wallet(process.env.WALLET_PRIVATE_KEY);

// The main function initiates the OrderBuilder (only once per signer)
// Then provides it as dependency to other functions
async function main() {
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  await checkBalance(builder);
}

async function checkBalance(orderBuilder: OrderBuilder) {
  // Fetch the current account/wallet balance in wei
  const balanceWei = await builder.balanceOf();

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
import { OrderBuilder } from "@predictdotfun/sdk";
import { Wallet } from "ethers";

// Create a wallet to interact with on-chain contracts
const signer = new Wallet(process.env.WALLET_PRIVATE_KEY);

// The main function initiates the OrderBuilder (only once per signer)
// Then provides it as dependency to other functions
async function main() {
  // Create a new instance of the OrderBuilder class. Note: This should only be done once per signer
  const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  await callContracts(builder);
}

async function callContracts(orderBuilder: OrderBuilder) {
  // If the signer is not provided within `OrderBuilder.make` the contracts won't be initiated
  if (!orderBuilder.contracts) {
    throw new Error("The signer was not provided during the OrderBuilder init.");
  }

  // You can now call contract functions (the actual contract instance is within `contract`)
  // The `codec` property contains the ethers Interface, useful to encode and decode data
  const balance = await orderBuilder.contracts["USDB"].contract.balanceOf(signer.address);
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
  NegRiskAdapter,
  NegRiskCtfExchange,
  ERC20,

  // ABIs
  CTFExchangeAbi,
  NegRiskCtfExchangeAbi,
  NegRiskAdapterAbi,
  ConditionalTokensAbi,
  ERC20Abi,

  // Order builder
  OrderBuilder,
} from "@predictdotfun/sdk";
```

## How to cancel orders

Here's an example on how to cancel orders via the SDK

1. **Fetch Orders**: Retrieve your open orders using `GET /orders`.
2. **Cancel Orders off chain**: Call `POST /orders/cancel` with orderIds and cancel orders from the orderbook
3. **Group by `isNegRisk`**: Separate orders based on the `isNegRisk` property.
4. **Cancel Orders**: Call the specific cancel function based on the order(s) type (`isNegRisk`).
5. **Check Transaction Success**: Check to confirm the transaction was successful.

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
  const builder = await OrderBuilder.make(ChainId.BnbMainnet, signer);

  // Call an helper function to cancel orders and provide the OrderBuilder instance
  await createOrder(builder);
}

async function cancelOrders(builder: OrderBuilder) {
  // Fetch your open orders from the `GET /orders` endpoint
  const apiResponse = [
    // There are more fields, but for cancellations we only care about `order` and `isNegRisk`
    { order: {}, isNegRisk: true },
    { order: {}, isNegRisk: false },
    { order: {}, isNegRisk: false },
  ];

  // Determine which orders you want to cancel
  const ordersToCancel = [
    { order: {}, isNegRisk: true },
    { order: {}, isNegRisk: false },
  ];

  const regularOrders: Order[] = [];
  const negRiskOrders: Order[] = [];

  // Group the orders by `isNegRisk`
  for (const { order, isNegRisk } of ordersToCancel) {
    if (isNegRisk) {
      negRiskOrders.push(order);
    } else {
      regularOrders.push(order);
    }
  }

  // Call the respective cancel functions
  const regResult = await builder.cancelOrders(regularOrders);
  const negRiskResult = await builder.cancelNegRiskOrders(regularOrders);

  // Check for the transactions success
  const success = regResult.success && negRiskResult.success;
}
```

## License

By contributing to this project, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
