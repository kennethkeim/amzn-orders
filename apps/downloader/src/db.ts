import "dotenv/config";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./db-schema";
import { createClient } from "@libsql/client";

export const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_TOKEN!,
});

export const db = drizzle(client, { schema });
