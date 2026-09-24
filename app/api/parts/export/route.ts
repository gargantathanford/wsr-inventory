import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getDb } from "@/lib/db";

const COLUMNS = [
  "Part Name",
  "Part Number",
  "Subsystem",
  "Manufacturer",
  "Category",
  "Quantity Required",
  "Quantity Owned",
  "Quantity Needed",
  "Status",
  "Importance",
  "Priority Score",
  "Estimated Cost",
  "Actual Cost",
  "Lead Time (days)",
  "Priority Score (Procurement)",
  "Purchase URL",
  "Supplier",
  "Owner",
  "CAD Status",
  "Documentation Status"
] as const;

function buildRows(filters: { subsystemId?: string; status?: string; importance?: string }) {
  const db = getDb();
  let sql = `
    SELECT p.*, s.name as subsystem_name, u.name as owner_name
    FROM parts p
    JOIN subsystems s ON s.id = p.subsystem_id
    LEFT JOIN users u ON u.id = p.owner_user_id
    WHERE 1=1
  `;
  const params: any[] = [];
  if (filters.subsystemId) {
    sql += ` AND p.subsystem_id = ?`;
    params.push(filters.subsystemId);
  }
  if (filters.status) {
    sql += ` AND p.status = ?`;
    params.push(filters.status);
  }
  if (filters.importance) {
    sql += ` AND p.importance = ?`;
    params.push(filters.importance);
  }
  sql += ` ORDER BY s.name ASC, p.part_name ASC`;
  const parts = db.prepare(sql).all(...params) as any[];

  return parts.map((p) => ({
    "Part Name": p.part_name,
    "Part Number": p.part_number || "",
    Subsystem: p.subsystem_name,
    Manufacturer: p.manufacturer || "",
    Category: p.category || "",
    "Quantity Required": p.quantity_required,
    "Quantity Owned": p.quantity_owned,
    "Quantity Needed": Math.max(p.quantity_required - p.quantity_owned, 0),
    Status: String(p.status).replace(/_/g, " "),
    Importance: p.importance,
    "Priority Score": p.priority_score,
    "Estimated Cost": p.estimated_cost ?? "",
    "Actual Cost": p.actual_cost ?? "",
    "Lead Time (days)": p.lead_time_days ?? "",
    "Purchase URL": p.purchase_url || "",
    Supplier: p.supplier || "",
    Owner: p.owner_name || "",
    "CAD Status": p.cad_status || "",
    "Documentation Status": p.documentation_status || ""
  }));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") || "csv").toLowerCase();
  const rows = buildRows({
    subsystemId: searchParams.get("subsystem") || undefined,
    status: searchParams.get("status") || undefined,
    importance: searchParams.get("importance") || undefined
  });

  const sheet = XLSX.utils.json_to_sheet(rows);
  const filename = `warp-speed-racing-bom-${new Date().toISOString().slice(0, 10)}`;

  if (format === "xlsx") {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "BOM");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`
      }
    });
  }

  const csv = XLSX.utils.sheet_to_csv(sheet);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`
    }
  });
}
