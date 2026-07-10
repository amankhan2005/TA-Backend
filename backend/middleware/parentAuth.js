/**
 * parentAuth.js — Phase 9 parent authentication + the MOST IMPORTANT security
 * control in the portal: child-ownership validation. A parent may only ever
 * touch a student that appears in their own `linkedStudents`. Every portal route
 * that names a student goes through `requireChild`, which derives the school
 * from the ownership link — never from client input — so cross-parent and
 * cross-school access are both structurally impossible.
 *
 * STATUS GATE: previously `!parent.isActive`. Now `status !== 'active'`, which
 * additionally revokes the session of a parent suspended mid-session. Their JWT
 * remains cryptographically valid until it expires; THIS check is what actually
 * ends their access.
 */

const jwt = require('jsonwebtoken');
const Parent = require('../models/Parent');

// Verify a parent JWT and load the (active) parent onto req.parent.
async function protectParent(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided.' });
    }
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    if (decoded.role !== 'parent' || !decoded.parentId) {
      return res.status(403).json({ success: false, message: 'Not a parent session.' });
    }
    const parent = await Parent.findById(decoded.parentId);
    if (!parent) {
      return res.status(401).json({ success: false, message: 'Parent account not found.' });
    }
    if (parent.status !== 'active') {
      // 403, not 401: the credential is valid, the account is not permitted.
      // Returning `status` lets the portal route the user to the right screen
      // (activation vs "contact your school") instead of a bare logout loop.
      return res.status(403).json({
        success: false,
        message: parent.status === 'suspended'
          ? 'Your portal access has been suspended. Please contact your school administrator.'
          : 'Your account has not been activated yet.',
        status: parent.status,
      });
    }
    req.parent = parent;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
}

/**
 * Ownership gate. Resolves the target student id from params/query/body and
 * confirms it is one of this parent's linked children. On success attaches
 * req.child = { studentId, schoolId, relation } with the school taken from the
 * OWNERSHIP LINK. On failure → 403 (never 404 — we don't confirm existence of
 * students the parent doesn't own).
 */
function requireChild(req, res, next) {
  const studentId = req.params.studentId || req.query.studentId || req.body.studentId;
  if (!studentId) return res.status(400).json({ success: false, message: 'A studentId is required.' });

  const link = (req.parent.linkedStudents || []).find((l) => String(l.student) === String(studentId));
  if (!link) {
    return res.status(403).json({ success: false, message: 'This student is not linked to your account.' });
  }
  req.child = { studentId: String(link.student), schoolId: link.schoolId, relation: link.relation };
  next();
}

module.exports = { protectParent, requireChild };