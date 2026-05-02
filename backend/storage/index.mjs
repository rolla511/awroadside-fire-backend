import { STORAGE_SCHEMA_SQL } from "../schema.mjs";

// --- SQL HELPERS (Formerly sql-helpers.mjs) ---

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

async function upsertUserRow(sql, user) {
  await sql.query(
    `INSERT INTO aw_users (
      user_id, full_name, username, email, phone_number, roles, account_state,
      provider_status, subscriber_active, next_billing_date, payload, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      username = EXCLUDED.username,
      email = EXCLUDED.email,
      phone_number = EXCLUDED.phone_number,
      roles = EXCLUDED.roles,
      account_state = EXCLUDED.account_state,
      provider_status = EXCLUDED.provider_status,
      subscriber_active = EXCLUDED.subscriber_active,
      next_billing_date = EXCLUDED.next_billing_date,
      payload = EXCLUDED.payload,
      updated_at = NOW()`,
    [
      Number(user.id),
      user.fullName || null,
      user.username || null,
      user.email || null,
      user.phoneNumber || null,
      toJson(Array.isArray(user.roles) ? user.roles : []),
      user.accountState || null,
      user.providerStatus || null,
      Boolean(user.subscriberActive),
      normalizeTimestamp(user.nextBillingDate),
      toJson(user)
    ]
  );
}

async function upsertSubscriberProfileRow(sql, user) {
  const profile = user?.subscriberProfile || null;
  if (!profile) {
    return;
  }
  await sql.query(
    `INSERT INTO aw_subscriber_profiles (
      user_id, membership_price, vehicle, saved_vehicles, payment_info, payload, updated_at
    )
    VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      membership_price = EXCLUDED.membership_price,
      vehicle = EXCLUDED.vehicle,
      saved_vehicles = EXCLUDED.saved_vehicles,
      payment_info = EXCLUDED.payment_info,
      payload = EXCLUDED.payload,
      updated_at = NOW()`,
    [
      Number(user.id),
      Number.isFinite(Number(profile.membershipPrice)) ? Number(profile.membershipPrice) : null,
      toJson(profile.vehicle || null),
      toJson(Array.isArray(profile.savedVehicles) ? profile.savedVehicles : []),
      toJson(profile.paymentInfo || null),
      toJson(profile)
    ]
  );
}

async function upsertProviderProfileRow(sql, user) {
  const profile = user?.providerProfile || null;
  if (!profile) {
    return;
  }
  await sql.query(
    `INSERT INTO aw_provider_profiles (
      user_id, service_area, current_location, services, rating, discipline, wallet, payload, updated_at
    )
    VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      service_area = EXCLUDED.service_area,
      current_location = EXCLUDED.current_location,
      services = EXCLUDED.services,
      rating = EXCLUDED.rating,
      discipline = EXCLUDED.discipline,
      wallet = EXCLUDED.wallet,
      payload = EXCLUDED.payload,
      updated_at = NOW()`,
    [
      Number(user.id),
      profile.serviceArea || null,
      profile.currentLocation || null,
      toJson(Array.isArray(user.services) ? user.services : []),
      toJson(profile.rates || {}),
      toJson(profile.discipline || {}),
      toJson(profile.paypal || {}),
      toJson(profile)
    ]
  );
}

async function upsertServiceRequestRow(sql, request) {
  const requestId = String(request.id || request.requestId || "");
  if (!requestId) {
    return;
  }
  await sql.query(
    `INSERT INTO aw_service_requests (
      request_id, user_id, assigned_provider_id, status, completion_status,
      payment_status, provider_payout_status, service_type, submitted_at, updated_at, payload
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    ON CONFLICT (request_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      assigned_provider_id = EXCLUDED.assigned_provider_id,
      status = EXCLUDED.status,
      completion_status = EXCLUDED.completion_status,
      payment_status = EXCLUDED.payment_status,
      provider_payout_status = EXCLUDED.provider_payout_status,
      service_type = EXCLUDED.service_type,
      submitted_at = EXCLUDED.submitted_at,
      updated_at = EXCLUDED.updated_at,
      payload = EXCLUDED.payload`,
    [
      requestId,
      Number.isInteger(Number(request.userId)) ? Number(request.userId) : null,
      Number.isInteger(Number(request.assignedProviderId)) ? Number(request.assignedProviderId) : null,
      request.status || null,
      request.completionStatus || null,
      request.paymentStatus || null,
      request.providerPayoutStatus || null,
      request.serviceType || null,
      normalizeTimestamp(request.submittedAt || request.createdAt),
      normalizeTimestamp(request.updatedAt || request.createdAt || request.submittedAt),
      toJson(request)
    ]
  );
}

