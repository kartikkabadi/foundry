import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { logPath } from "./paths";

export type EventSource = "system" | "operator";

export type EventReason =
  | "auto-advance"
  | "auto-complete"
  | "force-finish"
  | "hold"
  | "reopen"
  | "manual-advance"
  | "manual-complete"
  | "retry"
  | "re-run"
  | "oneshot"
  | "pause"
  | "resume"
  | "cancel"
  | "merge-not-real";

export type EventActor = {
  source: EventSource;
  reason?: EventReason;
};

export type FoundryEvent = {
  ts: string;
  issueId: string;
  kind: string;
  payload: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Redaction at the append boundary.
//
// Every event is deep-scanned before it is written so the JSONL never holds a
// literal credential. Field names that read like secrets (apiKey, token,
// password, ...) have their whole string/container value replaced; any string
// value that itself looks like a credential (Bearer tokens, common API-key
// prefixes, PEM private keys, JWTs, secret query params) is scrubbed even
// under an innocent field name. Structural metadata and ordinary evidence
// (paths, model ids, error text, numeric usage counters) pass through
// untouched, the caller's payload is never mutated, and cycles or oversized
// input fail closed to a truncation marker. The redactor logs nothing, so raw
// redaction input never reaches any output.
// ---------------------------------------------------------------------------

const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const MAX_DEPTH = 12;
const MAX_NODES = 2048;

/** Composite secret field names; matched on the lowercased key with
 *  separator boundaries so apiKey, api_key and API-KEY all agree. */
const SECRET_FIELD_NAME =
  /(^|[^a-z0-9])(api[_-]?key|access[_-]?key|private[_-]?key|authheader|session[_-]?id)([^a-z0-9]|$)/;

/** Secret stems are unambiguous even inside camelCase (accessToken,
 *  clientSecret, refresh_token, ...). */
const SECRET_FIELD_STEM =
  /token|secret|password|passwd|passphrase|bearer|credential|authorization|cookie/;

/** Usage/cost counters that read like credentials (token_budget, tokens_used,
 *  tokenCount, ...) are ordinary evidence, never redacted by name. */
const USAGE_COUNTER = /^tokens$|tokens?[_-]?(used|budget|remaining|total|limit|count)$/;

/** True when `key` names a credential-bearing field. */
function isSecretFieldName(key: string): boolean {
  const k = key.toLowerCase();
  if (USAGE_COUNTER.test(k)) return false;
  return SECRET_FIELD_STEM.test(k) || SECRET_FIELD_NAME.test(k);
}

// Credential-looking string shapes, applied regardless of field name. Each
// replacement yields "[REDACTED]" (with the parameter/header name preserved),
// which no pattern matches again, so the passes are independent.
const PEM_PRIVATE_KEY =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const BEARER_TOKEN = /\b(Bearer|Basic)\b\s+[A-Za-z0-9._~+/=-]{8,}/g;
const API_KEY_PREFIX =
  /\b(?:sk|sk_live|sk_test|sk-ant|sk-or|sk-proj|pk|pk_live|pk_test|rk_live|rk_test|whsec|ghp|gho|ghu|ghs|github_pat|glpat|glcbt|xox[abpr]|xvz)[-_][A-Za-z0-9_-]{10,}/g;
const AWS_KEY_ID = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g;
const SECRET_PARAM =
  /\b(api[_-]?key|apikey|access[_-]?key|client[_-]?secret|secret|password|passwd|passphrase|token|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|bearer|authorization)=([^&\s"']{3,})/gi;

const VALUE_SCRUBBERS: ReadonlyArray<readonly [RegExp, string]> = [
  [PEM_PRIVATE_KEY, REDACTED],
  [BEARER_TOKEN, `$1 ${REDACTED}`],
  [API_KEY_PREFIX, REDACTED],
  [AWS_KEY_ID, REDACTED],
  [JWT, REDACTED],
  [SECRET_PARAM, `$1=${REDACTED}`],
];

/** Scrub credential-looking substrings out of a single string value. */
function redactString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of VALUE_SCRUBBERS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

type RedactState = {
  budget: number;
  seen: WeakSet<object>;
};

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactValue(value: unknown, depth: number, state: RedactState): unknown {
  if (depth > MAX_DEPTH || state.budget <= 0) return TRUNCATED;
  state.budget -= 1;
  if (value === null || typeof value !== "object") {
    return typeof value === "string" ? redactString(value) : value;
  }
  if (state.seen.has(value)) return TRUNCATED;
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const item of value) {
        if (state.budget <= 0) break;
        out.push(redactValue(item, depth + 1, state));
      }
      return out;
    }
    if (!isPlainObject(value)) return value; // Date/RegExp/class: pass through
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (state.budget <= 0) break;
      out[key] =
        isSecretFieldName(key) && (typeof val === "string" || (val !== null && typeof val === "object"))
          ? REDACTED
          : redactValue(val, depth + 1, state);
    }
    return out;
  } finally {
    // Keep every visited object in `seen`: repeated aliases and cycles both
    // fail closed instead of copying sensitive object graphs twice.
  }
}

/**
 * Recursively redact credentials from any JSON-ish value without mutating it.
 * Exported so tests can probe the redactor directly; `appendEvent` is the
 * only production call site.
 */
export function redactSecrets(value: unknown): unknown {
  return redactValue(value, 0, { budget: MAX_NODES, seen: new WeakSet() });
}

export function appendEvent(
  issueId: string,
  kind: string,
  payload: Record<string, unknown> = {},
  actor: EventActor = { source: "system" },
): FoundryEvent {
  const event: FoundryEvent = {
    ts: new Date().toISOString(),
    issueId,
    kind,
    payload: {
      ...payload,
      source: actor.source,
      reason: actor.reason ?? null,
    },
  };
  const safe = redactSecrets(event) as FoundryEvent;
  const path = logPath(issueId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(safe)}\n`);
  return safe;
}

export function readEvents(issueId: string): FoundryEvent[] {
  try {
    const raw = readFileSync(logPath(issueId), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FoundryEvent);
  } catch {
    return [];
  }
}
