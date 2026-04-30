/**
 * UPDATE — PUT /registrations/{id}
 * Body: { firstName?, lastName?, address?, ssn? }
 * Returns: { success, entry }
 */
const { getObject, putObject } = require("../utils/gcs");
const { ok, err }              = require("../utils/response");

async function updateRegistration(id, event) {
  if (!id) return err(400, "Missing registration ID");

  const updates = JSON.parse(event.body || "{}");

  let existing;
  try {
    existing = await getObject(id);
  } catch (e) {
    if (e.message && e.message.startsWith("Registration not found")) return err(404, e.message);
    throw e;
  }

  const updated = {
    ...existing,
    ...updates,
    id:           existing.id,
    registeredAt: existing.registeredAt,
    updatedAt:    new Date().toISOString()
  };

  await putObject(id, updated);
  return ok({ success: true, entry: updated });
}

module.exports = { updateRegistration };
