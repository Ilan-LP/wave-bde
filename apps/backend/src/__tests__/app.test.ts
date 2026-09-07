import { describe, it, expect, vi, beforeEach } from "vitest";
import supertest from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { verifyDummyPassword } from "../lib/password.js";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("../lib/password.js", () => ({
  verifyPassword: vi.fn(),
  verifyDummyPassword: vi.fn(),
}));

const userFindUnique = vi.mocked(prisma.user.findUnique);
const verifyDummyPasswordMock = vi.mocked(verifyDummyPassword);

describe("createApp", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    userFindUnique.mockResolvedValue(null);
  });

  it("applies helmet security headers", async () => {
    const res = await supertest(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("returns 400 (not 500, no leaked detail) for a malformed JSON body", async () => {
    const res = await supertest(createApp())
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send("{not valid json");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad request" });
  });

  it("rate-limits /auth/login after the configured attempt count", async () => {
    const app = createApp();
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const res = await supertest(app)
        .post("/auth/login")
        .send({ email: "nobody@example.com", password: "whatever" });
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
    expect(verifyDummyPasswordMock).toHaveBeenCalledTimes(10);
  });
});
