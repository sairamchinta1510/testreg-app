/**
 * index.js — Lambda entry point / router
 * Routes requests to the appropriate service handler.
 *
 * Routes:
 *   POST   /prod/register              → createRegistration
 *   GET    /prod/registrations         → listRegistrations
 *   GET    /prod/registrations/{id}    → getRegistration
 *   PUT    /prod/registrations/{id}    → updateRegistration
 *   DELETE /prod/registrations/{id}    → deleteRegistration
 */
const { createRegistration }            = require("./services/create");
const { listRegistrations, getRegistration } = require("./services/read");
const { updateRegistration }            = require("./services/update");
const { deleteRegistration }            = require("./services/delete");
const { ok, err }                       = require("./utils/response");
const { logRequest, logResponse, logError } = require("./utils/logger");

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || "GET";
  const path   = event.rawPath || "/";
  const id     = path.startsWith("/prod/registrations/") ? path.split("/").pop() : null;

  if (method === "OPTIONS") return ok("");

  logRequest(method, path, event.body);

  let response;
  try {
    if (method === "POST"   && path === "/prod/register")               response = await createRegistration(event);
    else if (method === "GET"    && path === "/prod/registrations")      response = await listRegistrations();
    else if (method === "GET"    && path.startsWith("/prod/registrations/")) response = await getRegistration(id);
    else if (method === "PUT"    && path.startsWith("/prod/registrations/")) response = await updateRegistration(id, event);
    else if (method === "DELETE" && path.startsWith("/prod/registrations/")) response = await deleteRegistration(id);
    else response = err(404, `Route not found: ${method} ${path}`);
  } catch (e) {
    logError("Unhandled error", e);
    response = err(500, "Internal server error");
  }

  logResponse(method, path, response);
  return response;
};
