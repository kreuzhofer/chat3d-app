import { defineConfig } from "prisma/config";

const host = process.env.DB_HOST || "localhost";
const port = process.env.DB_PORT || "5432";
const user = process.env.DB_USER || "chat3d";
const password = encodeURIComponent(process.env.DB_PASSWORD || "chat3d_dev");
const database = process.env.DB_NAME || "chat3d";
const ssl = process.env.DB_SSL === "true" ? "?sslmode=require" : "";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: `postgresql://${user}:${password}@${host}:${port}/${database}${ssl}`,
  },
});
