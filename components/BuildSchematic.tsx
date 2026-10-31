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
  // Verified by hit test rather than by eye: a script asks the browser what
  // actually answers at the centre of every rectangle here. It has caught
  // three rounds of collisions. If you move the drawing, re-run it — an
  // overlapping rect fails silently and feels like a flaky interface rather
  // than a bug.
  //
  // The chassis gets the nose bay only. Its tub runs underneath every other
  // region, so a rectangle covering it would swallow half the car.
  CHS: [[122, 138, 38, 24]],
  AER: [[68, 60, 26, 180], [288, 100, 84, 12], [288, 190, 84, 12], [582, 74, 24, 152]],
  SUS: [[168, 72, 56, 54], [168, 174, 56, 54], [462, 76, 44, 52], [462, 172, 44, 52]],
  // Outboard slivers of each tyre, clear of the brake disc at the wheel centre.
  WHE: [[163, 31, 15, 18], [163, 251, 15, 18], [491, 33, 16, 20], [491, 247, 16, 20]],
  BRK: [[183, 33, 14, 14], [183, 253, 14, 14], [513, 36, 16, 14], [513, 250, 16, 14], [230, 130, 11, 8]],
  STE: [[170, 142, 54, 16], [288, 139, 12, 22]],
  PWT: [[408, 130, 74, 40], [302, 179, 46, 10]],
  CVT: [[506, 138, 28, 24], [514, 76, 12, 52], [514, 172, 12, 52]],
  ELE: [[392, 132, 22, 26], [552, 108, 10, 20]],
  // Starts past the steering wheel, which sits inside the cockpit opening.
  ERG: [[306, 136, 56, 28]]
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
        {/* Geometry notes: wheelbase 190->520, front track +/-110, rear +/-105,
            matching the 1600 mm / 1270 / 1219 vehicle targets at roughly 1px =
            4.8mm. A formula car is a NARROW tub with the wheels well outboard —
            drawing the body wide makes it read as a sports car. */}

        {/* Geometry notes. Top view, nose at the left, 1600 mm wheelbase over
            330px so roughly 1px = 4.8mm. Front axle x=190, rear x=521; front
            track +/-110 and rear +/-105 against the 1270/1219 targets.

            A formula car in plan view is three things: a very NARROW tub, wheels
            a long way outboard of it, and wings that span most of the track.
            The first draft of this got all three wrong — a wide hull with
            narrow wings reads as a sports car, which is what it looked like. */}

        {/* ---------- AERO: wings and sidepods ---------------------------- */}
        {region(
          "AER",
          <>
            {/* Front wing. Thin fore-aft and spanning just inside the front
                track — drawn deep, it reads as a wall rather than a wing. */}
            <path d="M74 64 H92 V236 H74 Z" />
            <path d="M74 110 H92 M74 150 H92 M74 190 H92" strokeWidth={0.9} />
            <path d="M68 58 H80 V86 H68 Z" strokeWidth={1.3} />
            <path d="M68 214 H80 V242 H68 Z" strokeWidth={1.3} />
            {/* Rear wing, narrower span, behind the rear axle. */}
            <path d="M588 78 H604 V222 H588 Z" />
            <path d="M588 118 H604 M588 150 H604 M588 182 H604" strokeWidth={0.9} />
            <path d="M582 72 H594 V98 H582 Z" strokeWidth={1.3} />
            <path d="M582 202 H594 V228 H582 Z" strokeWidth={1.3} />
            {/* Sidepods: small pods OUTBOARD of the tub, not a box around it. */}
            <path d="M286 100 H368 L376 112 H286 Z" />
            <path d="M286 200 H368 L376 188 H286 Z" />
          </>,
          8
        )}

        {/* ---------- CHASSIS: nose, tub, bulkheads, hoops ----------------- */}
        {region(
          "CHS",
          <>
            {/* Impact attenuator, then a nose that tapers back to the bulkhead. */}
            <rect x={104} y={140} width={14} height={20} rx={2} strokeWidth={1.3} />
            <path d="M118 142 L164 130 L164 170 L118 158 Z" />
            {/* The tub: widest at the cockpit, tapering both ways. */}
            <path d="M164 130 L242 124 L264 122 L386 122 L452 128 L520 138 L552 146
                     L552 154 L520 162 L452 172 L386 178 L264 178 L242 176 L164 170 Z" />
            <path d="M164 130 V170" strokeWidth={1.5} />
            <path d="M264 122 V178" strokeWidth={1.7} />
            <path d="M386 122 V178" strokeWidth={2.3} />
            <path d="M452 128 V172" strokeWidth={1.3} />
          </>,
          0
        )}

        {/* ---------- ERGONOMICS: cockpit, seat, headrest, pedals ---------- */}
        {region(
          "ERG",
          <>
            <path d="M280 134 Q274 150 280 166 L378 166 Q384 150 378 134 Z" />
            <ellipse cx={332} cy={150} rx={28} ry={15} />
            <rect x={368} y={138} width={14} height={24} rx={3} strokeWidth={1.3} />
            <rect x={206} y={140} width={22} height={20} rx={3} />
          </>,
          5
        )}

        {/* ---------- STEERING: wheel, column, rack, tie rods -------------- */}
        {region(
          "STE",
          <>
            <rect x={290} y={139} width={7} height={22} rx={3.5} />
            <path d="M290 150 H262" strokeWidth={1.4} />
            {/* Rack ahead of the front bulkhead, tie rods out to each upright. */}
            <path d="M166 142 H228 V158 H166" strokeWidth={1.4} />
            <path d="M166 143 L186 62 M166 157 L186 238" strokeWidth={1.3} />
          </>,
          6
        )}

        {/* ---------- POWERTRAIN: engine, intake, exhaust, radiator -------- */}
        {region(
          "PWT",
          <>
            <rect x={406} y={128} width={78} height={44} rx={4} />
            <path d="M424 128 V116 h10 v12 M452 128 V116 h10 v12" strokeWidth={1.3} />
            <rect x={420} y={104} width={44} height={12} rx={3} strokeWidth={1.2} />
            <path d="M484 164 h26 q12 0 12 -10 v-6" strokeWidth={1.3} />
            {/* Radiator in the left pod. */}
            <rect x={300} y={178} width={50} height={12} rx={2} strokeWidth={1.2} />
            <path d="M414 140 h62 M414 150 h62 M414 160 h62" strokeWidth={0.8} />
          </>,
          3
        )}

        {/* ---------- DRIVETRAIN: diff, half shafts, chain ----------------- */}
        {region(
          "CVT",
          <>
            <rect x={504} y={136} width={32} height={28} rx={4} />
            {/* Chain run from the engine sprocket to the diff. */}
            <path d="M502 144 H504 M502 156 H504" strokeWidth={1.2} />
            <path d="M498 140 H506 M498 160 H506" strokeWidth={1} />
            {/* Half shafts out to each rear upright, laterally. */}
            <path d="M520 136 V70 M520 164 V230" strokeWidth={1.8} />
            {/* Tripod joints at each end. */}
            <circle cx={520} cy={78} r={4} strokeWidth={1.2} />
            <circle cx={520} cy={222} r={4} strokeWidth={1.2} />
          </>,
          4
        )}

        {/* ---------- SUSPENSION: double wishbones and uprights ------------ */}
        {region(
          "SUS",
          <>
            {/* Front. Two arms per corner converging on the upright — the
                pushrods and rockers were drawn in and just read as noise at
                this size, so they are left out. */}
            <path d="M166 134 L184 70 M230 130 L192 70" strokeWidth={1.3} />
            <path d="M183 64 h12 V78 h-12 Z" strokeWidth={1.4} />
            <path d="M166 166 L184 230 M230 170 L192 230" strokeWidth={1.3} />
            <path d="M183 222 h12 V236 h-12 Z" strokeWidth={1.4} />
            {/* Rear. */}
            <path d="M458 132 L512 74 M548 146 L528 74" strokeWidth={1.3} />
            <path d="M513 68 h14 V82 h-14 Z" strokeWidth={1.4} />
            <path d="M458 168 L512 226 M548 154 L528 226" strokeWidth={1.3} />
            <path d="M513 218 h14 V232 h-14 Z" strokeWidth={1.4} />
          </>,
          1
        )}

        {/* ---------- WHEELS AND TYRES: 13in, front narrower than rear ----- */}
        {region(
          "WHE",
          <>
            <rect x={162} y={28} width={56} height={24} rx={7} />
            <rect x={162} y={248} width={56} height={24} rx={7} />
            <rect x={490} y={30} width={62} height={26} rx={7} />
            <rect x={490} y={244} width={62} height={26} rx={7} />
            {/* Tread lines, so a tyre reads as a tyre and not a pill. */}
            <path d="M176 28 V52 M190 28 V52 M204 28 V52" strokeWidth={0.8} />
            <path d="M176 248 V272 M190 248 V272 M204 248 V272" strokeWidth={0.8} />
            <path d="M506 30 V56 M521 30 V56 M536 30 V56" strokeWidth={0.8} />
            <path d="M506 244 V270 M521 244 V270 M536 244 V270" strokeWidth={0.8} />
          </>,
          2
        )}

        {/* ---------- BRAKES: discs, calipers, master cylinders ------------ */}
        {region(
          "BRK",
          <>
            <circle cx={190} cy={40} r={9} />
            <circle cx={190} cy={260} r={9} />
            <circle cx={521} cy={43} r={10} />
            <circle cx={521} cy={257} r={10} />
            <rect x={197} y={34} width={6} height={12} rx={2} strokeWidth={1.2} />
            <rect x={197} y={254} width={6} height={12} rx={2} strokeWidth={1.2} />
            <rect x={529} y={37} width={7} height={12} rx={2} strokeWidth={1.2} />
            <rect x={529} y={251} width={7} height={12} rx={2} strokeWidth={1.2} />
            <rect x={230} y={130} width={11} height={8} rx={2} />
            <rect x={230} y={162} width={11} height={8} rx={2} />
          </>,
          7
        )}

        {/* ---------- ELECTRICAL: accumulator, harness, shutdown ----------- */}
        {region(
          "ELE",
          <>
            <rect x={390} y={130} width={26} height={30} rx={3} />
            <path d="M390 145 H380" strokeWidth={1.3} />
            <path d="M400 130 V116 H548" strokeDasharray="5 4" strokeWidth={1} />
            <circle cx={556} cy={116} r={5} />
            <circle cx={556} cy={184} r={5} />
            <path d="M400 160 V184 H548" strokeDasharray="5 4" strokeWidth={1} />
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
