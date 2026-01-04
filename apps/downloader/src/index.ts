import path from "path";
import { config } from "dotenv";
config({ path: path.join(__dirname, "..", ".env") });

import puppeteer, { Page, Browser } from "puppeteer";
import { OrderData, Env } from "./types";
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

const APP_DIR = path.join(__dirname, "..");

const MOCK = process.argv.includes("--mock");
const HEADLESS = process.argv.includes("--headless");
logger.info(`Mock mode: ${MOCK}`);

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
  } catch (error) {
    handleError(error, `Failed to extract data for order ${orderId}`);
    return null;
  }
};

const goToOrdersListPage = async (
  browser: Browser,
  env: Env
): Promise<Page> => {
  const page = await browser.newPage();

  // Forward browser console logs to Node console
  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "log") console.log("[Browser]", text);
    else if (type === "warn") console.warn("[Browser]", text);
    else if (type === "error") console.error("[Browser]", text);
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

  // Navigate to orders page
  logger.debug("Navigating to orders page...");
  await page.goto("https://www.amazon.com/gp/your-account/order-history");
  await wait(3000, 5000);
  await handlePasswordReconfirmation(page, env);

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
  await page.goto("http://localhost:4200");

  return page;
};

const main = async (): Promise<void> => {
  if (MOCK) {
    // Add static html to mockserver/index.html and serve it from a dev server for mock mode
    const browser = await puppeteer.launch({ headless: false });
    const page = await goToMockPage(browser);
    const orderData = await extractDataFromInvoice(page, "111-7057469-3222651");
    if (orderData) logger.info(orderData);
    await browser.close();
    return;
  }

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
      const page = await goToOrdersListPage(browser, env);

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
    } finally {
      await browser.close();
    }
  }

  console.log("");
};

main().catch(async (error: unknown) => {
  handleError(error, "Failed to scrape Amazon order data");

  // Tell Node.js to exit with an error exit code, but don't call .exit() directly
  // This allows Node to finish any async work (e.g. sending error email) that was not awaited
  // Even logging to stdout can be async, so logs can get truncated if you call .exit()
  // See jsdoc notes on .exitCode(), or look at MDN for more info
  process.exitCode = 1;
});
