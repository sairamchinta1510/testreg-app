/**
 * READ ALL — GET /registrations
 * READ ONE — GET /registrations/{id}
 */
const { listObjects, getObject } = require("../utils/gcs");
const { ok, err }                = require("../utils/response");

async function listRegistrations() {
  const entries = await listObjects();
  return ok(entries);
}

async function getRegistration(id) {
  if (!id) return err(400, "Missing registration ID");
  try {
    const entry = await getObject(id);
    return ok(entry);
  } catch (e) {
    if (e.message && e.message.startsWith("Registration not found")) return err(404, e.message);
    throw e;
  }
}

module.exports = { listRegistrations, getRegistration };
