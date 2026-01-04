import { logger } from "./logger";
import { Mailer, emailError } from "@kennethkeim/api-utils-core";

const mailerApiKeyExists = Boolean(process.env["MAILER_API_KEY"]);

export const wait = async (min = 1000, max = 3000): Promise<void> => {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise((resolve) => setTimeout(resolve, delay));
  logger.debug(`Waited for ${delay}ms`);
};

export const getOrderUrl = (orderId: string): string => {
  return `https://www.amazon.com/gp/css/summary/print.html?orderID=${orderId}`;
};

export const handleError = (error: unknown, message?: string): void => {
  // Log the error
  if (message) logger.error(message);
  logger.error(error instanceof Error ? error.message : String(error));

  // Report it
  if (mailerApiKeyExists) {
    const mailer = new Mailer("Amazon Order Scraper");

    emailError(error, mailer).catch((e) => {
      logger.error("💀 Failed to report error via email");
      logger.error(e);
    });
  }
};
