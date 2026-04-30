/**
 * index.js — Cloud Function entry point (GCP)
 * Adapts Cloud Functions req/res into Lambda-event shape
 * so all service files work without modification.
 *
 * Routes:
 *   POST   /register              → createRegistration
 *   GET    /registrations         → listRegistrations
 *   GET    /registrations/{id}    → getRegistration
 *   PUT    /registrations/{id}    → updateRegistration
 *   DELETE /registrations/{id}    → deleteRegistration
 */
const functions = require("@google-cloud/functions-framework");

const { createRegistration }                 = require("./services/create");
const { listRegistrations, getRegistration } = require("./services/read");
const { updateRegistration }                 = require("./services/update");
const { deleteRegistration }                 = require("./services/delete");
const { logRequest, logResponse, logError }  = require("./utils/logger");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

functions.http("handler", async (req, res) => {
  res.set(CORS_HEADERS);

  const method = req.method;
  const path   = req.path;
  const id     = path.startsWith("/registrations/") ? path.split("/").pop() : null;

  if (method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  // Normalise to Lambda-event shape so all service files work unchanged
  const event = {
    body:           req.body ? JSON.stringify(req.body) : null,
    requestContext: { http: { method } },
    rawPath:        path
  };

  logRequest(method, path, event.body);

  let result;
  try {
    if      (method === "POST"   && path === "/register")                result = await createRegistration(event);
    else if (method === "GET"    && path === "/registrations")           result = await listRegistrations();
    else if (method === "GET"    && path.startsWith("/registrations/"))  result = await getRegistration(id);
    else if (method === "PUT"    && path.startsWith("/registrations/"))  result = await updateRegistration(id, event);
    else if (method === "DELETE" && path.startsWith("/registrations/"))  result = await deleteRegistration(id);
    else result = { statusCode: 404, body: JSON.stringify({ error: `Route not found: ${method} ${path}` }) };
  } catch (e) {
    logError("Unhandled error", e);
    result = { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
  }

  logResponse(method, path, result);
  res.status(result.statusCode).set("Content-Type", "application/json").send(result.body);
});
