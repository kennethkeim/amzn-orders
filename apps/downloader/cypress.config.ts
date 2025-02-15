import { defineConfig } from "cypress";
import { db } from "./src/db";
import { orderSchema } from "./src/db-schema";
import { desc, eq } from "drizzle-orm";
import type { Env, OrderData } from "./src/types";

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      on("task", {
        async getExistingOrders({ user }: { user: string }) {
          return await db
            .select({ id: orderSchema.id })
            .from(orderSchema)
            .where(eq(orderSchema.user, user))
            .orderBy(desc(orderSchema.created))
            .limit(50);
        },
        async saveOrderData({
          orders,
          env,
        }: {
          orders: OrderData[];
          env: Env;
        }) {
          // Use existing saveOrderData function
          await saveOrderData(orders, env);
          return null;
        },
      });
    },
  },
});
