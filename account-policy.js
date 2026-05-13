function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 8) {
    return 'password must be at least 8 characters.';
  }

  return null;
}

function validateSignupPayload(payload = {}) {
  if (typeof payload.fullName !== 'string' || payload.fullName.trim() === '') {
    return 'fullName is required.';
  }

  if (typeof payload.phone !== 'string' || payload.phone.trim() === '') {
    return 'phone is required.';
  }

  const email = normalizeEmail(payload.email);
  if (!email || !validateEmail(email)) {
    return 'email must be a valid email address.';
  }

  const passwordError = validatePassword(payload.password);
  if (passwordError) {
    return passwordError;
  }

  if (payload.password !== payload.confirmPassword) {
    return 'confirmPassword must match password.';
  }

  return null;
}

function validatePasswordResetRequestPayload(payload = {}) {
  const email = normalizeEmail(payload.email);
  if (!email || !validateEmail(email)) {
    return 'email must be a valid email address.';
  }

  return null;
}

function validatePasswordResetConfirmPayload(payload = {}) {
  if (typeof payload.token !== 'string' || payload.token.trim() === '') {
    return 'token is required.';
  }

  const passwordError = validatePassword(payload.password);
  if (passwordError) {
    return passwordError;
  }

  if (payload.password !== payload.confirmPassword) {
    return 'confirmPassword must match password.';
  }

  return null;
}

function sanitizeAccount(account) {
  if (!account) {
    return null;
  }

  return {
    id: account.id,
    subscriberId: account.subscriberId || '',
    fullName: account.fullName,
    email: account.email,
    phone: account.phone,
    status: account.status,
    roles: Array.isArray(account.roles) ? [...account.roles] : [],
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastPasswordResetRequestedAt: account.lastPasswordResetRequestedAt || '',
    lastPasswordResetCompletedAt: account.lastPasswordResetCompletedAt || '',
  };
}

module.exports = {
  normalizeEmail,
  sanitizeAccount,
  validatePasswordResetConfirmPayload,
  validatePasswordResetRequestPayload,
  validateSignupPayload,
};
