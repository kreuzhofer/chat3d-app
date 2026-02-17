import { Pool } from "pg";
import { config } from "../config.js";

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
});

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}
