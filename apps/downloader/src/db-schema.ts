import { sql } from "drizzle-orm";
import { int, sqliteTable, text, real } from "drizzle-orm/sqlite-core";

const created = int("created", { mode: "timestamp" })
  .$default(() => new Date())
  .notNull();

export const orderSchema = sqliteTable(
  "order",
  {
    id: text().notNull().primaryKey(),
    orderDate: int("orderDate", { mode: "timestamp" }),
    created,
    updated: int("updated", { mode: "timestamp" }).notNull(),
    total: real().notNull(),
    user: text().notNull(),
  },
  () => []
);

export const itemSchema = sqliteTable(
  "item",
  {
    id: int().primaryKey({ autoIncrement: true }),
    orderId: text()
      .notNull()
      .references(() => orderSchema.id),
    name: text().notNull(),
    price: real().notNull(),
    created,
  },
  () => []
);

export const transactionSchema = sqliteTable(
  "transaction",
  {
    id: int().primaryKey({ autoIncrement: true }),
    orderId: text()
      .notNull()
      .references(() => orderSchema.id),
    type: text().notNull(),
    last4: text().notNull(),
    amount: real().notNull(),
    created,
  },
  () => []
);
