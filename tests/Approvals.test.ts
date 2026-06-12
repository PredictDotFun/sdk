import type { BaseWallet } from "ethers";
import type { ApprovalStep } from "../src/Types";
import { MaxInt256, MaxUint256 } from "ethers";
import { OrderBuilder } from "../src/OrderBuilder";
import { AddressesByChainId, ChainId, Side } from "../src/Constants";
import { InvalidApprovalOperationError, MissingSignerError } from "../src/Errors";

const addresses = AddressesByChainId[ChainId.BnbMainnet];

const mockSigner = {
  address: "0x1111111111111111111111111111111111111111",
  provider: {
    _isMulticallProvider: true,
  },
  signTypedData: jest.fn().mockResolvedValue("0xmocksignature"),
  connect: jest.fn().mockReturnValue({
    signTypedData: jest.fn().mockResolvedValue("0xmocksignature"),
  }),
} as unknown as BaseWallet;

/** A contract write method shaped like an ethers v6 typechain method (callable + `estimateGas`). */
function mockTxMethod(success = true) {
  const fn = jest.fn().mockResolvedValue({
    wait: jest.fn().mockResolvedValue({ status: success ? 1 : 0 }),
  }) as jest.Mock & { estimateGas: jest.Mock };
  fn.estimateGas = jest.fn().mockResolvedValue(21_000n);
  return fn;
}

const ids = (steps: ApprovalStep[]) => steps.map((s) => s.id);

