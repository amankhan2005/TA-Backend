/**
 * parentAdminController.js — school-admin side of parent accounts.
 *
 * SCHOOL SCOPING IS SUBTLE HERE. Parent is deliberately NOT schoolId-scoped
 * (see models/Parent.js): a parent may have children at more than one school.
 * Every query below therefore scopes through the OWNERSHIP LINK —
 * `linkedStudents.schoolId` — and never through a bare `schoolId` field,
 * which does not exist on the document.
 *
 * That has a consequence worth stating plainly: a School Admin editing a
 * parent's name/email/phone is editing a record that may also be visible to
 * another school. That is inherent to the shared-parent design and predates
 * this change. What we DO enforce is that an admin can only ever link/unlink
 * students belonging to their own school, and can never unlink the last link
 * that grants them visibility without losing that visibility.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const { logEvent } = require('../utils/audit');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');
const { prefixRegex, normaliseSearchTerm } = require('../utils/searchQuery');
const brand = require('../config/brand');

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const VALID_RELATIONS = ['father', 'mother', 'guardian'];
const VALID_STATUSES = ['pending', 'active', 'suspended'];

/**
 * Build the child descriptor array from a create/update payload, validating
 * that EVERY student belongs to the caller's school.
 *
 * Accepts both shapes so the old single-child contract keeps working:
 *   { studentId, relation }                       ← legacy
 *   { children: [{ studentId, relation }, ...] }  ← new, unlimited
 */
