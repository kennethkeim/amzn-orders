import { chromium, Page, BrowserContext } from "playwright";
import { config } from "dotenv";
import path from "path";
import {
  BaseContext,
  OrderData,
  Transaction,
  OrderItem,
  EvaluateResult,
  Env,
} from "./types";
import { db } from "./db";
import { items, orders, transactions } from "./db-schema";
import { desc, eq, InferInsertModel } from "drizzle-orm";

// Define types for inserting into tables
type NewOrder = InferInsertModel<typeof orders>;
type NewItem = InferInsertModel<typeof items>;
type NewTx = InferInsertModel<typeof transactions>;

config();

const APP_DIR = path.join(__dirname);

const MOCK = process.argv.includes("--mock");
const HEADLESS = !process.argv.includes("--head");
console.log("Mock mode:", MOCK);

const BASE_CTX: BaseContext = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
  javaScriptEnabled: true,
  timezoneId: "America/New_York",
  geolocation: { latitude: 40.0794, longitude: -76.3141 },
};

const wait = async (min = 1000, max = 3000): Promise<void> => {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise((resolve) => setTimeout(resolve, delay));
  console.log(`Waited for ${delay}ms`);
};

const isLoggedIn = async (page: Page, env: Env): Promise<boolean> => {
  try {
    // Try to find an element that's only visible when logged in
    await page.waitForSelector("#nav-link-accountList-nav-line-1", {
      timeout: 3000,
    });
    const accountText = await page.textContent(
      "#nav-link-accountList-nav-line-1"
    );
    console.log("Account text:", accountText);
    return accountText?.toLowerCase().includes(`hello, ${env.name}`) ?? false;
  } catch (error) {
    return false;
  }
};

const login = async (page: Page, env: Env): Promise<boolean> => {
  console.log("Logging in...");
  try {
    await page.goto("https://www.amazon.com/");
    await wait(3000, 5000);
    await page.click("#nav-link-accountList");
    await wait(1000, 2000);
    await page.fill("#ap_email", env.email);
    await wait(800, 1500);
    await page.click("#continue");
    await wait(1000, 2000);
    await page.fill("#ap_password", env.password);
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

    console.log("Login successful");
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
  console.log("Getting recent order IDs...");
  await page.waitForSelector(".order-card");

  const orders = await page.$$eval(".order-card", (cards: Element[]) => {
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
  const validOrders = orders.filter((id) => id !== null);
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
        .map((tr): Transaction => {
          const tds = Array.from(tr.querySelectorAll("td")).filter((td) => {
            return td.childNodes.length === 1;
          });

          let amount: number | null = null,
            type: string | null = null,
            last4: string | null = null;

          // Get price, type, and last4 from the tds with only one child node
          for (const td of tds) {
            const text = td.textContent?.trim() ?? "";
            if (text.includes("ending in")) {
              last4 = text.split("ending in").pop()?.trim() ?? null;
              last4 = last4?.split(":").shift()?.trim() ?? null;
              type = text.split("ending in").shift()?.trim() ?? null;
            }
            if (text.includes("$")) {
              amount = getDollarAmount(text);
            }
          }
          return { type, last4, amount };
        })
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
      } else {
        // Sum all transaction amounts
        total = transactions.reduce((sum, t) => sum + (t.amount ?? 0), 0);
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
    await tx.insert(orders).values(ordersToInsert);
    await tx.insert(items).values(itemsToInsert);
    await tx.insert(transactions).values(txToInsert);
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
      console.log("Password reconfirmation required...");
      await wait(1000, 2000);
      await page.fill("#ap_password", env.password);
      await wait(500, 1000);

      try {
        await page.check('input[name="rememberMe"]', { timeout: 5000 });
        console.log("Checked 'Keep me signed in' box");
        await wait(500, 1000);
      } catch (error) {
        console.log(
          "No 'Keep me signed in' checkbox found:",
          error instanceof Error ? error.message : String(error)
        );
      }

      await page.click("#signInSubmit");
      await page.waitForLoadState("networkidle");
      return true;
    }
    return false;
  } catch (error) {
    // No password reconfirmation needed
    return false;
  }
};

const goToOrdersPage = async (
  context: BrowserContext,
  env: Env
): Promise<Page> => {
  const page = await context.newPage();
  let needsLogin = true;

  try {
    await page.goto("https://www.amazon.com/");

    if (await isLoggedIn(page, env)) {
      console.log("Existing session is valid");
      needsLogin = false;
    } else {
      console.log("No valid session found");
    }
  } catch (error) {
    console.log(
      "Error checking login:",
      error instanceof Error ? error.message : String(error)
    );
  }

  if (needsLogin) {
    console.log("Logging in to new session...");
    const loginSuccess = await login(page, env);
    if (!loginSuccess) {
      throw new Error("Unable to log in to Amazon");
    }
  }

  // Navigate to orders page
  console.log("Navigating to orders page...");
  await page.goto("https://www.amazon.com/gp/your-account/order-history");
  await wait(3000, 5000);
  await handlePasswordReconfirmation(page, env);

  return page;
};

const goToMockPage = async (context: BrowserContext): Promise<Page> => {
  const page = await context.newPage();

  // Navigate to orders page
  console.log("Navigating to mock page...");
  await page.goto("http://localhost:4200");

  return page;
};

const main = async (): Promise<void> => {
  if (MOCK) {
    // Add static html to mockserver/index.html and serve it from a dev server for mock mode
    const browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext();
    const page = await goToMockPage(ctx);
    const orderData = await extractDataFromInvoice(page, "113-7450326-7014652");
    if (orderData) console.log(orderData);
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
    console.log(`Downloading orders for ${env.name}...`);

    const existingOrders = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.user, env.name))
      .orderBy(desc(orders.created))
      .limit(50);
    const existingOrderIds = existingOrders.map((o) => o.id);
    console.log(`Found ${existingOrders.length} existing orders`);

    const newOrders = [];

    const USER_DATA_DIR = path.join(APP_DIR, `user-data-dir-${i}`);
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: HEADLESS,
      ...BASE_CTX,
    });

    try {
      const page = await goToOrdersPage(context, env);

      // Get recent order IDs
      const recentOrderIds = await getRecentOrderIds(page);
      console.log(`Found ${recentOrderIds.length} recent orders`);

      const toCreate = recentOrderIds.filter(
        (id) => !existingOrderIds.includes(id)
      );
      console.log(`Will create ${toCreate.length} orders`);

      // Download order data
      for (const orderId of toCreate) {
        console.log(`Extracting data for order ${orderId}...`);
        const orderData = await extractDataFromInvoice(page, orderId);
        if (orderData) newOrders.push(orderData);
      }

      if (newOrders.length) {
        await saveOrderData(newOrders, env);
      }
    } finally {
      await context.close();
    }
  }
};

main().catch((error: unknown) => {
  console.error(
    "Script failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
