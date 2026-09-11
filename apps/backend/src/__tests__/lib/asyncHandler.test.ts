import { describe, it, expect, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";

describe("asyncHandler", () => {
  it("calls next() with the rejection reason instead of leaving it unhandled", async () => {
    const err = new Error("boom");
    const handler = asyncHandler(async () => {
      throw err;
    });
    const next = vi.fn();

    await handler({} as Request, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(err);
  });

  it("does not call next() when the handler resolves normally", async () => {
    const handler = asyncHandler(async (_req, res) => {
      res.json({ ok: true });
    });
    const next = vi.fn();
    const res = { json: vi.fn() } as unknown as Response;

    await handler({} as Request, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});
