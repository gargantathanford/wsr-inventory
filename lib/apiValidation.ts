import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Turning validation and database failures into something a person can act on.
 *
 * THE BUG THIS FIXES. Routes used to answer a failed parse with
 * `{ error: parsed.error.flatten() }` — an OBJECT. Every form in the app does:
 *
 *     setError(typeof data.error === "string" ? data.error : "Could not create X.")
 *
 * so the object fell through the `typeof` check and every validation failure in
 * the app, in all fourteen forms, surfaced as a generic sentence with the actual
 * reason discarded. Jonathan hit it on the calendar and the procedure form and
 * had no way to tell what was wrong, which is the correct conclusion to draw
 * from a message that says nothing.
 *
 * So `error` is ALWAYS a string here. The forms then work as written, with no
 * change to any of them, and `fields` carries the per-field detail for any form
 * that later wants to highlight inputs.
 */

/** Field name -> the label a person recognises from the form. */
const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  item_name: "Item name",
  part_name: "Part name",
  name: "Name",
  deadline_date: "Date",
  deadline_time: "Time",
  subsystem_id: "Subsystem",
  subteam_id: "Subteam",
  part_id: "Part",
  responsible_user_id: "Responsible person",
  owner_user_id: "Owner",
  assignee_ids: "Assignees",
  quantity: "Quantity",
  quantity_required: "Quantity required",
  estimated_cost: "Estimated cost",
  estimated_cost_low: "Cost (low)",
  estimated_cost_high: "Cost (high)",
  priority: "Priority",
  status: "Status",
  design_status: "Design status",
  acceptance_criterion: "Acceptance criterion",
  governing_rule: "Governing rule",
  notify_scope: "Who to notify",
  event_type: "Event type",
  category: "Category",
  steps: "Steps",
  revision_number: "Revision",
  email: "Email",
  role: "Role",
  password: "Password",
  vendor: "Vendor",
  product_link: "Product link",
  justification: "Justification"
};

function label(field: string): string {
  return FIELD_LABEL[field] ?? field.replace(/_/g, " ").replace(/\bid\b/i, "").trim();
}

/**
 * Zod's own messages are written for developers ("Expected number, received
 * string"). These are written for whoever is filling in the form.
 */
function humanise(issue: z.ZodIssue, field: string): string {
  const name = label(field);
  switch (issue.code) {
    case "invalid_type":
      if (issue.received === "undefined" || issue.received === "null") return `${name} is required`;
      if (issue.expected === "number") return `${name} must be a number`;
      if (issue.expected === "boolean") return `${name} must be yes or no`;
      return `${name} is not in the expected format`;
    case "too_small":
      if (issue.type === "string") return issue.minimum === 1 ? `${name} is required` : `${name} is too short`;
      if (issue.type === "array") return issue.minimum === 1 ? `${name}: add at least one` : `${name}: not enough entries`;
      return `${name} must be at least ${issue.minimum}`;
    case "too_big":
      if (issue.type === "string") return `${name} is too long (max ${issue.maximum} characters)`;
      return `${name} must be at most ${issue.maximum}`;
    case "invalid_enum_value":
      return `${name} must be one of: ${issue.options.join(", ")}`;
    case "invalid_string":
      if (issue.validation === "email") return `${name} is not a valid email address`;
      if (issue.validation === "url") return `${name} must be a full URL starting with http:// or https://`;
      return `${name} is not valid`;
    default:
      return `${name}: ${issue.message}`;
  }
}

/**
 * 400 for a failed parse, with a sentence naming every problem at once.
 *
 * All of them, not the first — a form that reveals one missing field per submit
 * makes people guess, and guessing is what Jonathan was reduced to.
 */
