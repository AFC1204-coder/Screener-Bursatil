import "../../../styles/stock.css";
import { getCompanyBrief } from "@/app/api/company-brief/route";
import StockClient from "./StockClient";

const STOCK_SSR_TIMEOUT_MS = Number(process.env.STOCK_SSR_TIMEOUT_MS || 4500);

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function timeoutInitialLoad(symbol) {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ timedOut: true, symbol }), Math.max(500, STOCK_SSR_TIMEOUT_MS));
  });
}

export default async function StockPage({ params }) {
  const resolvedParams = await params;
  const symbol = decodeURIComponent(resolvedParams?.symbol || "").toUpperCase();
  let initialData = null;
  let initialError = "";

  if (symbol) {
    try {
      const result = await Promise.race([
        getCompanyBrief(symbol).then((data) => ({ data: jsonSafe(data) })),
        timeoutInitialLoad(symbol),
      ]);
      initialData = result?.timedOut ? null : result?.data || null;
    } catch (error) {
      initialError = "";
    }
  } else {
    initialError = "Falta symbol";
  }

  return <StockClient initialSymbol={symbol} initialData={initialData} initialError={initialError} />;
}
