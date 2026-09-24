import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import type { Part } from "@/lib/queries";

const NODE_W = 168;
const NODE_H = 46;
const ROW_GAP = 14;
const COL_GAP = 140;

export function DependencyGraph({
  centerLabel,
  centerHref,
  centerStatus,
  requires,
  blocks
}: {
  centerLabel: string;
  centerHref?: string;
  centerStatus?: string;
  requires: Part[];
  blocks: Part[];
}) {
  const rows = Math.max(requires.length, blocks.length, 1);
  const height = rows * (NODE_H + ROW_GAP) - ROW_GAP + 20;
  const width = NODE_W * 3 + COL_GAP * 2;
  const centerX = width / 2 - NODE_W / 2;
  const centerY = height / 2 - NODE_H / 2;

  const leftX = 0;
  const rightX = width - NODE_W;

  const yFor = (i: number, count: number) => {
    const blockHeight = count * (NODE_H + ROW_GAP) - ROW_GAP;
    const start = (height - blockHeight) / 2;
    return start + i * (NODE_H + ROW_GAP);
  };

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="min-w-full" style={{ minWidth: width }}>
        {/* edges: requires -> center */}
        {requires.map((r, i) => {
          const y = yFor(i, requires.length) + NODE_H / 2;
          return (
            <path
              key={`req-edge-${r.id}`}
              d={`M ${leftX + NODE_W} ${y} C ${leftX + NODE_W + COL_GAP / 2} ${y}, ${centerX - COL_GAP / 2} ${centerY + NODE_H / 2}, ${centerX} ${centerY + NODE_H / 2}`}
              fill="none"
              stroke="#343C44"
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            />
          );
        })}
        {/* edges: center -> blocks */}
        {blocks.map((b, i) => {
          const y = yFor(i, blocks.length) + NODE_H / 2;
          return (
            <path
              key={`blk-edge-${b.id}`}
              d={`M ${centerX + NODE_W} ${centerY + NODE_H / 2} C ${centerX + NODE_W + COL_GAP / 2} ${centerY + NODE_H / 2}, ${rightX - COL_GAP / 2} ${y}, ${rightX} ${y}`}
              fill="none"
              stroke="#343C44"
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            />
          );
        })}

        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4A545D" />
          </marker>
        </defs>

        {/* requires nodes */}
        {requires.map((r, i) => (
          <GraphNode key={r.id} x={leftX} y={yFor(i, requires.length)} part={r} />
        ))}

        {/* center node */}
        <g transform={`translate(${centerX}, ${centerY})`}>
          <rect width={NODE_W} height={NODE_H} rx={4} fill="#1C2126" stroke="#FF5A1F" strokeWidth={1.5} />
          <text x={NODE_W / 2} y={NODE_H / 2} textAnchor="middle" dominantBaseline="middle" fill="#E4E8EB" fontSize={12} fontFamily="monospace" fontWeight={600}>
            {truncate(centerLabel, 20)}
          </text>
        </g>

        {/* blocks nodes */}
        {blocks.map((b, i) => (
          <GraphNode key={b.id} x={rightX} y={yFor(i, blocks.length)} part={b} />
        ))}
      </svg>

      <div className="flex justify-between mt-2 px-1">
        <span className="data-label">{requires.length > 0 ? "REQUIRES" : ""}</span>
        <span className="data-label">{blocks.length > 0 ? "BLOCKS" : ""}</span>
      </div>
    </div>
  );
}

function GraphNode({ x, y, part }: { x: number; y: number; part: Part }) {
  const isOwned = ["OWNED", "AVAILABLE_FOR_INSTALLATION", "INSTALLED"].includes(part.status);
  const stroke = isOwned ? "#2ED573" : "#4A545D";
  return (
    <g transform={`translate(${x}, ${y})`}>
      <a href={`/parts/${part.id}`}>
        <rect width={NODE_W} height={NODE_H} rx={4} fill="#161A1E" stroke={stroke} strokeWidth={1.25} />
        <text x={10} y={18} fill="#C4CBD1" fontSize={11} fontFamily="ui-sans-serif, sans-serif">
          {truncate(part.part_name, 22)}
        </text>
        <text x={10} y={34} fill={isOwned ? "#2ED573" : "#98A2AA"} fontSize={9} fontFamily="monospace" letterSpacing={0.5}>
          {part.status.replace(/_/g, " ")}
        </text>
      </a>
    </g>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
