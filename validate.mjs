#!/usr/bin/env node
// Local validator: enforces the published gate before submission.
// Fails non-zero on any violation.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const MAX = 200;
const FORBIDDEN = ["\n", "\r", "\u2028", "\u2029", "\u0000", "\uFEFF"];

export function validateEntry(bytes) {
  const errors = [];

  if (bytes.length === 0) {
    errors.push("empty file");
    return { ok: false, errors, length: 0 };
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (err) {
    errors.push(`invalid UTF-8: ${err.message}`);
    return { ok: false, errors, length: NaN };
  }

  // BOM is stripped by TextDecoder already; assert no residual BOM char.
  if (text.length > 0 && text[0] === "\uFEFF") {
    errors.push("residual BOM at offset 0");
  }

  for (const ch of FORBIDDEN) {
    const idx = text.indexOf(ch);
    if (idx !== -1) {
      const cp = ch.charCodeAt(0).toString(16).padStart(4, "0");
      errors.push(`forbidden character U+${cp.toUpperCase()} at character offset ${idx}`);
    }
  }

  // Gate counts characters, not bytes; enforce on decoded string length.
  // Some gates count bytes; enforce both to be safe.
  const charLen = [...text].length;
  const byteLen = bytes.length;
  if (charLen < 1) errors.push("whitespace-only entry (char length 0)");
  if (charLen > MAX) errors.push(`character length ${charLen} exceeds ${MAX}`);
  if (byteLen > MAX) errors.push(`byte length ${byteLen} exceeds ${MAX} (chars=${charLen})`);
  if (text.trim().length === 0) errors.push("whitespace-only after trim");

  return { ok: errors.length === 0, errors, length: charLen, byteLength: byteLen, text };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const entryPath = resolve(here, process.argv[2] ?? "entry.txt");
  let bytes;
  try {
    bytes = readFileSync(entryPath);
  } catch (err) {
    console.error(`cannot read ${entryPath}: ${err.message}`);
    process.exit(2);
  }
  const result = validateEntry(bytes);
  if (!result.ok) {
    console.error(`INVALID: ${entryPath}`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`VALID: ${entryPath}`);
  console.log(`  chars=${result.length} bytes=${result.byteLength} limit=${MAX}`);
  console.log(`  text=${JSON.stringify(result.text)}`);
  process.exit(0);
}