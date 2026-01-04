import { InferSelectModel } from "drizzle-orm";
import { budgetLineItems, budgetOrders, budgetTransactions } from "./db-schema";

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
  photo?: string;
  productLink?: string;
}

export interface Transaction {
  date: string;
  amount: number | null;
  paymentMethod: string | null;
}

export interface OrderData {
  orderId: string;
  orderDate: string | null;
  items: OrderItem[];
  total: number;
  transactions: Transaction[];
}

export type OrderCardData = InferSelectModel<typeof budgetOrders> & {
  items: InferSelectModel<typeof budgetLineItems>[];
  transactions: InferSelectModel<typeof budgetTransactions>[];
};

export type EvaluateResult = Omit<OrderData, "orderId">;
