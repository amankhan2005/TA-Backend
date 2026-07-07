/**
 * pagination.js — Shared helper so every NEW list endpoint returns a
 * consistent, paginated shape from day one (see Mobile App Readiness,
 * Phase 2-4 design doc §G.1). Existing endpoints (teachers, schools, etc.)
 * are intentionally NOT retrofitted with this — that would be a response-
 * shape change to a live endpoint, which is out of scope for additive work.
 *
 * Usage inside a new controller:
 *   const { getPagination, buildPaginatedResponse } = require('../utils/pagination');
 *   const { page, limit, skip } = getPagination(req.query);
 *   const [results, total] = await Promise.all([
 *     Model.find(filter).skip(skip).limit(limit),
 *     Model.countDocuments(filter),
 *   ]);
 *   res.json(buildPaginatedResponse(results, total, page, limit));
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const getPagination = (query = {}) => {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);

  if (!Number.isInteger(page) || page < 1) page = 1;
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  return { page, limit, skip: (page - 1) * limit };
};

const buildPaginatedResponse = (results, total, page, limit) => ({
  success: true,
  total,
  page,
  limit,
  totalPages: Math.max(1, Math.ceil(total / limit)),
  results,
});

module.exports = { getPagination, buildPaginatedResponse, DEFAULT_LIMIT, MAX_LIMIT };
