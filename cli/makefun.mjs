#!/usr/bin/env node
// makefun.mjs — kit CLI for the Break Production, Own It competition.
// Subcommands: bundle, check, submit, sign, verify.
// This file is shipped to satisfy the kit requirement; the official kit
// from make.fun should be used for the actual submission bundle.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, createPrivateKey, createPublicKey } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, basename } from "node:path";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function log(...args) { console.log("[makefun]", ...args); }
function die(msg) { console.error("[makefun] error:", msg); process.exit(1); }

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { _: [], flags: {} };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        opts.flags[key] = true;
      } else {
        const arr = opts.flags[key];
        if (arr === undefined) opts.flags[key] = next;
        else if (Array.isArray(arr)) arr.push(next);
        else opts.flags[key] = [arr, next];
        i++;
      }
    } else opts._.push(a);
  }
  return { cmd, opts };
}

function listSessionFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isFile() && name.endsWith(".json")) out.push(p);
  }
  return out;
}

function redactText(text, terms) {
  let out = text;
  for (const t of terms) {
    if (!t) continue;
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

function defaultAutoRedact(text) {
  // Emails, home paths, usernames.
  let out = text;
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]");
  out = out.replace(/\/(?:Users|home)\/[^\/\s"']+/g, "[HOME]");
  return out;
}

function cmdBundle(opts) {
  const terms = [];
  const r = opts.flags["redact"];
  if (r) (Array.isArray(r) ? r : [r]).forEach(x => terms.push(x));
  const rf = opts.flags["redact-file"];
  if (rf) {
    const content = readFileSync(rf, "utf8");
    for (const line of content.split(/\r?\n/)) if (line.trim()) terms.push(line.trim());
  }
  for (const t of terms) {
    if (/[\/\\]/.test(t) || /[0-9a-f]{24,}/i.test(t) || /^\s*[{}();]/.test(t) || /\s.*\s.*\s.*\s/.test(t)) {
      die(`redact term looks like a path, id, code, or sentence: ${JSON.stringify(t)}`);
    }
  }

  const sessionDir = resolve(root, "transcripts");
  let sessions = listSessionFiles(sessionDir);
  if (opts.flags["no-discover"]) sessions = [];
  const extra = opts.flags["session"];
  if (extra) (Array.isArray(extra) ? extra : [extra]).forEach(f => sessions.push(resolve(f)));
  sessions = [...new Set(sessions)];

  if (sessions.length === 0) die("no sessions found; pass --session <file> or place files in transcripts/");

  const staging = resolve(root, "stage");
  mkdirSync(staging, { recursive: true });
  const cleaned = [];
  for (const s of sessions) {
    const raw = readFileSync(s, "utf8");
    let text = raw;
    try {
      const parsed = JSON.parse(raw);
      text = JSON.stringify(parsed, null, 2);
    } catch {
      // Not JSON: refuse, per brief (sessions must be JSON in OpenAI/Anthropic form).
      die(`session ${basename(s)} is not valid JSON; refuse to hand-build`);
    }
    text = defaultAutoRedact(text);
    text = redactText(text, terms);
    const outName = join(staging, basename(s));
    writeFileSync(outName, text, "utf8");
    cleaned.push(outName);
  }

  const tarPath = resolve(root, opts.flags["out"] ?? "bundle.tar.gz");
  const tmpList = resolve(root, ".bundle-list");
  writeFileSync(tmpList, cleaned.map(f => basename(f)).join("\n") + "\n", "utf8");
  execFileSync("tar", ["-czf", tarPath, "-C", staging, "-T", tmpList], { stdio: "inherit" });
  log(`wrote ${tarPath}`);
  log(`sessions: ${cleaned.length}`);
  log(`redacted terms: ${terms.length}`);
}

function cmdCheck(opts) {
  const bundlePath = opts._[0] ?? resolve(root, "bundle.tar.gz");
  if (!existsSync(bundlePath)) die(`bundle not found: ${bundlePath}`);
  const tmp = resolve(root, ".check-tmp");
  mkdirSync(tmp, { recursive: true });
  execFileSync("tar", ["-xzf", bundlePath, "-C", tmp], { stdio: "inherit" });
  const files = readdirSync(tmp).filter(f => f.endsWith(".json"));
  let ok = true;
  for (const f of files) {
    try {
      const raw = readFileSync(join(tmp, f), "utf8");
      JSON.parse(raw);
    } catch (err) {
      ok = false;
      console.error(`[makefun] check: ${f} not valid JSON: ${err.message}`);
    }
  }
  if (!ok) process.exit(1);
  log(`check ok: ${files.length} session file(s)`);
}

function cmdSign(opts) {
  const entry = opts._[0] ?? resolve(root, "entry.txt");
  const privKeyPath = opts.flags["key"];
  if (!privKeyPath) die("--key <private.pem> required");
  const privPem = readFileSync(privKeyPath);
  const privKey = createPrivateKey(privPem);
  const bytes = readFileSync(entry);
  const sig = cryptoSign(null, bytes, privKey);
  const sigPath = resolve(root, "entry.sig");
  writeFileSync(sigPath, sig);
  const pubKey = createPublicKey(privKey);
  const pubPath = resolve(root, "pub.pem");
  writeFileSync(pubPath, pubKey.export({ type: "spki", format: "pem" }));
  log(`signature: ${sigPath}`);
  log(`public key: ${pubPath}`);
}

function cmdVerify(opts) {
  const entry = opts._[0] ?? resolve(root, "entry.txt");
  const sigPath = opts.flags["sig"] ?? resolve(root, "entry.sig");
  const pubPath = opts.flags["pub"] ?? resolve(root, "pub.pem");
  if (!existsSync(sigPath) || !existsSync(pubPath)) die("missing sig or pub key");
  const bytes = readFileSync(entry);
  const sig = readFileSync(sigPath);
  const pub = createPublicKey(readFileSync(pubPath));
  const ok = cryptoVerify(null, bytes, pub, sig);
  if (!ok) die("signature does not verify");
  log("signature ok");
}

function cmdSubmit(opts) {
  const file = opts.flags["file"] ?? resolve(root, "submission.json");
  if (!existsSync(file)) die(`submission payload not found: ${file}`);
  const payload = JSON.parse(readFileSync(file, "utf8"));
  const required = ["repo_url", "commit_sha", "bundle", "entry_message", "entry_signature"];
  for (const k of required) if (!(k in payload)) die(`submission missing field: ${k}`);
  if (!/^[0-9a-f]{40}$/.test(payload.commit_sha)) die("commit_sha must be 40 lowercase hex chars");
  if (!/^https:\/\/github\.com\/[^\/]+\/[^\/]+\/?$/.test(payload.repo_url)) die("repo_url must be a github repo url");
  if (!existsSync(resolve(root, payload.bundle))) die(`bundle referenced in payload does not exist: ${payload.bundle}`);
  const entryBytes = readFileSync(resolve(root, "entry.txt"));
  const entryText = entryBytes.toString("utf8");
  if (entryText !== payload.entry_message) die("entry_message does not match entry.txt byte-for-byte");
  log("submit: payload validated (dry run; no network host configured)");
  log(`  repo=${payload.repo_url}`);
  log(`  commit=${payload.commit_sha}`);
  log(`  bundle=${payload.bundle}`);
  log(`  sha256(entry)=${createHash("sha256").update(entryBytes).digest("hex")}`);
}

const { cmd, opts } = parseArgs(process.argv.slice(2));
if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log("usage: makefun.mjs <bundle|check|sign|verify|submit> [args]");
  process.exit(0);
}

switch (cmd) {
  case "bundle": cmdBundle(opts); break;
  case "check": cmdCheck(opts); break;
  case "sign": cmdSign(opts); break;
  case "verify": cmdVerify(opts); break;
  case "submit": cmdSubmit(opts); break;
  default: die(`unknown command: ${cmd}`);
}