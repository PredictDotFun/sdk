export class MissingSignerError extends Error {
  public readonly name = "MissingSignerError";
  constructor() {
    super("A signer is required to sign the order");
  }
}

export class InvalidQuantityError extends Error {
  public readonly name = "InvalidQuantityError";
  constructor() {
    super("Invalid quantityWei. Must be greater than 1e16.");
  }
}

export class InvalidExpirationError extends Error {
  public readonly name = "InvalidExpirationError";
  constructor() {
    super("Invalid expiration. Must be greater than 0.");
  }
}

export class FailedOrderSignError extends Error {
  public readonly name = "FailedOrderSignError";
  constructor(cause?: Error) {
    super("Failed to EIP-712 sign the order via signTypedData", { cause });
  }
}

export class FailedTypedDataEncoderError extends Error {
  public readonly name = "FailedTypedDataEncoderError";
  constructor(cause?: Error) {
    super("Failed to hash the order's typed data", { cause });
  }
}

export class InvalidNegRiskConfig extends Error {
  public readonly name = "InvalidNegRiskConfig";
  constructor() {
    super(
      "The token ID of one or more orders is not registered in the selected contract. Use `cancelOrders` when `isNegRisk` is false. Otherwise, use `cancelNegRiskOrders`.",
    );
  }
}

export class MakerSignerMismatchError extends Error {
  public readonly name = "MakerSignerMismatchError";
  constructor() {
    super("The maker and signer must be the same address.");
  }
}

export class InvalidSignerError extends Error {
  public readonly name = "InvalidSignerError";
  constructor() {
    super(
      "The signer is not the owner of the Predict account or you are on the wrong chain. The signer must be the Privy wallet exported from your account's settings. See: https://predict.fun/account/settings",
    );
  }
}
