import "./config/env.js";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

const app = createApp();
const port = process.env.PORT ?? 3000;

const server = app.listen(port, () => {
  console.log(`Wave backend listening on port ${port}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    prisma
      .$disconnect()
      .catch((err: unknown) => console.error("error disconnecting prisma", err))
      .finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
