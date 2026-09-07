import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getAccessToken = vi.fn();
const jwtMock = vi.fn();

vi.mock("google-auth-library", () => ({
  JWT: vi.fn().mockImplementation((opts: unknown) => {
    jwtMock(opts);
    return { getAccessToken };
  }),
}));

vi.mock("../../config/env.js", () => ({
  env: {
    googleServiceAccount: {
      client_email: "service-account@example.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
    },
    googleDriveFolderId: "folder-123",
  },
}));

describe("jobs/googleDrive uploadJsonExport", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue({ token: "access-token-1" });
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK", text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates with the service account and uploads the file to the configured folder", async () => {
    const { uploadJsonExport } = await import("../../jobs/googleDrive.js");

    await uploadJsonExport("test.json", [{ id: "log-1" }]);

    expect(jwtMock).toHaveBeenCalledWith({
      email: "service-account@example.iam.gserviceaccount.com",
      key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer access-token-1");
    expect(init.headers["Content-Type"]).toMatch(/^multipart\/related; boundary=/);
    expect(init.body).toContain(JSON.stringify({ name: "test.json", parents: ["folder-123"] }));
    expect(init.body).toContain(JSON.stringify([{ id: "log-1" }]));
  });

  it("throws when the Drive API responds with a non-OK status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
    });
    const { uploadJsonExport } = await import("../../jobs/googleDrive.js");

    await expect(uploadJsonExport("test.json", [])).rejects.toThrow(/Google Drive upload failed: 500/);
  });

  it("propagates a network failure instead of swallowing it", async () => {
    fetchMock.mockRejectedValue(new Error("drive api down"));
    const { uploadJsonExport } = await import("../../jobs/googleDrive.js");

    await expect(uploadJsonExport("test.json", [])).rejects.toThrow("drive api down");
  });

  it("throws when no access token is returned", async () => {
    getAccessToken.mockResolvedValue({ token: undefined });
    const { uploadJsonExport } = await import("../../jobs/googleDrive.js");

    await expect(uploadJsonExport("test.json", [])).rejects.toThrow(
      /failed to obtain a Google access token/,
    );
  });
});

describe("jobs/googleDrive credential validation", () => {
  it("throws a clear error when the service account JSON is missing client_email/private_key", async () => {
    vi.resetModules();
    vi.doMock("../../config/env.js", () => ({
      env: { googleServiceAccount: {}, googleDriveFolderId: "folder-123" },
    }));

    const { uploadJsonExport } = await import("../../jobs/googleDrive.js");

    await expect(uploadJsonExport("test.json", [])).rejects.toThrow(
      /client_email\/private_key/,
    );
  });
});
