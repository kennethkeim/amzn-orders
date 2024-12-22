require("dotenv").config();
const { chromium } = require("playwright");
const fs = require("fs");

const DOWNLOADED_ORDERS_PATH = "downloaded-orders.json";

const isLoggedIn = async (page) => {
  try {
    // Try to find an element that's only visible when logged in
    await page.waitForSelector("#nav-link-accountList-nav-line-1", {
      timeout: 3000,
    });
    const accountText = await page.textContent(
      "#nav-link-accountList-nav-line-1"
    );
    console.log("Account text:", accountText);
    return accountText.toLowerCase().includes(`hello, ${process.env.NAME}`);
  } catch (error) {
    return false;
  }
};

const login = async (page) => {
  console.log("Logging in...");
  try {
    await page.goto("https://www.amazon.com/");
    await page.click("#nav-link-accountList");
    await page.fill("#ap_email", process.env.EMAIL);
    await page.click("#continue");
    await page.fill("#ap_password", process.env.PASS);
    await page.click("#signInSubmit");

    // Wait for login to complete and verify
    const loginSuccess = await page
      .waitForSelector("#nav-link-accountList-nav-line-1", { timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (!loginSuccess) {
      throw new Error("Login failed - couldn't verify login status");
    }

    console.log("Login successful");
    return true;
  } catch (error) {
    console.error("Login failed:", error.message);
    return false;
  }
};

const getRecentOrderIds = async (page) => {
  console.log("Getting recent order IDs...");
  await page.waitForSelector(".order-card");

  const orders = await page.$$eval(".order-card", (cards) => {
    return cards.slice(0, 2).map((card) => {
      // Find the order ID element within the card
      const orderIdElement = card.querySelector(
        '.yohtmlc-order-id span[dir="ltr"]'
      );
      if (!orderIdElement) return null;

      // Get the order ID text and clean it up
      const orderId = orderIdElement.textContent.trim();
      return orderId;
    });
  });

  // Filter out any null values and log the found orders
  const validOrders = orders.filter((id) => id);
  console.log("Found order IDs:", validOrders);
  return validOrders;
};

const loadDownloadedOrders = () => {
  if (fs.existsSync(DOWNLOADED_ORDERS_PATH)) {
    return JSON.parse(fs.readFileSync(DOWNLOADED_ORDERS_PATH, "utf8"));
  }
  return [];
};

const saveDownloadedOrder = (orderId) => {
  const downloadedOrders = loadDownloadedOrders();
  if (!downloadedOrders.includes(orderId)) {
    downloadedOrders.push(orderId);
    fs.writeFileSync(
      DOWNLOADED_ORDERS_PATH,
      JSON.stringify(downloadedOrders, null, 2)
    );
  }
};

const downloadInvoice = async (page, orderId) => {
  try {
    // Create downloads directory if it doesn't exist
    const downloadsDir = "./downloads";
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir);
    }

    // Navigate to invoice page
    const invoiceUrl = `https://www.amazon.com/gp/css/summary/print.html?orderID=${orderId}`;
    await page.goto(invoiceUrl);

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // Set up PDF options
    const pdfOptions = {
      path: `${downloadsDir}/${orderId}_invoice.pdf`,
      format: "A4",
      printBackground: true,
      margin: {
        top: "20px",
        bottom: "20px",
        left: "20px",
        right: "20px",
      },
    };

    // Generate PDF from the page
    await page.pdf(pdfOptions);

    console.log(`Downloaded invoice for order ${orderId}`);
    return true;
  } catch (error) {
    console.error(
      `Failed to download invoice for order ${orderId}:`,
      error.message
    );
    return false;
  }
};

const handlePasswordReconfirmation = async (page) => {
  try {
    // Check if password reconfirmation is needed (wait for password field)
    const passwordField = await page.waitForSelector("#ap_password", {
      timeout: 3000,
    });
    if (passwordField) {
      console.log("Password reconfirmation required...");
      await page.fill("#ap_password", process.env.PASS);

      try {
        await page.check('input[name="rememberMe"]', { timeout: 5000 });
        console.log("Checked 'Keep me signed in' box");
      } catch (error) {
        console.log("No 'Keep me signed in' checkbox found:", error.message);
      }

      await page.click("#signInSubmit");
      await page.waitForLoadState("networkidle");
      return true;
    }
  } catch (error) {
    // No password reconfirmation needed
    return false;
  }
};

const main = async () => {
  const storageStatePath = "state.json";
  const browser = await chromium.launch({ headless: false });

  const baseContext = {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
    javaScriptEnabled: true,
    timezoneId: "America/New_York",
    geolocation: { latitude: 40.0794, longitude: -76.3141 },
  };

  let context;
  let page;
  let needsLogin = true;

  // Create context and single page that we'll reuse
  if (fs.existsSync(storageStatePath)) {
    console.log("Found existing session state, testing if still valid...");
    try {
      context = await browser.newContext({
        ...baseContext,
        storageState: storageStatePath,
      });

      page = await context.newPage();
      await page.goto("https://www.amazon.com/");
    } catch (error) {
      console.log("Error testing existing session:", error.message);
      if (context) await context.close();
    }

    if (await isLoggedIn(page)) {
      console.log("Existing session is valid");
      needsLogin = false;
    } else {
      console.log("Existing session expired");
      await context.close();
    }
  }

  if (needsLogin) {
    console.log("Creating new session...");
    context = await browser.newContext(baseContext);
    page = await context.newPage();

    const loginSuccess = await login(page);
    if (!loginSuccess) {
      throw new Error("Unable to log in to Amazon");
    }

    console.log("Saving new session state...");
    await context.storageState({ path: storageStatePath });
  }

  // Navigate to orders page
  console.log("Navigating to orders page...");
  await page.goto("https://www.amazon.com/gp/your-account/order-history");
  await handlePasswordReconfirmation(page);

  // Get recent order IDs
  const recentOrderIds = await getRecentOrderIds(page);
  console.log(`Found ${recentOrderIds.length} recent orders`);

  // Load previously downloaded orders
  const downloadedOrders = loadDownloadedOrders();

  // Download new invoices
  for (const orderId of recentOrderIds) {
    if (!downloadedOrders.includes(orderId)) {
      console.log(`Downloading invoice for order ${orderId}...`);
      const success = await downloadInvoice(page, orderId);
      if (success) {
        saveDownloadedOrder(orderId);
      }
    } else {
      console.log(
        `Invoice for order ${orderId} already downloaded, skipping...`
      );
    }
  }

  await browser.close();
};

main().catch((error) => {
  console.error("Script failed:", error.message);
  process.exit(1);
});
