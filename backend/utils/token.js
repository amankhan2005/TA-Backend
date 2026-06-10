const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Generate a raw random token and its bcrypt hash
const generateToken = async () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = await bcrypt.hash(rawToken, 10);
  return { rawToken, hashedToken };
};

// Verify a raw token against its stored bcrypt hash
const verifyToken = async (rawToken, hashedToken) => {
  return bcrypt.compare(rawToken, hashedToken);
};

// Get expiry date for invite tokens (48 hours)
const getInviteExpiry = () => {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + (parseInt(process.env.INVITE_TOKEN_EXPIRY_HOURS) || 48));
  return expiry;
};

// Get expiry date for reset tokens (30 minutes)
const getResetExpiry = () => {
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + (parseInt(process.env.RESET_TOKEN_EXPIRY_MINUTES) || 30));
  return expiry;
};

const getTodayDate = () => {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
};

module.exports = { generateToken, verifyToken, getInviteExpiry, getResetExpiry, getTodayDate };
