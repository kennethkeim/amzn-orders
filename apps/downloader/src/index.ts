import path from "path";
import { config } from "dotenv";
config({ path: path.join(__dirname, "..", ".env") });

import puppeteer, { Page, Browser } from "puppeteer";
import { OrderData, Env, Transaction } from "./types";
import { db } from "./db";
import { budgetOrders } from "./db-schema";
import { desc } from "drizzle-orm";
import { green } from "picocolors";
import {
  getRecentOrderIds,
  parseOrderDetailsFromPage,
} from "./parse-order-data";
import { logger } from "./logger";
import { getOrderUrl, handleError, wait } from "./utils";
import { saveOrderData } from "./db-operations";
import {
  handlePasswordReconfirmation,
  isLoggedIn,
  login,
} from "./amazon-login";
import { CustomError, ServiceError } from "@kennethkeim/core";
import { parseTransactionsFromPage } from "./parse-transactions";

const APP_DIR = path.join(__dirname, "..");

type MockMode = "orders" | "transactions";
let MOCK: MockMode | null = process.argv.includes("--mock-orders")
  ? "orders"
  : null;
if (process.argv.includes("--mock-transactions")) {
  MOCK = "transactions";
}
const HEADLESS = process.argv.includes("--headless");
logger.info(`Mock mode: ${MOCK}`);

const TX_PAGE = "https://www.amazon.com/cpe/yourpayments/transactions";
const ORDERS_PAGE = "https://www.amazon.com/gp/your-account/order-history";
const MOCK_PAGE = "http://localhost:4200";

const extractDataFromInvoice = async (
  page: Page,
  orderId: string
): Promise<OrderData | null> => {
  try {
    // Navigate to invoice page with random delay
    if (!MOCK) {
      await wait(2000, 4000);
      const invoiceUrl = getOrderUrl(orderId);

      await page.goto(invoiceUrl);
      await wait(1000, 2000);
    }

    // Pass the function directly to page.evaluate
    // Otherwise there's weird serialization issues
    const orderData = await page.evaluate(parseOrderDetailsFromPage);

    if (!orderData?.orderDate) {
      logger.warn(`Missing order data ${JSON.stringify(orderData)}`);
      return null;
    }

    return { orderId, ...orderData };
  } catch (cause) {
    handleError(
      new ServiceError(500, `Failed to extract data for order ${orderId}`, {
        cause,
      })
    );
    return null;
  }
};

const extractTransactions = async (
  page: Page,
  env: Env
): Promise<Transaction[]> => {
  try {
    const transactions = await page.evaluate(parseTransactionsFromPage);

    transactions.forEach((txn) => {
      console.log(`${txn.date}: $${txn.amount} for order ${txn.orderId}`);
    });

    return transactions;
  } catch (cause) {
    throw new ServiceError(500, "Failed to parse transactions", { cause });
  }
};

/** Go to any Amazon page after initial login (handles password reconfirmation if needed) */
const goToAmazonPage = async (page: Page, env: Env, url: string) => {
  logger.debug(`Navigating to ${url}`);
  await page.goto(url);
  await wait(3000, 5000);

  await handlePasswordReconfirmation(page, env);

  // Wait for data to load after password submission
  await wait(2000, 4000);
};

const setupAmazonPage = async (browser: Browser, env: Env): Promise<Page> => {
  const page = await browser.newPage();

  // Forward browser console logs to Node console
  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    // We generally don't need this but we can toggle it on if debug info is needed
    // if (type === "log") console.log("[Browser]", text);
    if (type === "warn") console.warn("[Browser]", text);
    if (type === "error") console.error("[Browser]", text);
  });

  await page.goto("https://www.amazon.com/");
  const loggedIn = await isLoggedIn(page, env);
  logger.info(`${loggedIn ? "Valid session found" : "No session found"}`);

  if (!loggedIn) {
    logger.info("Logging in to new session...");
    const loginSuccess = await login(page, env);
    if (!loginSuccess) {
      throw new Error("Unable to log in to Amazon");
    }
  }

  return page;
};

