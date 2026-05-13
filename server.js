const http = require('http');
const path = require('path');

const {
  normalizeEmail,
  validatePasswordResetConfirmPayload,
  validatePasswordResetRequestPayload,
  validateSignupPayload,
} = require('./account-policy');
const {
  createAccountRepository,
} = require('./account-repository');
const {
  createComplianceRepository,
} = require('./compliance-repository');
const {
  buildProviderPolicy,
  validateHoursEndPayload,
  validateHoursStartPayload,
  validateProviderApprovalPayload,
  validateProviderPayoutDisputeDecisionPayload,
  validateProviderPayoutDisputePayload,
  validateProviderPayoutMethodPayload,
  validateProviderPayoutWebhookPayload,
  validateProviderProfilePayload,
  validateProviderReactivationPayload,
  validateProviderServiceAreaPayload,
  validateTrainingPaymentPayload,
  validateTrainingProgressPayload,
  validateTrainingSessionPayload,
  validateWorkLogCreatePayload,
  validateWorkLogEtaPayload,
} = require('./provider-policy');
const {
  createProviderRepository,
  hasActiveSuspension,
  haversineMiles,
} = require('./provider-repository');
const {
  createIntegrationRepository,
} = require('./integration-repository');
const {
  buildSubscriberPolicy,
  validateProviderRatingPayload,
  validateSubscriberPayload,
  validateSupportMessagePayload,
  validateSupportThreadPayload,
  validateTermsAcceptancePayload,
} = require('./subscriber-policy');
const {
  createSubscriberRepository,
} = require('./subscriber-repository');
const {
  buildCompliancePolicy,
  extractTowTermsAcceptance,
  formatUsd,
  validateDamageClaimPayload,
  validateDamageClaimReviewPayload,
  validateDocumentReviewPayload,
  validateProviderDocumentPayload,
  validateTowTermsAcceptance,
} = require('./compliance-policy');
const {
  decorateServiceRequest,
  getFinancePolicy,
  getPricingCatalog,
  resolveServicePolicy,
} = require('./finance');
const { createStorage } = require('./storage');
const {
  authorizeSystemAccess,
  buildSystemPathReport,
  getConfiguredSystemRoles,
} = require('./system-policy');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.warn('Skipping .env load:', error.message);
  }
}

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4000);
const PAYPAL_MODE =
  String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
const PAYPAL_API_BASE =
  PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';
const MAPBOX_WEBHOOK_SECRET = process.env.MAPBOX_WEBHOOK_SECRET || '';

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(payload));
}

function getUrlParts(requestUrl) {
  return new URL(requestUrl, 'http://127.0.0.1');
}

function collectBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });

    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on('error', reject);
  });
}

function buildPathSearchIndex(pathReport) {
  const pathEntries = Object.entries(pathReport.dataPaths || {}).map(([key, value]) => ({
    id: key,
    kind: 'file_path',
    value,
  }));
  const normalizedUrlEntries = Array.isArray(pathReport.fallbackApiBaseUrls)
    ? pathReport.fallbackApiBaseUrls.map((value, index) => ({
        id: `fallbackApiBaseUrl${index + 1}`,
        kind: 'url',
        value,
      }))
    : [];

  return [...pathEntries, { id: 'apiBaseUrl', kind: 'url', value: pathReport.apiBaseUrl }, ...normalizedUrlEntries];
}

function filterPathSearchIndex(pathIndex, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) {
    return pathIndex;
  }

  return pathIndex.filter((entry) =>
    [entry.id, entry.kind, entry.value].join(' ').toLowerCase().includes(normalizedQuery)
  );
}

function readHeader(request, name) {
  return String(request.headers[name] || '').trim();
}

async function getPaypalAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal client credentials are not configured.');
  }

  const credentials = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(`PayPal token request failed with ${response.status}.`);
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error('PayPal token response did not include an access token.');
  }

  return payload.access_token;
}

async function verifyPaypalWebhook(payload, request) {
  if (!PAYPAL_WEBHOOK_ID || !PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return {
      status: 'not_configured',
      detail: 'PayPal webhook verification is not configured on this server.',
    };
  }

  const verificationPayload = {
    auth_algo: readHeader(request, 'paypal-auth-algo'),
    cert_url: readHeader(request, 'paypal-cert-url'),
    transmission_id: readHeader(request, 'paypal-transmission-id'),
    transmission_sig: readHeader(request, 'paypal-transmission-sig'),
    transmission_time: readHeader(request, 'paypal-transmission-time'),
    webhook_id: PAYPAL_WEBHOOK_ID,
    webhook_event: payload,
  };

  const missingHeader = Object.entries(verificationPayload).find(
    ([key, value]) => key !== 'webhook_id' && key !== 'webhook_event' && !value
  );
  if (missingHeader) {
    return {
      status: 'missing_headers',
      detail: `Missing required PayPal verification header for ${missingHeader[0]}.`,
    };
  }

  const accessToken = await getPaypalAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(verificationPayload),
  });
  const verificationResult = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      status: 'verification_failed',
      detail: `PayPal verification endpoint returned ${response.status}.`,
    };
  }

  return {
    status:
      String(verificationResult.verification_status || '').toUpperCase() === 'SUCCESS'
        ? 'verified'
        : 'verification_failed',
    detail: verificationResult.verification_status || 'unknown',
  };
}

