/**
 * UPDATE — PUT /prod/registrations/{id}
 * Body: { firstName?, lastName?, address?, ssn? } (any subset)
 * Returns: { success, entry } — full updated record
 */
const { getObject, putObject } = require("../utils/s3");
const { ok, err }              = require("../utils/response");

async function updateRegistration(id, event) {
  if (!id) return err(400, "Missing registration ID");

  const updates = JSON.parse(event.body || "{}");

  // Fetch existing record
  const existing = await getObject(id);

  // Merge — preserve id and registeredAt, never allow overwrite
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
