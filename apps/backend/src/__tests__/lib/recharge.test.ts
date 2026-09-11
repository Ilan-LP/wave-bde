import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { applySumUpCheckoutStatus } from "../../lib/recharge.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    pointsAccount: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    rechargeCheckout: {
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const rechargeCheckoutUpdateMany = vi.mocked(prisma.rechargeCheckout.updateMany);
const pointsAccountFindUnique = vi.mocked(prisma.pointsAccount.findUnique);
const auditLogCreate = vi.mocked(prisma.auditLog.create);
const transactionMock = vi.mocked(prisma.$transaction);

const pendingCheckout = {
  id: "recharge-1",
  pointsAccountId: "pa-1",
  sumupCheckoutId: "sumup-checkout-1",
  points: 150,
  amountMinorUnit: 1000,
  currency: "EUR",
  status: "PENDING" as const,
  createdAt: new Date(),
  confirmedAt: null,
};

function mockSuccessfulCredit(balanceAfter = 650) {
  transactionMock.mockImplementation(async (cb) => {
    const tx = {
      rechargeCheckout: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      pointsAccount: {
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ balance: balanceAfter }),
      },
      transaction: { create: vi.fn().mockResolvedValue({ id: "txn-1" }) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return cb(tx);
  });
}

describe("applySumUpCheckoutStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auditLogCreate.mockResolvedValue({} as never);
  });

  it("returns still-pending and writes nothing when SumUp still reports PENDING", async () => {
    const result = await applySumUpCheckoutStatus({
      rechargeCheckout: pendingCheckout,
      sumupStatus: "PENDING",
      actorId: null,
      source: "reconciliation-job",
    });

    expect(result).toEqual({ outcome: "still-pending" });
    expect(rechargeCheckoutUpdateMany).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("flips to FAILED and audit-logs it when SumUp reports FAILED", async () => {
    rechargeCheckoutUpdateMany.mockResolvedValue({ count: 1 });

    const result = await applySumUpCheckoutStatus({
      rechargeCheckout: pendingCheckout,
      sumupStatus: "FAILED",
      actorId: null,
      source: "reconciliation-job",
    });

    expect(result).toEqual({ outcome: "failed-or-expired", status: "FAILED" });
    expect(rechargeCheckoutUpdateMany).toHaveBeenCalledWith({
      where: { id: "recharge-1", status: "PENDING" },
      data: { status: "FAILED" },
    });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: null,
          action: "UPDATE",
          entityType: "RechargeCheckout",
          entityId: "recharge-1",
        }),
      }),
    );
  });

  it("flips to EXPIRED when SumUp reports EXPIRED", async () => {
    rechargeCheckoutUpdateMany.mockResolvedValue({ count: 1 });

    const result = await applySumUpCheckoutStatus({
      rechargeCheckout: pendingCheckout,
      sumupStatus: "EXPIRED",
      actorId: "member-user-1",
      source: "confirm-endpoint",
    });

    expect(result).toEqual({ outcome: "failed-or-expired", status: "EXPIRED" });
    expect(rechargeCheckoutUpdateMany).toHaveBeenCalledWith({
      where: { id: "recharge-1", status: "PENDING" },
      data: { status: "EXPIRED" },
    });
  });

  it("does not audit-log a FAILED/EXPIRED transition that lost the race (already resolved elsewhere)", async () => {
    rechargeCheckoutUpdateMany.mockResolvedValue({ count: 0 });

    const result = await applySumUpCheckoutStatus({
      rechargeCheckout: pendingCheckout,
      sumupStatus: "FAILED",
      actorId: null,
      source: "reconciliation-job",
    });

    expect(result).toEqual({ outcome: "failed-or-expired", status: "FAILED" });
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("credits points, creates a TOPUP transaction, and audit-logs it when SumUp reports PAID", async () => {
    mockSuccessfulCredit(650);

    const result = await applySumUpCheckoutStatus({
      rechargeCheckout: pendingCheckout,
      sumupStatus: "PAID",
      actorId: null,
      source: "reconciliation-job",
    });

    expect(result).toEqual({ outcome: "credited", transactionId: "txn-1", newBalance: 650 });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: null,
          action: "UPDATE",
          entityType: "Transaction",
          entityId: "txn-1",
        }),
      }),
    );
  });

  it("does not double-credit when it loses the race to a concurrent confirm/reconcile call", async () => {
    transactionMock.mockImplementation(async (cb) => {
      const tx = {
        rechargeCheckout: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        pointsAccount: { update: vi.fn(), findUnique: vi.fn() },
        transaction: { create: vi.fn() },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      return cb(tx);
    });
    pointsAccountFindUnique.mockResolvedValue({ id: "pa-1", userId: "user-1", balance: 650 } as never);

    const result = await applySumUpCheckoutStatus({
      rechargeCheckout: pendingCheckout,
      sumupStatus: "PAID",
      actorId: null,
      source: "reconciliation-job",
    });

    expect(result).toEqual({ outcome: "already-confirmed", newBalance: 650 });
    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});
