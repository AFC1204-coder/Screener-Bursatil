import "../../styles/metodologia.css";
import Link from "next/link";
import {
  buildMetodologiaSections,
  METODOLOGIA_PAGE_TITLE,
} from "@/lib/metodologiaContent";

function BulletList({ items = [] }) {
  return (
    <ul className="metodologiaList">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function QualifierList({ items = [] }) {
  if (!items.length) return null;
  return (
    <dl className="metodologiaQualifiers">
      {items.map((item) => (
        <div key={item.word} className="metodologiaQualifier">
          <dt>{item.word}</dt>
          <dd>{item.title}</dd>
        </div>
      ))}
    </dl>
  );
}

function HealthSection({ section }) {
  return (
    <>
      <p className="metodologiaLead">{section.scope}</p>
      <p className="metodologiaFormula">{section.formula}</p>
      <table className="metodologiaTable">
        <thead>
          <tr>
            <th scope="col">Componente</th>
            <th scope="col">Peso</th>
            <th scope="col">Rampa</th>
          </tr>
        </thead>
        <tbody>
          {section.components.map((component) => (
            <tr key={component.label}>
              <td>{component.label}</td>
              <td>{component.weight}</td>
              <td>{component.ramp}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Suma de pesos: {section.weightSum}</td>
          </tr>
        </tfoot>
      </table>
      <p className="metodologiaNote">{section.mirrorStage4}</p>
      <div className="metodologiaExample" aria-label="Ejemplo trabajado">
        <h3>Ejemplo trabajado</h3>
        <p><strong>{section.workedExample.stage}</strong></p>
        <p>{section.workedExample.inputs}</p>
        <p>Desglose: {section.workedExample.breakdown}</p>
        <p className="metodologiaExampleScore">Salud {section.workedExample.score}/100</p>
      </div>
      <p className="metodologiaNote">{section.allOrNothing}</p>
    </>
  );
}

export default function MetodologiaPage() {
  const sections = buildMetodologiaSections();

  return (
    <main className="metodologiaPage">
      <header className="metodologiaHeader">
        <h1>{METODOLOGIA_PAGE_TITLE}</h1>
        <p className="metodologiaLead">
          Umbrales y definiciones que usa el motor de clasificación. La herramienta describe estado;
          no emite recomendaciones de inversión.
        </p>
      </header>

      <nav className="metodologiaToc" aria-label="Secciones de metodología">
        <ul>
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ul>
      </nav>

      {sections.map((section) => (
        <section key={section.id} id={section.id} className="metodologiaSection">
          <h2>{section.title}</h2>
          {section.intro ? <p className="metodologiaLead">{section.intro}</p> : null}
          {section.qualifiers ? <QualifierList items={section.qualifiers} /> : null}
          {section.bullets ? <BulletList items={section.bullets} /> : null}
          {section.id === "salud" ? <HealthSection section={section} /> : null}
        </section>
      ))}

      <footer className="metodologiaFooter">
        <Link href="/">Volver al screener</Link>
      </footer>
    </main>
  );
}
