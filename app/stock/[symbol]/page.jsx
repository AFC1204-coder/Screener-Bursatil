import "../../../styles/stock.css";
import { getCompanyBrief } from "@/app/api/company-brief/route";
import StockClient from "./StockClient";

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

export default async function StockPage({ params }) {
  const resolvedParams = await params;
  const symbol = decodeURIComponent(resolvedParams?.symbol || "").toUpperCase();
  let initialData = null;
  let initialError = "";

  if (symbol) {
    try {
      initialData = jsonSafe(await getCompanyBrief(symbol));
    } catch (error) {
      initialError = error?.message || String(error);
    }
  } else {
    initialError = "Falta symbol";
  }

  return <StockClient initialSymbol={symbol} initialData={initialData} initialError={initialError} />;
}
