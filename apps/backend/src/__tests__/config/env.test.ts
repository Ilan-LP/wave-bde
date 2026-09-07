import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
const ORIGINAL_JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

describe("config/env", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
    process.env.JWT_REFRESH_SECRET = ORIGINAL_JWT_REFRESH_SECRET;
  });

  it("throws when JWT_SECRET is missing", async () => {
    delete process.env.JWT_SECRET;
    process.env.JWT_REFRESH_SECRET = "a-refresh-secret-32-chars-min-xx";

    await expect(import("../../config/env.js")).rejects.toThrow(/JWT_SECRET/);
  });

  it("throws when JWT_SECRET is empty", async () => {
    process.env.JWT_SECRET = "";
    process.env.JWT_REFRESH_SECRET = "a-refresh-secret-32-chars-min-xx";

    await expect(import("../../config/env.js")).rejects.toThrow(/JWT_SECRET/);
  });

  it("throws when JWT_REFRESH_SECRET is missing", async () => {
    process.env.JWT_SECRET = "an-access-secret-32-chars-min-xxx";
    delete process.env.JWT_REFRESH_SECRET;

    await expect(import("../../config/env.js")).rejects.toThrow(/JWT_REFRESH_SECRET/);
  });

  it("throws when both secrets are identical", async () => {
    process.env.JWT_SECRET = "same-value-32-characters-long-xxx";
    process.env.JWT_REFRESH_SECRET = "same-value-32-characters-long-xxx";

    await expect(import("../../config/env.js")).rejects.toThrow(/must not be the same/);
  });

  it("does not throw when both secrets are present and distinct", async () => {
    process.env.JWT_SECRET = "an-access-secret-32-chars-min-xxx";
    process.env.JWT_REFRESH_SECRET = "a-refresh-secret-32-chars-min-xx";

    await expect(import("../../config/env.js")).resolves.toBeDefined();
  });
});
