import { EvaluateResult, OrderItem, Transaction } from "./types";

export function parseOrderDetailsFromPage() {
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
        el.parentElement?.textContent?.split("Order Placed:").pop()?.trim() ??
        null;
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
}
