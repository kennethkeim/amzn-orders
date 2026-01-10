import { Transaction } from "./types";

export function parseTransactionsFromPage(): Transaction[] {
  console.log(
    "Starting parseTransactionsFromPage on:",
    document.title,
    document.location.href
  );

  const roundTo2 = (num: number): number => {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  };
  const getDollarAmount = (text: string | undefined): number => {
    const str = text?.split("$").pop()?.trim() ?? "0";
    return roundTo2(parseFloat(str));
  };

  const transactions: Transaction[] = [];
  /** This is a somewhat generic class that is used in several places, so it should be used in a scoped query */
  const attrName = "data-pmts-component-id";

  const txnDateDivs = Array.from(
    document.querySelectorAll(".apx-transaction-date-container")
  );

  txnDateDivs.forEach((dateDiv) => {
    const txnDate = dateDiv.textContent?.trim();

    const txnListDiv = dateDiv.nextElementSibling;
    const txnItemDivs = Array.from(
      txnListDiv?.querySelectorAll(
        ".apx-transactions-line-item-component-container"
      ) ?? []
    );

    txnItemDivs.forEach((itemDiv) => {
      const txnAttrDivs = Array.from(
        itemDiv.querySelectorAll(`div[${attrName}]`)
      );

      let paymentMethod = "",
        amount = 0,
        orderId = "",
        isRefund = false;

      txnAttrDivs.forEach((attrDiv, index) => {
        const text = attrDiv?.textContent?.trim().replace(/\s+/g, " ") ?? "";
        const textLower = text.toLowerCase();

        if (index === 0) {
          // Pmt method & amount e.g. "Prime Visa ****1234 -$26.41"
          const parts = text.split(/[-+]\$/);
          paymentMethod = parts[0]?.trim();
          const amountStr = parts[1]?.trim();
          amount = getDollarAmount(amountStr);
        } else if (textLower.includes("order #")) {
          // Order number or seller e.g. "Order #123-4567890-1234567" or "AMZN Mktp US"
          const parts = textLower.split("order #");
          orderId = parts[1]?.trim();
          // Example: "Refund: Order #123-4567890-1234567"
          isRefund = textLower.includes("refund:");
        }
      });

      amount = isRefund ? amount : -amount;

      if (txnDate && orderId && amount !== 0 && paymentMethod) {
        transactions.push({
          date: new Date(txnDate).toISOString(),
          amount,
          paymentMethod,
          orderId,
          isRefund,
        });
      }
    });
  });

  return transactions;
}
