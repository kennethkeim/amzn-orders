import { logger } from "./logger";
import { handleError, wait } from "./utils";
import { Env } from "./types";
import { Page } from "puppeteer";

export const isLoggedIn = async (page: Page, env: Env): Promise<boolean> => {
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
    handleError(error, "Failed to check login status");
    return false;
  }
};

export const login = async (page: Page, env: Env): Promise<boolean> => {
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
      throw new Error("Could not verify if login succeeded");
    }

    logger.info("Login successful");
    return true;
  } catch (error) {
    handleError(error, "Failed to log in");
    return false;
  }
};

export const handlePasswordReconfirmation = async (
  page: Page,
  env: Env
): Promise<void> => {
  let passwordField;
  try {
    // Throws error if selector not found within timeout
    passwordField = await page.waitForSelector("#ap_password", {
      timeout: 3000,
    });
  } catch {
    logger.debug("No password reconfirmation needed");
  }

  if (!passwordField) return;

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
    handleError(error, `Failed to check 'Keep me signed in' checkbox`);
  }

  await page.click("#signInSubmit");
  await page.waitForNavigation({ waitUntil: "networkidle0" });
};
