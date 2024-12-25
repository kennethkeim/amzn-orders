import { sql } from "drizzle-orm";
import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const orders = sqliteTable(
  "order",
  {
    id: text().notNull().primaryKey(),
    orderDate: int("orderDate", { mode: "timestamp" }),
    created: int("created", { mode: "timestamp" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: int("updated", { mode: "timestamp" }).notNull(),
    total: int(),
  },
  () => []
);
