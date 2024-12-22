const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false }); // Set headless to true for silent execution
  const context = await browser.newContext({
    // Persist cookies and sessions if needed
    storageState: "state.json",
  });
  const page = await context.newPage();

  // Navigate to Amazon
  console.log("Navigating to Amazon...");
  await page.goto("https://www.amazon.com/");

  // Log in to your account
  console.log("Logging in...");
  await page.click("#nav-link-accountList"); // Click on "Sign In"
  await page.fill("#ap_email", "YOUR_EMAIL"); // Replace with your Amazon email
  await page.click("#continue");
  await page.fill("#ap_password", "YOUR_PASSWORD"); // Replace with your Amazon password
  await page.click("#signInSubmit");

  // Navigate to orders page
  console.log("Navigating to orders...");
  await page.goto("https://www.amazon.com/gp/your-account/order-history");

  // Loop through orders and download invoices
  console.log("Downloading invoices...");
  const orders = await page.$$(".order"); // Adjust selector based on the page's structure
  for (let i = 0; i < orders.length; i++) {
    try {
      const order = orders[i];
      await order.click(".a-button-text"); // Click "Invoice"
      await page.waitForSelector(".download-invoice"); // Wait for invoice download button
      const [download] = await Promise.all([
        page.waitForEvent("download"), // Wait for the download to start
        page.click(".download-invoice"), // Trigger the download
      ]);
      const path = await download.path();
      console.log(`Invoice downloaded: ${path}`);
    } catch (err) {
      console.error(
        `Failed to download invoice for order ${i + 1}: ${err.message}`
      );
    }
  }

  // Close the browser
  await browser.close();
})();
