const Inquiry = require('../models/Inquiry');
const { logEvent } = require('../utils/audit');
const { sendInquiryAdminEmail, sendInquiryConfirmationEmail } = require('../utils/email');

// ─── PUBLIC: submit inquiry (website form) ───────────────────────────────────
exports.createInquiry = async (req, res) => {
  try {
    const { schoolName, contactPerson, email, phone, country, teacherCount, message } = req.body;

    const inquiry = await Inquiry.create({
      schoolName,
      contactPerson,
      email,
      phone,
      country,
      teacherCount,
      message: message || '',
      ipAddress: req.ip || req.connection?.remoteAddress || null,
    });

    // Fire emails — non-blocking, never fail the request
    Promise.allSettled([
      sendInquiryAdminEmail({ inquiry }),
      sendInquiryConfirmationEmail({ inquiry }),
    ]).then(results => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`[Inquiry Email ${i === 0 ? 'admin' : 'user'}] Failed:`, r.reason?.message || r.reason);
        }
      });
    });

    res.status(201).json({
      success: true,
      message: 'Inquiry submitted. Our team will contact you shortly.',
      inquiryId: inquiry._id,
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join('. ') });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SUPER ADMIN: list inquiries ─────────────────────────────────────────────
exports.getInquiries = async (req, res) => {
  try {
    const {
      page = 1, limit = 25,
      status, country,
      search,
      sortBy = 'createdAt', sortOrder = 'desc',
    } = req.query;

    const filter = {};
    if (status)  filter.status = status;
    if (country) filter.country = { $regex: country, $options: 'i' };
    if (search) {
      filter.$or = [
        { schoolName:    { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } },
        { email:         { $regex: search, $options: 'i' } },
        { country:       { $regex: search, $options: 'i' } },
      ];
    }

    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [inquiries, total] = await Promise.all([
      Inquiry.find(filter)
        .sort(sort)
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit))
        .lean(),
      Inquiry.countDocuments(filter),
    ]);

    // Status counts for filter badges
    const statusCounts = await Inquiry.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const counts = {};
    statusCounts.forEach(s => { counts[s._id] = s.count; });

    res.json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      inquiries,
      statusCounts: counts,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SUPER ADMIN: get single inquiry ────────────────────────────────────────
exports.getInquiry = async (req, res) => {
  try {
    const inquiry = await Inquiry.findById(req.params.id).lean();
    if (!inquiry) return res.status(404).json({ success: false, message: 'Inquiry not found.' });
    res.json({ success: true, inquiry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SUPER ADMIN: update status/notes ───────────────────────────────────────
exports.updateInquiry = async (req, res) => {
  try {
    const { status, notes, assignedTo } = req.body;

    const inquiry = await Inquiry.findById(req.params.id);
    if (!inquiry) return res.status(404).json({ success: false, message: 'Inquiry not found.' });

    const prevStatus = inquiry.status;
    if (status)              inquiry.status     = status;
    if (notes !== undefined) inquiry.notes      = notes;
    if (assignedTo !== undefined) inquiry.assignedTo = assignedTo;
    await inquiry.save();

    await logEvent(req, 'inquiry.status.changed', {
      targetType: 'inquiry',
      targetId:   inquiry._id.toString(),
      targetName: inquiry.schoolName,
      metadata: {
        previousStatus: prevStatus,
        newStatus:      status || prevStatus,
        contactPerson:  inquiry.contactPerson,
        email:          inquiry.email,
      },
    });

    res.json({ success: true, message: 'Inquiry updated.', inquiry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SUPER ADMIN: delete inquiry ─────────────────────────────────────────────
exports.deleteInquiry = async (req, res) => {
  try {
    const inquiry = await Inquiry.findByIdAndDelete(req.params.id);
    if (!inquiry) return res.status(404).json({ success: false, message: 'Inquiry not found.' });

    await logEvent(req, 'inquiry.deleted', {
      targetType: 'inquiry',
      targetId:   inquiry._id.toString(),
      targetName: inquiry.schoolName,
      metadata:   { email: inquiry.email, status: inquiry.status },
    });

    res.json({ success: true, message: 'Inquiry deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};