async function insertPaymentEventRow(sql, entry) {
  const eventId = String(entry?.id || entry?.paypalOrderId || `${Date.now()}`);
  await sql.query(
    `INSERT INTO aw_payment_events (
      event_id, event_type, request_id, paypal_order_id, created_at, payload
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)
    ON CONFLICT (event_id) DO UPDATE SET
      event_type = EXCLUDED.event_type,
      request_id = EXCLUDED.request_id,
      paypal_order_id = EXCLUDED.paypal_order_id,
      created_at = EXCLUDED.created_at,
      payload = EXCLUDED.payload`,
    [
      eventId,
      entry?.event || null,
      entry?.requestId || null,
      entry?.paypalOrderId || null,
      normalizeTimestamp(entry?.createdAt || new Date().toISOString()),
      toJson(entry)
    ]
  );
}

function buildPerformanceRowsFromUser(user) {
  const providerId = Number(user?.id);
  if (!Number.isInteger(providerId)) {
    return [];
  }
  const discipline = user?.providerProfile?.discipline || {};
  const rows = [];
  for (const event of Array.isArray(discipline.lowRatingEvents) ? discipline.lowRatingEvents : []) {
    rows.push({
      historyId: `rating:${providerId}:${event.eventId}`,
      providerUserId: providerId,
      category: "rating",
      eventReference: event.eventId,
      occurredAt: normalizeTimestamp(event.submittedAt),
      payload: event
    });
  }
  for (const event of Array.isArray(discipline.suspensionHistory) ? discipline.suspensionHistory : []) {
    rows.push({
      historyId: `suspension:${providerId}:${event.suspensionId}`,
      providerUserId: providerId,
      category: "suspension",
      eventReference: event.suspensionId,
      occurredAt: normalizeTimestamp(event.startedAt),
      payload: event
    });
  }
  if (discipline.training && typeof discipline.training === "object") {
    rows.push({
      historyId: `training:${providerId}:${discipline.training.updatedAt || "current"}`,
      providerUserId: providerId,
      category: "training",
      eventReference: discipline.training.status || "training",
      occurredAt: normalizeTimestamp(discipline.training.updatedAt || discipline.training.completedAt || discipline.training.enrolledAt),
      payload: discipline.training
    });
  }
  if (discipline.restriction && discipline.restriction.active) {
    rows.push({
      historyId: `restriction:${providerId}:${discipline.restriction.flaggedAt || "active"}`,
      providerUserId: providerId,
      category: "restriction",
      eventReference: discipline.restriction.sourceProbationId || "restriction",
      occurredAt: normalizeTimestamp(discipline.restriction.flaggedAt),
      payload: discipline.restriction
    });
  }
  return rows;
}

async function upsertPerformanceRow(sql, row) {
  await sql.query(
    `INSERT INTO aw_provider_performance_history (
      history_id, provider_user_id, category, event_reference, occurred_at, payload, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())
    ON CONFLICT (history_id) DO UPDATE SET
      provider_user_id = EXCLUDED.provider_user_id,
      category = EXCLUDED.category,
      event_reference = EXCLUDED.event_reference,
      occurred_at = EXCLUDED.occurred_at,
      payload = EXCLUDED.payload,
      updated_at = NOW()`,
    [
      row.historyId,
      row.providerUserId,
      row.category,
      row.eventReference || null,
      normalizeTimestamp(row.occurredAt),
      toJson(row.payload)
    ]
  );
}

