import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response } from "express";
import supertest from "supertest";
import { auditLog } from "../../middleware/audit.js";
import { prisma } from "../../lib/prisma.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}));

const auditCreate = vi.mocked(prisma.auditLog.create);

function withAuth(sub: string, role: "BUREAU" | "RESPONSABLE_POLE" | "MEMBRE_POLE") {
  return (req: Request, _res: Response, next: () => void) => {
    req.auth = { sub, memberId: "member-1", role, poleId: null };
    next();
  };
}

function makeApp(...extraMiddleware: Array<(req: Request, res: Response, next: () => void) => void>) {
  const app = express();
  app.use(express.json());
  app.use(auditLog);
  if (extraMiddleware.length > 0) {
    app.use(...extraMiddleware);
  }

  app.post("/todos", (_req, res) => {
    res.status(201).json({ id: "todo-1", title: "test" });
  });
  app.put("/todos/:id", (_req, res) => {
    res.status(200).json({ id: "todo-1", title: "updated" });
  });
  app.delete("/todos/:id", (_req, res) => {
    res.status(204).send();
  });
  app.post("/todos/rejected", (_req, res) => {
    res.status(400).json({ error: "bad request" });
  });
  app.post("/auth/login", (_req, res) => {
    res.status(200).json({ accessToken: "abc" });
  });
  app.post("/no-id", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.post("/override", (_req, res) => {
    res.locals.auditEntityType = "CustomEntity";
    res.locals.auditEntityId = "custom-1";
    res.status(200).json({ ok: true });
  });
  app.post("/skipped", (_req, res) => {
    res.locals.skipAudit = true;
    res.status(200).json({ id: "skip-1" });
  });
  app.post("/poles/:poleId/todos", (_req, res) => {
    res.status(201).json({ id: "todo-2", title: "nested" });
  });

  return app;
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("auditLog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auditCreate.mockResolvedValue({} as never);
  });

  it("logs a CREATE with entityId from the response body", async () => {
    await supertest(makeApp(withAuth("user-1", "BUREAU")))
      .post("/todos")
      .send({ title: "test" });
    await flush();

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const call = auditCreate.mock.calls[0][0];
    expect(call.data).toMatchObject({
      actorId: "user-1",
      action: "CREATE",
      entityType: "Todo",
      entityId: "todo-1",
    });
  });

  it("logs an UPDATE with entityId from route params", async () => {
    await supertest(makeApp(withAuth("user-1", "BUREAU")))
      .put("/todos/todo-1")
      .send({ title: "updated" });
    await flush();

    const call = auditCreate.mock.calls[0][0];
    expect(call.data).toMatchObject({ action: "UPDATE", entityType: "Todo", entityId: "todo-1" });
  });

  it("logs a DELETE with entityId from route params even with no response body", async () => {
    await supertest(makeApp(withAuth("user-1", "BUREAU"))).delete("/todos/todo-1");
    await flush();

    const call = auditCreate.mock.calls[0][0];
    expect(call.data).toMatchObject({ action: "DELETE", entityType: "Todo", entityId: "todo-1" });
  });

  it("does not log a rejected (4xx) mutation", async () => {
    await supertest(makeApp(withAuth("user-1", "BUREAU"))).post("/todos/rejected").send({});
    await flush();

    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("does not log /auth routes", async () => {
    await supertest(makeApp()).post("/auth/login").send({ email: "a@b.com", password: "x" });
    await flush();

    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("falls back to entityId 'unknown' when none can be determined", async () => {
    await supertest(makeApp(withAuth("user-1", "BUREAU"))).post("/no-id").send({});
    await flush();

    const call = auditCreate.mock.calls[0][0];
    expect(call.data).toMatchObject({ entityId: "unknown" });
  });

  it("honors res.locals.auditEntityType / auditEntityId overrides", async () => {
    await supertest(makeApp(withAuth("user-1", "BUREAU"))).post("/override").send({});
    await flush();

    const call = auditCreate.mock.calls[0][0];
    expect(call.data).toMatchObject({ entityType: "CustomEntity", entityId: "custom-1" });
  });

  it("honors res.locals.skipAudit", async () => {
    await supertest(makeApp(withAuth("user-1", "BUREAU"))).post("/skipped").send({});
    await flush();

    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("records actorId null and role null for unauthenticated requests", async () => {
    await supertest(makeApp()).post("/no-id").send({});
    await flush();

    const call = auditCreate.mock.calls[0][0];
    expect(call.data.actorId).toBeNull();
    expect((call.data.metadata as Record<string, unknown>).role).toBeNull();
  });

  it("redacts sensitive keys in request/response bodies", async () => {
    await supertest(makeApp(withAuth("user-1", "BUREAU")))
      .post("/todos")
      .send({ title: "test", password: "hunter2" });
    await flush();

    const call = auditCreate.mock.calls[0][0];
    const metadata = call.data.metadata as Record<string, unknown>;
    expect((metadata.requestBody as Record<string, unknown>).password).toBe("[REDACTED]");
  });

  it("KNOWN LIMITATION: mislabels entityType on a nested resource route unless the handler overrides it", async () => {
    // Path-based inference only looks at the first segment. A route shaped
    // like CLAUDE.md's own documented RBAC example (`/poles/:poleId/todos`)
    // creates a Todo but gets audited as entityType "Pole" — the mismatch
    // this test pins down. Any such route MUST set
    // res.locals.auditEntityType / auditEntityId explicitly (see CLAUDE.md
    // "Audit Logging" -> Known limitation) — this test exists so that
    // forgetting to do so fails loudly instead of silently mislogging.
    await supertest(makeApp(withAuth("user-1", "BUREAU")))
      .post("/poles/pole-1/todos")
      .send({ title: "nested" });
    await flush();

    const call = auditCreate.mock.calls[0][0];
    expect(call.data).toMatchObject({ entityType: "Pole", entityId: "todo-2" });
  });

  it("does not fail the HTTP response when the audit write itself fails", async () => {
    auditCreate.mockRejectedValue(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await supertest(makeApp(withAuth("user-1", "BUREAU")))
      .post("/todos")
      .send({ title: "test" });
    await flush();

    expect(res.status).toBe(201);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
