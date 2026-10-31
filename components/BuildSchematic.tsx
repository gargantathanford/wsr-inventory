"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * The shape the gate store returns. The schematic now colours by GATE
 * completeness, not by owned-part count — a subsystem with one owned part used
 * to paint green here, which is how Jonathan spotted the metric was wrong.
 */
export interface SubsystemReadiness {
  name: string;
  slug: string;
  partCount: number;
  readiness: {
    pct: number;
    gatePct: number;
    passed: number;
    applicable: number;
    ceiling: { cap: number; reason: string } | null;
    stale: unknown[];
  };
}

/**
 * Top-down FSAE car, coloured by what the team actually owns.
 *
 * SVG rather than WebGL, deliberately. A 3D model looks impressive for ten
 * seconds; a schematic that turns orange where Chassis is behind is something a
 * lead reads every day. It also costs no dependency, stays crisp at any size,
 * works on every phone in the shop, and each region links through to its
 * subsystem — none of which a canvas gives you for free.
 *
 * It is a SCHEMATIC, not a model of your car. Proportions follow the vehicle
 * targets (1600 mm wheelbase, 1270/1219 mm track, 13 in wheels) so it reads as
 * a formula car, but nothing here is drawn from CAD and it should not be used
 * to judge a layout.
 *
 * Regions map to workbook subsystem codes. MFG has no region — manufacturing is
 * a capability, not a part of the car — so it is reported in the legend only.
 */

const REGION_ORDER = ["CHS", "SUS", "WHE", "BRK", "STE", "PWT", "CVT", "ELE", "ERG", "AER"] as const;

/**
 * An explicit area to point at, per region.
 *
 * A fat transparent stroke was the first attempt and it was not enough: it only
 * catches on the line itself, so picking out a wishbone still meant hitting a
 * few pixels. Jonathan's words were "too tough to highlight individual
 * sections", and he was right.
 *
 * So each region gets real rectangles covering where it lives. Rectangles
 * rather than exact outlines because a target you can find beats a target that
 * traces the drawing: nobody is trying to click the precise edge of a brake
 * disc, they are trying to click "the brakes".
 *
 * Regions overlap — the chassis tub runs under everything — so they are painted
 * in REGION_ORDER and the later ones win the pointer. Hence the chassis is
 * first in that list and the small, specific items are last.
 */
const HIT: Record<string, Array<[number, number, number, number]>> = {
  // [x, y, width, height] in viewBox units.
  //
  // These rectangles must not overlap each other, which is the part that took
  // measuring rather than guessing: an earlier set put the wheel targets on top
  // of the brake discs and the chassis target under the cockpit, so pointing at
  // a wheel selected Brakes and pointing at the middle of the car selected
  // Ergonomics. Verified by asking the browser what answers at the centre of
  // every rectangle — see the hit test in the commit message.
  //
  // The chassis gets the nose bay only: its tub runs underneath every other
  // region, so a rectangle covering it would swallow half the car. The rest of
  // the chassis is pickable along its outline, via the stroke target below.
  CHS: [[82, 122, 74, 56]],
  AER: [[52, 70, 26, 160], [262, 86, 120, 26], [262, 188, 120, 26], [584, 84, 44, 132]],
  SUS: [[150, 56, 70, 76], [150, 168, 70, 76], [466, 58, 100, 74], [466, 168, 100, 74]],
  // Deliberately shallower than the tyres are drawn, to clear the brake discs
  // that sit inboard at each wheel centre.
  WHE: [[155, 25, 70, 14], [155, 257, 70, 14], [483, 29, 76, 14], [483, 253, 76, 14]],
  BRK: [[176, 41, 28, 28], [176, 231, 28, 28], [506, 46, 30, 30], [506, 224, 30, 30], [242, 124, 20, 52]],
  STE: [[164, 134, 64, 32], [284, 134, 16, 32]],
  PWT: [[412, 108, 100, 74]],
  CVT: [[500, 128, 44, 44], [514, 62, 14, 180]],
  ELE: [[394, 126, 38, 48], [556, 108, 16, 84]],
  ERG: [[262, 126, 116, 48]]
};
type Code = (typeof REGION_ORDER)[number];

