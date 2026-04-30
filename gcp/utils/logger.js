/**
 * logger.js — Structured Cloud Logging logger
 * Cloud Functions automatically stream console output to Cloud Logging.
 * Sensitive fields (ssn) are redacted before logging.
 */
const REDACTED_FIELDS = ["ssn"];

function redact(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) =>
      REDACTED_FIELDS.includes(k) ? [k, "***REDACTED***"] : [k, redact(v)]
    )
  );
}

function log(level, message, data) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(data !== undefined ? { data } : {})
  };
  console.log(JSON.stringify(entry));
}

function logRequest(method, path, body) {
  let parsed;
  try { parsed = body ? JSON.parse(body) : undefined; } catch { parsed = body; }
  log("INFO", "Incoming request", { method, path, body: redact(parsed) });
}

function logResponse(method, path, response) {
  let parsedBody;
  try { parsedBody = response.body ? JSON.parse(response.body) : undefined; } catch { parsedBody = response.body; }
  log("INFO", "Outgoing response", {
    method,
    path,
    statusCode: response.statusCode,
    body: redact(parsedBody)
  });
}

function logError(message, error) {
  log("ERROR", message, { error: error?.message || String(error), stack: error?.stack });
}

module.exports = { logRequest, logResponse, logError };
