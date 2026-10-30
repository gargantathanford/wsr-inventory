"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into document.body instead of where they appear in the tree.
 *
 * WHY THIS EXISTS, so nobody deletes it as indirection:
 *
 * `position: fixed` is resolved against the nearest ancestor that establishes a
 * containing block — and `filter`, `backdrop-filter`, `transform`, `perspective`
 * and `contain` all establish one. TopBar is
 * `<header class="h-14 ... backdrop-blur">`, so a `fixed inset-0` overlay
 * rendered from any component inside it is clipped to a 56px-tall strip rather
 * than covering the viewport. That is exactly how the XP drawer shipped: the
 * whole ledger was in the DOM and none of it was visible below the header.
 *
 * Nothing in the markup hints at the cause, so the fix belongs in one named
 * place rather than as a mysterious class on each overlay. Any full-screen
 * overlay opened from the nav goes through here.
 *
 * Renders nothing on the server and on the first client pass, because
 * document.body does not exist during SSR; the overlay is user-opened, so there
 * is nothing to show before hydration anyway.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
