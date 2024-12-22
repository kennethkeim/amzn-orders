require("dotenv").config();
const { chromium } = require("playwright");
const fs = require("fs");

const main = async () => {
  // Check if the storage state file exists
  const storageStatePath = "state.json";
  const browser = await chromium.launch({ headless: false }); // Open browser in non-headless mode
  let context;

  const baseContext = {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
    javaScriptEnabled: true,
    timezoneId: "America/New_York",
    geolocation: { latitude: 40.0794, longitude: -76.3141 },
  };

  if (fs.existsSync(storageStatePath)) {
    // Use the existing session state
    console.log("Using existing session state...");
    context = await browser.newContext({
      ...baseContext,
      storageState: storageStatePath,
    });
  } else {
    // Create a new context and log in
    console.log("No existing session state. Logging in...");
    context = await browser.newContext({
      ...baseContext,
    });

    const page = await context.newPage({
      viewport: { width: 1920, height: 1080 },
    });

    // Navigate to Amazon login page
    console.log("Navigating to Amazon...");
    await page.goto("https://www.amazon.com/");

    // Log in
    console.log("Logging in...");
    await page.click("#nav-link-accountList"); // Click on "Sign In"
    await page.fill("#ap_email", process.env.EMAIL);
    await page.click("#continue");
    await page.fill("#ap_password", process.env.PASS);
    await page.click("#signInSubmit");

    // Optionally wait to confirm login succeeded
    console.log("Verifying login...");
    await page.waitForSelector("#nav-orders", { timeout: 15000 });

    // Save the session state to state.json
    console.log("Saving session state...");
    await context.storageState({ path: storageStatePath });
  }

  // Proceed with your actions (e.g., navigate to orders page)
  const page = await context.newPage();
  console.log("Navigating to orders page...");
  await page.goto("https://www.amazon.com/gp/your-account/order-history");
};

main().catch(console.error);
