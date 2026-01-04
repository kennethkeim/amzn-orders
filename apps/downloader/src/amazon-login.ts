import { logger } from "./logger";
import { wait } from "./utils";
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

export const handlePasswordReconfirmation = async (
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
