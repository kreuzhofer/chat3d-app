import express from "express";
import { config } from "./config.js";
import { query } from "./db/connection.js";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "backend" });
});

app.get("/ready", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.status(200).json({ status: "ready" });
  } catch (error) {
    res.status(503).json({ status: "not_ready", error: String(error) });
  }
});

app.listen(config.port, () => {
  console.log(`[backend] listening on ${config.port}`);
});
