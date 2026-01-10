import { desc } from "drizzle-orm";
import { db, getLibsqlError, SQLiteErrorCode } from "./db";
import { budgetLineItems, budgetOrders, budgetTransactions } from "./db-schema";
import { logger } from "./logger";
import type {
  OrderData,
  Env,
  NewItem,
  NewOrder,
  NewTx,
  Transaction,
} from "./types";
import { getOrderUrl } from "./utils";

export const saveOrderData = async (
  newOrders: OrderData[],
  env: Env
): Promise<void> => {
  const ordersToInsert = newOrders.map<NewOrder>((o) => ({
    id: o.orderId,
    orderDate: o.orderDate ? new Date(o.orderDate) : null,
    total: o.total,
    updated: new Date(),
    user: env.name,
    detailsLink: getOrderUrl(o.orderId),
  }));

  const itemsToInsert = newOrders
    .map((o) => {
      return o.items.map<NewItem>((i) => ({
        orderId: o.orderId,
        name: i.name,
        price: i.price,
        photo: i.photo,
        productLink: i.productLink,
      }));
    })
    .flat();

  await db.transaction(async (tx) => {
    if (ordersToInsert.length) {
      await tx.insert(budgetOrders).values(ordersToInsert);
    }
    if (itemsToInsert.length) {
      await tx.insert(budgetLineItems).values(itemsToInsert);
    }
  });
};

export const saveTransactions = async (
  transactions: Transaction[]
): Promise<void> => {
  const txToInsert = transactions.map<NewTx>((t) => ({
    orderId: t.orderId,
    date: new Date(t.date),
    amount: t.amount,
    isRefund: t.isRefund,
    paymentMethod: t.paymentMethod,
  }));

  // Query 100 most recent transactions to filter out duplicates
  const recentTxs = await db
    .select()
    .from(budgetTransactions)
    .orderBy(desc(budgetTransactions.created))
    .limit(100);

  // Filter out transactions that already exist
  const newTransactions = txToInsert.filter((tx) => {
    return !recentTxs.some(
      (existing) =>
        existing.orderId === tx.orderId &&
        existing.date.getTime() === tx.date.getTime() &&
        existing.amount === tx.amount &&
        existing.paymentMethod === tx.paymentMethod &&
        existing.isRefund === tx.isRefund
    );
  });

  const existingCount = txToInsert.length - newTransactions.length;
  logger.info(
    `${newTransactions.length} txns are new and ${existingCount} are existing`
  );

  if (!newTransactions.length) {
    logger.info("No new transactions to insert");
    return;
  }

  let inserted = 0;
  for (const txnRow of newTransactions) {
    try {
      // onConflictDoNothing as safety net for duplicates beyond 100 most recent
      // conflict target is the unique index defined in db schema
      await db.insert(budgetTransactions).values(txnRow).onConflictDoNothing();
      inserted++;
    } catch (error) {
      const libsqlErr = getLibsqlError(error);

      if (libsqlErr?.code === SQLiteErrorCode.FkViolation) {
        logger.warn(
          `Skipped transaction due to missing order ${txnRow.orderId}`
        );
      } else {
        throw error;
      }
    }
  }

  logger.info(`✔️ Inserted ${inserted} transactions`);
};