describe("getApprovalSteps", () => {
  // Pure method: works on a signer-less builder, no network access.
  const builder = OrderBuilder.make(ChainId.BnbMainnet);

  describe("TRADE - standard market", () => {
    it("returns exchange approval + allowance when side is omitted", () => {
      const steps = builder.getApprovalSteps({ operation: "TRADE", isNegRisk: false, isYieldBearing: false });
      expect(ids(steps)).toEqual(["ERC1155_APPROVAL:CTF_EXCHANGE", "ERC20_ALLOWANCE:CTF_EXCHANGE"]);
    });

    it("returns only the allowance for a BUY", () => {
      const steps = builder.getApprovalSteps({
        operation: "TRADE",
        isNegRisk: false,
        isYieldBearing: false,
        side: Side.BUY,
      });
      expect(ids(steps)).toEqual(["ERC20_ALLOWANCE:CTF_EXCHANGE"]);
    });

    it("returns only the ERC-1155 approval for a SELL", () => {
      const steps = builder.getApprovalSteps({
        operation: "TRADE",
        isNegRisk: false,
        isYieldBearing: false,
        side: Side.SELL,
      });
      expect(ids(steps)).toEqual(["ERC1155_APPROVAL:CTF_EXCHANGE"]);
    });

    it("populates spender, token and default copy", () => {
      const [approval, allowance] = builder.getApprovalSteps({
        operation: "TRADE",
        isNegRisk: false,
        isYieldBearing: false,
      });

      expect(approval).toMatchObject({
        type: "ERC1155_APPROVAL",
        spender: addresses.CTF_EXCHANGE,
        token: addresses.CONDITIONAL_TOKENS,
        label: "Approve Exchange",
        description: "Allows you to interact with the exchange.",
      });
      expect(allowance).toMatchObject({
        type: "ERC20_ALLOWANCE",
        spender: addresses.CTF_EXCHANGE,
        token: addresses.USDT,
        label: "Exchange Allowance",
        description: "Grants the exchange permission to use your collateral to trade.",
      });
    });
  });

  describe("TRADE - neg risk market", () => {
    it("includes the adapter approval regardless of side", () => {
      const both = builder.getApprovalSteps({ operation: "TRADE", isNegRisk: true, isYieldBearing: false });
      expect(ids(both)).toEqual([
        "ERC1155_APPROVAL:NEG_RISK_CTF_EXCHANGE",
        "ERC1155_APPROVAL:NEG_RISK_ADAPTER",
        "ERC20_ALLOWANCE:NEG_RISK_CTF_EXCHANGE",
      ]);

      const buy = builder.getApprovalSteps({
        operation: "TRADE",
        isNegRisk: true,
        isYieldBearing: false,
        side: Side.BUY,
      });
      expect(ids(buy)).toEqual(["ERC1155_APPROVAL:NEG_RISK_ADAPTER", "ERC20_ALLOWANCE:NEG_RISK_CTF_EXCHANGE"]);

      const sell = builder.getApprovalSteps({
        operation: "TRADE",
        isNegRisk: true,
        isYieldBearing: false,
        side: Side.SELL,
      });
      expect(ids(sell)).toEqual(["ERC1155_APPROVAL:NEG_RISK_CTF_EXCHANGE", "ERC1155_APPROVAL:NEG_RISK_ADAPTER"]);
    });

    it("uses multi-outcome copy", () => {
      const [exchange, adapter] = builder.getApprovalSteps({
        operation: "TRADE",
        isNegRisk: true,
        isYieldBearing: false,
        side: Side.SELL,
      });
      expect(exchange.label).toBe("Approve Multi-Outcome");
      expect(adapter.label).toBe("Approve Multi-Outcome Adapter");
    });
  });

  describe("SPLIT", () => {
    it("standard: USDT allowance to the conditional tokens contract", () => {
      const steps = builder.getApprovalSteps({ operation: "SPLIT", isNegRisk: false, isYieldBearing: false });
      expect(ids(steps)).toEqual(["ERC20_ALLOWANCE:CONDITIONAL_TOKENS"]);
      expect(steps[0]).toMatchObject({
        spender: addresses.CONDITIONAL_TOKENS,
        token: addresses.USDT,
        label: "Split Allowance",
      });
    });

    it("neg risk: USDT allowance to the adapter", () => {
      const steps = builder.getApprovalSteps({ operation: "SPLIT", isNegRisk: true, isYieldBearing: false });
      expect(ids(steps)).toEqual(["ERC20_ALLOWANCE:NEG_RISK_ADAPTER"]);
      expect(steps[0].label).toBe("Multi-Outcome Split Allowance");
    });
  });

  describe("MERGE / REDEEM", () => {
    it("standard merge and redeem need no approvals", () => {
      expect(builder.getApprovalSteps({ operation: "MERGE", isNegRisk: false, isYieldBearing: false })).toEqual([]);
      expect(builder.getApprovalSteps({ operation: "REDEEM", isNegRisk: false, isYieldBearing: false })).toEqual([]);
    });

    it("neg risk merge and redeem need the adapter approval", () => {
      expect(ids(builder.getApprovalSteps({ operation: "MERGE", isNegRisk: true, isYieldBearing: false }))).toEqual([
        "ERC1155_APPROVAL:NEG_RISK_ADAPTER",
      ]);
      expect(ids(builder.getApprovalSteps({ operation: "REDEEM", isNegRisk: true, isYieldBearing: false }))).toEqual([
        "ERC1155_APPROVAL:NEG_RISK_ADAPTER",
      ]);
    });
  });

  describe("CONVERT", () => {
    it("neg risk: needs the adapter approval", () => {
      expect(ids(builder.getApprovalSteps({ operation: "CONVERT", isNegRisk: true, isYieldBearing: false }))).toEqual([
        "ERC1155_APPROVAL:NEG_RISK_ADAPTER",
      ]);
    });

    it("throws for a non-neg-risk market", () => {
      expect(() => builder.getApprovalSteps({ operation: "CONVERT", isNegRisk: false, isYieldBearing: false })).toThrow(
        InvalidApprovalOperationError,
      );
    });
  });

  describe("yield-bearing track", () => {
    it("uses the yield-bearing spender keys but shares the same copy", () => {
      const standard = builder.getApprovalSteps({ operation: "TRADE", isNegRisk: false, isYieldBearing: false });
      const yieldBearing = builder.getApprovalSteps({ operation: "TRADE", isNegRisk: false, isYieldBearing: true });

      expect(ids(yieldBearing)).toEqual([
        "ERC1155_APPROVAL:YIELD_BEARING_CTF_EXCHANGE",
        "ERC20_ALLOWANCE:YIELD_BEARING_CTF_EXCHANGE",
      ]);
      // Copy is role-based, so it matches the standard track.
      expect(yieldBearing.map((s) => s.label)).toEqual(standard.map((s) => s.label));
      expect(yieldBearing[0].spender).toBe(addresses.YIELD_BEARING_CTF_EXCHANGE);
    });
  });
});

