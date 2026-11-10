"use client";

// HuntCardRail — raíl de vistas vertical a la izquierda de la mesa (rediseño
// 2026-11, paso 6; sustituye a la banda horizontal de 5 fichas). Tres grupos:
//   · Del análisis nocturno: las 5 fichas de caza (applyHuntCard, sin cambios).
//   · Cambios de la semana (antes «Esta noche»): las cifras de
//     /api/weekly-changes como colas externas, con las fechas en el rótulo.
//   · Mis vistas: Favoritos, plantillas guardadas y «Guardar vista actual».
// Memoria muscular: el mismo gesto (clic en el raíl) abre cualquier cola.

import { useEffect, useRef } from "react";
import { HUNT_CARDS, resolveActiveHuntCard } from "@/lib/screenerHuntCards";
import { num } from "@/lib/formatters";
import { WEEKLY_PENDING_LABEL } from "@/lib/weeklyChanges";

function RailCount({ value }) {
  if (value == null) return <em className="screenerViewRailCount isGhost">—</em>;
  return <em className="screenerViewRailCount">{num(value, 0)}</em>;
}

function RailItem({ view, glyph, label, count, active = false, disabled = false, title = "", onClick, className = "" }) {
  return (
    <button
      type="button"
      className={`screenerViewRailItem${active ? " active" : ""}${className ? ` ${className}` : ""}`}
      data-view={view}
      aria-current={active ? "true" : undefined}
      disabled={disabled}
      title={title || label}
      onClick={onClick}
    >
      <i aria-hidden="true">{glyph}</i>
      <span>{label}</span>
      {count !== undefined ? <RailCount value={count} /> : null}
    </button>
  );
}

export default function HuntCardRail({
  presetKey = "",
  markets = [],
  onSelect,
  pending = false,
  cardCounts = {},
  activeCount = null,
  activeQueueId = "",
  weeklyViews = [],
  weeklySinceLabel = "",
  // D2 (auditoría 2026-11): rótulo del grupo con las fechas de la comparación
  // («Semana 9 → 16 oct») o «Sin comparación esta semana»; antes, «Esta noche».
  weeklyHeading = WEEKLY_PENDING_LABEL,
  onOpenWeeklyDetail,
  favoritesView = null,
  onSelectQueue,
  savedTemplates = [],
  selectedTemplateId = "",
  onApplyTemplate,
  onSaveView,
  // Estudio móvil 2026-11 (paso 8): «tabs» pinta las MISMAS vistas, con el
  // mismo activo y los mismos conteos, como pestañas deslizables en una fila.
  layout = "rail",
}) {
  const activeCard = resolveActiveHuntCard(presetKey, markets);
  const templateActive = Boolean(selectedTemplateId) && !activeQueueId;
  const cardActiveId = activeQueueId || templateActive ? "" : activeCard?.id;
  const cardCount = (card) => (cardActiveId === card.id && activeCount != null ? activeCount : cardCounts[card.id]);

  if (layout === "tabs") {
    // D2: en móvil no hay cabeceras de grupo; el rótulo con las fechas va como
    // etiqueta delante de las pestañas semanales.
    return (
      <HuntViewTabs
        pending={pending}
        groupLabels={[null, weeklyViews.length ? weeklyHeading : null, null]}
        groups={[
          HUNT_CARDS.map((card) => ({
            id: card.id,
            label: card.label,
            count: cardCount(card) ?? null,
            active: cardActiveId === card.id,
            disabled: pending,
            onClick: () => onSelect?.(card.id),
          })),
          weeklyViews.map((view) => ({
            id: view.id,
            label: view.label,
            count: view.count,
            active: activeQueueId === view.id,
            disabled: pending || !view.count,
            title: `${view.label} · ${weeklyHeading}`,
            onClick: () => onSelectQueue?.(view),
          })),
          [
            ...(favoritesView ? [{
              id: favoritesView.id,
              label: `${favoritesView.glyph} ${favoritesView.label}`,
              count: favoritesView.count,
              active: activeQueueId === favoritesView.id,
              disabled: pending || !favoritesView.count,
              onClick: () => onSelectQueue?.(favoritesView),
            }] : []),
            ...savedTemplates.map((template) => ({
              id: `plantilla:${template.id}`,
              label: template.name,
              active: templateActive && selectedTemplateId === template.id,
              disabled: pending,
              onClick: () => onApplyTemplate?.(template.id),
            })),
          ],
        ]}
      />
    );
  }

  return (
    <nav
      className={`screenerViewRail${pending ? " screenerViewRailPending" : ""}`}
      aria-label="Vistas"
      aria-busy={pending ? "true" : "false"}
    >
      <div className="screenerViewRailGroup">
        <h3>Del análisis nocturno</h3>
        {HUNT_CARDS.map((card) => {
          const selected = cardActiveId === card.id;
          const count = cardCount(card);
          return (
            <RailItem
              key={card.id}
              view={card.id}
              glyph={card.glyph}
              label={card.label}
              count={count ?? null}
              active={selected}
              disabled={pending}
              onClick={() => onSelect?.(card.id)}
            />
          );
        })}
      </div>

      <div className="screenerViewRailGroup">
        <h3 title={weeklySinceLabel ? `Cambios desde el ${weeklySinceLabel}` : undefined}>
          {weeklyHeading}
          {onOpenWeeklyDetail && weeklySinceLabel ? (
            <button
              type="button"
              className="screenerViewRailDetail"
              onClick={() => onOpenWeeklyDetail()}
              title={`Detalle de cambios desde el ${weeklySinceLabel}`}
            >
              detalle
            </button>
          ) : null}
        </h3>
        {weeklyViews.map((view) => (
          <RailItem
            key={view.id}
            view={view.id}
            glyph={view.glyph}
            label={view.label}
            count={view.count}
            active={activeQueueId === view.id}
            disabled={pending || !view.count}
            title={`${view.label} · ${weeklyHeading}`}
            onClick={() => onSelectQueue?.(view)}
          />
        ))}
      </div>

      <div className="screenerViewRailGroup">
        <h3>Mis vistas</h3>
        {favoritesView ? (
          <RailItem
            view={favoritesView.id}
            glyph={favoritesView.glyph}
            label={favoritesView.label}
            count={favoritesView.count}
            active={activeQueueId === favoritesView.id}
            disabled={pending || !favoritesView.count}
            onClick={() => onSelectQueue?.(favoritesView)}
          />
        ) : null}
        {savedTemplates.map((template) => (
          <RailItem
            key={template.id}
            view={`plantilla:${template.id}`}
            glyph="·"
            label={template.name}
            active={templateActive && selectedTemplateId === template.id}
            disabled={pending}
            onClick={() => onApplyTemplate?.(template.id)}
          />
        ))}
        {onSaveView ? (
          <RailItem
            view="guardar-vista"
            glyph="+"
            label="Guardar vista actual"
            className="screenerViewRailAdd"
            disabled={pending || Boolean(activeQueueId)}
            title={activeQueueId
              ? "Una cola de cambios de la semana o Favoritos no se guarda como plantilla"
              : "Guarda filtros, mercados y orden actuales como plantilla"}
            onClick={() => onSaveView()}
          />
        ) : null}
      </div>
      {pending ? (
        <span className="screenerViewRailPendingLabel" role="status" aria-live="polite">
          Aplicando ficha…
        </span>
      ) : null}
    </nav>
  );
}

