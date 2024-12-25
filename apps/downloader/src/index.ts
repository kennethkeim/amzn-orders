import { chromium, Page, BrowserContext, Browser } from "playwright";
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import {
  BaseContext,
  OrderData,
  PageAndContext,
  Transaction,
  OrderItem,
  EvaluateResult,
} from "./types";

config();

const APP_DIR = path.join(__dirname);
const ORDER_DATA_PATH = path.join(APP_DIR, "order-data.json");
const STATE_PATH = path.join(APP_DIR, "state.json");

const MOCK = process.argv.includes("--mock");
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

const isLoggedIn = async (page: Page): Promise<boolean> => {
  try {
    // Try to find an element that's only visible when logged in
    await page.waitForSelector("#nav-link-accountList-nav-line-1", {
      timeout: 3000,
    });
    const accountText = await page.textContent(
      "#nav-link-accountList-nav-line-1"
    );
    console.log("Account text:", accountText);
    return (
      accountText?.toLowerCase().includes(`hello, ${process.env.NAME}`) ?? false
    );
  } catch (error) {
    return false;
  }
};

const login = async (page: Page): Promise<boolean> => {
  console.log("Logging in...");
  try {
    await page.goto("https://www.amazon.com/");
    await wait(3000, 5000);
    await page.click("#nav-link-accountList");
    await wait(1000, 2000);
    await page.fill("#ap_email", process.env.EMAIL ?? "");
    await wait(800, 1500);
    await page.click("#continue");
    await wait(1000, 2000);
    await page.fill("#ap_password", process.env.PASS ?? "");
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
  console.log("Found order IDs:", validOrders);
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

const loadOrderData = (): OrderData[] => {
  // Load existing data from file if it exists
  let existingData: OrderData[] = [];

  if (fs.existsSync(ORDER_DATA_PATH)) {
    existingData = JSON.parse(fs.readFileSync(ORDER_DATA_PATH, "utf8"));
  }

  return existingData;
};

const saveToFile = (orderData: OrderData[]): void => {
  fs.writeFileSync(ORDER_DATA_PATH, JSON.stringify(orderData, null, 2));
};

const checkIfOrderExists = (
  orderData: OrderData[],
  orderId: string
): boolean => {
  return orderData.some((order) => order.orderId === orderId);
};

const saveOrderData = (orderData: OrderData): void => {
  let existingData = loadOrderData();

  // Check if order already exists
  const orderIndex = existingData.findIndex(
    (order) => order.orderId === orderData.orderId
  );

  if (orderIndex === -1) {
    console.log(`Adding one order to ${existingData.length} orders`);
    existingData.push(orderData);
  } else {
    console.log(`Updating one of ${existingData.length} orders`);
    existingData[orderIndex] = orderData;
  }

  // Save to file
  saveToFile(existingData);
  console.log(`Saved data for order ${orderData.orderId}`);
};

const handlePasswordReconfirmation = async (page: Page): Promise<boolean> => {
  try {
    const passwordField = await page.waitForSelector("#ap_password", {
      timeout: 3000,
    });
    if (passwordField) {
      console.log("Password reconfirmation required...");
      await wait(1000, 2000);
      await page.fill("#ap_password", process.env.PASS ?? "");
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

const goToOrdersPage = async (browser: Browser): Promise<PageAndContext> => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let needsLogin = true;

  // Create context and single page that we'll reuse
  if (fs.existsSync(STATE_PATH)) {
    console.log("Found existing session state, testing if still valid...");
    try {
      context = await browser.newContext({
        ...BASE_CTX,
        storageState: STATE_PATH,
      });

      page = await context.newPage();
      await page.goto("https://www.amazon.com/");
    } catch (error) {
      console.log(
        "Error testing existing session:",
        error instanceof Error ? error.message : String(error)
      );
      if (context) await context.close();
    }

    if (page && (await isLoggedIn(page))) {
      console.log("Existing session is valid");
      needsLogin = false;
    } else {
      console.log("Existing session expired");
      if (context) await context.close();
    }
  }

  if (needsLogin) {
    console.log("Creating new session...");
    context = await browser.newContext(BASE_CTX);
    page = await context.newPage();

    const loginSuccess = await login(page);
    if (!loginSuccess) {
      throw new Error("Unable to log in to Amazon");
    }

    console.log("Saving new session state...");
    await context.storageState({ path: STATE_PATH });
  }

  if (!context || !page) {
    throw new Error("Failed to create context or page");
  }

  // Navigate to orders page
  console.log("Navigating to orders page...");
  await page.goto("https://www.amazon.com/gp/your-account/order-history");
  await wait(3000, 5000);
  await handlePasswordReconfirmation(page);

  return { context, page };
};

const goToMockPage = async (browser: Browser): Promise<PageAndContext> => {
  const context = await browser.newContext(BASE_CTX);
  const page = await context.newPage();

  // Navigate to orders page
  console.log("Navigating to mock page...");
  await page.goto("http://localhost:4200");

  return { context, page };
};

const main = async (): Promise<void> => {
  const browser = await chromium.launch({ headless: false });

  try {
    if (MOCK) {
      const { page } = await goToMockPage(browser);
      const orderData = await extractDataFromInvoice(
        page,
        "113-7450326-7014652"
      );
      console.log(orderData);
      if (orderData) saveOrderData(orderData);
    } else {
      const existingData = loadOrderData();
      const { page } = await goToOrdersPage(browser);

      // Get recent order IDs
      const recentOrderIds = await getRecentOrderIds(page);
      console.log(`Found ${recentOrderIds.length} recent orders`);

      // Download order data
      for (const orderId of recentOrderIds) {
        console.log(`Extracting data for order ${orderId}...`);
        const exists = checkIfOrderExists(existingData, orderId);
        if (!exists) {
          const orderData = await extractDataFromInvoice(page, orderId);
          if (orderData) saveOrderData(orderData);
        } else {
          console.log(`Order ${orderId} already exists`);
        }
      }
    }
  } finally {
    await browser.close();
  }
};

main().catch((error: unknown) => {
  console.error(
    "Script failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
