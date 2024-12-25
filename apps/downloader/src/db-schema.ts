import { sql } from "drizzle-orm";
import { int, sqliteTable, text, real } from "drizzle-orm/sqlite-core";

const created = int("created", { mode: "timestamp" })
  .$default(() => new Date())
  .notNull();

export const orders = sqliteTable(
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

export const items = sqliteTable(
  "item",
  {
    id: int().primaryKey({ autoIncrement: true }),
    orderId: text()
      .notNull()
      .references(() => orders.id),
    name: text().notNull(),
    price: real().notNull(),
    created,
  },
  () => []
);

export const transactions = sqliteTable(
  "transaction",
  {
    id: int().primaryKey({ autoIncrement: true }),
    orderId: text()
      .notNull()
      .references(() => orders.id),
    type: text().notNull(),
    last4: text().notNull(),
    amount: real().notNull(),
    created,
  },
  () => []
);
