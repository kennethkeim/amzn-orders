import { InferSelectModel } from "drizzle-orm";
import { itemSchema, orderSchema, transactionSchema } from "./db-schema";

export interface Env {
  /** Amazon account email */
  email: string;
  /** Amazon account password */
  password: string;
  /** Name shown in Amazon navbar message - e.g. "Hello, {name}" */
  name: string;
}

export interface OrderItem {
  name: string;
  price: number;
}

export interface Transaction {
  type: string | null;
  last4: string | null;
  amount: number | null;
}

export interface OrderData {
  orderId: string;
  orderDate: string | null;
  items: OrderItem[];
  total: number;
  transactions: Transaction[];
}

export type OrderCardData = InferSelectModel<typeof orderSchema> & {
  items: InferSelectModel<typeof itemSchema>[];
  transactions: InferSelectModel<typeof transactionSchema>[];
};

export type EvaluateResult = Omit<OrderData, "orderId">;
