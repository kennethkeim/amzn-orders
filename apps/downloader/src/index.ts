import path from "path";
import { config } from "dotenv";
config({ path: path.join(__dirname, "..", ".env") });

import puppeteer, { Page, Browser } from "puppeteer";
import { OrderData, Env } from "./types";
import { db } from "./db";
import { budgetLineItems, budgetOrders, budgetTransactions } from "./db-schema";
import { desc, InferInsertModel } from "drizzle-orm";
import { green } from "picocolors";
import { Mailer, emailError } from "@kennethkeim/api-utils-core";
import { parseOrderDetailsFromPage } from "./order-detail";
import { logger } from "./logger";

// Define types for inserting into tables
type NewOrder = InferInsertModel<typeof budgetOrders>;
type NewItem = InferInsertModel<typeof budgetLineItems>;
type NewTx = InferInsertModel<typeof budgetTransactions>;

const APP_DIR = path.join(__dirname, "..");

const MOCK = process.argv.includes("--mock");
const HEADLESS = process.argv.includes("--headless");
const mailerApiKeyExists = Boolean(process.env["MAILER_API_KEY"]);
logger.info(`Mock mode: ${MOCK}`);

const wait = async (min = 1000, max = 3000): Promise<void> => {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise((resolve) => setTimeout(resolve, delay));
  logger.debug(`Waited for ${delay}ms`);
};

const isLoggedIn = async (page: Page, env: Env): Promise<boolean> => {
  try {
    // Try to find an element that's only visible when logged in
    await page.waitForSelector("#nav-link-accountList-nav-line-1", {
      timeout: 3000,
    });
    const accountText = await page.$eval(
      "#nav-link-accountList-nav-line-1",
      (el) => el.textContent
    );
    logger.debug(`Account text: ${accountText}`);
    return (
      accountText?.toLowerCase().includes(`hello, ${env.name.toLowerCase()}`) ??
      false
    );
  } catch (error) {
    return false;
  }
};

const login = async (page: Page, env: Env): Promise<boolean> => {
  logger.info("Logging in...");
  try {
    await page.goto("https://www.amazon.com/");
    await wait(3000, 5000);
    await page.click("#nav-link-accountList");
    await wait(1000, 2000);
    await page.type("#ap_email_login", env.email);
    await wait(800, 1500);
    await page.click("#continue");
    await wait(1000, 2000);
    await page.type("#ap_password", env.password);
    await wait(700, 1900);
    await page.click("#signInSubmit");

    // Wait for login to complete and verify
    const loginSuccess = await page
      .waitForSelector("#nav-link-accountList-nav-line-1", { timeout: 30000 })
      .then(() => true)
      .catch(() => false);

    if (!loginSuccess) {
      throw new Error("Login failed - couldn't verify login status");
    }

    logger.info("Login successful");
    return true;
  } catch (error) {
    console.error(
      "Login failed:",
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
};

const getRecentOrderIds = async (page: Page): Promise<string[]> => {
  logger.debug("Getting recent order IDs...");
  await page.waitForSelector(".order-card");

  const orders = await page.$$eval(".order-card", (cards) => {
    return cards.slice(0, 10).map((card) => {
      // Find the order ID element within the card
      const orderIdElement = card.querySelector(
        '.yohtmlc-order-id span[dir="ltr"]'
      );
      if (!orderIdElement) return null;

      // Get the order ID text and clean it up
      const orderId = orderIdElement.textContent?.trim() ?? null;
      return orderId;
    });
  });

  // Filter out any null values and log the found orders
  const validOrders = orders.filter((id): id is string => id !== null);
  return validOrders;
};

const getOrderUrl = (orderId: string): string => {
  return `https://www.amazon.com/gp/css/summary/print.html?orderID=${orderId}`;
};

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
    console.error(
      `[Outer] Failed to extract data for order ${orderId}:`,
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
};

const saveOrderData = async (
  newOrders: OrderData[],
  env: Env
): Promise<void> => {
  const ordersToInsert = newOrders.map<NewOrder>((o) => ({
    id: o.orderId,
    orderDate: o.orderDate ? new Date(o.orderDate) : null,
    total: o.total,
    updated: new Date(),
    user: env.name,
    detailsLink: getOrderUrl(o.orderId),
  }));

  const itemsToInsert = newOrders
    .map((o) => {
      return o.items.map<NewItem>((i) => ({
        orderId: o.orderId,
        name: i.name,
        price: i.price,
        photo: i.photo,
        productLink: i.productLink,
      }));
    })
    .flat();

  const txToInsert = newOrders
    .map((o) => {
      return o.transactions.map<NewTx>((tx) => ({
        orderId: o.orderId,
        date: new Date(tx.date),
        amount: tx.amount ?? 0,
        isRefund: false,
        paymentMethod: tx.paymentMethod ?? "",
      }));
    })
    .flat();

  await db.transaction(async (tx) => {
    if (ordersToInsert.length) {
      await tx.insert(budgetOrders).values(ordersToInsert);
    }
    if (itemsToInsert.length) {
      await tx.insert(budgetLineItems).values(itemsToInsert);
    }
    if (txToInsert.length) {
      await tx.insert(budgetTransactions).values(txToInsert);
    }
  });
};

const handlePasswordReconfirmation = async (
  page: Page,
  env: Env
): Promise<boolean> => {
  try {
    const passwordField = await page.waitForSelector("#ap_password", {
      timeout: 3000,
    });
    if (passwordField) {
      logger.warn("Password reconfirmation required...");
      await wait(1000, 2000);
      await page.type("#ap_password", env.password);
      await wait(500, 1000);

      try {
        const checkbox = await page.$('input[name="rememberMe"]');
        if (checkbox) {
          await checkbox.click();
          logger.debug("Checked 'Keep me signed in' box");
          await wait(500, 1000);
        }
      } catch (error) {
        const errStr = error instanceof Error ? error.message : String(error);
        console.error(`No 'Keep me signed in' checkbox found:`, errStr);
      }

      await page.click("#signInSubmit");
      await page.waitForNavigation({ waitUntil: "networkidle0" });
      return true;
    }
    return false;
  } catch (error) {
    // No password reconfirmation needed
    return false;
  }
};

const goToOrdersPage = async (browser: Browser, env: Env): Promise<Page> => {
  const page = await browser.newPage();

  // Forward browser console logs to Node console
  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "log") console.log("[Browser]", text);
    else if (type === "warn") console.warn("[Browser]", text);
    else if (type === "error") console.error("[Browser]", text);
  });

  let needsLogin = true;

  try {
    await page.goto("https://www.amazon.com/");

    if (await isLoggedIn(page, env)) {
      logger.info("Existing session is valid");
      needsLogin = false;
    } else {
      logger.info("No valid session found");
    }
  } catch (error) {
    const errStr = error instanceof Error ? error.message : String(error);
    console.error("Error checking login", errStr);
  }

  if (needsLogin) {
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
      const page = await goToOrdersPage(browser, env);

      // Get recent order IDs
      const recentOrderIds = await getRecentOrderIds(page);
      logger.debug(`Found ${recentOrderIds.length} recent orders in Amazon`);

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

main().catch((error: unknown) => {
  console.error(
    "Script failed:",
    error instanceof Error ? error.message : String(error)
  );

  if (mailerApiKeyExists) {
    const mailer = new Mailer("Amazon Order Script");
    emailError(error, mailer).catch((e) => console.error(e));
  }

  process.exit(1);
});
