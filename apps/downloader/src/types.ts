import { InferInsertModel, InferSelectModel } from "drizzle-orm";
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
  orderId: string;
  isRefund: boolean;
}

export interface OrderData {
  orderId: string;
  orderDate: string | null;
  items: OrderItem[];
  total: number;
}

export type OrderCardData = InferSelectModel<typeof budgetOrders> & {
  items: InferSelectModel<typeof budgetLineItems>[];
  transactions: InferSelectModel<typeof budgetTransactions>[];
};

export type EvaluateResult = Omit<OrderData, "orderId">;

// Define types for inserting into tables
export type NewOrder = InferInsertModel<typeof budgetOrders>;
export type NewItem = InferInsertModel<typeof budgetLineItems>;
export type NewTx = InferInsertModel<typeof budgetTransactions>;
