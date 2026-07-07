const mongoose = require('mongoose');

/**
 * Counter — atomic per-school monotonic sequences for human-facing document
 * numbers (invoices, receipts). `findOneAndUpdate($inc)` is atomic, so two
 * concurrent invoice creations can never collide on a number (unlike count()+1).
 */
const counterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, // e.g. "S123:invoice:2026"
  seq: { type: Number, default: 0 },
});

counterSchema.statics.next = async function (key) {
  const doc = await this.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return doc.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
