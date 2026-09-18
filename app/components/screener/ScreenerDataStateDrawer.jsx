"use client";

// ScreenerDataStateDrawer — overflow de banners demoted (P2).
// Lista compacta en «Estado de datos»; no compite con el slot hard/soft primario.

export default function ScreenerDataStateDrawer({ items = [], childrenById = null }) {
  const list = Array.isArray(items) ? items.filter((item) => item?.id) : [];
  if (!list.length) return null;

  const count = list.length;
  return (
    <details className="screenerDataStateDrawer">
      <summary>
        <span className="screenerDataStateDrawerLabel">Estado de datos</span>
        <em className="screenerDataStateDrawerCount">
          {count === 1 ? "1 aviso más" : `${count} avisos más`}
        </em>
      </summary>
      <ul className="screenerDataStateDrawerList" role="list">
        {list.map((item) => (
          <li key={item.id} className={`screenerDataStateDrawerItem screenerDataStateDrawerItem--${item.severity || "soft"}`}>
            <div className="screenerDataStateDrawerItemHead">
              <span className="screenerDataStateDrawerItemLabel">{item.label || "Aviso"}</span>
              {item.severity === "hard" ? (
                <em className="screenerDataStateDrawerItemTone">prioridad</em>
              ) : null}
            </div>
            {item.detail ? <p className="screenerDataStateDrawerItemDetail">{item.detail}</p> : null}
            {childrenById && childrenById[item.id] ? (
              <div className="screenerDataStateDrawerItemActions">{childrenById[item.id]}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