function verifyMapboxWebhook(request) {
  if (!MAPBOX_WEBHOOK_SECRET) {
    return {
      status: 'not_configured',
      detail: 'Mapbox webhook secret is not configured on this server.',
    };
  }

  const providedSecret =
    readHeader(request, 'x-mapbox-webhook-secret') ||
    readHeader(request, 'x-mapbox-signature') ||
    readHeader(request, 'authorization').replace(/^Bearer\s+/i, '');

  if (providedSecret && providedSecret === MAPBOX_WEBHOOK_SECRET) {
    return {
      status: 'verified',
      detail: 'Mapbox webhook secret matched.',
    };
  }

  return {
    status: 'verification_failed',
    detail: 'Mapbox webhook secret did not match.',
  };
}

function validateServiceRequest(payload) {
  const requiredFields = ['customerName', 'phone', 'vehicle', 'location', 'serviceType'];
  const missingField = requiredFields.find((field) => {
    const value = payload[field];
    return typeof value !== 'string' || value.trim() === '';
  });

  if (missingField) {
    return `Missing required field: ${missingField}`;
  }

  return null;
}

const serviceRequestActionMap = {
  accept: {
    nextStatus: 'accepted',
    allowedCurrentStatuses: ['pending'],
  },
  arrival: {
    nextStatus: 'arrived',
    allowedCurrentStatuses: ['accepted'],
  },
  complete: {
    nextStatus: 'completed',
    allowedCurrentStatuses: ['accepted', 'arrived'],
  },
  cancel: {
    nextStatus: 'cancelled',
    allowedCurrentStatuses: ['pending', 'accepted', 'arrived'],
  },
};

function getServiceRequestAction(url) {
  const match = /^\/api\/service-requests\/([^/]+)\/([^/]+)$/.exec(url);
  if (!match) {
    return null;
  }

  return {
    id: decodeURIComponent(match[1]),
    action: decodeURIComponent(match[2]).toLowerCase(),
  };
}

function validateStatusTransition(currentStatus, actionConfig, action) {
  const normalizedStatus = String(currentStatus || '').toLowerCase();
  if (actionConfig.allowedCurrentStatuses.includes(normalizedStatus)) {
    return null;
  }

  return `Cannot ${action} a request while status is ${normalizedStatus || 'unknown'}.`;
}

