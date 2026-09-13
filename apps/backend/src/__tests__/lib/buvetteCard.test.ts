import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { applyCardCheckoutStatus, recheckForcedCancellation } from "../../lib/buvetteCard.js";

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
  forcedCancelAt: null,
  forcedCancelRecheckedAt: null,
  metadata: null,
  createdAt: new Date(),
  resolvedAt: null,
};

const cancelledCheckout = {
  ...pendingCheckout,
  status: "CANCELLED" as const,
  forcedCancelAt: new Date(),
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

  it("stamps forcedCancelAt and flags the audit log when forcedCancel is true and the result is CANCELLED", async () => {
    cardCheckoutUpdateMany.mockResolvedValue({ count: 1 });

    const result = await applyCardCheckoutStatus({
      cardCheckout: pendingCheckout,
      sumupStatus: "CANCELLED",
      actorId: null,
      source: "poll-endpoint",
      forcedCancel: true,
    });

    expect(result).toEqual({ outcome: "resolved", status: "CANCELLED" });
    expect(cardCheckoutUpdateMany).toHaveBeenCalledWith({
      where: { id: "card-1", status: "PENDING" },
      data: { status: "CANCELLED", resolvedAt: expect.any(Date), forcedCancelAt: expect.any(Date) },
    });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: expect.objectContaining({ forcedCancel: true }) }),
      }),
    );
  });

  it("does not stamp forcedCancelAt when forcedCancel is true but the result isn't CANCELLED", async () => {
    cardCheckoutUpdateMany.mockResolvedValue({ count: 1 });

    await applyCardCheckoutStatus({
      cardCheckout: pendingCheckout,
      sumupStatus: "SUCCESSFUL",
      actorId: null,
      source: "poll-endpoint",
      forcedCancel: true,
    });

    expect(cardCheckoutUpdateMany).toHaveBeenCalledWith({
      where: { id: "card-1", status: "PENDING" },
      data: { status: "SUCCESSFUL", resolvedAt: expect.any(Date) },
    });
  });
});

describe("recheckForcedCancellation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auditLogCreate.mockResolvedValue({} as never);
  });

  it("confirms the cancellation and audit-logs it (not flagged) when SumUp still shows no charge", async () => {
    cardCheckoutUpdateMany.mockResolvedValue({ count: 1 });

    const result = await recheckForcedCancellation({
      cardCheckout: cancelledCheckout,
      sumupStatus: "FAILED",
    });

    expect(result).toEqual({ outcome: "confirmed-cancelled" });
    expect(cardCheckoutUpdateMany).toHaveBeenCalledWith({
      where: { id: "card-1", status: "CANCELLED", forcedCancelRecheckedAt: null },
      data: { forcedCancelRecheckedAt: expect.any(Date) },
    });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ needsManualReview: false, newStatus: "CANCELLED" }),
        }),
      }),
    );
  });

  it("corrects to SUCCESSFUL and audit-logs it flagged for manual review when SumUp shows the charge completed", async () => {
    cardCheckoutUpdateMany.mockResolvedValue({ count: 1 });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await recheckForcedCancellation({
      cardCheckout: cancelledCheckout,
      sumupStatus: "SUCCESSFUL",
    });

    expect(result).toEqual({ outcome: "corrected-to-successful" });
    expect(cardCheckoutUpdateMany).toHaveBeenCalledWith({
      where: { id: "card-1", status: "CANCELLED", forcedCancelRecheckedAt: null },
      data: { forcedCancelRecheckedAt: expect.any(Date), status: "SUCCESSFUL", resolvedAt: expect.any(Date) },
    });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ needsManualReview: true, newStatus: "SUCCESSFUL" }),
        }),
      }),
    );
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("FORCED-CANCEL CORRECTION"));

    consoleError.mockRestore();
  });

  it("does not double-recheck or double-audit-log when it loses the race to a concurrent run", async () => {
    cardCheckoutUpdateMany.mockResolvedValue({ count: 0 });

    const result = await recheckForcedCancellation({
      cardCheckout: cancelledCheckout,
      sumupStatus: "SUCCESSFUL",
    });

    expect(result).toEqual({ outcome: "already-rechecked" });
    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});
