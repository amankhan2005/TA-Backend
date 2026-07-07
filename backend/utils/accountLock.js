/**
 * accountLock.js — Pure account-lock policy for parent auth (Phase 9). No I/O.
 * After MAX consecutive failures the account is locked for LOCK_MINUTES.
 */
const MAX_ATTEMPTS = parseInt(process.env.PARENT_MAX_LOGIN_ATTEMPTS || '5', 10);
const LOCK_MINUTES = parseInt(process.env.PARENT_LOCK_MINUTES || '15', 10);

function isLocked(state, now = new Date()) {
  return !!(state.lockUntil && new Date(state.lockUntil).getTime() > now.getTime());
}

// Returns the new {failedLoginAttempts, lockUntil} after a failed attempt.
function registerFailure(state, now = new Date()) {
  const attempts = (state.failedLoginAttempts || 0) + 1;
  const lock = attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCK_MINUTES * 60000) : (state.lockUntil || null);
  return { failedLoginAttempts: attempts, lockUntil: lock };
}

function reset() {
  return { failedLoginAttempts: 0, lockUntil: null };
}

module.exports = { isLocked, registerFailure, reset, MAX_ATTEMPTS, LOCK_MINUTES };