async function upsertWalletRow(sql, row) {
  await sql.query(
    `INSERT INTO aw_provider_wallet_history (
      entry_id, provider_user_id, request_id, provider_payout_status, payout_reference,
      amount_collected, provider_payout_amount, completed_at, payout_completed_at, payload, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW())
    ON CONFLICT (entry_id) DO UPDATE SET
      provider_user_id = EXCLUDED.provider_user_id,
      request_id = EXCLUDED.request_id,
      provider_payout_status = EXCLUDED.provider_payout_status,
      payout_reference = EXCLUDED.payout_reference,
      amount_collected = EXCLUDED.amount_collected,
      provider_payout_amount = EXCLUDED.provider_payout_amount,
      completed_at = EXCLUDED.completed_at,
      payout_completed_at = EXCLUDED.payout_completed_at,
      payload = EXCLUDED.payload,
      updated_at = NOW()`,
    [
      row.entryId,
      row.providerUserId,
      row.requestId,
      row.providerPayoutStatus || null,
      row.payoutReference || null,
      row.amountCollected,
      row.providerPayoutAmount,
      normalizeTimestamp(row.completedAt),
      normalizeTimestamp(row.payoutCompletedAt),
      toJson(row.payload)
    ]
  );
}

// --- REPOSITORIES (Formerly separate .mjs files) ---

function createUsersRepository() {
  return {
    name: "users",
    syncCoordinator: "backend/server.mjs",
    targetTables: ["aw_users", "aw_subscriber_profiles", "aw_provider_profiles"],
    async sync(sql, users) {
      for (const user of users) {
        await upsertUserRow(sql, user);
        await upsertSubscriberProfileRow(sql, user);
        await upsertProviderProfileRow(sql, user);
      }
    }
  };
}

function createRequestsRepository() {
  return {
    name: "requests",
    syncCoordinator: "backend/server.mjs",
    targetTables: ["aw_service_requests"],
    async sync(sql, requests) {
      for (const request of requests) {
        await upsertServiceRequestRow(sql, request);
      }
    }
  };
}

function createPaymentsRepository() {
  return {
    name: "payments",
    syncCoordinator: "backend/server.mjs",
    targetTables: ["aw_payment_events"],
    async insert(sql, entry) {
      await insertPaymentEventRow(sql, entry);
    }
  };
}

function createProviderWalletRepository() {
  return {
    name: "providerWallet",
    syncCoordinator: "backend/server.mjs",
    targetTables: ["aw_provider_wallet_history"],
    async syncFromRequests(sql, requests) {
      for (const request of requests) {
        const providerUserId = Number(request?.assignedProviderId);
        if (!Number.isInteger(providerUserId)) {
          continue;
        }
        await upsertWalletRow(sql, {
          entryId: `wallet:${providerUserId}:${request.id || request.requestId}`,
          providerUserId,
          requestId: String(request.id || request.requestId || ""),
          providerPayoutStatus: request.providerPayoutStatus || null,
          payoutReference: request.payoutReference || null,
          amountCollected: Number.isFinite(Number(request.amountCollected)) ? Number(request.amountCollected) : null,
          providerPayoutAmount: Number.isFinite(Number(request.providerPayoutAmount)) ? Number(request.providerPayoutAmount) : null,
          completedAt: request.completedAt || null,
          payoutCompletedAt: request.payoutCompletedAt || null,
          payload: request
        });
      }
    }
  };
}

function createProviderHistoryRepository() {
  return {
    name: "providerHistory",
    syncCoordinator: "backend/server.mjs",
    targetTables: ["aw_provider_performance_history"],
    async syncFromUsers(sql, users) {
      for (const user of users) {
        for (const row of buildPerformanceRowsFromUser(user)) {
          await upsertPerformanceRow(sql, row);
        }
      }
    }
  };
}

// --- STORAGE KERNEL & AUTHORITY ---

export function createAwRoadsideStorageKernel() {
  return Object.freeze({
    schemaSql: STORAGE_SCHEMA_SQL,
    repositories: Object.freeze({
      users: createUsersRepository(),
      requests: createRequestsRepository(),
      payments: createPaymentsRepository(),
      providerWallet: createProviderWalletRepository(),
      providerHistory: createProviderHistoryRepository()
    })
  });
}

