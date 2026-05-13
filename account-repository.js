const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { normalizeEmail, sanitizeAccount } = require('./account-policy');

const defaultStore = {
  accounts: [],
  passwordResetTokens: [],
  auditEvents: [],
};

function getAccountDataPath(env = process.env) {
  return env.ROADSIDE_ACCOUNT_DATA_PATH || path.join(__dirname, 'data', 'account-store.json');
}

function ensureArtifacts(env = process.env) {
  const dataPath = getAccountDataPath(env);
  const directory = path.dirname(dataPath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(dataPath, JSON.stringify(defaultStore, null, 2));
  }
}

function readStore(env = process.env) {
  ensureArtifacts(env);
  const parsed = JSON.parse(fs.readFileSync(getAccountDataPath(env), 'utf8'));
  return {
    accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    passwordResetTokens: Array.isArray(parsed.passwordResetTokens)
      ? parsed.passwordResetTokens
      : [],
    auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : [],
  };
}

function writeStore(store, env = process.env) {
  ensureArtifacts(env);
  fs.writeFileSync(getAccountDataPath(env), JSON.stringify(store, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createAuditEvent(event) {
  return {
    id: `acctevt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    createdAt: new Date().toISOString(),
    ...event,
  };
}

class FileAccountRepository {
  constructor(env = process.env) {
    this.env = env;
    this.kind = 'file';
  }

  async init() {
    ensureArtifacts(this.env);
  }

  async getAccountByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return null;
    }

    return (
      readStore(this.env).accounts.find((account) => account.email === normalizedEmail) || null
    );
  }

  async getAccountById(accountId) {
    return readStore(this.env).accounts.find((account) => account.id === accountId) || null;
  }

  async createAccount(payload) {
    const normalizedEmail = normalizeEmail(payload.email);
    const store = readStore(this.env);
    if (store.accounts.some((account) => account.email === normalizedEmail)) {
      throw new Error('An account already exists for this email.');
    }

    const now = new Date().toISOString();
    const account = {
      id: `acct-${Date.now()}`,
      subscriberId: payload.subscriberId || '',
      fullName: payload.fullName.trim(),
      email: normalizedEmail,
      phone: payload.phone.trim(),
      status: 'active',
      roles: ['subscriber'],
      passwordHash: hashPassword(payload.password),
      createdAt: now,
      updatedAt: now,
      lastPasswordResetRequestedAt: '',
      lastPasswordResetCompletedAt: '',
    };

    store.accounts.unshift(account);
    store.auditEvents.unshift(
      createAuditEvent({
        eventType: 'account_created',
        entityType: 'account',
        entityId: account.id,
        accountId: account.id,
        message: `Account ${account.email} created.`,
      })
    );
    writeStore(store, this.env);
    return sanitizeAccount(account);
  }

  async requestPasswordReset(email, options = {}) {
    const normalizedEmail = normalizeEmail(email);
    const store = readStore(this.env);
    const accountIndex = store.accounts.findIndex((account) => account.email === normalizedEmail);
    const account = accountIndex === -1 ? null : store.accounts[accountIndex];
    const now = new Date();

    if (!account) {
      store.auditEvents.unshift(
        createAuditEvent({
          eventType: 'password_reset_requested_unknown_email',
          entityType: 'password_reset',
          entityId: normalizedEmail || 'unknown',
          accountId: '',
          message: `Password reset requested for unknown email ${normalizedEmail || 'unknown'}.`,
        })
      );
      writeStore(store, this.env);
      return {
        accepted: true,
        matchedAccount: false,
        resetToken: '',
      };
    }

    const resetToken = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const resetRecord = {
      id: `rst-${Date.now()}`,
      accountId: account.id,
      tokenHash: hashResetToken(resetToken),
      requestedAt: now.toISOString(),
      expiresAt,
      consumedAt: '',
      requestedByIp: options.requestedByIp || '',
    };

    store.passwordResetTokens.unshift(resetRecord);
    store.accounts[accountIndex] = {
      ...account,
      lastPasswordResetRequestedAt: resetRecord.requestedAt,
      updatedAt: now.toISOString(),
    };
    store.auditEvents.unshift(
      createAuditEvent({
        eventType: 'password_reset_requested',
        entityType: 'password_reset',
        entityId: resetRecord.id,
        accountId: account.id,
        message: `Password reset requested for ${account.email}.`,
      })
    );

    writeStore(store, this.env);
    return {
      accepted: true,
      matchedAccount: true,
      resetToken,
      expiresAt,
    };
  }

  async completePasswordReset(token, password) {
    const store = readStore(this.env);
    const tokenHash = hashResetToken(token);
    const tokenIndex = store.passwordResetTokens.findIndex(
      (resetToken) => resetToken.tokenHash === tokenHash
    );
    if (tokenIndex === -1) {
      return null;
    }

    const resetRecord = store.passwordResetTokens[tokenIndex];
    if (resetRecord.consumedAt) {
      throw new Error('Password reset token was already used.');
    }

    if (new Date(resetRecord.expiresAt).toISOString() < new Date().toISOString()) {
      throw new Error('Password reset token has expired.');
    }

    const accountIndex = store.accounts.findIndex((account) => account.id === resetRecord.accountId);
    if (accountIndex === -1) {
      return null;
    }

    const now = new Date().toISOString();
    store.passwordResetTokens[tokenIndex] = {
      ...resetRecord,
      consumedAt: now,
    };
    store.accounts[accountIndex] = {
      ...store.accounts[accountIndex],
      passwordHash: hashPassword(password),
      updatedAt: now,
      lastPasswordResetCompletedAt: now,
    };
    store.auditEvents.unshift(
      createAuditEvent({
        eventType: 'password_reset_completed',
        entityType: 'password_reset',
        entityId: resetRecord.id,
        accountId: resetRecord.accountId,
        message: `Password reset completed for account ${resetRecord.accountId}.`,
      })
    );

    writeStore(store, this.env);
    return sanitizeAccount(store.accounts[accountIndex]);
  }

  async searchAccounts(filters = {}) {
    const query = String(filters.q || '').trim().toLowerCase();
    const subscriberId = String(filters.subscriberId || '').trim();
    const status = String(filters.status || '').trim().toLowerCase();
    const limit = Number(filters.limit || 50);

    return readStore(this.env).accounts
      .filter((account) => {
        if (subscriberId && account.subscriberId !== subscriberId) {
          return false;
        }

        if (status && String(account.status || '').toLowerCase() !== status) {
          return false;
        }

        if (!query) {
          return true;
        }

        const haystack = [account.email, account.fullName, account.phone, account.subscriberId]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, Number.isFinite(limit) ? limit : 50)
      .map((account) => sanitizeAccount(account));
  }

  async listAuditEvents(limit = 50) {
    return readStore(this.env).auditEvents.slice(0, limit);
  }
}

function createAccountRepository(env = process.env) {
  return new FileAccountRepository(env);
}

module.exports = {
  createAccountRepository,
  hashPassword,
  hashResetToken,
};
