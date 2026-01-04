import { logger } from "./logger";

export const wait = async (min = 1000, max = 3000): Promise<void> => {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise((resolve) => setTimeout(resolve, delay));
  logger.debug(`Waited for ${delay}ms`);
};

export const getOrderUrl = (orderId: string): string => {
  return `https://www.amazon.com/gp/css/summary/print.html?orderID=${orderId}`;
};
