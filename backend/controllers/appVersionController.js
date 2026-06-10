const AppVersion = require('../models/AppVersion');
const { logEvent } = require('../utils/audit');

// ── PUBLIC: Mobile app fetches this on startup ───────────────────────────────
// Returns the single active version config. No auth required.
// Response is intentionally minimal — only what the mobile app needs.
exports.getActiveVersion = async (req, res) => {
  try {
    const config = await AppVersion.findOne({ isActive: true }).sort({ createdAt: -1 });

    if (!config) {
      // No version record yet — allow app through (default safe behaviour)
      return res.json({
        success: true,
        data: null,
        message: 'No version configuration set.',
      });
    }

    res.json({
      success: true,
      data: {
        latestVersion:  config.latestVersion,
        minimumVersion: config.minimumVersion,
        updateType:     config.updateType,
        title:          config.title,
        message:        config.message,
        androidUrl:     config.androidUrl,
        iosUrl:         config.iosUrl,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── SUPER ADMIN: Get all version records (history) ───────────────────────────
exports.getAllVersions = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const [versions, total] = await Promise.all([
      AppVersion.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .lean(),
      AppVersion.countDocuments(),
    ]);
    res.json({ success: true, total, page: parseInt(page), versions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── SUPER ADMIN: Create a new version config ─────────────────────────────────
// Creating a new record automatically deactivates the previous active one.
exports.createVersion = async (req, res) => {
  try {
    const {
      latestVersion, minimumVersion, updateType,
      title, message, androidUrl, iosUrl,
    } = req.body;

    // Deactivate current active record first (only one active at a time)
    await AppVersion.updateMany({ isActive: true }, { isActive: false });

    const config = await AppVersion.create({
      latestVersion,
      minimumVersion,
      updateType,
      title,
      message,
      androidUrl:  androidUrl  || '',
      iosUrl:      iosUrl      || '',
      isActive:    true,
      createdBy:   req.user?.email || null,
    });

    await logEvent(req, 'appversion.created', {
      targetType: 'appVersion',
      targetId:   String(config._id),
      targetName: `v${config.latestVersion}`,
      metadata:   {
        latestVersion,
        minimumVersion,
        updateType,
        title,
      },
    });

    res.status(201).json({ success: true, message: 'App version configuration created.', config });
  } catch (err) {
    if (err.message.includes('minimumVersion cannot')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── SUPER ADMIN: Update an existing version config ───────────────────────────
exports.updateVersion = async (req, res) => {
  try {
    const { id } = req.params;
    const old = await AppVersion.findById(id);
    if (!old) return res.status(404).json({ success: false, message: 'Version config not found.' });

    const allowedFields = [
      'latestVersion', 'minimumVersion', 'updateType',
      'title', 'message', 'androidUrl', 'iosUrl', 'isActive',
    ];
    const updates = {};
    allowedFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    // If activating this record, deactivate others first
    if (updates.isActive === true && !old.isActive) {
      await AppVersion.updateMany({ isActive: true }, { isActive: false });
    }

    // Apply and trigger pre-save validation via findById + save
    Object.assign(old, updates);
    await old.save();

    await logEvent(req, 'appversion.updated', {
      targetType: 'appVersion',
      targetId:   String(old._id),
      targetName: `v${old.latestVersion}`,
      metadata:   { changes: updates },
    });

    res.json({ success: true, message: 'Version config updated.', config: old });
  } catch (err) {
    if (err.message.includes('minimumVersion cannot')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── SUPER ADMIN: Activate a specific version record ──────────────────────────
exports.activateVersion = async (req, res) => {
  try {
    const { id } = req.params;
    const config = await AppVersion.findById(id);
    if (!config) return res.status(404).json({ success: false, message: 'Version config not found.' });

    await AppVersion.updateMany({ isActive: true }, { isActive: false });
    config.isActive = true;
    await config.save();

    await logEvent(req, 'appversion.updated', {
      targetType: 'appVersion',
      targetId:   String(config._id),
      targetName: `v${config.latestVersion}`,
      metadata:   { action: 'activated' },
    });

    res.json({ success: true, message: `v${config.latestVersion} is now the active version config.`, config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── SUPER ADMIN: Delete a version record (only non-active) ───────────────────
exports.deleteVersion = async (req, res) => {
  try {
    const { id } = req.params;
    const config = await AppVersion.findById(id);
    if (!config) return res.status(404).json({ success: false, message: 'Version config not found.' });
    if (config.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete the active version config. Activate another record first.',
      });
    }

    await AppVersion.findByIdAndDelete(id);

    await logEvent(req, 'appversion.deleted', {
      targetType: 'appVersion',
      targetId:   id,
      targetName: `v${config.latestVersion}`,
    });

    res.json({ success: true, message: 'Version config deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