const goToMockPage = async (browser: Browser): Promise<Page> => {
  const page = await browser.newPage();

  // Forward browser console logs to Node console
  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "log") console.log("[Browser]", text);
    else if (type === "warn") console.warn("[Browser]", text);
    else if (type === "error") console.error("[Browser]", text);
  });

  // Navigate to orders page
  logger.debug("Navigating to mock page...");
  await page.goto(MOCK_PAGE);

  return page;
};

const main = async (): Promise<void> => {
  const emails = (process.env.EMAIL ?? "").split(",");
  const passwords = (process.env.PASS ?? "").split(",");
  const names = (process.env.NAME ?? "").split(",");

  // Use traditional loop to avoid concurrent promise.all
  for (let i = 0; i < emails.length; i++) {
    const env: Env = {
      email: emails[i],
      password: passwords[i],
      name: names[i],
    };
    if (!env.email || !env.name || !env.password) {
      throw new Error(
        `Invalid env: missing email/password/name for index: ${i}`
      );
    }
    logger.info(`\nExtracting orders for ${env.name}...`);

    if (MOCK) {
      // Add static html to mockserver/index.html and serve it from a dev server for mock mode
      const browser = await puppeteer.launch({ headless: false });
      const page = await goToMockPage(browser);

      let data = null;
      if (MOCK === "orders") {
        data = await extractDataFromInvoice(page, "111-7057469-3222651");
      } else if (MOCK === "transactions") {
        data = await extractTransactions(page, env);
      }

      if (data) logger.info(data);

      await browser.close();
      continue;
    }

    const existingOrders = await db
      .select({ id: budgetOrders.id })
      .from(budgetOrders)
      .orderBy(desc(budgetOrders.created))
      .limit(100);
    const existingOrderIds = existingOrders.map((o) => o.id);
    logger.debug(`Found ${existingOrders.length} existing orders in DB`);

    const newOrders = [];

    const USER_DATA_DIR = path.join(APP_DIR, `user-data-dir-${i}`);
    const browser = await puppeteer.launch({
      headless: HEADLESS,
      userDataDir: USER_DATA_DIR,
      defaultViewport: null,
      args: ["--start-maximized"],
    });

    try {
      const page = await setupAmazonPage(browser, env);
      await goToAmazonPage(page, env, ORDERS_PAGE);

      // Get recent order IDs
      const recentOrderIds = await getRecentOrderIds(page);
      logger.info(`Found ${recentOrderIds.length} recent orders in Amazon`);

      const toCreate = recentOrderIds.filter(
        (id) => !existingOrderIds.includes(id)
      );
      toCreate.length
        ? console.log(green(`💾 Inserting ${toCreate.length} orders into DB`))
        : logger.info("No orders to insert");

      // Download order data
      for (const orderId of toCreate) {
        logger.debug(`Extracting data for order ${orderId}...`);
        const orderData = await extractDataFromInvoice(page, orderId);
        if (orderData) newOrders.push(orderData);
      }

      if (newOrders.length) {
        await saveOrderData(newOrders, env);
      }

      // Extract transactions from transactions page
      logger.info(`\nExtracting transactions for ${env.name}...`);
      await goToAmazonPage(page, env, TX_PAGE);
      const transactions = await extractTransactions(page, env);
      logger.info(`Found ${transactions.length} transactions in Amazon`);
      // TODO: save transactions
      // if (transactions.length) {
      //   await saveTransactions(transactions);
      // }
    } finally {
      await browser.close();
    }
  }

  console.log("");
};

main().catch(async (error) => {
  handleError(
    error instanceof CustomError
      ? error
      : new ServiceError(500, "Failed to scrape Amazon order data", {
          cause: error,
        })
  );

  // Tell Node.js to exit with an error exit code, but don't call .exit() directly
  // This allows Node to finish any async work (e.g. sending error email) that was not awaited
  // Even logging to stdout can be async, so logs can get truncated if you call .exit()
  // See jsdoc notes on .exitCode(), or look at MDN for more info
  process.exitCode = 1;
});