async function startServer() {
  const storage = await createStorage();
  const complianceRepository = createComplianceRepository();
  const providerRepository = createProviderRepository();
  const subscriberRepository = createSubscriberRepository();
  await storage.init();
  await complianceRepository.init();
  await providerRepository.init();
  await subscriberRepository.init();

  async function decorateRequestRecord(serviceRequest) {
    const requestWithFinance = decorateServiceRequest(serviceRequest);
    const towTerms = await complianceRepository.getServiceRequestTerms(serviceRequest.id);
    return {
      ...requestWithFinance,
      towTerms,
    };
  }

  function extractComplianceProviderId(event) {
    if (event.entityType === 'provider_document') {
      return event.payload?.providerId || event.actorId || '';
    }

    if (event.entityType === 'damage_claim') {
      return event.payload?.providerId || event.actorId || '';
    }

    return '';
  }

  function extractComplianceRequestId(event) {
    if (event.entityType === 'damage_claim') {
      return event.payload?.requestId || '';
    }

    return '';
  }

  async function buildProviderEventFeed(filters = {}) {
    const limit = Number(filters.limit || 50);
    const providerEvents = await providerRepository.listEvents(filters);
    const complianceEvents = await complianceRepository.listAuditEvents(limit * 3);

    const providerIdFilter = typeof filters.providerId === 'string' ? filters.providerId.trim() : '';
    const requestIdFilter = typeof filters.requestId === 'string' ? filters.requestId.trim() : '';
    const eventTypeFilter = String(filters.eventType || '').trim();
    const entityTypeFilter = String(filters.entityType || '').trim();
    const actorTypeFilter = String(filters.actorType || '').trim();

    const complianceProviderEvents = complianceEvents
      .filter((event) => ['provider_document', 'damage_claim'].includes(event.entityType))
      .filter((event) => {
        if (eventTypeFilter && event.eventType !== eventTypeFilter) {
          return false;
        }

        if (entityTypeFilter && event.entityType !== entityTypeFilter) {
          return false;
        }

        if (actorTypeFilter && event.actorType !== actorTypeFilter) {
          return false;
        }

        if (providerIdFilter && extractComplianceProviderId(event) !== providerIdFilter) {
          return false;
        }

        if (requestIdFilter && extractComplianceRequestId(event) !== requestIdFilter) {
          return false;
        }

        return true;
      })
      .map((event) => ({
        ...event,
        providerId: extractComplianceProviderId(event),
        requestId: extractComplianceRequestId(event),
      }));

    return [...providerEvents, ...complianceProviderEvents]
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
      .slice(0, Number.isFinite(limit) ? limit : 50);
  }

  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      return sendJson(response, 400, { error: 'Missing URL' });
    }

    const url = getUrlParts(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return sendJson(response, 204, {});
    }

    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        await storage.healthCheck();
        return sendJson(response, 200, {
          ok: true,
          service: 'roadside-backend',
          storage: storage.kind,
        });
      }

      if (request.method === 'GET' && pathname === '/api/pricing') {
        return sendJson(response, 200, getPricingCatalog());
      }

      if (request.method === 'GET' && pathname === '/api/finance/policy') {
        return sendJson(response, 200, getFinancePolicy());
      }

      if (request.method === 'GET' && pathname === '/api/compliance/policy') {
        return sendJson(response, 200, buildCompliancePolicy());
      }

      if (request.method === 'GET' && pathname === '/api/compliance/events') {
        const limit = Number(url.searchParams.get('limit') || 50);
        return sendJson(response, 200, {
          events: await complianceRepository.listAuditEvents(limit),
        });
      }

      if (request.method === 'GET' && pathname === '/api/provider/policy') {
        return sendJson(response, 200, buildProviderPolicy());
      }

      if (pathname === '/api/providers') {
        if (request.method === 'GET') {
          return sendJson(response, 200, {
            providers: await providerRepository.listProviders({
              status: url.searchParams.get('status') || '',
            }),
          });
        }

        if (request.method === 'POST') {
          const payload = await collectBody(request);
          const validationError = validateProviderProfilePayload(payload);
          if (validationError) {
            return sendJson(response, 400, { error: validationError });
          }

          const provider = await providerRepository.createProvider(payload);
          return sendJson(response, 201, { provider });
        }
      }

      const providerApproveMatch = /^\/api\/providers\/([^/]+)\/approve$/.exec(pathname);
      if (request.method === 'POST' && providerApproveMatch) {
        const payload = await collectBody(request);
        const validationError = validateProviderApprovalPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const provider = await providerRepository.approveProvider(
          decodeURIComponent(providerApproveMatch[1]),
          payload
        );
        if (!provider) {
          return sendJson(response, 404, { error: 'Provider not found' });
        }

        return sendJson(response, 200, { provider });
      }

      const providerServiceAreaMatch = /^\/api\/providers\/([^/]+)\/service-area$/.exec(pathname);
      if (request.method === 'POST' && providerServiceAreaMatch) {
        const payload = await collectBody(request);
        const validationError = validateProviderServiceAreaPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const provider = await providerRepository.updateProviderServiceArea(
          decodeURIComponent(providerServiceAreaMatch[1]),
          payload
        );
        if (!provider) {
          return sendJson(response, 404, { error: 'Provider not found' });
        }

        return sendJson(response, 200, { provider });
      }

      const providerPayoutMethodMatch = /^\/api\/providers\/([^/]+)\/payout-method$/.exec(pathname);
      if (request.method === 'POST' && providerPayoutMethodMatch) {
        const payload = await collectBody(request);
        const validationError = validateProviderPayoutMethodPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const provider = await providerRepository.updateProviderPayoutMethod(
          decodeURIComponent(providerPayoutMethodMatch[1]),
          payload
        );
        if (!provider) {
          return sendJson(response, 404, { error: 'Provider not found' });
        }

        return sendJson(response, 200, { provider });
      }

      const providerReactivateMatch = /^\/api\/providers\/([^/]+)\/reactivate$/.exec(pathname);
      if (request.method === 'POST' && providerReactivateMatch) {
        const payload = await collectBody(request);
        const validationError = validateProviderReactivationPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const provider = await providerRepository.reactivateProvider(
          decodeURIComponent(providerReactivateMatch[1]),
          payload
        );
        if (!provider) {
          return sendJson(response, 404, { error: 'Provider not found' });
        }

        return sendJson(response, 200, { provider });
      }

      const providerHoursStartMatch = /^\/api\/providers\/([^/]+)\/hours\/start$/.exec(pathname);
      if (request.method === 'POST' && providerHoursStartMatch) {
        const payload = await collectBody(request);
        const validationError = validateHoursStartPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const providerId = decodeURIComponent(providerHoursStartMatch[1]);
        const provider = await providerRepository.getProvider(providerId);
        if (!provider) {
          return sendJson(response, 404, { error: 'Provider not found' });
        }

        if (provider.status !== 'active' || hasActiveSuspension(provider)) {
          return sendJson(response, 409, {
            error: 'Provider is not eligible to start hours of service.',
          });
        }

        if (new Date(payload.scheduledEndsAt).toISOString() <= new Date().toISOString()) {
          return sendJson(response, 400, {
            error: 'scheduledEndsAt must be later than the current time.',
          });
        }

        if (!payload.center && !provider.serviceAreaCenter) {
          return sendJson(response, 400, {
            error: 'Provider must configure a service area before starting hours.',
          });
        }

        const session = await providerRepository.startHoursSession(providerId, payload);
        return sendJson(response, 201, { session });
      }

      const providerMatch = /^\/api\/providers\/([^/]+)$/.exec(pathname);
      if (request.method === 'GET' && providerMatch) {
        const provider = await providerRepository.getProvider(decodeURIComponent(providerMatch[1]));
        if (!provider) {
          return sendJson(response, 404, { error: 'Provider not found' });
        }

        return sendJson(response, 200, { provider });
      }

      if (pathname === '/api/provider-hours') {
        if (request.method === 'GET') {
          return sendJson(response, 200, {
            sessions: await providerRepository.listHoursSessions({
              providerId: url.searchParams.get('providerId') || '',
              status: url.searchParams.get('status') || '',
            }),
          });
        }
      }

      const providerHoursEndMatch = /^\/api\/provider-hours\/([^/]+)\/end$/.exec(pathname);
      if (request.method === 'POST' && providerHoursEndMatch) {
        const payload = await collectBody(request);
        const validationError = validateHoursEndPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const session = await providerRepository.getHoursSession(
          decodeURIComponent(providerHoursEndMatch[1])
        );
        if (!session) {
          return sendJson(response, 404, { error: 'Hours session not found' });
        }

        if (session.status !== 'active') {
          return sendJson(response, 409, { error: 'Hours session is not active.' });
        }

        const updatedSession = await providerRepository.endHoursSession(session.id, payload);
        return sendJson(response, 200, { session: updatedSession });
      }

      if (pathname === '/api/provider-work-logs') {
        if (request.method === 'GET') {
          return sendJson(response, 200, {
            workLogs: await providerRepository.listWorkLogs({
              providerId: url.searchParams.get('providerId') || '',
              requestId: url.searchParams.get('requestId') || '',
              hoursSessionId: url.searchParams.get('hoursSessionId') || '',
              status: url.searchParams.get('status') || '',
            }),
          });
        }

        if (request.method === 'POST') {
          const payload = await collectBody(request);
          const validationError = validateWorkLogCreatePayload(payload);
          if (validationError) {
            return sendJson(response, 400, { error: validationError });
          }

          const provider = await providerRepository.getProvider(payload.providerId);
          if (!provider) {
            return sendJson(response, 404, { error: 'Provider not found' });
          }

          const session = await providerRepository.getHoursSession(payload.hoursSessionId);
          if (!session) {
            return sendJson(response, 404, { error: 'Hours session not found' });
          }

          if (session.providerId !== provider.id) {
            return sendJson(response, 409, { error: 'Hours session does not belong to provider.' });
          }

          if (provider.status !== 'active' || hasActiveSuspension(provider)) {
            await providerRepository.recordCandidateDisqualification({
              providerId: provider.id,
              requestId: payload.requestId,
              hoursSessionId: session.id,
              reason: provider.status === 'suspended' ? 'provider_suspended' : 'provider_unavailable',
            });
            return sendJson(response, 409, {
              error: 'Provider is not eligible for assignment.',
            });
          }

          if (session.status !== 'active' || new Date().toISOString() > session.scheduledEndsAt) {
            await providerRepository.recordCandidateDisqualification({
              providerId: provider.id,
              requestId: payload.requestId,
              hoursSessionId: session.id,
              reason: 'outside_hours_of_service',
            });
            return sendJson(response, 409, {
              error: 'Provider is outside active hours of service.',
            });
          }

          const distanceMiles = haversineMiles(payload.startLocation, payload.customerLocation);
          if (distanceMiles > Number(session.serviceRadiusMiles || 0)) {
            await providerRepository.recordCandidateDisqualification({
              providerId: provider.id,
              requestId: payload.requestId,
              hoursSessionId: session.id,
              reason: 'outside_service_radius',
              distanceMiles,
            });
            return sendJson(response, 409, {
              error: 'Provider is outside the configured service radius.',
            });
          }

          const etaProjectedEnd = new Date(Date.now() + Number(payload.softEtaMinutes) * 60000).toISOString();
          if (etaProjectedEnd > session.scheduledEndsAt) {
            await providerRepository.recordCandidateDisqualification({
              providerId: provider.id,
              requestId: payload.requestId,
              hoursSessionId: session.id,
              reason: 'eta_past_hours_end',
              etaProjectedEnd,
            });
            return sendJson(response, 409, {
              error: 'Projected ETA extends past provider hours of service.',
            });
          }

          const existingLogs = await providerRepository.listWorkLogs({
            providerId: provider.id,
            requestId: payload.requestId,
          });
          if (existingLogs.some((workLog) => workLog.status !== 'service_closed')) {
            return sendJson(response, 409, {
              error: 'Provider already has an active work log for this request.',
            });
          }

          const currentRequest = await storage.getServiceRequest(payload.requestId);
          if (!currentRequest) {
            return sendJson(response, 404, { error: 'Service request not found' });
          }

          if (['completed', 'cancelled'].includes(String(currentRequest.status || '').toLowerCase())) {
            return sendJson(response, 409, {
              error: 'Service request is no longer assignable.',
            });
          }

          const requestRecord = await decorateRequestRecord(currentRequest);
          if (!session.serviceTypeIds.includes(requestRecord.serviceTypeId)) {
            await providerRepository.recordCandidateDisqualification({
              providerId: provider.id,
              requestId: payload.requestId,
              hoursSessionId: session.id,
              reason: 'provider_unavailable',
            });
            return sendJson(response, 409, {
              error: 'Provider is not configured for this service type.',
            });
          }

          if (requestRecord.serviceTypeId === 'tow') {
            const compliance = await complianceRepository.getProviderCompliance(provider.id);
            if (!compliance.towProgram.eligible) {
              await providerRepository.recordCandidateDisqualification({
                providerId: provider.id,
                requestId: payload.requestId,
                hoursSessionId: session.id,
                reason: 'missing_required_documents',
              });
              return sendJson(response, 409, {
                error: 'Tow provider is missing required approved documents.',
              });
            }
          }

          const workLog = await providerRepository.createWorkLog({
            providerId: provider.id,
            requestId: currentRequest.id,
            hoursSessionId: session.id,
            serviceType: requestRecord.serviceType,
            serviceTypeId: requestRecord.serviceTypeId,
            customerName: currentRequest.customerName,
            subscriberId: payload.subscriberId || '',
            startLocation: payload.startLocation,
            customerLocation: payload.customerLocation,
            softEtaMinutes: payload.softEtaMinutes,
            hardEtaMinutes: payload.hardEtaMinutes,
            grossAmountCents: requestRecord.financials?.customerChargeCents || 0,
            platformFeeCents: requestRecord.financials?.platformFeeCents || 0,
            netAmountCents: requestRecord.financials?.providerPayoutCents || 0,
          });

          if (!workLog) {
            return sendJson(response, 500, { error: 'Failed to create provider work log.' });
          }

          if (String(currentRequest.status || '').toLowerCase() === 'pending') {
            await storage.updateServiceRequestStatus(currentRequest.id, 'accepted');
          }

          return sendJson(response, 201, { workLog });
        }
      }

      const providerWorkLogMatch = /^\/api\/provider-work-logs\/([^/]+)$/.exec(pathname);
      if (request.method === 'GET' && providerWorkLogMatch) {
        const workLog = await providerRepository.getWorkLog(
          decodeURIComponent(providerWorkLogMatch[1])
        );
        if (!workLog) {
          return sendJson(response, 404, { error: 'Provider work log not found' });
        }

        return sendJson(response, 200, { workLog });
      }

      const providerWorkLogEtaMatch = /^\/api\/provider-work-logs\/([^/]+)\/eta$/.exec(pathname);
      if (request.method === 'POST' && providerWorkLogEtaMatch) {
        const payload = await collectBody(request);
        const validationError = validateWorkLogEtaPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const workLog = await providerRepository.updateWorkLogEta(
          decodeURIComponent(providerWorkLogEtaMatch[1]),
          payload
        );
        if (!workLog) {
          return sendJson(response, 404, { error: 'Provider work log not found' });
        }

        return sendJson(response, 200, { workLog });
      }

      const providerWorkLogActionMatch = /^\/api\/provider-work-logs\/([^/]+)\/(en-route|arrive|start|complete)$/.exec(pathname);
      if (request.method === 'POST' && providerWorkLogActionMatch) {
        try {
          const workLog = await providerRepository.updateWorkLogStatus(
            decodeURIComponent(providerWorkLogActionMatch[1]),
            providerWorkLogActionMatch[2]
          );
          if (!workLog) {
            return sendJson(response, 404, { error: 'Provider work log not found' });
          }

          if (providerWorkLogActionMatch[2] === 'arrive') {
            const request = await storage.getServiceRequest(workLog.requestId);
            if (request && String(request.status || '').toLowerCase() === 'accepted') {
              await storage.updateServiceRequestStatus(workLog.requestId, 'arrived');
            }
          }

          if (providerWorkLogActionMatch[2] === 'complete') {
            const request = await storage.getServiceRequest(workLog.requestId);
            if (request && ['accepted', 'arrived'].includes(String(request.status || '').toLowerCase())) {
              await storage.updateServiceRequestStatus(workLog.requestId, 'completed');
            }
          }

          return sendJson(response, 200, { workLog });
        } catch (error) {
          return sendJson(response, 409, { error: error.message });
        }
      }

      if (pathname === '/api/provider-payouts') {
        if (request.method === 'GET') {
          return sendJson(response, 200, {
            payouts: await providerRepository.listPayouts({
              providerId: url.searchParams.get('providerId') || '',
              hoursSessionId: url.searchParams.get('hoursSessionId') || '',
              status: url.searchParams.get('status') || '',
            }),
          });
        }
      }

      const providerPayoutWebhookMatch = /^\/api\/provider-payouts\/([^/]+)\/webhooks$/.exec(pathname);
      if (request.method === 'POST' && providerPayoutWebhookMatch) {
        const payload = await collectBody(request);
        const validationError = validateProviderPayoutWebhookPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const payout = await providerRepository.recordPayoutWebhook(
          decodeURIComponent(providerPayoutWebhookMatch[1]),
          payload
        );
        if (!payout) {
          return sendJson(response, 404, { error: 'Provider payout not found' });
        }

        return sendJson(response, 200, { payout });
      }

      if (pathname === '/api/provider-payout-disputes') {
        if (request.method === 'GET') {
          return sendJson(response, 200, {
            disputes: await providerRepository.listPayoutDisputes({
              providerId: url.searchParams.get('providerId') || '',
              payoutId: url.searchParams.get('payoutId') || '',
              status: url.searchParams.get('status') || '',
            }),
          });
        }

        if (request.method === 'POST') {
          const payload = await collectBody(request);
          const validationError = validateProviderPayoutDisputePayload(payload);
          if (validationError) {
            return sendJson(response, 400, { error: validationError });
          }

          try {
            const dispute = await providerRepository.submitPayoutDispute(payload);
            if (!dispute) {
              return sendJson(response, 404, { error: 'Provider payout not found' });
            }

            return sendJson(response, 201, { dispute });
          } catch (error) {
            return sendJson(response, 409, { error: error.message });
          }
        }
      }

      const providerPayoutDisputeDecisionMatch = /^\/api\/provider-payout-disputes\/([^/]+)\/decision$/.exec(pathname);
      if (request.method === 'POST' && providerPayoutDisputeDecisionMatch) {
        const payload = await collectBody(request);
        const validationError = validateProviderPayoutDisputeDecisionPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        try {
          const dispute = await providerRepository.decidePayoutDispute(
            decodeURIComponent(providerPayoutDisputeDecisionMatch[1]),
            payload
          );
          if (!dispute) {
            return sendJson(response, 404, { error: 'Provider payout dispute not found' });
          }

          return sendJson(response, 200, { dispute });
        } catch (error) {
          return sendJson(response, 409, { error: error.message });
        }
      }

      if (pathname === '/api/provider-training-sessions') {
        if (request.method === 'GET') {
          return sendJson(response, 200, {
            sessions: await providerRepository.listTrainingSessions({
              traineeProviderId: url.searchParams.get('traineeProviderId') || '',
              trainerProviderId: url.searchParams.get('trainerProviderId') || '',
              status: url.searchParams.get('status') || '',
            }),
          });
        }

        if (request.method === 'POST') {
          const payload = await collectBody(request);
          const validationError = validateTrainingSessionPayload(payload);
          if (validationError) {
            return sendJson(response, 400, { error: validationError });
          }

          const session = await providerRepository.createTrainingSession(payload);
          if (!session) {
            return sendJson(response, 404, { error: 'Training provider or trainer not found' });
          }

          return sendJson(response, 201, { session });
        }
      }

      const providerTrainingPaymentMatch = /^\/api\/provider-training-sessions\/([^/]+)\/pay$/.exec(pathname);
      if (request.method === 'POST' && providerTrainingPaymentMatch) {
        const payload = await collectBody(request);
        const validationError = validateTrainingPaymentPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const session = await providerRepository.recordTrainingPayment(
          decodeURIComponent(providerTrainingPaymentMatch[1]),
          payload
        );
        if (!session) {
          return sendJson(response, 404, { error: 'Training session not found' });
        }

        return sendJson(response, 200, { session });
      }

      const providerTrainingStartMatch = /^\/api\/provider-training-sessions\/([^/]+)\/start$/.exec(pathname);
      if (request.method === 'POST' && providerTrainingStartMatch) {
        const payload = await collectBody(request);
        const validationError = validateTrainingProgressPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const session = await providerRepository.startTrainingSession(
          decodeURIComponent(providerTrainingStartMatch[1]),
          payload
        );
        if (!session) {
          return sendJson(response, 404, { error: 'Training session not found' });
        }

        return sendJson(response, 200, { session });
      }

      const providerTrainingCompleteMatch = /^\/api\/provider-training-sessions\/([^/]+)\/complete$/.exec(pathname);
      if (request.method === 'POST' && providerTrainingCompleteMatch) {
        const payload = await collectBody(request);
        const validationError = validateTrainingProgressPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const session = await providerRepository.completeTrainingSession(
          decodeURIComponent(providerTrainingCompleteMatch[1]),
          payload
        );
        if (!session) {
          return sendJson(response, 404, { error: 'Training session not found' });
        }

        return sendJson(response, 200, { session });
      }

      if (request.method === 'GET' && pathname === '/api/subscriber/policy') {
        return sendJson(response, 200, buildSubscriberPolicy());
      }

      if (request.method === 'GET' && pathname === '/api/subscribers') {
        return sendJson(response, 200, {
          subscribers: await subscriberRepository.listSubscribers(),
        });
      }

      if (request.method === 'POST' && pathname === '/api/subscribers') {
        const payload = await collectBody(request);
        const validationError = validateSubscriberPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const subscriber = await subscriberRepository.createSubscriber(payload);
        return sendJson(response, 201, { subscriber });
      }

      const subscriberMatch = /^\/api\/subscribers\/([^/]+)$/.exec(pathname);
      if (request.method === 'GET' && subscriberMatch) {
        const subscriberId = decodeURIComponent(subscriberMatch[1]);
        const subscriber = await subscriberRepository.getSubscriber(subscriberId);
        if (!subscriber) {
          return sendJson(response, 404, { error: 'Subscriber not found' });
        }

        return sendJson(response, 200, {
          subscriber,
          latestTermsAcceptance: await subscriberRepository.getLatestTermsAcceptance(subscriberId),
        });
      }

      const subscriberTermsMatch = /^\/api\/subscribers\/([^/]+)\/terms-acceptance$/.exec(pathname);
      if (subscriberTermsMatch) {
        const subscriberId = decodeURIComponent(subscriberTermsMatch[1]);
        const subscriber = await subscriberRepository.getSubscriber(subscriberId);
        if (!subscriber) {
          return sendJson(response, 404, { error: 'Subscriber not found' });
        }

        if (request.method === 'GET') {
          return sendJson(response, 200, {
            subscriberId,
            acceptance: await subscriberRepository.getLatestTermsAcceptance(subscriberId),
          });
        }

        if (request.method === 'POST') {
          const payload = await collectBody(request);
          const validationError = validateTermsAcceptancePayload(payload);
          if (validationError) {
            return sendJson(response, 400, { error: validationError });
          }

          const result = await subscriberRepository.saveTermsAcceptance(subscriberId, payload);
          return sendJson(response, 201, result);
        }

        return sendJson(response, 405, { error: 'Method not allowed' });
      }

      if (pathname === '/api/support/threads') {
        if (request.method === 'GET') {
          return sendJson(response, 200, {
            threads: await subscriberRepository.listSupportThreads({
              subscriberId: url.searchParams.get('subscriberId') || '',
              channel: url.searchParams.get('channel') || '',
              status: url.searchParams.get('status') || '',
            }),
          });
        }

        if (request.method === 'POST') {
          const payload = await collectBody(request);
          const validationError = validateSupportThreadPayload(payload);
          if (validationError) {
            return sendJson(response, 400, { error: validationError });
          }

          if (payload.requestId) {
            const serviceRequest = await storage.getServiceRequest(payload.requestId);
            if (!serviceRequest) {
              return sendJson(response, 404, { error: 'Service request not found' });
            }
          }

          const thread = await subscriberRepository.createSupportThread(payload);
          if (!thread) {
            return sendJson(response, 404, { error: 'Subscriber not found' });
          }

          return sendJson(response, 201, { thread });
        }
      }

      const supportThreadMatch = /^\/api\/support\/threads\/([^/]+)$/.exec(pathname);
      if (request.method === 'GET' && supportThreadMatch) {
        const thread = await subscriberRepository.getSupportThread(
          decodeURIComponent(supportThreadMatch[1])
        );
        if (!thread) {
          return sendJson(response, 404, { error: 'Support thread not found' });
        }

        return sendJson(response, 200, { thread });
      }

      const supportThreadMessageMatch = /^\/api\/support\/threads\/([^/]+)\/messages$/.exec(pathname);
      if (request.method === 'POST' && supportThreadMessageMatch) {
        const payload = await collectBody(request);
        const validationError = validateSupportMessagePayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const thread = await subscriberRepository.addSupportMessage(
          decodeURIComponent(supportThreadMessageMatch[1]),
          payload
        );

        if (!thread) {
          return sendJson(response, 404, { error: 'Support thread not found' });
        }

        return sendJson(response, 201, { thread });
      }

      if (pathname === '/api/provider-ratings') {
        if (request.method === 'GET') {
          return sendJson(response, 200, {
            ratings: await subscriberRepository.listProviderRatings({
              subscriberId: url.searchParams.get('subscriberId') || '',
              providerId: url.searchParams.get('providerId') || '',
              requestId: url.searchParams.get('requestId') || '',
            }),
          });
        }

        if (request.method === 'POST') {
          const payload = await collectBody(request);
          const validationError = validateProviderRatingPayload(payload);
          if (validationError) {
            return sendJson(response, 400, { error: validationError });
          }

          const subscriber = await subscriberRepository.getSubscriber(payload.subscriberId);
          if (!subscriber) {
            return sendJson(response, 404, { error: 'Subscriber not found' });
          }

          const provider = await providerRepository.getProvider(payload.providerId);
          if (!provider) {
            return sendJson(response, 404, { error: 'Provider not found' });
          }

          const serviceRequest = await storage.getServiceRequest(payload.requestId);
          if (!serviceRequest) {
            return sendJson(response, 404, { error: 'Service request not found' });
          }

          const rating = await subscriberRepository.saveProviderRating({
            ...payload,
            serviceType: serviceRequest.serviceType,
          });
          await providerRepository.recordProviderRating(rating);
          return sendJson(response, 201, { rating });
        }
      }

      if (request.method === 'GET' && pathname === '/api/subscriber-events') {
        return sendJson(response, 200, {
          events: await subscriberRepository.listEvents({
            eventType: url.searchParams.get('eventType') || '',
            entityType: url.searchParams.get('entityType') || '',
            actorType: url.searchParams.get('actorType') || '',
            subscriberId: url.searchParams.get('subscriberId') || '',
            providerId: url.searchParams.get('providerId') || '',
            requestId: url.searchParams.get('requestId') || '',
            limit: url.searchParams.get('limit') || 50,
          }),
        });
      }

      if (request.method === 'GET' && pathname === '/api/provider-events') {
        return sendJson(response, 200, {
          events: await buildProviderEventFeed({
            eventType: url.searchParams.get('eventType') || '',
            entityType: url.searchParams.get('entityType') || '',
            actorType: url.searchParams.get('actorType') || '',
            providerId: url.searchParams.get('providerId') || '',
            requestId: url.searchParams.get('requestId') || '',
            limit: url.searchParams.get('limit') || 50,
          }),
        });
      }

      if (request.method === 'GET' && pathname === '/api/provider-documents') {
        return sendJson(response, 200, {
          documents: await complianceRepository.listProviderDocuments({
            providerId: url.searchParams.get('providerId') || '',
            status: url.searchParams.get('status') || '',
            serviceTypeId: url.searchParams.get('serviceTypeId') || '',
          }),
        });
      }

      const providerDocumentsMatch = /^\/api\/providers\/([^/]+)\/documents$/.exec(pathname);
      if (providerDocumentsMatch) {
        const providerId = decodeURIComponent(providerDocumentsMatch[1]);

        if (request.method === 'GET') {
          return sendJson(response, 200, {
            providerId,
            documents: await complianceRepository.listProviderDocuments({ providerId }),
          });
        }

        if (request.method === 'POST') {
          const payload = await collectBody(request);
          const validationError = validateProviderDocumentPayload(payload);
          if (validationError) {
            return sendJson(response, 400, { error: validationError });
          }

          const document = await complianceRepository.createProviderDocument({
            ...payload,
            providerId,
          });
          return sendJson(response, 201, { document });
        }

        return sendJson(response, 405, { error: 'Method not allowed' });
      }

      const providerComplianceMatch = /^\/api\/providers\/([^/]+)\/compliance$/.exec(pathname);
      if (request.method === 'GET' && providerComplianceMatch) {
        const providerId = decodeURIComponent(providerComplianceMatch[1]);
        return sendJson(response, 200, await complianceRepository.getProviderCompliance(providerId));
      }

      const providerDocumentReviewMatch = /^\/api\/provider-documents\/([^/]+)\/review$/.exec(
        pathname
      );
      if (request.method === 'POST' && providerDocumentReviewMatch) {
        const payload = await collectBody(request);
        const validationError = validateDocumentReviewPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const document = await complianceRepository.reviewProviderDocument(
          decodeURIComponent(providerDocumentReviewMatch[1]),
          payload
        );

        if (!document) {
          return sendJson(response, 404, { error: 'Provider document not found' });
        }

        return sendJson(response, 200, { document });
      }

      if (pathname === '/api/damage-claims') {
        if (request.method === 'GET') {
          return sendJson(response, 200, {
            claims: await complianceRepository.listDamageClaims({
              providerId: url.searchParams.get('providerId') || '',
              status: url.searchParams.get('status') || '',
            }),
          });
        }

        if (request.method === 'POST') {
          const payload = await collectBody(request);
          const validationError = validateDamageClaimPayload(payload);
          if (validationError) {
            return sendJson(response, 400, { error: validationError });
          }

          const claim = await complianceRepository.createDamageClaim(payload);
          return sendJson(response, 201, { claim });
        }
      }

      const damageClaimReviewMatch = /^\/api\/damage-claims\/([^/]+)\/review$/.exec(pathname);
      if (request.method === 'POST' && damageClaimReviewMatch) {
        const payload = await collectBody(request);
        const validationError = validateDamageClaimReviewPayload(payload);
        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const claim = await complianceRepository.reviewDamageClaim(
          decodeURIComponent(damageClaimReviewMatch[1]),
          payload
        );

        if (!claim) {
          return sendJson(response, 404, { error: 'Damage claim not found' });
        }

        return sendJson(response, 200, {
          claim: {
            ...claim,
            damageFundCoverage: formatUsd(claim.damageFundCoverageCents),
          },
        });
      }

      if (request.method === 'GET' && pathname === '/api/service-requests') {
        const serviceRequests = await storage.listServiceRequests();
        return sendJson(response, 200, await Promise.all(serviceRequests.map(decorateRequestRecord)));
      }

      if (request.method === 'POST' && pathname === '/api/service-requests') {
        const payload = await collectBody(request);
        const validationError = validateServiceRequest(payload);

        if (validationError) {
          return sendJson(response, 400, { error: validationError });
        }

        const pricingPolicy = resolveServicePolicy(payload.serviceType);
        if (!pricingPolicy) {
          return sendJson(response, 400, {
            error: `Unsupported service type: ${payload.serviceType}`,
          });
        }

        const towTermsError = validateTowTermsAcceptance(payload, pricingPolicy.id);
        if (towTermsError) {
          return sendJson(response, 400, {
            error: towTermsError,
          });
        }

        const serviceRequest = await storage.createServiceRequest({
          ...payload,
          serviceType: pricingPolicy.label,
        });

        const towTerms = extractTowTermsAcceptance(payload, pricingPolicy.id);
        if (towTerms) {
          await complianceRepository.saveServiceRequestTerms({
            requestId: serviceRequest.id,
            customerName: serviceRequest.customerName,
            serviceTypeId: pricingPolicy.id,
            ...towTerms,
          });
        }

        return sendJson(response, 201, { request: await decorateRequestRecord(serviceRequest) });
      }

      const serviceRequestAction = getServiceRequestAction(pathname);
      if (request.method === 'POST' && serviceRequestAction) {
        const actionConfig = serviceRequestActionMap[serviceRequestAction.action];
        if (!actionConfig) {
          return sendJson(response, 404, { error: 'Not found' });
        }

        const currentRequest = await storage.getServiceRequest(serviceRequestAction.id);

        if (!currentRequest) {
          return sendJson(response, 404, { error: 'Service request not found' });
        }

        const transitionError = validateStatusTransition(
          currentRequest.status,
          actionConfig,
          serviceRequestAction.action
        );
        if (transitionError) {
          return sendJson(response, 409, { error: transitionError });
        }

        const serviceRequest = await storage.updateServiceRequestStatus(
          serviceRequestAction.id,
          actionConfig.nextStatus
        );

        if (!serviceRequest) {
          return sendJson(response, 404, { error: 'Service request not found' });
        }

        const payload = {
          action: serviceRequestAction.action,
          requestId: serviceRequest.id,
          status: serviceRequest.status,
          request: await decorateRequestRecord(serviceRequest),
        };

        if (serviceRequestAction.action === 'accept') {
          payload.acceptedBy = 'admin_override';
        }

        return sendJson(response, 200, payload);
      }
    } catch (error) {
      return sendJson(response, 500, {
        error: 'Backend request failed',
        detail: error.message,
      });
    }

    return sendJson(response, 404, { error: 'Not found' });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Roadside backend listening on http://${HOST}:${PORT} using ${storage.kind}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start backend:', error.message);
  process.exit(1);
});
