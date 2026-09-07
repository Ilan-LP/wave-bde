import { describe, it, expect, vi, beforeEach } from "vitest";

const filesCreate = vi.fn();
const jwtMock = vi.fn();
const driveMock = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      JWT: vi.fn().mockImplementation((opts: unknown) => {
        jwtMock(opts);
        return { opts };
      }),
    },
    drive: vi.fn().mockImplementation((opts: unknown) => {
      driveMock(opts);
      return { files: { create: filesCreate } };
    }),
  },
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
  beforeEach(() => {
    vi.clearAllMocks();
    filesCreate.mockResolvedValue({ data: { id: "file-1" } });
  });

  it("authenticates with the service account and uploads the file to the configured folder", async () => {
    const { uploadJsonExport } = await import("../../jobs/googleDrive.js");

    await uploadJsonExport("test.json", [{ id: "log-1" }]);

    expect(jwtMock).toHaveBeenCalledWith({
      email: "service-account@example.iam.gserviceaccount.com",
      key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    expect(filesCreate).toHaveBeenCalledWith({
      requestBody: { name: "test.json", parents: ["folder-123"] },
      media: { mimeType: "application/json", body: JSON.stringify([{ id: "log-1" }]) },
      fields: "id",
    });
  });

  it("propagates a Drive API failure instead of swallowing it", async () => {
    filesCreate.mockRejectedValue(new Error("drive api down"));
    const { uploadJsonExport } = await import("../../jobs/googleDrive.js");

    await expect(uploadJsonExport("test.json", [])).rejects.toThrow("drive api down");
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
