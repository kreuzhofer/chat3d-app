import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config } from "../config.js";

const connectionString = `postgresql://${config.db.user}:${encodeURIComponent(config.db.password)}@${config.db.host}:${config.db.port}/${config.db.database}${config.db.ssl ? "?sslmode=require" : ""}`;

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
