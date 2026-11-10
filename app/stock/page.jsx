// /stock sin símbolo: antes caía en el 404 genérico. Aquí solo se ofrece buscar.
import "../../styles/stock.css";
import "../../styles/empty-states.css";
import StockSymbolSearch from "./[symbol]/StockSymbolSearch";

export const metadata = { title: "Ficha de valor · StatsEdge" };

export default function StockIndexPage() {
  return (
    <main className="page stockPage">
      <section className="stockPanel esPanel" aria-labelledby="stockIndexTitle">
        <span className="esEyebrow">Ficha de valor</span>
        <h1 className="esTitle" id="stockIndexTitle">¿Qué valor quieres abrir?</h1>
        <p className="esLead">Busca por ticker o por nombre de empresa para abrir su ficha.</p>
        <div className="esSearch">
          <StockSymbolSearch />
        </div>
        <div className="esActions">
          <a className="btn btnPrimary" href="/">Volver al screener</a>
        </div>
      </section>
    </main>
  );
}