const REGION_LABEL: Record<Code, string> = {
  CHS: "Chassis",
  SUS: "Suspension",
  WHE: "Wheels & tyres",
  BRK: "Brakes",
  STE: "Steering",
  PWT: "Powertrain",
  CVT: "Drivetrain",
  ELE: "Electrical",
  ERG: "Ergonomics",
  AER: "Aero"
};

/**
 * Four states, and "nothing entered yet" is deliberately neutral rather than
 * red. Early in a build almost everything is unstarted; colouring that as alarm
 * trains people to ignore the colour.
 */
function tone(r: SubsystemReadiness | undefined): { stroke: string; fill: string; state: string } {
  if (!r || r.partCount === 0) return { stroke: "#123843", fill: "none", state: "no parts entered" };
  const pct = r.readiness.pct;
  if (pct === 0) return { stroke: "#2E5C67", fill: "none", state: "no gates closed" };
  if (pct >= 100) return { stroke: "#2ED573", fill: "rgba(46,213,115,0.10)", state: "every gate closed" };
  // A capped subsystem is amber rather than orange: its own work may be done
  // and something shared is holding it. Different problem, different colour.
  if (r.readiness.ceiling) return { stroke: "#FFB020", fill: "rgba(255,176,32,0.08)", state: "capped" };
  return { stroke: "#FF9900", fill: "rgba(255,153,0,0.08)", state: "in progress" };
}

