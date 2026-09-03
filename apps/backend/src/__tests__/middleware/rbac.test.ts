import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type RequestHandler } from "express";
import supertest from "supertest";
import { signAccessToken } from "../../lib/jwt.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole, requirePoleAccess } from "../../middleware/rbac.js";
import { prisma } from "../../lib/prisma.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    poleAccessGrant: {
      findUnique: vi.fn(),
    },
  },
}));

const grantFindUnique = vi.mocked(prisma.poleAccessGrant.findUnique);

function makeToken(
  overrides: Partial<{
    sub: string;
    memberId: string;
    role: "BUREAU" | "RESPONSABLE_POLE" | "MEMBRE_POLE";
    poleId: string | null;
  }> = {},
) {
  return signAccessToken({
    sub: "user-1",
    memberId: "member-1",
    role: "BUREAU",
    poleId: null,
    ...overrides,
  });
}

function makeApp(...middleware: RequestHandler[]) {
  const app = express();
  app.use(express.json());
  const ok: RequestHandler = (_req, res) => {
    res.status(200).json({ ok: true });
  };
  app.get("/test", ...middleware, ok);
  app.get("/poles/:poleId/data", ...middleware, ok);
  return app;
}

describe("authenticate", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await supertest(makeApp(authenticate)).get("/test");
    expect(res.status).toBe(401);
  });

  it("returns 401 when header is not Bearer scheme", async () => {
    const res = await supertest(makeApp(authenticate))
      .get("/test")
      .set("Authorization", "Basic dXNlcjpwYXNz");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid token string", async () => {
    const res = await supertest(makeApp(authenticate))
      .get("/test")
      .set("Authorization", "Bearer not.a.real.token");
    expect(res.status).toBe(401);
  });

  it("passes with a valid access token", async () => {
    const res = await supertest(makeApp(authenticate))
      .get("/test")
      .set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
  });
});

describe("requireRole", () => {
  it("returns 403 when MEMBRE_POLE accesses a BUREAU-only route", async () => {
    const res = await supertest(makeApp(authenticate, requireRole("BUREAU")))
      .get("/test")
      .set("Authorization", `Bearer ${makeToken({ role: "MEMBRE_POLE" })}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 when MEMBRE_POLE accesses a RESPONSABLE_POLE-only route", async () => {
    const res = await supertest(makeApp(authenticate, requireRole("RESPONSABLE_POLE")))
      .get("/test")
      .set("Authorization", `Bearer ${makeToken({ role: "MEMBRE_POLE" })}`);
    expect(res.status).toBe(403);
  });

  it("allows RESPONSABLE_POLE on a matching route", async () => {
    const res = await supertest(makeApp(authenticate, requireRole("RESPONSABLE_POLE")))
      .get("/test")
      .set("Authorization", `Bearer ${makeToken({ role: "RESPONSABLE_POLE", poleId: "pole-1" })}`);
    expect(res.status).toBe(200);
  });

  it("allows MEMBRE_POLE on a route that lists MEMBRE_POLE", async () => {
    const res = await supertest(
      makeApp(authenticate, requireRole("RESPONSABLE_POLE", "MEMBRE_POLE")),
    )
      .get("/test")
      .set("Authorization", `Bearer ${makeToken({ role: "MEMBRE_POLE", poleId: "pole-1" })}`);
    expect(res.status).toBe(200);
  });

  it("BUREAU bypasses requireRole even when not listed", async () => {
    const res = await supertest(makeApp(authenticate, requireRole("RESPONSABLE_POLE")))
      .get("/test")
      .set("Authorization", `Bearer ${makeToken({ role: "BUREAU" })}`);
    expect(res.status).toBe(200);
  });
});

describe("requirePoleAccess", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("BUREAU bypasses pole check without hitting the DB", async () => {
    const res = await supertest(makeApp(authenticate, requirePoleAccess()))
      .get("/poles/any-pole/data")
      .set("Authorization", `Bearer ${makeToken({ role: "BUREAU" })}`);
    expect(res.status).toBe(200);
    expect(grantFindUnique).not.toHaveBeenCalled();
  });

  it("allows a member accessing their own pole without hitting the DB", async () => {
    const res = await supertest(makeApp(authenticate, requirePoleAccess()))
      .get("/poles/pole-1/data")
      .set("Authorization", `Bearer ${makeToken({ role: "MEMBRE_POLE", poleId: "pole-1" })}`);
    expect(res.status).toBe(200);
    expect(grantFindUnique).not.toHaveBeenCalled();
  });

  it("RESPONSABLE_POLE is allowed on their own pole without hitting the DB", async () => {
    const res = await supertest(makeApp(authenticate, requirePoleAccess()))
      .get("/poles/pole-1/data")
      .set("Authorization", `Bearer ${makeToken({ role: "RESPONSABLE_POLE", poleId: "pole-1" })}`);
    expect(res.status).toBe(200);
    expect(grantFindUnique).not.toHaveBeenCalled();
  });

  it("returns 403 when member accesses a foreign pole with no grant", async () => {
    grantFindUnique.mockResolvedValue(null);
    const res = await supertest(makeApp(authenticate, requirePoleAccess()))
      .get("/poles/pole-2/data")
      .set("Authorization", `Bearer ${makeToken({ role: "MEMBRE_POLE", poleId: "pole-1" })}`);
    expect(res.status).toBe(403);
  });

  it("allows member on foreign pole with an active grant (no expiry)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    grantFindUnique.mockResolvedValue({ expiresAt: null } as any);
    const res = await supertest(makeApp(authenticate, requirePoleAccess()))
      .get("/poles/pole-2/data")
      .set("Authorization", `Bearer ${makeToken({ role: "MEMBRE_POLE", poleId: "pole-1" })}`);
    expect(res.status).toBe(200);
  });

  it("allows member on foreign pole with an active grant (future expiry)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    grantFindUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 86_400_000) } as any);
    const res = await supertest(makeApp(authenticate, requirePoleAccess()))
      .get("/poles/pole-2/data")
      .set("Authorization", `Bearer ${makeToken({ role: "MEMBRE_POLE", poleId: "pole-1" })}`);
    expect(res.status).toBe(200);
  });

  it("returns 403 when the grant is expired", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    grantFindUnique.mockResolvedValue({ expiresAt: new Date(Date.now() - 3_600_000) } as any);
    const res = await supertest(makeApp(authenticate, requirePoleAccess()))
      .get("/poles/pole-2/data")
      .set("Authorization", `Bearer ${makeToken({ role: "MEMBRE_POLE", poleId: "pole-1" })}`);
    expect(res.status).toBe(403);
  });

  it("RESPONSABLE_POLE can access a foreign pole if granted", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    grantFindUnique.mockResolvedValue({ expiresAt: null } as any);
    const res = await supertest(makeApp(authenticate, requirePoleAccess()))
      .get("/poles/pole-2/data")
      .set("Authorization", `Bearer ${makeToken({ role: "RESPONSABLE_POLE", poleId: "pole-1" })}`);
    expect(res.status).toBe(200);
  });
});
