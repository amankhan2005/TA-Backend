const SubscriptionPlan = require('../models/SubscriptionPlan');
const { logEvent } = require('../utils/audit');

exports.getPlans = async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find({ isActive: true }).sort({ price: 1 });
    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createPlan = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.create(req.body);

    await logEvent(req, 'plan.created', {
      targetType: 'plan',
      targetId: plan._id,
      targetName: plan.name,
      metadata: { maxTeachers: plan.maxTeachers, price: plan.price, features: plan.features },
    });

    res.status(201).json({ success: true, plan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updatePlan = async (req, res) => {
  try {
    const old = await SubscriptionPlan.findById(req.params.id);
    if (!old) return res.status(404).json({ success: false, message: 'Plan not found.' });

    const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, req.body, { new: true });

    await logEvent(req, 'plan.updated', {
      targetType: 'plan',
      targetId: plan._id,
      targetName: plan.name,
      metadata: {
        changes: {
          maxTeachers: old.maxTeachers !== plan.maxTeachers ? { from: old.maxTeachers, to: plan.maxTeachers } : undefined,
          price: old.price !== plan.price ? { from: old.price, to: plan.price } : undefined,
        },
      },
    });

    res.json({ success: true, plan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deletePlan = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });

    await logEvent(req, 'plan.deactivated', {
      targetType: 'plan',
      targetId: plan._id,
      targetName: plan.name,
    });

    res.json({ success: true, message: 'Plan deactivated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
