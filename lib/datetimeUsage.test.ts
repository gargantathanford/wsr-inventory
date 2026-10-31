/**
 * Nobody formats a timestamp by hand.
 *
 * The timezone bug was not one mistake; it was the same mistake in nine
 * places, because formatting a date inline is easier than finding the helper.
 * Unit tests on the helper cannot catch a call site that never uses it, so
 * this test reads the source.
 *
 * Two patterns are banned in anything that renders:
 *
 *   toLocaleString() / toLocaleDateString() / toLocaleTimeString() with no
 *   timeZone — formats in whatever timezone the process is running in. These
 *   are server components, so that is the container (UTC), and the number
 *   moves again if the VM changes region.
 *
 *   stamp.slice(0, 10) — takes the UTC date off a UTC timestamp. An event at
 *   19:00 in Tulsa is already tomorrow in UTC, so it is filed on the wrong
 *   day, and the error only appears in the evening.
 *
 * lib/datetime.ts is exempt: it is the implementation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIRS = ["app", "components", "lib"];
const EXEMPT = new Set([path.join("lib", "datetime.ts")]);

function sources(dir: string, out: string[] = []): string[] {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      sources(rel, out);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
      out.push(rel);
    }
  }
  return out;
}

const FILES = DIRS.flatMap((d) => sources(d)).filter((f) => !EXEMPT.has(f));

test("there are source files to check", () => {
  assert.ok(FILES.length > 40, `only found ${FILES.length} files — the scan is not looking in the right place`);
});

test("no bare toLocale*String on a date", () => {
  const offenders: string[] = [];
  for (const file of FILES) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    text.split("\n").forEach((line, i) => {
      const m = /\.toLocale(Date|Time)?String\(([^)]*)\)/.exec(line);
      if (!m) return;
      // toLocaleString on a NUMBER is thousands separators — fine, and all
      // over the cost columns. Only flag it when a timeZone is absent AND the
      // receiver looks like a date.
      if (/timeZone/.test(m[2])) return;
      const receiver = line.slice(0, m.index);
      // Underscores are word characters, so \b never fires inside
      // "opened_at" — an earlier version of this check passed over the exact
      // line that caused the bug. Match on substrings instead.
      const looksLikeDate =
        /new\s+Date\s*\(/.test(receiver) ||
        /(_at|_date|_time|At|Date|Time|deadline|due|opened|closed|expires)\s*\)?\s*$/.test(receiver);
      if (looksLikeDate) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "Format dates with lib/datetime.ts (formatDateTime / formatDate / formatDay / formatTime).\n" +
      offenders.join("\n")
  );
});

test("no slicing a timestamp to get a date", () => {
  const offenders: string[] = [];
  for (const file of FILES) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    text.split("\n").forEach((line, i) => {
      // `.slice(0, 10)` or `.slice(0, 16)` on something named like a timestamp.
      const m = /(\w+(?:_at|At|_date|Date|At|_time|Time))\s*\??\.slice\(\s*0\s*,\s*(10|16|19)\s*\)/.exec(line);
      if (m) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "Slicing a UTC timestamp files evening work on the wrong day. Use formatDay / localDayOf.\n" +
      offenders.join("\n")
  );
});
