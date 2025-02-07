import { int, text, real, sqliteTableCreator } from "drizzle-orm/sqlite-core";

export const createTable = sqliteTableCreator((name) => `keimdigital_${name}`);

const created = int("created", { mode: "timestamp" })
  .$default(() => new Date())
  .notNull();

export const orderSchema = createTable(
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

export const itemSchema = createTable(
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

export const transactionSchema = createTable(
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
