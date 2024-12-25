import { Page, BrowserContext } from "playwright";

export interface BaseContext {
  userAgent: string;
  javaScriptEnabled: boolean;
  timezoneId: string;
  geolocation: {
    latitude: number;
    longitude: number;
  };
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

export type EvaluateResult = Omit<OrderData, "orderId">;
