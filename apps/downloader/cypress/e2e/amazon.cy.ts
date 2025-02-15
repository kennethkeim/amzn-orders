import { Env, OrderData } from "../../src/types";

describe("Amazon Order Download", () => {
  // Mock mode check
  const MOCK = Cypress.env("MOCK") === true;

  if (MOCK) {
    it("handles mock data", () => {
      // Add static html to mockserver/index.html and serve it from a dev server for mock mode
      cy.visit("http://localhost:4200");
      cy.extractInvoiceData("111-7057469-3222651").then((orderData) => {
        if (orderData) cy.log(orderData);
      });
    });
  } else {
    // Get credentials from Cypress env
    const emails = (Cypress.env("EMAIL") ?? "").split(",");
    const passwords = (Cypress.env("PASS") ?? "").split(",");
    const names = (Cypress.env("NAME") ?? "").split(",");

    // Use traditional loop to avoid concurrent tests
    for (let i = 0; i < emails.length; i++) {
      const env: Env = {
        email: emails[i],
        password: passwords[i],
        name: names[i],
      };

      // Validate environment variables
      if (!env.email || !env.name || !env.password) {
        throw new Error(
          `Invalid env: missing email/password/name for index: ${i}`
        );
      }

      it(`downloads orders for ${env.name}`, () => {
        cy.log(`Downloading orders for ${env.name}...`);

        // Get existing orders from database
        cy.task<Array<{ id: string }>>("getExistingOrders", {
          user: env.name,
        }).then((existingOrders) => {
          const existingOrderIds = existingOrders.map((o) => o.id);
          cy.log(`Found ${existingOrders.length} existing orders`);

          // Navigate to orders page and handle login
          cy.visit("https://www.amazon.com");
          cy.isLoggedIn(env).then((loggedIn) => {
            if (!loggedIn) {
              cy.login(env);
            }
          });

          // Go to orders page
          cy.visit("https://www.amazon.com/gp/your-account/order-history");
          cy.handlePasswordReconfirmation(env);

          // Get recent order IDs
          cy.getRecentOrderIds().then((recentOrderIds) => {
            cy.log(`Found ${recentOrderIds.length} recent orders`);

            const toCreate = recentOrderIds.filter(
              (id) => !existingOrderIds.includes(id)
            );
            cy.log(`Will create ${toCreate.length} orders`);

            // Process each new order
            const newOrders: OrderData[] = [];

            // Use Cypress's each to process orders sequentially
            cy.wrap(toCreate).each((orderId) => {
              cy.log(`Extracting data for order ${orderId}...`);
              cy.extractInvoiceData(orderId).then((orderData) => {
                if (orderData) newOrders.push(orderData);
              });
            });

            // Save all new orders
            cy.wrap(newOrders).then((orders) => {
              if (orders.length) {
                cy.task("saveOrderData", { orders, env });
              }
            });
          });
        });
      });
    }
  }
});