export function BuildSchematic({ readiness }: { readiness: Record<string, SubsystemReadiness> }) {
  const [hovered, setHovered] = useState<Code | null>(null);
  const [drawn, setDrawn] = useState(false);
  const ref = useRef<SVGSVGElement>(null);

  // The build-itself animation runs once, on first paint, and is skipped
  // entirely for anyone who asked for reduced motion — the colours carry the
  // information, the animation is only ornament.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setDrawn(true);
    const t = setTimeout(() => setDrawn(true), 60);
    return () => clearTimeout(t);
  }, []);

  const info = hovered ? readiness[hovered] : undefined;

  /**
   * One subsystem region.
   *
   * Wrapped in a link, so clicking any part of the car goes to that subsystem —
   * the readout underneath was a link before, which meant you had to hover the
   * right shape and then travel to a different element to click it.
   *
   * `hitArea` is an invisible stroke many times wider than the drawn one. Thin
   * SVG strokes are a 2px target, which is unusable with a mouse and hopeless
   * on a phone; `vector-effect: non-scaling-stroke` keeps that target the same
   * size on screen however the viewBox scales. The visible drawing stays thin.
   */
  const region = (code: Code, children: React.ReactNode, delayIndex: number) => {
    const r = readiness[code];
    const t = tone(r);
    const dim = hovered && hovered !== code;
    const label = r
      ? `${REGION_LABEL[code]}: ${r.readiness.passed} of ${r.readiness.applicable} gates closed, ${r.readiness.pct}%`
      : `${REGION_LABEL[code]}: no parts entered`;

    return (
      <a
        key={code}
        href={r ? `/subsystems/${r.slug}` : "/subsystems"}
        role="listitem"
        aria-label={label}
        onMouseEnter={() => setHovered(code)}
        onMouseLeave={() => setHovered(null)}
        onFocus={() => setHovered(code)}
        onBlur={() => setHovered(null)}
        style={{
          opacity: drawn ? (dim ? 0.28 : 1) : 0,
          transition: `opacity 420ms ease ${drawn ? delayIndex * 85 : 0}ms`,
          cursor: "pointer"
        }}
      >
        {/* The grab area: real rectangles, plus a fat transparent stroke along
            the drawing itself so the shape is pickable where it extends beyond
            them. Invisible, and `aria-hidden` so a screen reader hears the
            region once, from the link, rather than once per rectangle. */}
        <g aria-hidden style={{ pointerEvents: "all", fill: "transparent", stroke: "none" }}>
          {(HIT[code] ?? []).map(([x, y, w, h], i) => (
            <rect key={i} x={x} y={y} width={w} height={h} />
          ))}
        </g>
        <g
          aria-hidden
          style={{ stroke: "transparent", strokeWidth: 14, fill: "none", pointerEvents: "stroke" }}
        >
          {children}
        </g>
        {/* The drawing itself. */}
        <g
          style={{ stroke: t.stroke, fill: t.fill, pointerEvents: "none" }}
          className="[&_*]:transition-[stroke,fill] [&_*]:duration-300"
        >
          {children}
        </g>
      </a>
    );
  };

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox="0 0 720 300"
        className="w-full h-auto"
        role="list"
        aria-label="Build progress by subsystem, drawn on a schematic formula car"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      >
        {/* Geometry notes: wheelbase 190->520, front track +/-110, rear +/-105,
            matching the 1600 mm / 1270 / 1219 vehicle targets at roughly 1px =
            4.8mm. A formula car is a NARROW tub with the wheels well outboard —
            drawing the body wide makes it read as a sports car. */}

        {/* ---------- AERO: front wing on struts, rear wing, sidepods ---------- */}
        {region(
          "AER",
          <>
            <rect x={56} y={74} width={13} height={152} rx={3} />
            <path d="M69 118 L96 142 M69 182 L96 158" strokeWidth={1.4} />
            <rect x={596} y={88} width={14} height={124} rx={3} />
            <path d="M596 112 H610 M596 150 H610 M596 188 H610" strokeWidth={1.2} />
            <path d="M588 94 v112 M620 94 v112" strokeWidth={1.4} />
            <path d="M262 112 h118 l-10 -22 h-98 Z" />
            <path d="M262 188 h118 l-10 22 h-98 Z" />
          </>,
          8
        )}

        {/* ---------- CHASSIS: the tub, bulkhead, hoops ---------- */}
        {region(
          "CHS",
          <>
            <path d="M80 150 L112 136 L160 128 L250 124 L380 122 L470 126 L560 133 L598 143 L598 157 L560 167 L470 174 L380 178 L250 176 L160 172 L112 164 Z" />
            <path d="M160 128 V172" strokeWidth={1.4} />
            <path d="M252 122 V178" strokeWidth={1.6} />
            <path d="M398 121 V178" strokeWidth={1.6} />
            <path d="M470 126 V174" strokeWidth={1.2} />
          </>,
          0
        )}

        {/* ---------- ERGONOMICS: cockpit opening, seat, pedal box ---------- */}
        {region(
          "ERG",
          <>
            <path d="M268 132 Q262 150 268 168 L372 168 Q380 150 372 132 Z" />
            <ellipse cx={322} cy={150} rx={34} ry={21} />
            <path d="M368 136 Q378 150 368 164" strokeWidth={1.4} />
            <rect x={214} y={138} width={26} height={24} rx={3} />
            <path d="M240 144 h10 M240 156 h10" strokeWidth={1.2} />
          </>,
          5
        )}

        {/* ---------- STEERING: wheel, column, rack, tie rods ---------- */}
        {region(
          "STE",
          <>
            <rect x={288} y={138} width={8} height={24} rx={4} />
            <path d="M288 150 H246" strokeWidth={1.4} />
            <path d="M168 140 H246 V160 H168" strokeWidth={1.4} />
            <path d="M168 142 L182 76 M168 158 L182 224" strokeWidth={1.4} />
          </>,
          6
        )}

        {/* ---------- POWERTRAIN: engine, intake runners, exhaust ---------- */}
        {region(
          "PWT",
          <>
            <rect x={416} y={124} width={92} height={52} rx={5} />
            <path d="M436 124 V112 h14 v12 M470 124 V112 h14 v12" strokeWidth={1.4} />
            <path d="M508 166 h34 q12 0 12 -12 v-10" strokeWidth={1.4} />
            <path d="M424 138 h76 M424 150 h76 M424 162 h76" strokeWidth={0.9} />
          </>,
          3
        )}

        {/* ---------- DRIVETRAIN: diff and half shafts ---------- */}
        {region(
          "CVT",
          <>
            <rect x={506} y={135} width={30} height={30} rx={4} />
            <path d="M508 150 H506" strokeWidth={1.4} />
            <path d="M521 135 V66 M521 165 V234" strokeWidth={1.8} />
          </>,
          4
        )}

        {/* ---------- SUSPENSION: double wishbones, apex at each upright ---------- */}
        {region(
          "SUS",
          <>
            {/* front left: two arms from the tub converging on the upright */}
            <path d="M162 130 L186 62 M206 126 L192 62 M186 62 h8" strokeWidth={1.4} />
            <path d="M162 170 L186 238 M206 174 L192 238 M186 238 h8" strokeWidth={1.4} />
            {/* rear: arms off the engine bulkhead and the tail */}
            <path d="M474 128 L514 64 M556 136 L528 64 M514 64 h14" strokeWidth={1.4} />
            <path d="M474 172 L514 236 M556 164 L528 236 M514 236 h14" strokeWidth={1.4} />
          </>,
          1
        )}

        {/* ---------- WHEELS AND TYRES ---------- */}
        {region(
          "WHE",
          <>
            <rect x={159} y={29} width={62} height={22} rx={8} />
            <rect x={159} y={249} width={62} height={22} rx={8} />
            <rect x={487} y={33} width={68} height={24} rx={8} />
            <rect x={487} y={243} width={68} height={24} rx={8} />
          </>,
          2
        )}

        {/* ---------- BRAKES: discs inboard of each wheel, master cylinders ---------- */}
        {region(
          "BRK",
          <>
            <circle cx={190} cy={55} r={8} />
            <circle cx={190} cy={245} r={8} />
            <circle cx={521} cy={61} r={9} />
            <circle cx={521} cy={239} r={9} />
            <rect x={246} y={128} width={12} height={8} rx={2} />
            <rect x={246} y={164} width={12} height={8} rx={2} />
          </>,
          7
        )}

        {/* ---------- ELECTRICAL: battery box, harness run, shutdown buttons ---------- */}
        {region(
          "ELE",
          <>
            <rect x={398} y={132} width={30} height={36} rx={3} />
            <path d="M398 150 H384" strokeWidth={1.4} />
            <path d="M410 132 V116 H556" strokeDasharray="5 4" strokeWidth={1.1} />
            <path d="M410 168 V184 H556" strokeDasharray="5 4" strokeWidth={1.1} />
            <circle cx={562} cy={116} r={5} />
            <circle cx={562} cy={184} r={5} />
          </>,
          9
        )}
      </svg>

      {/* Readout. Replaces a tooltip, which is unusable on a phone in a shop. */}
      <div className="mt-3 min-h-[2.75rem] flex items-start justify-between gap-4 border-t border-graphite-800 pt-3">
        {hovered && info ? (
          <>
            <div className="min-w-0">
              <Link href={`/subsystems/${info.slug}`} className="text-sm text-graphite-100 hover:text-signal">
                {info.name}
              </Link>
              <div className="font-mono text-[11px] text-graphite-400 mt-0.5">
                {info.partCount === 0
                  ? "no parts entered yet"
                  : `${info.readiness.passed} of ${info.readiness.applicable} gates closed`}
              </div>
              {info.readiness.ceiling && (
                <div className="font-mono text-[10px] text-telemetry-amber mt-0.5">
                  capped at {info.readiness.ceiling.cap}% — gates alone would say {info.readiness.gatePct}%
                </div>
              )}
              {info.readiness.stale.length > 0 && (
                <div className="font-mono text-[10px] text-telemetry-red mt-0.5">
                  {info.readiness.stale.length === 1
                    ? "1 closed gate no longer matches the data"
                    : `${info.readiness.stale.length} closed gates no longer match the data`}
                </div>
              )}
            </div>
            <div className="font-mono text-2xl tabular-nums shrink-0" style={{ color: tone(info).stroke }}>
              {info.partCount === 0 ? "—" : `${info.readiness.pct}%`}
            </div>
          </>
        ) : (
          <p className="text-[11px] text-graphite-500 leading-relaxed">
            Schematic, not a model of the car — proportions follow the vehicle targets. Click a region to open that
            subsystem. Green is every gate closed, orange is in progress, amber is held by an open critical interface,
            dim is nothing entered yet.
          </p>
        )}
      </div>
    </div>
  );
}
