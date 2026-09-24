import fs from "fs";
import path from "path";
import { newId } from "./id";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

// Deliberately an allowlist, not a denylist — anything not explicitly a document/image/
// archive/CAD format is rejected outright. This is the single biggest lever against
// malicious file upload (the OWASP-listed risk for any file upload feature).
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".ppt", ".pptx", ".txt", ".md",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".step", ".stp", ".iges", ".igs", ".sldprt", ".sldasm", ".dwg", ".dxf",
  ".zip"
]);

export function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export class UnsupportedFileTypeError extends Error {}

// Magic-byte signatures for the binary formats in ALLOWED_EXTENSIONS. This catches the
// classic "rename malware.exe to malware.pdf" bypass of extension-only checks — the
// extension says one thing, the actual file header says another, and this rejects the
// mismatch instead of trusting user-supplied metadata. Text-based formats (.txt, .md,
// .csv, .svg, .dxf, .step/.iges when ASCII-encoded) have no reliable binary signature to
// check, so they're intentionally left out of this table and still pass on extension
// alone — the mitigation for that one is in how it's served, not what's checked at
// upload time (see app/api/files/[id]/route.ts).
type Signature = { bytes: number[]; offset?: number };
const FILE_SIGNATURES: Record<string, Signature[]> = {
  ".pdf": [{ bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  ".png": [{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  ".jpg": [{ bytes: [0xff, 0xd8, 0xff] }],
  ".jpeg": [{ bytes: [0xff, 0xd8, 0xff] }],
  ".gif": [{ bytes: [0x47, 0x49, 0x46, 0x38] }], // GIF8
  ".webp": [{ bytes: [0x52, 0x49, 0x46, 0x46] }, { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }],
  ".zip": [{ bytes: [0x50, 0x4b, 0x03, 0x04] }],
  // Office Open XML formats (.docx/.xlsx/.pptx) are ZIP containers under the hood.
  ".docx": [{ bytes: [0x50, 0x4b, 0x03, 0x04] }],
  ".xlsx": [{ bytes: [0x50, 0x4b, 0x03, 0x04] }],
  ".pptx": [{ bytes: [0x50, 0x4b, 0x03, 0x04] }],
  // Legacy binary Office formats (.doc/.xls/.ppt) share the OLE Compound File header.
  ".doc": [{ bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
  ".xls": [{ bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
  ".ppt": [{ bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }]
};

function matchesSignature(buffer: Buffer, sig: Signature): boolean {
  const offset = sig.offset ?? 0;
  if (buffer.length < offset + sig.bytes.length) return false;
  return sig.bytes.every((byte, i) => buffer[offset + i] === byte);
}

function verifyFileContents(ext: string, buffer: Buffer): boolean {
  const signatures = FILE_SIGNATURES[ext];
  if (!signatures) return true; // text-based / no reliable signature — extension check already passed
  return signatures.some((sig) => matchesSignature(buffer, sig));
}

/** True for formats that can carry active content (script) if ever rendered inline. */
export function isActiveContentRisk(ext: string): boolean {
  return ext === ".svg";
}

/** Persist an uploaded File (from a multipart FormData request) to local disk. */
export async function saveUploadedFile(file: File): Promise<{
  storedName: string;
  filePath: string;
  mimeType: string;
  size: number;
}> {
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new UnsupportedFileTypeError(`File type "${ext || "unknown"}" is not permitted.`);
  }
  ensureUploadDir();
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!verifyFileContents(ext, buffer)) {
    throw new UnsupportedFileTypeError(
      `File contents don't match a valid ${ext} file — the actual file header doesn't match ` +
        `what its extension claims. Rejected to prevent a mislabeled or disguised file from being stored.`
    );
  }
  // Randomly generated storage name, deliberately discarding the original filename for
  // the on-disk path — the original is still shown to users via `original_filename`,
  // but nothing derived from user input ever becomes part of a filesystem path.
  const storedName = `${newId("f")}${ext}`;
  const diskPath = path.join(UPLOAD_DIR, storedName);
  fs.writeFileSync(diskPath, buffer);
  return {
    storedName,
    filePath: storedName, // stored relative to UPLOAD_DIR; resolved again on read
    mimeType: file.type || "application/octet-stream",
    size: buffer.length
  };
}

export function readUploadedFile(storedName: string): Buffer {
  const diskPath = path.join(UPLOAD_DIR, storedName);
  return fs.readFileSync(diskPath);
}

export function deleteUploadedFile(storedName: string) {
  const diskPath = path.join(UPLOAD_DIR, storedName);
  if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB
