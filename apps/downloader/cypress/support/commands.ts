/// <reference types="cypress" />
// ***********************************************
// This example commands.ts shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })
//
// declare global {
//   namespace Cypress {
//     interface Chainable {
//       login(email: string, password: string): Chainable<void>
//       drag(subject: string, options?: Partial<TypeOptions>): Chainable<Element>
//       dismiss(subject: string, options?: Partial<TypeOptions>): Chainable<Element>
//       visit(originalFn: CommandOriginalFn, url: string, options: Partial<VisitOptions>): Chainable<Element>
//     }
//   }
// }

import { Env, OrderData } from "../../src/types";

declare global {
  namespace Cypress {
    interface Chainable {
      login(env: Env): Chainable<void>;
      isLoggedIn(env: Env): Chainable<boolean>;
      getRecentOrderIds(): Chainable<string[]>;
      extractInvoiceData(orderId: string): Chainable<OrderData | null>;
      handlePasswordReconfirmation(env: Env): Chainable<boolean>;
    }
  }
}

Cypress.Commands.add("login", (env: Env) => {
  cy.log("Logging in...");
  cy.visit("https://www.amazon.com");
  cy.get("#nav-link-accountList").click();
  cy.get("#ap_email").type(env.email);
  cy.get("#continue").click();
  cy.get("#ap_password").type(env.password);
  cy.get("#signInSubmit").click();

  // Wait for login to complete
  cy.get("#nav-link-accountList-nav-line-1", { timeout: 30000 }).should(
    "exist"
  );
});

Cypress.Commands.add("isLoggedIn", (env: Env) => {
  return cy
    .get("#nav-link-accountList-nav-line-1", { timeout: 3000 })
    .invoke("text")
    .then((text) => text.toLowerCase().includes(`hello, ${env.name}`));
});

Cypress.Commands.add("getRecentOrderIds", () => {
  return cy.get(".order-card").then(($cards) => {
    const orderIds = Array.from($cards)
      .slice(0, 10)
      .map((card) => {
        const $orderIdElement = Cypress.$(card).find(
          '.yohtmlc-order-id span[dir="ltr"]'
        );
        return $orderIdElement.text().trim();
      });

    return orderIds.filter(Boolean);
  });
});

Cypress.Commands.add("handlePasswordReconfirmation", (env: Env) => {
  return cy.get("body").then(($body) => {
    if ($body.find("#ap_password").length) {
      cy.log("Password reconfirmation required...");
      cy.get("#ap_password").type(env.password);

      // Try to check "Keep me signed in"
      cy.get('input[name="rememberMe"]').then(($checkbox) => {
        if ($checkbox.length) {
          cy.wrap($checkbox).check();
        }
      });

      cy.get("#signInSubmit").click();
      return true;
    }
    return false;
  });
});

Cypress.Commands.add("extractInvoiceData", (orderId: string) => {
  if (!Cypress.env("MOCK")) {
    cy.visit(
      `https://www.amazon.com/gp/css/summary/print.html?orderID=${orderId}`
    );
  }

  return cy.document().then((doc) => {
    const getDollarAmount = (text: string | undefined): number => {
      const str = text?.split("$").pop()?.trim() ?? "0";
      return parseFloat(str);
    };

    const roundTo2 = (num: number): number => {
      return Math.round((num + Number.EPSILON) * 100) / 100;
    };

    // Get order date
    let orderDate: string | null = null;
    const elements = Array.from(doc.querySelectorAll("b"));
    for (const el of elements) {
      if (el.textContent?.includes("Order Placed:")) {
        orderDate =
          el.parentElement?.textContent?.split("Order Placed:").pop()?.trim() ??
          null;
        break;
      }
    }

    // Get items
    const spans = Array.from(doc.querySelectorAll("span"));
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
      .filter((i) => Boolean(i.name));

    // Get transactions
    const bElements = Array.from(doc.querySelectorAll("b"));
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
      .map((tr) => {
        const tds = Array.from(tr.querySelectorAll("td")).filter(
          (td) => td.children.length === 0
        );

        const tx = [];
        let amount: number | null = null,
          type: string | null = null,
          last4: string | null = null;

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
          if (last4 && type && amount !== null) {
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
        (t): t is { type: string; last4: string; amount: number } =>
          t.type !== null && t.last4 !== null && t.amount !== null
      );

    // Calculate total
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

      total = grandTotal.reduce((sum, t) => sum + (t.amount ?? 0), 0);
      total = roundTo2(total);
    } else {
      total = transactions.reduce((sum, t) => sum + t.amount, 0);
      total = roundTo2(total);
    }

    return {
      orderId,
      orderDate,
      items,
      total,
      transactions,
    };
  });
});
