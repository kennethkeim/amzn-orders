import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { orderSchema, itemSchema, transactionSchema } from "./db-schema";
import { OrderCardData } from "./types";

const main = async (): Promise<void> => {
  const rawResults = await db
    .select({
      order: orderSchema,
      item: itemSchema,
      transaction: transactionSchema,
    })
    .from(orderSchema)
    .leftJoin(itemSchema, eq(itemSchema.orderId, orderSchema.id))
    .leftJoin(transactionSchema, eq(transactionSchema.orderId, orderSchema.id))
    .orderBy(desc(orderSchema.orderDate))
    .limit(50);

  // Group the results by order
  const orders = rawResults.reduce((acc, row) => {
    const order = acc.get(row.order.id) ?? {
      ...row.order,
      items: [],
      transactions: [],
    };

    if (row.item?.name) {
      if (!order.items.some((i) => i.name === row.item?.name)) {
        order.items.push(row.item);
      }
    }

    if (row.transaction?.type) {
      if (
        !order.transactions.some((t) => t.amount === row.transaction?.amount)
      ) {
        order.transactions.push(row.transaction);
      }
    }

    acc.set(row.order.id, order);
    return acc;
  }, new Map<string, OrderCardData>());

  const structuredOrders = Array.from(orders.values());

  structuredOrders.forEach((order) => {
    const d = order.orderDate;
    const month = (d?.getMonth() ?? 0) + 1;
    const date = `${month}/${d?.getDate()}/${d?.getFullYear()}`;

    const tx =
      order.transactions.map((t) => `${t.amount}`).join(", ") ||
      `${order.total}`;

    console.group(`\n${date} | ${order.user} | ${tx}`);
    order.items.forEach((item) => {
      console.log(`${item.price} - ${item.name.slice(0, 100)}`);
    });
    console.groupEnd();
  });
};

main().catch((error: unknown) => {
  console.error(
    "Script failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
