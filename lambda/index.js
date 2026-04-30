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

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || "GET";
  const path   = event.rawPath || "/";
  const id     = path.startsWith("/prod/registrations/") ? path.split("/").pop() : null;

  if (method === "OPTIONS") return ok("");

  try {
    if (method === "POST"   && path === "/prod/register")              return await createRegistration(event);
    if (method === "GET"    && path === "/prod/registrations")         return await listRegistrations();
    if (method === "GET"    && path.startsWith("/prod/registrations/")) return await getRegistration(id);
    if (method === "PUT"    && path.startsWith("/prod/registrations/")) return await updateRegistration(id, event);
    if (method === "DELETE" && path.startsWith("/prod/registrations/")) return await deleteRegistration(id);

    return err(404, `Route not found: ${method} ${path}`);
  } catch (e) {
    console.error("Unhandled error:", e);
    return err(500, "Internal server error");
  }
};
