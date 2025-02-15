import path from "path";
import { config } from "dotenv";
config({ path: path.join(__dirname, "..", ".env") });

import puppeteer, { Page, Browser } from "puppeteer";
import {
  OrderData,
  Transaction,
  OrderItem,
  EvaluateResult,
  Env,
} from "./types";
import { db } from "./db";
import { itemSchema, orderSchema, transactionSchema } from "./db-schema";
import { desc, eq, InferInsertModel } from "drizzle-orm";
import { green, gray, yellow } from "picocolors";
import { Mailer, emailError } from "@kennethkeim/api-utils-core";

class Logger {
  private toStr(text: string | object): string {
    return typeof text === "string" ? text : JSON.stringify(text, null, 2);
  }

  info(text: string | object): void {
    console.log(this.toStr(text));
  }

  debug(text: string | object): void {
    console.log(gray(this.toStr(text)));
  }

  warn(text: string | object): void {
    console.log(yellow(this.toStr(text)));
  }
}
const logger = new Logger();

// Define types for inserting into tables
type NewOrder = InferInsertModel<typeof orderSchema>;
type NewItem = InferInsertModel<typeof itemSchema>;
type NewTx = InferInsertModel<typeof transactionSchema>;

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
    return accountText?.toLowerCase().includes(`hello, ${env.name}`) ?? false;
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
    await page.type("#ap_email", env.email);
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

const extractDataFromInvoice = async (
  page: Page,
  orderId: string
): Promise<OrderData | null> => {
  try {
    // Navigate to invoice page with random delay
    if (!MOCK) {
      await wait(2000, 4000);
      const invoiceUrl = `https://www.amazon.com/gp/css/summary/print.html?orderID=${orderId}`;
      await page.goto(invoiceUrl);
      await wait(1000, 2000);
    }

    const orderData = await page.evaluate(() => {
      const getDollarAmount = (text: string | undefined): number => {
        const str = text?.split("$").pop()?.trim() ?? "0";
        return parseFloat(str);
      };
      const roundTo2 = (num: number): number => {
        return Math.round((num + Number.EPSILON) * 100) / 100;
      };

      // Get order date - find text content that includes "Order Placed:"
      let orderDate: string | null = null;
      const elements = Array.from(document.querySelectorAll("b"));
      for (const el of elements) {
        if (el.textContent?.includes("Order Placed:")) {
          orderDate =
            el.parentElement?.textContent
              ?.split("Order Placed:")
              .pop()
              ?.trim() ?? null;
          break;
        }
      }

      // Get all items
      const spans = Array.from(document.querySelectorAll("span"));

      const items = spans
        .filter((s) => s.textContent?.includes("Sold by:"))
        .map((s) => {
          const td = s.parentElement;
          const name = td
            ?.querySelector("i")
            ?.textContent?.trim()
            .replace(/\s+/g, " ");
          const price = td?.nextElementSibling?.textContent?.trim();
          return { name, price: getDollarAmount(price) };
        })
        .filter((i): i is OrderItem => Boolean(i.name));

      // Get credit card transactions
      const bElements = Array.from(document.querySelectorAll("b"));

      const transactions = bElements
        .filter((b) => b.textContent?.includes("Credit Card transactions"))
        .map((b) => {
          let e: Element | null = b;
          while (e && e.tagName !== "TR") {
            e = e.parentElement;
          }
          return e;
        })
        .filter((e): e is Element => e !== null)
        .map((tr): Transaction[] => {
          const tds = Array.from(tr.querySelectorAll("td")).filter((td) => {
            // Return only elements that have no child nodes (only text content)
            return td.children.length === 0;
          });

          const tx: Transaction[] = [];
          let amount: number | null = null,
            type: string | null = null,
            last4: string | null = null;

          // Get price, type, and last4 from the tds with only one (text) child node
          for (const td of tds) {
            // td 1 will have last 4 and type, td 2 will have amount
            const text = td.textContent?.trim() ?? "";
            if (text.includes("ending in")) {
              last4 = text.split("ending in").pop()?.trim() ?? null;
              last4 = last4?.split(":").shift()?.trim() ?? null;
              type = text.split("ending in").shift()?.trim() ?? null;
            }
            if (text.includes("$")) {
              amount = getDollarAmount(text);
            }
            if (last4 && type && amount !== null) {
              // Add transaction and reset variables
              tx.push({ type, last4, amount });
              amount = null;
              type = null;
              last4 = null;
            }
          }
          return tx;
        })
        .flat()
        .filter(
          (t): t is Transaction =>
            t.type !== null && t.last4 !== null && t.amount !== null
        );

      // If no transactions found, try to get grand total
      let total = 0;
      if (transactions.length === 0) {
        const grandTotal = bElements
          .filter((b) => b.textContent?.includes("Grand Total:"))
          .map((b) => {
            let e: Element | null = b;
            while (e && e.tagName !== "TR") {
              e = e.parentElement;
            }
            return e;
          })
          .filter((e): e is Element => e !== null)
          .map((tr) => {
            let amount: number | null = null;
            Array.from(tr.querySelectorAll("td")).forEach((td) => {
              const text = td.textContent?.trim() ?? "";
              if (text.includes("$")) {
                amount = getDollarAmount(text);
              }
            });
            return { amount };
          });

        // note: will be only one grand total
        total = grandTotal.reduce((sum, t) => sum + (t.amount ?? 0), 0);
        total = roundTo2(total);
      } else {
        // Sum all transaction amounts
        total = transactions.reduce((sum, t) => sum + (t.amount ?? 0), 0);
        total = roundTo2(total);
      }

      return {
        orderDate,
        items,
        total,
        transactions,
      } satisfies EvaluateResult;
    });

    // Return combined data
    return {
      orderId,
      ...orderData,
    };
  } catch (error) {
    console.error(
      `Failed to extract data for order ${orderId}:`,
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
  }));

  const itemsToInsert = newOrders
    .map((o) => {
      return o.items.map<NewItem>((i) => ({
        orderId: o.orderId,
        name: i.name,
        price: i.price,
      }));
    })
    .flat();

  const txToInsert = newOrders
    .map((o) => {
      return o.transactions.map<NewTx>((tx) => ({
        orderId: o.orderId,
        type: tx.type ?? "Unknown",
        amount: tx.amount ?? 0,
        last4: tx.last4 ?? "Unknown",
      }));
    })
    .flat();

  await db.transaction(async (tx) => {
    if (ordersToInsert.length) {
      await tx.insert(orderSchema).values(ordersToInsert);
    }
    if (itemsToInsert.length) {
      await tx.insert(itemSchema).values(itemsToInsert);
    }
    if (txToInsert.length) {
      await tx.insert(transactionSchema).values(txToInsert);
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
      .select({ id: orderSchema.id })
      .from(orderSchema)
      .where(eq(orderSchema.user, env.name))
      .orderBy(desc(orderSchema.created))
      .limit(50);
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