export function createAwRoadsideStorageAuthority({
  awRoadsideDbConfig = null,
  dbConfig = null,
  localWatchdog = null,
  storageKernel = createAwRoadsideStorageKernel()
} = {}) {
  const resolvedDbConfig = awRoadsideDbConfig || dbConfig;
  if (!resolvedDbConfig || !resolvedDbConfig.authority) {
    throw new Error("AW Roadside storage authority requires awRoadsideDbConfig.");
  }

  const repositories = Object.freeze(storageKernel.repositories || {});
  const schemaSql = typeof storageKernel.schemaSql === "string" ? storageKernel.schemaSql : "";
  let sql = null;
  let enabled = false;
  let status = {
    initialized: false,
    enabled: false,
    mode: resolvedDbConfig.authority.mode,
    configured: resolvedDbConfig.authority.configured,
    client: resolvedDbConfig.authority.client,
    database: resolvedDbConfig.authority.database || null,
    strict: resolvedDbConfig.authority.strict,
    repositories: Object.keys(repositories),
    lastEvent: "created"
  };

  return {
    repositories,
    getStatus() {
      return { ...status };
    },
    async initialize() {
      await resolvedDbConfig.recordTransition("awroadsidedb-config-initialized", {
        mode: resolvedDbConfig.authority.mode,
        configured: resolvedDbConfig.authority.configured,
        client: resolvedDbConfig.authority.client,
        strict: resolvedDbConfig.authority.strict
      });
      status = {
        ...status,
        initialized: true,
        lastEvent: "awroadsidedb-config-initialized"
      };

      if (!resolvedDbConfig.authority.configured || resolvedDbConfig.authority.mode === "file-runtime") {
        status = {
          ...status,
          enabled: false,
          lastEvent: "storage-authority-file-runtime"
        };
        await record("storage-authority-file-runtime", {
          repositories: Object.keys(repositories)
        });
        return;
      }

      if (!schemaSql || !repositories.users || !repositories.requests || !repositories.payments) {
        await handleFailure(
          new Error("AW Roadside storage kernel is incomplete."),
          "storage-authority-incomplete-kernel"
        );
        return;
      }

      if (resolvedDbConfig.authority.client !== "postgres") {
        await handleFailure(
          new Error(`Unsupported DB client: ${resolvedDbConfig.authority.client}`),
          "storage-authority-unsupported-client"
        );
        return;
      }

      try {
        const { Pool } = await import("pg");
        sql = new Pool(resolvedDbConfig.getConnectionConfig());
        await sql.query(schemaSql);
        enabled = true;
        status = {
          ...status,
          enabled: true,
          lastEvent: "storage-authority-sql-ready"
        };
        await record("storage-authority-sql-ready", {
          repositories: Object.keys(repositories),
          client: resolvedDbConfig.authority.client,
          database: resolvedDbConfig.authority.database || null
        });
      } catch (error) {
        await handleFailure(error, "storage-authority-sql-unavailable");
      }
    },
    async syncUsers(users) {
      if (!enabled || !sql) {
        return;
      }
      try {
        await repositories.users.sync(sql, Array.isArray(users) ? users : []);
        await repositories.providerHistory.syncFromUsers(sql, Array.isArray(users) ? users : []);
      } catch (error) {
        await handleFailure(error, "storage-sync-users-failed");
      }
    },
    async syncRequests(requests) {
      if (!enabled || !sql) {
        return;
      }
      try {
        const list = Array.isArray(requests) ? requests : [];
        await repositories.requests.sync(sql, list);
        await repositories.providerWallet.syncFromRequests(sql, list);
      } catch (error) {
        await handleFailure(error, "storage-sync-requests-failed");
      }
    },
    async appendPaymentEvent(entry) {
      if (!enabled || !sql) {
        return;
      }
      try {
        await repositories.payments.insert(sql, entry);
      } catch (error) {
        await handleFailure(error, "storage-sync-payment-failed");
      }
    }
  };

  async function record(event, details = {}) {
    await resolvedDbConfig.recordTransition(event, details);
    if (localWatchdog && typeof localWatchdog.record === "function") {
      await localWatchdog.record(event, {
        layer: "awroadside-storage",
        ...details
      });
    }
  }

  async function handleFailure(error, event) {
    status = {
      ...status,
      enabled: false,
      lastEvent: event,
      lastError: error instanceof Error ? error.message : String(error)
    };
    await record(event, {
      message: error instanceof Error ? error.message : String(error)
    });
    if (resolvedDbConfig.authority.strict) {
      throw error;
    }
  }
}