describe("getAllApprovalSteps", () => {
  const builder = OrderBuilder.make(ChainId.BnbMainnet);

  it("returns the full deduped set for a single track", () => {
    const steps = builder.getAllApprovalSteps({ isYieldBearing: false });
    expect(ids(steps)).toEqual([
      "ERC1155_APPROVAL:CTF_EXCHANGE",
      "ERC20_ALLOWANCE:CTF_EXCHANGE",
      "ERC20_ALLOWANCE:CONDITIONAL_TOKENS",
      "ERC1155_APPROVAL:NEG_RISK_CTF_EXCHANGE",
      "ERC1155_APPROVAL:NEG_RISK_ADAPTER",
      "ERC20_ALLOWANCE:NEG_RISK_CTF_EXCHANGE",
      "ERC20_ALLOWANCE:NEG_RISK_ADAPTER",
    ]);
    // The neg-risk adapter approval is shared by TRADE/MERGE/REDEEM/CONVERT but appears once.
    expect(ids(steps).filter((id) => id === "ERC1155_APPROVAL:NEG_RISK_ADAPTER")).toHaveLength(1);
  });

  it("spans both tracks when isYieldBearing is omitted, with no duplicate ids", () => {
    const steps = builder.getAllApprovalSteps();
    const allIds = ids(steps);

    expect(allIds).toHaveLength(14); // 7 per track
    expect(new Set(allIds).size).toBe(allIds.length); // no duplicates
    // Standard track first, then yield-bearing.
    expect(allIds.slice(0, 7)).toEqual(builder.getAllApprovalSteps({ isYieldBearing: false }).map((s) => s.id));
    expect(allIds.slice(7)).toEqual(builder.getAllApprovalSteps({ isYieldBearing: true }).map((s) => s.id));
  });
});

describe("runApprovals with getAllApprovalSteps", () => {
  it("runs the full set and reports per step", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);
    jest.spyOn(builder, "checkApproval").mockResolvedValue(false);
    const setApproval = jest.spyOn(builder, "setApproval").mockResolvedValue({ success: true });

    const report = await builder.runApprovals(builder.getAllApprovalSteps({ isYieldBearing: false }));

    expect(report.success).toBe(true);
    expect(setApproval).toHaveBeenCalledTimes(7);
    expect(report.steps).toHaveLength(7);
  });
});

describe("checkApprovals", () => {
  it("reports satisfied/unsatisfied per step (ERC-20 by allowance, ERC-1155 by operator)", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);

    // Replace the multicall entries with plain mocks to avoid the ethers Contract proxy.
    (builder.contracts!.multicall as Record<string, unknown>).USDT = {
      contract: { allowance: jest.fn().mockResolvedValue(MaxInt256) },
      codec: {},
    };
    (builder.contracts!.multicall as Record<string, unknown>).CONDITIONAL_TOKENS = {
      contract: { isApprovedForAll: jest.fn().mockResolvedValue(false) },
      codec: {},
    };

    const steps = builder.getApprovalSteps({ operation: "TRADE", isNegRisk: false, isYieldBearing: false });
    const checks = await builder.checkApprovals(steps);

    expect(checks).toHaveLength(2);
    const byId = Object.fromEntries(checks.map((c) => [c.step.id, c.satisfied]));
    expect(byId["ERC1155_APPROVAL:CTF_EXCHANGE"]).toBe(false);
    expect(byId["ERC20_ALLOWANCE:CTF_EXCHANGE"]).toBe(true);
  });

  it("treats an ERC-20 allowance below MaxInt256 as unsatisfied", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);
    (builder.contracts!.multicall as Record<string, unknown>).USDT = {
      contract: { allowance: jest.fn().mockResolvedValue(0n) },
      codec: {},
    };

    const [step] = builder.getApprovalSteps({
      operation: "TRADE",
      isNegRisk: false,
      isYieldBearing: false,
      side: Side.BUY,
    });
    expect(await builder.checkApproval(step)).toBe(false);
  });

  it("throws without a signer", async () => {
    const builder = OrderBuilder.make(ChainId.BnbMainnet);
    const [step] = builder.getApprovalSteps({
      operation: "TRADE",
      isNegRisk: false,
      isYieldBearing: false,
      side: Side.BUY,
    });
    await expect(builder.checkApproval(step)).rejects.toBeInstanceOf(MissingSignerError);
  });
});

