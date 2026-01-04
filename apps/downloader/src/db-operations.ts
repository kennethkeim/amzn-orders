import { db } from "./db";
import { budgetLineItems, budgetOrders, budgetTransactions } from "./db-schema";
import type { OrderData, Env, NewItem, NewOrder, NewTx } from "./types";
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

  const txToInsert = newOrders
    .map((o) => {
      return o.transactions.map<NewTx>((tx) => ({
        orderId: o.orderId,
        date: new Date(tx.date),
        amount: tx.amount ?? 0,
        isRefund: false,
        paymentMethod: tx.paymentMethod ?? "",
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
    if (txToInsert.length) {
      await tx.insert(budgetTransactions).values(txToInsert);
    }
  });
};
