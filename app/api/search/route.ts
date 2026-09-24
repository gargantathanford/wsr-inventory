import { NextRequest, NextResponse } from "next/server";
import { globalSearch } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") || "";
  if (!q.trim()) return NextResponse.json({ parts: [], tools: [], documents: [], instructions: [], subsystems: [] });
  return NextResponse.json(globalSearch(q.trim()));
}