describe("setApproval", () => {
  it("routes ERC-20 steps to USDT.approve with the requested amount", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);
    const approve = mockTxMethod();
    (builder.contracts!.USDT as { contract: unknown }).contract = { approve };

    const [step] = builder.getApprovalSteps({ operation: "SPLIT", isNegRisk: false, isYieldBearing: false });
    const result = await builder.setApproval(step);

    expect(result.success).toBe(true);
    expect(approve).toHaveBeenCalledWith(addresses.CONDITIONAL_TOKENS, MaxUint256, expect.any(Object));
  });

  it("routes ERC-1155 steps to setApprovalForAll", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);
    const setApprovalForAll = mockTxMethod();
    (builder.contracts!.CONDITIONAL_TOKENS as { contract: unknown }).contract = { setApprovalForAll };

    const [step] = builder.getApprovalSteps({
      operation: "TRADE",
      isNegRisk: false,
      isYieldBearing: false,
      side: Side.SELL,
    });
    const result = await builder.setApproval(step);

    expect(result.success).toBe(true);
    expect(setApprovalForAll).toHaveBeenCalledWith(addresses.CTF_EXCHANGE, true, expect.any(Object));
  });

  it("supports revocation via approved: false", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);
    const setApprovalForAll = mockTxMethod();
    (builder.contracts!.CONDITIONAL_TOKENS as { contract: unknown }).contract = { setApprovalForAll };

    const [step] = builder.getApprovalSteps({
      operation: "TRADE",
      isNegRisk: false,
      isYieldBearing: false,
      side: Side.SELL,
    });
    await builder.setApproval(step, { approved: false });

    expect(setApprovalForAll).toHaveBeenCalledWith(addresses.CTF_EXCHANGE, false, expect.any(Object));
  });

  it("revokes an ERC-20 allowance (sets it to 0) when approved is false", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);
    const approve = mockTxMethod();
    (builder.contracts!.USDT as { contract: unknown }).contract = { approve };

    const [step] = builder.getApprovalSteps({ operation: "SPLIT", isNegRisk: false, isYieldBearing: false });
    await builder.setApproval(step, { approved: false });

    expect(approve).toHaveBeenCalledWith(addresses.CONDITIONAL_TOKENS, 0n, expect.any(Object));
  });

  it("throws without a signer", async () => {
    const builder = OrderBuilder.make(ChainId.BnbMainnet);
    const [step] = builder.getApprovalSteps({ operation: "SPLIT", isNegRisk: false, isYieldBearing: false });
    await expect(builder.setApproval(step)).rejects.toBeInstanceOf(MissingSignerError);
  });
});

