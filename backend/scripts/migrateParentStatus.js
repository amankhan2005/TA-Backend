/**
 * migrateParentStatus.js — one-time data + index migration for this release.
 *
 * DOES TWO THINGS, both idempotent (safe to run more than once):
 *
 *   1. PARENT STATUS BACKFILL
 *      Populates the new `status` field from the old isActive/isActivated
 *      booleans, which are being removed from the schema. Mapping:
 *
 *        isActivated === false                       → 'pending'
 *        isActivated !== false && isActive === false → 'suspended'
 *        otherwise                                    → 'active'
 *
 *      `isActivated: false` wins: a never-activated account that was also
 *      deactivated is fundamentally still pending, not suspended.
 *
 *      Because the Parent SCHEMA no longer declares isActive/isActivated,
 *      Mongoose would strip them from any query projection — so this reads the
 *      RAW documents straight off the driver collection, bypassing the schema.
 *      Documents that already have a valid `status` are skipped.
 *
 *   2. DROP THE OLD STUDENT TEXT INDEX
 *      models/Student.js no longer declares `{ name: 'text' }`. Mongoose does
 *      NOT drop indexes it stops declaring, so the stale `name_text` index
 *      would linger and keep serving the (removed) $text path. We drop it
 *      explicitly. The new compound search indexes are built automatically by
 *      autoIndex on boot; this only removes the obsolete one.
 *
 * USAGE:
 *   NODE_ENV=production node scripts/migrateParentStatus.js
 *   (reads MONGODB_URI from the environment, same as the app)
 *
 * The script connects, runs, prints a summary, and exits. It NEVER deletes or
 * suspends an account on its own — worst case it re-derives a status that is
 * already correct.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const DRY_RUN = process.argv.includes('--dry-run');

function deriveStatus(doc) {
  // Treat missing booleans as their historical defaults (both defaulted true).
  const isActivated = doc.isActivated;
  const isActive = doc.isActive;
  if (isActivated === false) return 'pending';
  if (isActive === false) return 'suspended';
  return 'active';
}

async function backfillParentStatus(db) {
  const col = db.collection('parents');
  const cursor = col.find({});
  let scanned = 0;
  let updated = 0;
  const tally = { pending: 0, active: 0, suspended: 0, alreadySet: 0 };

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned += 1;

    // Skip documents that already carry a valid status AND no longer carry the
    // legacy booleans — those are already migrated.
    const hasValidStatus = ['pending', 'active', 'suspended'].includes(doc.status);
    const hasLegacy = doc.isActive !== undefined || doc.isActivated !== undefined;
    if (hasValidStatus && !hasLegacy) { tally.alreadySet += 1; continue; }

    const status = hasValidStatus ? doc.status : deriveStatus(doc);
    tally[status] += 1;

    // Also stamp activatedAt so a later "re-activate a suspended parent" flow
    // (which requires proof of prior activation) works for historical accounts.
    const set = { status };
    if ((status === 'active' || status === 'suspended') && !doc.activatedAt) {
      set.activatedAt = doc.updatedAt || doc.createdAt || new Date();
    }
    if (status === 'suspended' && !doc.suspendedAt) {
      set.suspendedAt = doc.updatedAt || new Date();
    }

    if (!DRY_RUN) {
      await col.updateOne(
        { _id: doc._id },
        {
          $set: set,
          // Remove the now-defunct real fields so nothing reads them by accident.
          $unset: { isActive: '', isActivated: '' },
        }
      );
    }
    updated += 1;
  }

  return { scanned, updated, tally };
}

async function dropOldStudentTextIndex(db) {
  const col = db.collection('students');
  let indexes = [];
  try { indexes = await col.indexes(); } catch (_) { return { dropped: false, reason: 'no students collection' }; }

  // The text index is identifiable by its `textIndexVersion` field, and by
  // convention it is named `name_text` for a single-field `{ name: 'text' }`.
  const textIndex = indexes.find(
    (ix) => ix.textIndexVersion !== undefined || ix.name === 'name_text'
  );

  if (!textIndex) return { dropped: false, reason: 'no text index present' };
  if (DRY_RUN) return { dropped: false, reason: `would drop "${textIndex.name}"`, name: textIndex.name };

  await col.dropIndex(textIndex.name);
  return { dropped: true, name: textIndex.name };
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not set. Aborting.');
    process.exit(1);
  }

  console.log(`\n[migrate] Connecting${DRY_RUN ? ' (DRY RUN — no writes)' : ''}...`);
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  try {
    console.log('[migrate] 1/2 — Backfilling Parent.status ...');
    const parents = await backfillParentStatus(db);
    console.log(`         scanned ${parents.scanned}, migrated ${parents.updated}`);
    console.log(`         → pending: ${parents.tally.pending}, active: ${parents.tally.active}, suspended: ${parents.tally.suspended}, already set: ${parents.tally.alreadySet}`);

    console.log('[migrate] 2/2 — Dropping stale Student text index ...');
    const idx = await dropOldStudentTextIndex(db);
    if (idx.dropped) console.log(`         dropped index "${idx.name}"`);
    else console.log(`         ${idx.reason}`);

    console.log(`\n[migrate] ✅ Done${DRY_RUN ? ' (dry run — nothing written)' : ''}.\n`);
  } catch (err) {
    console.error('\n[migrate] ❌ Failed:', err.message, '\n');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();