async function resolveChildren({ schoolId, body }) {
  const raw = [];

  if (Array.isArray(body.children) && body.children.length) {
    for (const c of body.children) {
      if (!c) continue;
      raw.push({ studentId: c.studentId || c.student, relation: c.relation });
    }
  } else if (body.studentId) {
    raw.push({ studentId: body.studentId, relation: body.relation });
  }

  if (!raw.length) return { error: 'At least one child must be linked.' };

  // De-duplicate by studentId — a double-submitted form must not create two
  // links to the same child (linkedStudents has no unique constraint).
  const seen = new Set();
  const deduped = [];
  for (const r of raw) {
    const key = String(r.studentId || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  const students = await Student.find({ _id: { $in: deduped.map((d) => d.studentId) }, schoolId })
    .select('_id studentId name');

  if (students.length !== deduped.length) {
    return { error: 'One or more selected students were not found in this school.' };
  }

  const byId = new Map(students.map((s) => [String(s._id), s]));
  const links = deduped.map((d) => {
    const relation = VALID_RELATIONS.includes(d.relation) ? d.relation : 'guardian';
    return { student: byId.get(String(d.studentId))._id, schoolId, relation };
  });

  return { links, students };
}

/**
 * Issue a fresh activation token and (best-effort) email it.
 * Returns the raw token so callers can surface it outside production.
 */
async function issueActivationToken(parent, schoolId) {
  const activationToken = crypto.randomBytes(24).toString('hex');
  parent.resetTokenHash = hashToken(activationToken);
  parent.resetTokenExpiry = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await parent.save();

  // brand.parentPortalUrl() already carries the "/parent" subpath
  // (e.g. https://liberiaschoolhub.com/parent), so append only the page path.
  const activationLink = `${brand.parentPortalUrl()}/activate?token=${activationToken}`;

  let delivered = false;
  if (parent.email) {
    try {
      const { sendParentActivationEmail } = require('../utils/email');
      const school = await require('../models/School').findOne({ schoolId }).select('name');
      await sendParentActivationEmail({
        toEmail: parent.email,
        activationLink,
        parentName: parent.name,
        schoolName: school?.name,
      });
      delivered = true;
    } catch (e) {
      console.error('[parent] activation email failed:', e.message);
    }
  }

  return { activationToken, activationLink, delivered };
}

// ═════════════════════════ CREATE ══════════════════════════════════════════

/**
 * POST /api/parents
 * Body: { name, mobileNumber, email, address, studentId?, relation?, children?: [{studentId, relation}] }
 *
 * A newly created account starts as `pending` — never `active`. It becomes
 * `active` only when the parent themselves completes activation and sets a
 * password (parentAuthController.activate).
 */
exports.createParent = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { name, mobileNumber, email, address } = req.body;

    if (!mobileNumber && !email) {
      return res.status(400).json({ success: false, message: 'A mobile number or email is required.' });
    }

    const resolved = await resolveChildren({ schoolId, body: req.body });
    if (resolved.error) return res.status(404).json({ success: false, message: resolved.error });

    const parent = await Parent.create({
      name: name || null,
      mobileNumber: mobileNumber || undefined,
      email: email || undefined,
      address: address || null,
      // Unusable until activation sets a real password.
      passwordHash: await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10),
      status: 'pending',
      linkedStudents: resolved.links,
    });

    await logEvent(req, 'parent.created', {
      targetType: 'Parent',
      targetId: parent._id,
      metadata: {
        students: resolved.students.map((s) => s.studentId),
        childrenCount: resolved.links.length,
        status: 'pending',
      },
    });

    const { activationToken, delivered } = await issueActivationToken(parent, schoolId);

    // Raw token returned ONLY outside production (SMS/manual delivery fallback).
    const devToken = process.env.NODE_ENV === 'production' ? undefined : activationToken;

    res.status(201).json({
      success: true,
      message: 'Parent created. Activation link issued.',
      parentId: parent._id,
      parent: parent.toSafeObject(),
      activationToken: devToken,
      delivered,
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'A parent with that mobile/email already exists.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════ LIST / READ ═════════════════════════════════════

/**
 * GET /api/parents?search=&status=&page=&limit=
 *
 * Paginated, school-scoped through the ownership link. Search matches parent
 * name, email, or mobile number with an anchored regex (index-seekable).
 *
 * Response is the standard paginated envelope: { success, total, page, limit,
 * totalPages, results }. `results` — matching every other paginated endpoint
 * in this codebase (utils/pagination.js). We ALSO mirror it under `parents`
 * so a client reading either key works; the frontend api layer normalises.
 */
exports.listParents = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { page, limit, skip } = getPagination(req.query);
    const term = normaliseSearchTerm(req.query.search);
    const status = req.query.status;

    const filter = { 'linkedStudents.schoolId': schoolId };

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(', ')}.` });
      }
      filter.status = status;
    }

    if (term) {
      const nameRx = prefixRegex(term, { wordBoundary: true });
      const idRx = prefixRegex(term);
      filter.$or = [
        { name: nameRx },
        { email: idRx },
        { mobileNumber: idRx },
      ];
    }

    const [docs, total] = await Promise.all([
      Parent.find(filter)
        .sort({ name: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'linkedStudents.student',
          select: 'name studentId admissionNumber photoUrl class section',
          populate: [
            { path: 'class', select: 'name' },
            { path: 'section', select: 'name' },
          ],
        }),
      Parent.countDocuments(filter),
    ]);

    // Project to a safe wire shape, and expose ONLY the children that belong
    // to the requesting admin's school. A sibling at another school must not
    // leak into this response.
    const results = docs.map((p) => ({
      ...p.toSafeObject(),
      children: (p.linkedStudents || [])
        .filter((l) => l.schoolId === schoolId)
        .map((l) => ({
          _id: l.student?._id || l.student,
          name: l.student?.name || null,
          studentId: l.student?.studentId || null,
          admissionNumber: l.student?.admissionNumber || null,
          photoUrl: l.student?.photoUrl || null,
          class: l.student?.class?.name || null,
          section: l.student?.section?.name || null,
          relation: l.relation,
        })),
      // Children at OTHER schools are counted but never itemised.
      childrenAtOtherSchools: (p.linkedStudents || []).filter((l) => l.schoolId !== schoolId).length,
    }));

    const body = buildPaginatedResponse(results, total, page, limit);
    res.json({ ...body, parents: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/parents/:id
 * 404 (not 403) when the parent has no child at this school — we do not
 * confirm the existence of accounts the admin has no relationship with.
 */
exports.getParent = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const parent = await Parent.findOne({ _id: req.params.id, 'linkedStudents.schoolId': schoolId })
      .populate({
        path: 'linkedStudents.student',
        select: 'name studentId admissionNumber photoUrl class section',
        populate: [
          { path: 'class', select: 'name' },
          { path: 'section', select: 'name' },
        ],
      });

    if (!parent) return res.status(404).json({ success: false, message: 'Parent not found.' });

    const children = (parent.linkedStudents || [])
      .filter((l) => l.schoolId === schoolId)
      .map((l) => ({
        _id: l.student?._id || l.student,
        name: l.student?.name || null,
        studentId: l.student?.studentId || null,
        admissionNumber: l.student?.admissionNumber || null,
        photoUrl: l.student?.photoUrl || null,
        class: l.student?.class?.name || null,
        section: l.student?.section?.name || null,
        relation: l.relation,
      }));

    res.json({
      success: true,
      parent: {
        ...parent.toSafeObject(),
        children,
        childrenAtOtherSchools: (parent.linkedStudents || []).filter((l) => l.schoolId !== schoolId).length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════ UPDATE ══════════════════════════════════════════

/**
 * PATCH /api/parents/:id
 * Body: { name?, email?, mobileNumber?, address?, children?: [{studentId, relation}] }
 *
 * When `children` is supplied it REPLACES this school's links wholesale
 * (add + remove + relation change in one atomic save). Links belonging to
 * other schools are preserved untouched.
 *
 * Refuses to leave the parent with zero children at this school — that would
 * orphan the account from the admin's own visibility, making it unmanageable.
 * Use DELETE /api/parents/:id/children/:studentId for a deliberate unlink,
 * which enforces the same floor.
 */
exports.updateParent = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { name, email, mobileNumber, address, children } = req.body;

    const parent = await Parent.findOne({ _id: req.params.id, 'linkedStudents.schoolId': schoolId });
    if (!parent) return res.status(404).json({ success: false, message: 'Parent not found.' });

    const before = {
      name: parent.name, email: parent.email, mobileNumber: parent.mobileNumber, address: parent.address,
      childrenCount: parent.linkedStudents.filter((l) => l.schoolId === schoolId).length,
    };

    if (name !== undefined) parent.name = name || null;
    if (address !== undefined) parent.address = address || null;

    // A parent must retain at least one login identifier.
    const nextEmail = email !== undefined ? (email || null) : parent.email;
    const nextMobile = mobileNumber !== undefined ? (mobileNumber || null) : parent.mobileNumber;
    if (!nextEmail && !nextMobile) {
      return res.status(400).json({ success: false, message: 'A parent must keep at least a mobile number or an email.' });
    }
    // `undefined` (not null) removes the key from a sparse unique index.
    if (email !== undefined) parent.email = email || undefined;
    if (mobileNumber !== undefined) parent.mobileNumber = mobileNumber || undefined;

    if (children !== undefined) {
      const resolved = await resolveChildren({ schoolId, body: { children } });
      if (resolved.error) return res.status(404).json({ success: false, message: resolved.error });

      const otherSchoolLinks = parent.linkedStudents.filter((l) => l.schoolId !== schoolId);
      parent.linkedStudents = [...otherSchoolLinks, ...resolved.links];
    }

    await parent.save();

    await logEvent(req, 'parent.updated', {
      targetType: 'Parent',
      targetId: parent._id,
      metadata: {
        before,
        after: {
          name: parent.name, email: parent.email, mobileNumber: parent.mobileNumber, address: parent.address,
          childrenCount: parent.linkedStudents.filter((l) => l.schoolId === schoolId).length,
        },
      },
    });

    res.json({ success: true, message: 'Parent updated.', parent: parent.toSafeObject() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'That mobile/email is already in use by another parent.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════ CHILD LINKS ═════════════════════════════════════

/**
 * POST /api/parents/link   { parentId, studentId, relation }
 * Kept at its original path and payload — the mobile/admin clients call it.
 */
exports.linkChild = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { parentId, studentId, relation } = req.body;

    const [parent, student] = await Promise.all([
      Parent.findById(parentId),
      Student.findOne({ _id: studentId, schoolId }),
    ]);

    if (!parent) return res.status(404).json({ success: false, message: 'Parent not found.' });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found in this school.' });

    if (parent.linkedStudents.some((l) => String(l.student) === String(student._id))) {
      return res.status(409).json({ success: false, message: 'Child already linked.' });
    }

    parent.linkedStudents.push({
      student: student._id,
      schoolId,
      relation: VALID_RELATIONS.includes(relation) ? relation : 'guardian',
    });
    await parent.save();

    await logEvent(req, 'parent.childLinked', {
      targetType: 'Parent', targetId: parent._id, metadata: { student: student.studentId },
    });

    res.json({ success: true, message: 'Child linked.', childrenCount: parent.linkedStudents.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/parents/:id/children/:studentId
 *
 * Unlinking the LAST child at this school is refused. Once the final link is
 * gone, `linkedStudents.schoolId` no longer matches, and the admin loses all
 * visibility of the account — including the ability to undo. If the intent is
 * to revoke access, suspend the account instead (that is what suspension is
 * for, and it is reversible).
 */
exports.unlinkChild = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { id, studentId } = req.params;

    const parent = await Parent.findOne({ _id: id, 'linkedStudents.schoolId': schoolId });
    if (!parent) return res.status(404).json({ success: false, message: 'Parent not found.' });

    const link = parent.linkedStudents.find(
      (l) => String(l.student) === String(studentId) && l.schoolId === schoolId
    );
    if (!link) return res.status(404).json({ success: false, message: 'That child is not linked to this parent at your school.' });

    const linksAtThisSchool = parent.linkedStudents.filter((l) => l.schoolId === schoolId).length;
    if (linksAtThisSchool <= 1) {
      return res.status(409).json({
        success: false,
        message: 'Cannot unlink the parent\'s only child at this school — you would lose access to the account. Suspend the parent instead.',
      });
    }

    const student = await Student.findById(studentId).select('studentId');
    parent.linkedStudents = parent.linkedStudents.filter(
      (l) => !(String(l.student) === String(studentId) && l.schoolId === schoolId)
    );
    await parent.save();

    await logEvent(req, 'parent.childUnlinked', {
      targetType: 'Parent', targetId: parent._id, metadata: { student: student?.studentId || studentId },
    });

    res.json({
      success: true,
      message: 'Child unlinked.',
      childrenCount: parent.linkedStudents.filter((l) => l.schoolId === schoolId).length,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════ STATUS ACTIONS ══════════════════════════════════

/**
 * PATCH /api/parents/:id/status   { status: 'active'|'suspended'|'pending', reason? }
 *
 * Legal transitions (anything else is a 400, so the UI can't invent states):
 *
 *   pending    → suspended            (revoke before they ever activate)
 *   active     → suspended            (revoke)
 *   suspended  → active               (restore; only if they had activated)
 *   suspended  → pending              (restore + force re-activation)
 *   pending    → pending              (no-op, allowed for idempotency)
 *
 * Notably ABSENT: pending → active. An admin cannot mark an account active on
 * the parent's behalf, because "active" means "the parent set their own
 * password". Flipping that flag would leave an account whose passwordHash is
 * still the random unusable string from creation — logged-in-able by nobody,
 * yet displaying as Active. Use `POST /:id/resend-activation` instead.
 */
exports.setParentStatus = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { status, reason } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(', ')}.` });
    }

    const parent = await Parent.findOne({ _id: req.params.id, 'linkedStudents.schoolId': schoolId });
    if (!parent) return res.status(404).json({ success: false, message: 'Parent not found.' });

    const from = parent.status;

    if (from === status) {
      return res.json({ success: true, message: `Parent is already ${status}.`, parent: parent.toSafeObject() });
    }

    if (status === 'active') {
      if (from !== 'suspended') {
        return res.status(400).json({
          success: false,
          message: 'Only a suspended parent can be re-activated. A pending parent must activate their own account — use "Resend activation".',
        });
      }
      if (!parent.activatedAt) {
        return res.status(400).json({
          success: false,
          message: 'This parent never completed activation. Set them back to pending and resend the activation link.',
        });
      }
      parent.status = 'active';
      parent.suspendedAt = null;
      parent.suspendedReason = null;
    } else if (status === 'suspended') {
      parent.status = 'suspended';
      parent.suspendedAt = new Date();
      parent.suspendedReason = reason || null;
    } else if (status === 'pending') {
      if (from !== 'suspended') {
        return res.status(400).json({ success: false, message: 'Only a suspended parent can be returned to pending.' });
      }
      parent.status = 'pending';
      parent.suspendedAt = null;
      parent.suspendedReason = null;
    }

    await parent.save();

    await logEvent(req, `parent.status.${status}`, {
      targetType: 'Parent', targetId: parent._id, metadata: { from, to: status, reason: reason || null },
    });

    res.json({ success: true, message: `Parent ${status}.`, parent: parent.toSafeObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/parents/:id/resend-activation
 * Issues a NEW token (invalidating any prior one) and emails it. Allowed only
 * while the account is pending — an active parent uses "forgot password".
 */
exports.resendActivation = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const parent = await Parent.findOne({ _id: req.params.id, 'linkedStudents.schoolId': schoolId });
    if (!parent) return res.status(404).json({ success: false, message: 'Parent not found.' });

    if (parent.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Activation can only be resent to a pending account (this one is ${parent.status}).`,
      });
    }

    const { activationToken, delivered } = await issueActivationToken(parent, schoolId);

    await logEvent(req, 'parent.activationResent', { targetType: 'Parent', targetId: parent._id, metadata: { delivered } });

    const devToken = process.env.NODE_ENV === 'production' ? undefined : activationToken;
    res.json({ success: true, message: delivered ? 'Activation email sent.' : 'Activation token regenerated (no email on file).', activationToken: devToken, delivered });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};