describe("runApprovals", () => {
  it("skips satisfied steps, submits the rest, and reports progress in order", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);

    // First step already approved, second needs submitting.
    jest.spyOn(builder, "checkApproval").mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const setApproval = jest.spyOn(builder, "setApproval").mockResolvedValue({ success: true });

    const progress: string[] = [];
    const report = await builder.runApprovals(
      builder.getApprovalSteps({ operation: "TRADE", isNegRisk: false, isYieldBearing: false }),
      { onProgress: ({ step, status }) => progress.push(`${step.id}:${status}`) },
    );

    expect(setApproval).toHaveBeenCalledTimes(1);
    expect(report.success).toBe(true);
    expect(report.steps).toEqual([
      { step: expect.objectContaining({ id: "ERC1155_APPROVAL:CTF_EXCHANGE" }), status: "skipped" },
      expect.objectContaining({
        step: expect.objectContaining({ id: "ERC20_ALLOWANCE:CTF_EXCHANGE" }),
        status: "confirmed",
      }),
    ]);
    expect(progress).toEqual([
      "ERC1155_APPROVAL:CTF_EXCHANGE:checking",
      "ERC1155_APPROVAL:CTF_EXCHANGE:skipped",
      "ERC20_ALLOWANCE:CTF_EXCHANGE:checking",
      "ERC20_ALLOWANCE:CTF_EXCHANGE:submitting",
      "ERC20_ALLOWANCE:CTF_EXCHANGE:confirmed",
    ]);
  });

  it("stops on the first failure by default", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);
    jest.spyOn(builder, "checkApproval").mockResolvedValue(false);
    const setApproval = jest.spyOn(builder, "setApproval").mockResolvedValue({ success: false });

    const report = await builder.runApprovals(
      builder.getApprovalSteps({ operation: "TRADE", isNegRisk: true, isYieldBearing: false }),
    );

    expect(report.success).toBe(false);
    expect(setApproval).toHaveBeenCalledTimes(1); // stopped after the first failing step
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0].status).toBe("failed");
  });

  it("continues past failures when stopOnError is false", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);
    jest.spyOn(builder, "checkApproval").mockResolvedValue(false);
    const setApproval = jest.spyOn(builder, "setApproval").mockResolvedValue({ success: false });

    const report = await builder.runApprovals(
      builder.getApprovalSteps({ operation: "TRADE", isNegRisk: true, isYieldBearing: false }),
      { stopOnError: false },
    );

    expect(report.success).toBe(false);
    expect(setApproval).toHaveBeenCalledTimes(3); // all three neg-risk trade steps attempted
    expect(report.steps).toHaveLength(3);
  });

  it("returns an empty, successful report for an operation that needs no approvals", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);
    const checkApproval = jest.spyOn(builder, "checkApproval");

    const report = await builder.runApprovals(
      builder.getApprovalSteps({ operation: "MERGE", isNegRisk: false, isYieldBearing: false }),
    );

    expect(report).toEqual({ success: true, steps: [] });
    expect(checkApproval).not.toHaveBeenCalled();
  });

  it("does not check or emit 'checking' when skipSatisfied is false", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);
    const checkApproval = jest.spyOn(builder, "checkApproval");
    const setApproval = jest.spyOn(builder, "setApproval").mockResolvedValue({ success: true });

    const statuses: string[] = [];
    const report = await builder.runApprovals(
      builder.getApprovalSteps({ operation: "TRADE", isNegRisk: false, isYieldBearing: false }),
      { skipSatisfied: false, onProgress: ({ status }) => statuses.push(status) },
    );

    expect(checkApproval).not.toHaveBeenCalled();
    expect(statuses).not.toContain("checking");
    expect(setApproval).toHaveBeenCalledTimes(2); // nothing skipped, both submitted
    expect(report.success).toBe(true);
  });

  it("treats a failed pre-check as not-satisfied and still submits (does not abort)", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);
    jest.spyOn(builder, "checkApproval").mockRejectedValue(new Error("rpc down"));
    const setApproval = jest.spyOn(builder, "setApproval").mockResolvedValue({ success: true });

    const report = await builder.runApprovals(
      builder.getApprovalSteps({ operation: "TRADE", isNegRisk: false, isYieldBearing: false }),
    ); // skipSatisfied defaults to true

    expect(setApproval).toHaveBeenCalledTimes(2); // pre-check failure did not abort the run
    expect(report.success).toBe(true);
  });

  it("dedupes steps by id (first occurrence wins)", async () => {
    const builder = await OrderBuilder.make(ChainId.BnbMainnet, mockSigner);
    jest.spyOn(builder, "checkApproval").mockResolvedValue(false);
    const setApproval = jest.spyOn(builder, "setApproval").mockResolvedValue({ success: true });

    const steps = builder.getApprovalSteps({ operation: "TRADE", isNegRisk: false, isYieldBearing: false });
    const report = await builder.runApprovals([...steps, ...steps]); // duplicated on purpose

    expect(setApproval).toHaveBeenCalledTimes(2); // 2 unique ids, not 4
    expect(report.steps).toHaveLength(2);
  });
});
