import "./config/env.js";
import express from "express";
import { authRouter } from "./routes/auth.js";

const app = express();
const port = process.env.PORT ?? 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);

app.listen(port, () => {
  console.log(`Wave backend listening on port ${port}`);
});
