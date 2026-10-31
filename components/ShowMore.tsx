"use client";

import { useState } from "react";

/**
 * Show the first N of a list, then reveal more in batches.
 *
 * Paged rather than infinite-scrolled, on purpose. Infinite scroll hides how
 * much there is, makes the footer unreachable, and loses your place the moment
 * you navigate away and come back — all of which are worse on a phone in a
 * shop than a button you press.
 *
 * The count is always stated. "Showing 10 of 63" is the part people actually
 * need: a list that silently truncates teaches them not to trust it.
 *
 * Client-side: everything is already fetched by the server component, so this
 * is purely about what is PAINTED. A dashboard with a few hundred rows does
 * not need cursor pagination, and adding it would mean a round trip per batch
 * for no benefit. If a list ever reaches thousands, that is the point to move
 * the limit into SQL — and the symptom will be a slow page, not this.
 */
export function ShowMore({
  children,
  initial = 10,
  step = 10,
  noun = "items"
}: {
  children: React.ReactNode[];
  initial?: number;
  step?: number;
  /** Plural noun for the count line, e.g. "tasks". */
  noun?: string;
}) {
  const items = children.filter(Boolean);
  const [shown, setShown] = useState(initial);
  const visible = items.slice(0, shown);
  const remaining = items.length - visible.length;

  return (
    <>
      {visible}
      {items.length > initial && (
        <div className="flex items-center justify-between gap-3 pt-3 flex-wrap">
          <span className="font-mono text-[11px] text-graphite-500">
            Showing {visible.length} of {items.length} {noun}
          </span>
          <div className="flex gap-2">
            {remaining > 0 && (
              <button className="btn-ghost text-xs py-1" onClick={() => setShown((n) => n + step)}>
                Show {Math.min(step, remaining)} more
              </button>
            )}
            {remaining > step && (
              <button className="btn-ghost text-xs py-1" onClick={() => setShown(items.length)}>
                Show all {items.length}
              </button>
            )}
            {remaining === 0 && shown > initial && (
              <button className="btn-ghost text-xs py-1" onClick={() => setShown(initial)}>
                Collapse
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