/**
 * Pestañas de vistas (móvil): una fila deslizable, grupos separados por un
 * filete (nocturnas │ esta noche │ mías). Conteo sin cifra → nada (no «—»:
 * en una pestaña el hueco no informa). La activa se centra al cambiar.
 */
function HuntViewTabs({ groups = [], groupLabels = [], pending = false }) {
  const visible = groups
    .map((group, index) => ({ items: group, label: groupLabels[index] || "" }))
    .filter((group) => group.items.length);
  const navRef = useRef(null);
  const activeId = visible.flatMap((group) => group.items).find((item) => item.active)?.id || "";
  useEffect(() => {
    const node = navRef.current;
    const active = node?.querySelector(".mobileViewTab.isOn");
    if (!active || node.scrollWidth <= node.clientWidth) return;
    node.scrollLeft = Math.max(0, active.offsetLeft - (node.clientWidth - active.offsetWidth) / 2);
  }, [activeId]);
  return (
    <nav
      ref={navRef}
      className={`mobileViewTabs${pending ? " isPending" : ""}`}
      aria-label="Vistas"
      aria-busy={pending ? "true" : "false"}
    >
      {visible.map((group, groupIndex) => (
        <span key={groupIndex} className="mobileViewTabGroup">
          {groupIndex ? <i className="mobileViewTabSep" aria-hidden="true" /> : null}
          {group.label ? <em className="mobileViewTabGroupLabel">{group.label}</em> : null}
          {group.items.map((item) => (
            <button
              type="button"
              key={item.id}
              data-view={item.id}
              className={`mobileViewTab${item.active ? " isOn" : ""}`}
              aria-current={item.active ? "true" : undefined}
              disabled={item.disabled}
              title={item.title || item.label}
              onClick={item.onClick}
            >
              {item.label}
              {item.count != null ? <b>{num(item.count, 0)}</b> : null}
            </button>
          ))}
        </span>
      ))}
    </nav>
  );
}
