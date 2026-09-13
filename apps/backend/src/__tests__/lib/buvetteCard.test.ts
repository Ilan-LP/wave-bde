import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { applyCardCheckoutStatus } from "../../lib/buvetteCard.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    buvetteCardCheckout: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

const cardCheckoutUpdateMany = vi.mocked(prisma.buvetteCardCheckout.updateMany);
const cardCheckoutFindUnique = vi.mocked(prisma.buvetteCardCheckout.findUnique);
const auditLogCreate = vi.mocked(prisma.auditLog.create);

const pendingCheckout = {
  id: "card-1",
  readerId: "rdr_1",
  clientTransactionId: "ctx-1",
  amountPoints: 100,
  amountMinorUnit: 667,
  currency: "EUR",
  status: "PENDING" as const,
  cancelRequestedAt: null,
  metadata: null,
  createdAt: new Date(),
  resolvedAt: null,
};

describe("applyCardCheckoutStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auditLogCreate.mockResolvedValue({} as never);
  });

  it("returns still-pending and writes nothing when SumUp still reports PENDING", async () => {
    const result = await applyCardCheckoutStatus({
      cardCheckout: pendingCheckout,
      sumupStatus: "PENDING",
      actorId: null,
      source: "reconciliation-job",
    });

    expect(result).toEqual({ outcome: "still-pending" });
    expect(cardCheckoutUpdateMany).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("resolves to SUCCESSFUL and audit-logs it when SumUp reports SUCCESSFUL", async () => {
    cardCheckoutUpdateMany.mockResolvedValue({ count: 1 });

    const result = await applyCardCheckoutStatus({
      cardCheckout: pendingCheckout,
      sumupStatus: "SUCCESSFUL",
      actorId: "operator-1",
      source: "poll-endpoint",
    });

    expect(result).toEqual({ outcome: "resolved", status: "SUCCESSFUL" });
    expect(cardCheckoutUpdateMany).toHaveBeenCalledWith({
      where: { id: "card-1", status: "PENDING" },
      data: { status: "SUCCESSFUL", resolvedAt: expect.any(Date) },
    });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: "operator-1",
          action: "UPDATE",
          entityType: "BuvetteCardCheckout",
          entityId: "card-1",
        }),
      }),
    );
  });

  it("resolves to CANCELLED when SumUp reports CANCELLED", async () => {
    cardCheckoutUpdateMany.mockResolvedValue({ count: 1 });

    const result = await applyCardCheckoutStatus({
      cardCheckout: pendingCheckout,
      sumupStatus: "CANCELLED",
      actorId: null,
      source: "poll-endpoint",
    });

    expect(result).toEqual({ outcome: "resolved", status: "CANCELLED" });
  });

  it.each(["FAILED", "REFUNDED", "CHARGE_BACK"] as const)(
    "maps SumUp status %s to a resolved FAILED outcome",
    async (sumupStatus) => {
      cardCheckoutUpdateMany.mockResolvedValue({ count: 1 });

      const result = await applyCardCheckoutStatus({
        cardCheckout: pendingCheckout,
        sumupStatus,
        actorId: null,
        source: "reconciliation-job",
      });

      expect(result).toEqual({ outcome: "resolved", status: "FAILED" });
    },
  );

  it("does not double-resolve or double-audit-log when it loses the race to a concurrent poll", async () => {
    cardCheckoutUpdateMany.mockResolvedValue({ count: 0 });
    cardCheckoutFindUnique.mockResolvedValue({ ...pendingCheckout, status: "SUCCESSFUL" } as never);

    const result = await applyCardCheckoutStatus({
      cardCheckout: pendingCheckout,
      sumupStatus: "SUCCESSFUL",
      actorId: null,
      source: "reconciliation-job",
    });

    expect(result).toEqual({ outcome: "already-resolved", status: "SUCCESSFUL" });
    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});
