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
  // [x, y, width, height] in viewBox units. THESE MUST NOT OVERLAP.
  //
  // Verified by hit test, never by eye: a script asks the browser what actually
  // answers at the centre of every rectangle here. It has caught four rounds of
  // collisions. Re-run it after moving anything — an overlapping rect fails
  // silently and feels like a flaky interface rather than a bug.
  //
  // The chassis gets the nose bay and the rear bay only. Its rails run
  // underneath every other region, so a rectangle covering the whole frame
  // would swallow the car.
  CHS: [[106, 136, 60, 28], [536, 120, 22, 24]],
  AER: [[56, 60, 24, 180], [292, 94, 80, 14], [292, 192, 80, 14], [578, 72, 22, 156]],
  SUS: [[168, 84, 60, 36], [168, 180, 60, 36], [480, 86, 70, 30], [480, 184, 70, 30]],
  // Outboard slivers of each tyre, clear of the brake disc at the wheel centre.
  WHE: [[163, 29, 15, 20], [163, 251, 15, 20], [491, 34, 15, 20], [491, 246, 15, 20]],
  BRK: [[183, 33, 14, 14], [183, 253, 14, 14], [513, 38, 14, 14], [513, 248, 14, 14], [212, 130, 11, 8]],
  STE: [[218, 143, 24, 14], [266, 141, 11, 18]],
  PWT: [[454, 118, 42, 64], [298, 183, 44, 9]],
  CVT: [[506, 136, 26, 28], [513, 118, 12, 14], [513, 168, 12, 14]],
  ELE: [[432, 134, 16, 32], [546, 112, 12, 12]],
  // Starts past the steering wheel, which sits inside the cockpit opening.
  ERG: [[286, 132, 70, 36]]
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
        {/* The grab area: rectangles only, and they do not overlap each other.
            A fat transparent stroke along the drawing was the previous approach
            and it had to go — once the geometry got denser, a 14px stroke on
            every region stole pointer area from its neighbours, so pointing at
            a tyre selected Brakes and pointing at a sidepod selected Chassis.
            Rectangles are less generous and completely predictable, which is
            the better trade: a target you can rely on beats a bigger one that
            sometimes belongs to somebody else.

            aria-hidden so a screen reader announces the region once, from the
            link, rather than once per rectangle. */}
        <g aria-hidden style={{ pointerEvents: "all", fill: "transparent", stroke: "none" }}>
          {(HIT[code] ?? []).map(([x, y, w, h], i) => (
            <rect key={i} x={x} y={y} width={w} height={h} />
          ))}
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
        {/* GEOMETRY. Traced from Warp Speed Racing's own SolidWorks top view of
            the chassis, not approximated. The frame stations are taken off that
            drawing as fractions of its overall length and mapped onto the
            vehicle targets: 1600 mm wheelbase over 331px (front axle x=190,
            rear x=521), 1270/1219 track, so roughly 1px = 4.83 mm.

              x=100  front bulkhead
              x=172  front bulkhead support
              x=242  front hoop
              x=394  main hoop        (the frame is widest here)
              x=449  rear of the hoop bracing
              x=477  rear bay forward station
              x=560  back of the frame

            Three earlier versions were drawn from imagination and all three
            read as the wrong kind of car — the giveaway every time was the tub,
            which guesswork makes too wide and too parallel. A real spaceframe
            is narrow at the nose and opens steadily to the main hoop. */}

        {/* ---------- AERO: wings and sidepods ---------------------------- */}
        {region(
          "AER",
          <>
            <path d="M60 58 H78 V242 H60 Z" />
            <path d="M60 104 H78 M60 150 H78 M60 196 H78" strokeWidth={0.9} />
            <path d="M54 52 H66 V80 H54 Z" strokeWidth={1.3} />
            <path d="M54 220 H66 V248 H54 Z" strokeWidth={1.3} />
            <path d="M582 74 H598 V226 H582 Z" />
            <path d="M582 112 H598 M582 150 H598 M582 188 H598" strokeWidth={0.9} />
            <path d="M576 68 H588 V94 H576 Z" strokeWidth={1.3} />
            <path d="M576 206 H588 V232 H576 Z" strokeWidth={1.3} />
            {/* Sidepods sit OUTBOARD of the frame rails, which taper — so these
                follow the taper rather than being parallel boxes. */}
            <path d="M276 108 L380 92 L384 104 L276 120 Z" />
            <path d="M276 192 L380 208 L384 196 L276 180 Z" />
          </>,
          8
        )}

        {/* ---------- CHASSIS: the spaceframe, traced from CAD ------------- */}
        {region(
          "CHS",
          <>
            {/* Impact attenuator ahead of the front bulkhead. */}
            <rect x={86} y={138} width={14} height={24} rx={2} strokeWidth={1.3} />
            {/* The frame rails. Narrow at the nose, opening to the main hoop,
                then closing slightly through the rear bay. */}
            <path d="M100 132 L172 124 L242 116 L394 98 L449 100 L477 105 L560 107
                     L560 193 L477 195 L449 200 L394 202 L242 184 L172 176 L100 168 Z" />
            {/* Bulkheads and hoops, weighted by how much they matter. */}
            <path d="M100 132 V168" strokeWidth={1.5} />
            <path d="M172 124 V176" strokeWidth={1.4} />
            <path d="M242 116 V184" strokeWidth={1.9} />
            <path d="M449 100 V200" strokeWidth={1.4} />
            <path d="M477 105 V195" strokeWidth={1.2} />
            <path d="M560 107 V193" strokeWidth={1.4} />
            {/* Main hoop: the one bent tube on the car, and it reads as a curve
                from above rather than a straight bulkhead. */}
            <path d="M394 98 Q412 99 414 118 L414 182 Q412 201 394 202" strokeWidth={2.4} />
            {/* X-bracing, bay by bay, as drawn in the CAD view. */}
            <path d="M100 132 L172 176 M100 168 L172 124" strokeWidth={0.9} />
            <path d="M172 124 L242 184 M172 176 L242 116" strokeWidth={0.9} />
            <path d="M242 116 L394 202 M242 184 L394 98" strokeWidth={0.9} />
            <path d="M477 105 L560 193 M477 195 L560 107" strokeWidth={0.9} />
            {/* Main hoop bracing back into the rear bay. */}
            <path d="M414 120 L477 105 M414 180 L477 195" strokeWidth={1} />
          </>,
          0
        )}

        {/* ---------- ERGONOMICS: cockpit between the two hoops ------------ */}
        {region(
          "ERG",
          <>
            {/* The opening sits between the front hoop and the main hoop,
                because that is literally where the driver is. */}
            <path d="M256 126 Q250 150 256 174 L384 182 Q392 150 384 118 Z" />
            <ellipse cx={322} cy={150} rx={30} ry={17} />
            <rect x={372} y={136} width={14} height={28} rx={3} strokeWidth={1.3} />
            {/* Pedal box forward of the front hoop, in the nose bay. */}
            <rect x={188} y={140} width={22} height={20} rx={3} />
          </>,
          5
        )}

        {/* ---------- STEERING: wheel, column, rack ahead of the hoop ------ */}
        {region(
          "STE",
          <>
            <rect x={268} y={140} width={7} height={20} rx={3.5} />
            <path d="M268 150 H244" strokeWidth={1.3} />
            <path d="M216 143 H244 V157 H216" strokeWidth={1.3} />
            <path d="M214 144 L188 70 M214 156 L188 230" strokeWidth={1.2} />
          </>,
          6
        )}

        {/* ---------- POWERTRAIN: engine in the rear bay ------------------- */}
        {region(
          "PWT",
          <>
            <rect x={452} y={116} width={46} height={68} rx={4} />
            <path d="M462 116 V106 h10 v10 M482 116 V106 h10 v10" strokeWidth={1.2} />
            <rect x={458} y={94} width={38} height={12} rx={3} strokeWidth={1.2} />
            <path d="M498 176 h24 q10 0 10 -9 v-6" strokeWidth={1.3} />
            {/* Radiator in the left pod, outboard of the rails. */}
            <rect x={296} y={182} width={48} height={11} rx={2} strokeWidth={1.2} />
            <path d="M460 128 h30 M460 150 h30 M460 172 h30" strokeWidth={0.8} />
          </>,
          3
        )}

        {/* ---------- DRIVETRAIN: diff on the rear axle, half shafts ------- */}
        {region(
          "CVT",
          <>
            <rect x={504} y={134} width={30} height={32} rx={4} />
            <path d="M498 142 H504 M498 158 H504" strokeWidth={1.1} />
            <path d="M519 134 V78 M519 166 V222" strokeWidth={1.8} />
            <circle cx={519} cy={84} r={4} strokeWidth={1.2} />
            <circle cx={519} cy={216} r={4} strokeWidth={1.2} />
          </>,
          4
        )}

        {/* ---------- SUSPENSION: wishbones off the frame nodes ------------ */}
        {region(
          "SUS",
          <>
            {/* Front: arms pick up on the bulkhead support and the front hoop,
                which is where the CAD shows the nodes. */}
            <path d="M166 126 L186 70 M236 118 L194 70" strokeWidth={1.3} />
            <path d="M184 64 h14 V78 h-14 Z" strokeWidth={1.4} />
            <path d="M166 174 L186 230 M236 182 L194 230" strokeWidth={1.3} />
            <path d="M184 222 h14 V236 h-14 Z" strokeWidth={1.4} />
            {/* Rear: off the rear bay stations. */}
            <path d="M479 104 L513 80 M558 108 L527 80" strokeWidth={1.3} />
            <path d="M512 72 h14 V86 h-14 Z" strokeWidth={1.4} />
            <path d="M479 196 L513 220 M558 192 L527 220" strokeWidth={1.3} />
            <path d="M512 214 h14 V228 h-14 Z" strokeWidth={1.4} />
          </>,
          1
        )}

        {/* ---------- WHEELS: front track wider than rear ------------------ */}
        {region(
          "WHE",
          <>
            <rect x={162} y={28} width={56} height={24} rx={7} />
            <rect x={162} y={248} width={56} height={24} rx={7} />
            <rect x={490} y={33} width={60} height={24} rx={7} />
            <rect x={490} y={243} width={60} height={24} rx={7} />
            <path d="M176 28 V52 M190 28 V52 M204 28 V52" strokeWidth={0.8} />
            <path d="M176 248 V272 M190 248 V272 M204 248 V272" strokeWidth={0.8} />
            <path d="M505 33 V57 M520 33 V57 M535 33 V57" strokeWidth={0.8} />
            <path d="M505 243 V267 M520 243 V267 M535 243 V267" strokeWidth={0.8} />
          </>,
          2
        )}

        {/* ---------- BRAKES: discs at each wheel, masters at the pedals --- */}
        {region(
          "BRK",
          <>
            <circle cx={190} cy={40} r={9} />
            <circle cx={190} cy={260} r={9} />
            <circle cx={520} cy={45} r={9} />
            <circle cx={520} cy={255} r={9} />
            <rect x={197} y={34} width={6} height={12} rx={2} strokeWidth={1.2} />
            <rect x={197} y={254} width={6} height={12} rx={2} strokeWidth={1.2} />
            <rect x={527} y={39} width={6} height={12} rx={2} strokeWidth={1.2} />
            <rect x={527} y={249} width={6} height={12} rx={2} strokeWidth={1.2} />
            <rect x={212} y={130} width={11} height={8} rx={2} />
            <rect x={212} y={162} width={11} height={8} rx={2} />
          </>,
          7
        )}

        {/* ---------- ELECTRICAL: box behind the main hoop ----------------- */}
        {region(
          "ELE",
          <>
            <rect x={430} y={132} width={20} height={36} rx={3} />
            <path d="M430 150 H422" strokeWidth={1.3} />
            <path d="M440 132 V118 H546" strokeDasharray="5 4" strokeWidth={1} />
            <path d="M440 168 V182 H546" strokeDasharray="5 4" strokeWidth={1} />
            <circle cx={552} cy={118} r={4} />
            <circle cx={552} cy={182} r={4} />
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
            Frame traced from the team&rsquo;s CAD top view; everything else is schematic. Click a region to open that
            subsystem. Green is every gate closed, orange is in progress, amber is held by an open critical interface,
            dim is nothing entered yet.
          </p>
        )}
      </div>
    </div>
  );
}
