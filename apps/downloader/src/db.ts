import "dotenv/config";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./db-schema";
import { createClient, LibsqlError } from "@libsql/client";

export const client = createClient({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_TOKEN!,
});

export const db = drizzle(client, { schema });

/** https://sqlite.org/rescode.html */
export enum SQLiteErrorCode {
  FkViolation = "SQLITE_CONSTRAINT",
}

export function getLibsqlError(error: unknown): LibsqlError | null {
  if (error instanceof LibsqlError) {
    return error;
  }

  // This is the expected case - DrizzleQueryError usually wraps the driver error
  if (error instanceof Error && error.cause instanceof LibsqlError) {
    return error.cause;
  }

  return null;
}
