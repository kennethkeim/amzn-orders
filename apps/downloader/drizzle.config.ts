import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db-schema.ts",
  out: "./drizzle",
  dialect: "turso",
  tablesFilter: ["budget_*"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_TOKEN!,
  },
});