export function invalid(error: z.ZodError, context?: string): NextResponse {
  const problems: string[] = [];
  const fields: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.length ? String(issue.path[0]) : "";
    const text = field ? humanise(issue, field) : issue.message;
    if (!problems.includes(text)) problems.push(text);
    if (field) (fields[field] ??= []).push(text);
  }

  // Joined without lowercasing the trailing clause. Each problem starts with a
  // field LABEL — "Quantity", "Date" — and lowercasing it for grammar's sake
  // turns the one word the person needs to spot into prose they skim past.
  const joined =
    problems.length === 1
      ? problems[0]
      : problems.length === 2
        ? `${problems[0]} and ${problems[1]}`
        : problems.slice(0, -1).join(", ") + ", and " + problems[problems.length - 1];

  return NextResponse.json(
    { error: context ? `${context}: ${joined}.` : `${joined}.`, fields },
    { status: 400 }
  );
}

/**
 * A reference to another row: a subsystem, a part, a person.
 *
 * `Object.fromEntries(new FormData(form).entries())` makes EVERY value a string,
 * so an unselected `<option value="">` arrives as `""`. A plain
 * `z.string().optional().nullable()` accepts that happily, and `data.x ?? null`
 * does not catch it either — `""` is neither null nor undefined. The empty
 * string then reaches a `REFERENCES` column and SQLite raises
 * `FOREIGN KEY constraint failed`, which escapes the route as a 500 with no
 * JSON body at all. That is the second half of why the calendar form failed
 * with no reason: selecting "All Teams" sent `subsystem_id: ""`.
 *
 * Coercing here rather than at each call site, because every form in the app
 * posts this way and the next one will too.
 */
export const optionalRef = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.string().nullable()
);

/** Optional free text. Blank means "not provided", never a stored empty string. */
export const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v === undefined ? null : v),
  z.string().nullable()
);

/** Optional number from a form, where "" means absent rather than 0. */
export const optionalNumber = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number().nullable()
);

/** Required number from a form field, which always arrives as a string. */
export const formNumber = z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number());

/**
 * SQLite constraint failures, as a sentence instead of a 500.
 *
 * Without this, a CHECK or FOREIGN KEY violation throws out of the route
 * handler, Next.js answers with a non-JSON 500, the client's
 * `res.json().catch(() => ({}))` yields `{}` and the person sees the generic
 * fallback. Same end result as the Zod bug above, different cause, so both get
 * closed or neither is really fixed.
 */
export function dbError(e: unknown, context?: string): NextResponse {
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? "";
  const msg = err?.message ?? String(e);
  const prefix = context ? `${context}: ` : "";

  if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    return NextResponse.json(
      {
        error:
          `${prefix}one of the selections points at something that no longer exists. ` +
          `Reload the page and choose again — a subsystem, part or person may have been removed.`
      },
      { status: 409 }
    );
  }
  if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return NextResponse.json({ error: `${prefix}that already exists.` }, { status: 409 });
  }
  if (code === "SQLITE_CONSTRAINT_CHECK") {
    // The CHECK clause names the column and its allowed values; surfacing the
    // column is far more useful than "invalid value somewhere".
    const col = /CHECK constraint failed:\s*([a-z_]+)/i.exec(msg)?.[1];
    return NextResponse.json(
      { error: `${prefix}${col ? `${label(col)} is not one of the allowed values` : "a value is not allowed"}.` },
      { status: 400 }
    );
  }
  if (code === "SQLITE_CONSTRAINT_NOTNULL") {
    const col = /NOT NULL constraint failed:\s*\w+\.([a-z_]+)/i.exec(msg)?.[1];
    return NextResponse.json(
      { error: `${prefix}${col ? `${label(col)} is required` : "a required value is missing"}.` },
      { status: 400 }
    );
  }
  if (code === "SQLITE_READONLY") {
    return NextResponse.json(
      { error: `${prefix}the database is read-only. This is a server problem, not something you did — see RUNBOOK.md.` },
      { status: 500 }
    );
  }

  console.error("[api] unhandled error", code, msg);
  return NextResponse.json({ error: `${prefix}something went wrong on the server.` }, { status: 500 });
}
