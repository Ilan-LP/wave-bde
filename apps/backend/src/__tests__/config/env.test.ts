import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
const ORIGINAL_JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ORIGINAL_GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const ORIGINAL_GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const ORIGINAL_SUMUP_CLIENT_ID = process.env.SUMUP_CLIENT_ID;
const ORIGINAL_SUMUP_CLIENT_SECRET = process.env.SUMUP_CLIENT_SECRET;
const ORIGINAL_SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE;

describe("config/env", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
    process.env.JWT_REFRESH_SECRET = ORIGINAL_JWT_REFRESH_SECRET;
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = ORIGINAL_GOOGLE_SERVICE_ACCOUNT_JSON;
    process.env.GOOGLE_DRIVE_FOLDER_ID = ORIGINAL_GOOGLE_DRIVE_FOLDER_ID;
    process.env.SUMUP_CLIENT_ID = ORIGINAL_SUMUP_CLIENT_ID;
    process.env.SUMUP_CLIENT_SECRET = ORIGINAL_SUMUP_CLIENT_SECRET;
    process.env.SUMUP_MERCHANT_CODE = ORIGINAL_SUMUP_MERCHANT_CODE;
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

  it("boots with GOOGLE_SERVICE_ACCOUNT_JSON/GOOGLE_DRIVE_FOLDER_ID unset, marking Drive export unconfigured", async () => {
    process.env.JWT_SECRET = "an-access-secret-32-chars-min-xxx";
    process.env.JWT_REFRESH_SECRET = "a-refresh-secret-32-chars-min-xx";
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_DRIVE_FOLDER_ID;

    const { env } = await import("../../config/env.js");

    expect(env.googleServiceAccount).toBeUndefined();
    expect(env.googleDriveFolderId).toBeUndefined();
    expect(env.isGoogleDriveConfigured).toBe(false);
  });

  it("boots with SUMUP_CLIENT_ID/SUMUP_CLIENT_SECRET/SUMUP_MERCHANT_CODE unset, marking recharge unconfigured", async () => {
    process.env.JWT_SECRET = "an-access-secret-32-chars-min-xxx";
    process.env.JWT_REFRESH_SECRET = "a-refresh-secret-32-chars-min-xx";
    delete process.env.SUMUP_CLIENT_ID;
    delete process.env.SUMUP_CLIENT_SECRET;
    delete process.env.SUMUP_MERCHANT_CODE;

    const { env } = await import("../../config/env.js");

    expect(env.sumupClientId).toBeUndefined();
    expect(env.sumupClientSecret).toBeUndefined();
    expect(env.sumupMerchantCode).toBeUndefined();
    expect(env.isSumUpConfigured).toBe(false);
  });
});
