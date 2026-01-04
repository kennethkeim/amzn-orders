import { EvaluateResult, OrderItem } from "./types";

export function parseOrderDetailsFromPage(): EvaluateResult | null {
  console.log(
    "Starting parseOrderDetailsFromPage on:",
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
  const c = (componentName: string): string => {
    return `[data-component="${componentName}"]`;
  };

  // Get order date from the span inside the orderDateDiv
  const orderDateDiv = document.querySelector(c("orderDate"));
  const orderDate =
    orderDateDiv?.querySelector("span")?.textContent?.trim() ?? null;
  console.log("orderDate extracted:", orderDate);

  // Get container element for all line items
  const itemListDiv = document.querySelector(c("purchasedItems"));
  console.log("itemListDiv found:", !!itemListDiv);
  if (!itemListDiv) return null;

  // Get line items
  const itemImageDivs = Array.from(
    itemListDiv.querySelectorAll(c("purchasedItemsLeftGrid"))
  );
  console.log("itemImageDivs found:", itemImageDivs.length);
  const items = itemImageDivs
    .map<OrderItem | null>((imgDiv) => {
      const dataDiv = imgDiv.parentElement?.querySelector(
        c("purchasedItemsRightGrid")
      );
      console.log("dataDiv found for imgDiv:", !!dataDiv);
      if (!dataDiv) return null;

      const itemTitleDiv = dataDiv.querySelector(c("itemTitle"));
      const itemName = itemTitleDiv?.textContent?.trim();
      const productLink = itemTitleDiv?.querySelector("a")?.href;
      console.log("itemName extracted:", itemName);
      if (!itemName) return null;

      const unitPrice = dataDiv
        .querySelector(c("unitPrice"))
        ?.textContent?.trim();
      console.log("unitPrice extracted:", unitPrice);

      const photo = imgDiv
        .querySelector(c("itemImage"))
        ?.querySelector("img")?.src;

      return {
        name: itemName,
        price: getDollarAmount(unitPrice ?? undefined),
        photo,
        productLink,
      } satisfies OrderItem;
    })
    .filter((i): i is OrderItem => Boolean(i?.name));

  const chargesDiv = document.querySelector(c("chargeSummary"));
  console.log("chargesDiv found:", !!chargesDiv);
  const chargeItems = Array.from(chargesDiv?.querySelectorAll("li") ?? []);
  const liWithAmount = chargeItems.find((li) =>
    li.textContent?.includes("Grand Total:")
  );
  console.log("liWithAmount found:", !!liWithAmount);

  const spans = Array.from(
    liWithAmount?.querySelectorAll("div.a-column") ?? []
  );
  const amountStr = spans
    .find((s) => s?.textContent?.includes("$"))
    ?.textContent?.trim();
  console.log("amountStr extracted:", amountStr);

  return {
    orderDate,
    items,
    total: getDollarAmount(amountStr ?? undefined),
    transactions: [],
  } satisfies EvaluateResult;
}
