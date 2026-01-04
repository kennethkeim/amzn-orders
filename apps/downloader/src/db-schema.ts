import { relations } from "drizzle-orm";
import { int, sqliteTableCreator, text, real } from "drizzle-orm/sqlite-core";

// :::::::::::::::::::::::::::::::::: Budget ::::::::::::::::::::::::::::::::::

export const createBudgetTable = sqliteTableCreator((name) => `budget_${name}`);

export const budgetOrders = createBudgetTable(
  "order",
  {
    id: text().notNull().primaryKey(),
    orderDate: int("order_date", { mode: "timestamp" }),
    total: real(),
    user: text().notNull(),
    detailsLink: text("details_link"),
    created: int("created", { mode: "timestamp" })
      .$default(() => new Date())
      .notNull(),
    updated: int("updated", { mode: "timestamp" }).notNull(),
  },
  () => []
);

export const budgetLineItems = createBudgetTable(
  "line_item",
  {
    id: int().primaryKey({ autoIncrement: true }),
    orderId: text("order_id")
      .notNull()
      .references(() => budgetOrders.id, { onDelete: "cascade" }),
    productLink: text("product_link"),
    photo: text(),
    name: text().notNull(),
    price: real(),
    created: int("created", { mode: "timestamp" })
      .$default(() => new Date())
      .notNull(),
  },
  () => []
);

export const budgetTransactions = createBudgetTable(
  "transaction",
  {
    id: int().primaryKey({ autoIncrement: true }),
    orderId: text("order_id")
      .notNull()
      .references(() => budgetOrders.id, { onDelete: "cascade" }),
    date: int({ mode: "timestamp" }).notNull(),
    paymentMethod: text("payment_method").notNull(),
    isRefund: int("is_refund", { mode: "boolean" }).notNull(),
    amount: real().notNull(),
    syncedToBudget: int("synced_to_budget", { mode: "boolean" }),
    created: int("created", { mode: "timestamp" })
      .$default(() => new Date())
      .notNull(),
  },
  () => []
);

export const budgetOrdersRelations = relations(budgetOrders, ({ many }) => ({
  lineItems: many(budgetLineItems),
  transactions: many(budgetTransactions),
}));

export const budgetLineItemsRelations = relations(
  budgetLineItems,
  ({ one }) => ({
    order: one(budgetOrders, {
      fields: [budgetLineItems.orderId],
      references: [budgetOrders.id],
    }),
  })
);

export const budgetTransactionsRelations = relations(
  budgetTransactions,
  ({ one }) => ({
    order: one(budgetOrders, {
      fields: [budgetTransactions.orderId],
      references: [budgetOrders.id],
    }),
  })
);
