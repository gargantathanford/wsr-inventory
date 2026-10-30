"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Confetti burst — one canvas, no dependency, nothing running when idle.
 *
 * Deliberately cheap. The whole thing is roughly 80 particles with constant
 * gravity on a single canvas that is mounted once at the app root and sits at
 * `display: none` between bursts. No DOM node is created per particle, no
 * library is added, and `requestAnimationFrame` is cancelled the moment the
 * last particle leaves the viewport — an idle dashboard pays nothing for this.
 *
 * The canvas is `pointer-events: none` and `aria-hidden`, so it can never
 * intercept a click or reach a screen reader.
 *
 * Honours `prefers-reduced-motion`: the burst is skipped entirely. The toast
 * still says what was earned, so nobody loses the information — they just don't
 * get the movement. This is also why confetti is never the only signal.
 */

const PARTICLE_COUNT = 80;
const DURATION_MS = 1200;
const GRAVITY = 0.00042; // px per ms^2
const COLORS = ["#C7FF3D", "#FF5A1F", "#3DA9FC", "#2ED573", "#FFB020"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  color: string;
}

let fire: ((origin?: { x: number; y: number }) => void) | null = null;

/**
 * Trigger a burst from anywhere, without threading a ref through the tree.
 * A no-op when the canvas is not mounted, so callers never need to check.
 */
export function burstConfetti(origin?: { x: number; y: number }): void {
  fire?.(origin);
}

export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    particlesRef.current = [];
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = "none";
    }
  }, []);

  const frame = useCallback(
    (now: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return stop();

      const elapsed = now - startRef.current;
      if (elapsed > DURATION_MS) return stop();

      const dt = 16; // fixed step; exact physics is not the point here
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Fade out over the last third so particles don't vanish mid-air.
      ctx.globalAlpha = elapsed > DURATION_MS * 0.66 ? 1 - (elapsed - DURATION_MS * 0.66) / (DURATION_MS * 0.34) : 1;

      for (const p of particlesRef.current) {
        p.vy += GRAVITY * dt * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.spin * dt;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      rafRef.current = requestAnimationFrame(frame);
    },
    [stop]
  );

  useEffect(() => {
    fire = (origin) => {
      // One cheap check, read at fire time rather than cached, so changing the
      // OS setting takes effect without a reload.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.display = "block";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const ox = origin?.x ?? window.innerWidth / 2;
      const oy = origin?.y ?? window.innerHeight * 0.3;

      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
        const speed = 0.25 + Math.random() * 0.45;
        return {
          x: ox,
          y: oy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 5 + Math.random() * 6,
          rotation: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 0.012,
          color: COLORS[Math.floor(Math.random() * COLORS.length)]
        };
      });

      startRef.current = performance.now();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(frame);
    };

    return () => {
      fire = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [frame]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 z-[60] pointer-events-none"
      style={{ display: "none" }}
    />
  );
}
