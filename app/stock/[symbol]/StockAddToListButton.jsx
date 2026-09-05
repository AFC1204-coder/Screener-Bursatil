"use client";

import { useEffect, useRef, useState } from "react";
import {
  USER_LIST_TARGETS,
  addSymbolToUserLists,
  readUserListMembership,
} from "@/lib/stockListActions";

export default function StockAddToListButton({ symbol = "", data = null }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [membership, setMembership] = useState({ favorites: false });
  const [selected, setSelected] = useState(() => new Set(["favorites"]));
  const menuRef = useRef(null);

  useEffect(() => {
    setMembership(readUserListMembership(symbol));
    setStatus("");
    setOpen(false);
  }, [symbol]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function toggleTarget(key = "") {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next.size ? next : new Set([key]);
    });
  }

  function handleAdd() {
    const targets = USER_LIST_TARGETS.length === 1
      ? [USER_LIST_TARGETS[0].key]
      : [...selected];
    const results = addSymbolToUserLists(targets, symbol, data, { source: "stock" });
    const messages = results.map((item) => item.message).filter(Boolean);
    setMembership(readUserListMembership(symbol));
    setStatus(messages[0] || "Guardado.");
    setOpen(false);
  }

  const singleTarget = USER_LIST_TARGETS.length === 1;
  const inFavorites = membership.favorites;

  return (
    <div className="stockAddToList" ref={menuRef}>
      <button
        type="button"
        className={`stockAddToListTrigger ${inFavorites ? "inList" : ""}`.trim()}
        aria-expanded={open}
        aria-haspopup={singleTarget ? "false" : "menu"}
        title={inFavorites ? "Ya en favoritos" : "Añadir a lista"}
        onClick={() => {
          if (singleTarget) handleAdd();
          else setOpen((value) => !value);
        }}
      >
        + lista
      </button>
      {!singleTarget && open ? (
        <div className="stockAddToListMenu" role="menu" aria-label="Elegir listas">
          {USER_LIST_TARGETS.map((target) => (
            <label className="stockAddToListOption" key={target.key}>
              <input
                type="checkbox"
                checked={selected.has(target.key)}
                onChange={() => toggleTarget(target.key)}
              />
              <span>
                <b>{target.label}</b>
                <em>{target.detail}</em>
              </span>
            </label>
          ))}
          <button type="button" className="stockAddToListConfirm" onClick={handleAdd}>
            Añadir
          </button>
        </div>
      ) : null}
      {status ? <span className="stockAddToListStatus" role="status">{status}</span> : null}
    </div>
  );
}
