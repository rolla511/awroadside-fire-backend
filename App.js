import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import Button from './components/Button';
import InputField from './components/InputField';
import ServiceCard from './components/ServiceCard';
import { createApiClient } from './lib/api';
import { theme } from './theme';

const homeGraphic = require('./assets/images/roadside-home.png');
const subscriberGraphic = require('./assets/images/roadside-subscriber.png');
const DEFAULT_BACKEND_URL =
  typeof process !== 'undefined'
    ? process.env?.EXPO_PUBLIC_API_BASE_URL?.trim?.() || ''
    : '';

const topNavItems = [
  { id: 'overview', label: 'Overview' },
  { id: 'guest', label: 'Guest' },
  { id: 'subscriber', label: 'Subscriber' },
  { id: 'provider', label: 'Provider' },
  { id: 'admin', label: 'Admin' },
];

const guestTabs = [
  { id: 'request', label: 'Request' },
  { id: 'status', label: 'Status' },
];

const subscriberTabs = [
  { id: 'access', label: 'Sign In / Up' },
  { id: 'profile', label: 'Profile' },
  { id: 'request', label: 'Request' },
  { id: 'status', label: 'Status' },
];

const providerTabs = [
  { id: 'access', label: 'Sign In' },
  { id: 'info', label: 'Info Form' },
  { id: 'profile', label: 'Profile' },
  { id: 'work', label: 'Work' },
  { id: 'log', label: 'Log' },
  { id: 'wallet', label: 'Wallet' },
];

const adminTabs = [
  { id: 'access', label: 'Sign In' },
  { id: 'work', label: 'Work' },
  { id: 'directory', label: 'Directory' },
  { id: 'providers', label: 'Providers' },
  { id: 'subscribers', label: 'Subscribers' },
];

const serviceOptions = [
  { id: 'Jump Start', label: 'Jump Start', detail: 'Back on the road fast' },
  { id: 'Lockout', label: 'Lockout', detail: "Won't be locked out for long" },
  { id: 'Tire Change', label: 'Tire Change', detail: 'Tires changed in a jiffy' },
  { id: 'Gas Delivery', label: 'Gas Delivery', detail: 'Fuel arrives before the worry sets in' },
  { id: 'Battery Install', label: 'Battery Install', detail: 'Fresh battery power without the hassle' },
];

const providerServiceOptions = [
  'LOCKOUT',
  'JUMP_START',
  'TIRE_CHANGE',
  'GAS_DELIVERY',
  'BATTERY_INSTALL',
];

const initialRequestForm = {
  fullName: '',
  phoneNumber: '',
  serviceType: 'Jump Start',
  location: '',
  notes: '',
};

const initialSignin = {
  identifier: '',
  password: '',
};

const initialSubscriberSignup = {
  fullName: '',
  username: '',
  email: '',
  password: '',
  year: '',
  make: '',
  model: '',
  color: '',
  paymentMethodMasked: '****1111',
};

const initialProviderSignup = {
  fullName: '',
  username: '',
  email: '',
  password: '',
  year: '',
  make: '',
  model: '',
  color: '',
  experience: '',
  services: ['LOCKOUT', 'JUMP_START'],
  license: true,
  registration: true,
  insurance: true,
  helperId: false,
};

const initialAdminSignin = {
  email: 'admin@adub.com',
  password: '',
  locationZone: 'HOME_BASE',
  twoFactorCode: '',
};

const initialFeedbackForm = {
  rating: '8',
  notes: '',
};

export default function App() {
  const [section, setSection] = useState('overview');
  const [guestView, setGuestView] = useState('request');
  const [subscriberView, setSubscriberView] = useState('access');
  const [providerView, setProviderView] = useState('access');
  const [adminView, setAdminView] = useState('access');
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [frontendConfig, setFrontendConfig] = useState(null);
  const [compatibilityManifest, setCompatibilityManifest] = useState(null);
  const [compatibilityVariant, setCompatibilityVariant] = useState(null);
  const [paymentConfig, setPaymentConfig] = useState(null);
  const [securityStatus, setSecurityStatus] = useState(null);
  const [auth, setAuth] = useState(null);
  const [profile, setProfile] = useState(null);
  const [adminSession, setAdminSession] = useState(null);
  const [adminDashboard, setAdminDashboard] = useState(null);
  const [adminSearchQuery, setAdminSearchQuery] = useState('');
  const [adminSearchRole, setAdminSearchRole] = useState('ALL');
  const [adminSearchResults, setAdminSearchResults] = useState([]);
  const [adminSelectedUserProfile, setAdminSelectedUserProfile] = useState(null);
  const [requests, setRequests] = useState([]);
  const [providerActions, setProviderActions] = useState({});
  const [sessionRequests, setSessionRequests] = useState([]);
  const [latestRequest, setLatestRequest] = useState(null);
  const [servicePaymentQuote, setServicePaymentQuote] = useState(null);
  const [serviceQuoteAccepted, setServiceQuoteAccepted] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [requestForm, setRequestForm] = useState(initialRequestForm);
  const [signinForm, setSigninForm] = useState(initialSignin);
  const [subscriberSignup, setSubscriberSignup] = useState(initialSubscriberSignup);
  const [providerSignup, setProviderSignup] = useState(initialProviderSignup);
  const [adminSignin, setAdminSignin] = useState(initialAdminSignin);
  const [adminNotes, setAdminNotes] = useState({
    approvals: {},
    refunds: {},
    payouts: {},
    resets: {},
  });
  const [feedbackForm, setFeedbackForm] = useState(initialFeedbackForm);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const navItems = adminSession?.token ? [...topNavItems, { id: 'security', label: 'Security' }] : topNavItems;
  const api = createApiClient({
    baseUrl: backendUrl,
    getToken: () => auth?.sessionToken || null,
  });

  useEffect(() => {
    if (!backendUrl.trim()) {
      setStatusMessage('Set the service URL for this build before refreshing runtime config.');
      return;
    }
    loadBootstrap().catch((error) => {
      setErrorMessage(error.message);
    });
  }, []);

  const providerQueue = requests.filter((request) =>
    ['SUBMITTED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED'].includes(normalizeValue(request.status))
  );
  const providerOwnedRequests = requests.filter(
    (request) => String(request.assignedProviderId || '') === String(auth?.userId || '')
  );
  const providerWallet = summarizeProviderWallet(providerOwnedRequests, profile?.providerProfile?.paypal);
  const subscriberRequestHistory = mergeRequestCollections(profile?.requestHistory, sessionRequests);
  const activeSessionRequest = latestRequest || sessionRequests[0] || null;
  const activeRequestId = activeSessionRequest?.requestId || activeSessionRequest?.id || null;
  const adminFinancials = Array.isArray(adminDashboard?.financials) ? adminDashboard.financials : [];
  const adminProviders = Array.isArray(adminDashboard?.providers) ? adminDashboard.providers : [];
  const adminSubscribers = Array.isArray(adminDashboard?.subscribers) ? adminDashboard.subscribers : [];
  const uiEventMap = frontendConfig?.uiEventMap || paymentConfig?.uiEventMap || adminDashboard?.policy?.uiEventMap || null;
  const pricingSource = paymentConfig || frontendConfig || null;

  async function loadBootstrap() {
    if (!backendUrl.trim()) {
      clearMessages();
      setStatusMessage('Set the service URL for this build before refreshing runtime config.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const [config, manifestPayload, payments, security] = await Promise.all([
        api.getFrontendConfig(),
        api.getCompatibilityManifest().catch(() => null),
        api.getPaymentConfig().catch(() => null),
        adminSession?.token ? api.getSecurityStatus().catch(() => null) : Promise.resolve(null),
      ]);
      setFrontendConfig(config);
      setCompatibilityManifest(manifestPayload?.manifest || null);
      setPaymentConfig(payments);
      setSecurityStatus(security);
      await syncCompatibilityHandshake(manifestPayload?.manifest || null);
      setStatusMessage('Service connected.');
      if (auth?.sessionToken) {
        await loadProfile(config, auth.sessionToken);
      }
      if (auth?.roles?.includes('PROVIDER')) {
        await loadRequestQueue(config, auth.sessionToken);
      }
      if (adminSession?.token) {
        await loadAdminDashboard(config, adminSession);
      }
    } finally {
      setLoading(false);
    }
  }

  async function syncCompatibilityHandshake(manifestOverride = null) {
    try {
      const payload = await api.acknowledgeVariant({
        projectId: 'awroadside-family',
        variantId: 'awroadside-fire-mobile',
        platform: 'android-ios-mobile',
        appVersion: '1.0.0',
        sdkVersion: '55',
        note: 'expo-mobile-handshake',
      });
      setCompatibilityManifest(payload?.manifest || manifestOverride || null);
      setCompatibilityVariant(payload?.variant || null);
    } catch {
      setCompatibilityVariant(null);
    }
  }

  async function handleSignin() {
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.login(signinForm);
      const nextAuth = {
        userId: payload.userId,
        roles: payload.roles || [],
        providerStatus: payload.providerStatus || null,
        subscriberActive: Boolean(payload.subscriberActive),
        sessionToken: payload.sessionToken || null,
      };
      setAuth(nextAuth);
      await loadProfile(frontendConfig, nextAuth.sessionToken);
      if ((payload.roles || []).includes('PROVIDER')) {
        await loadRequestQueue(frontendConfig, nextAuth.sessionToken);
        setSection('provider');
        setProviderView('work');
      } else {
        setSection('subscriber');
        setSubscriberView('profile');
      }
      setStatusMessage('Sign in complete.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscriberSignup() {
    setLoading(true);
    clearMessages();
    try {
      const signup = await api.signup({
        fullName: subscriberSignup.fullName,
        username: subscriberSignup.username,
        email: subscriberSignup.email,
        password: subscriberSignup.password,
        role: 'SUBSCRIBER',
        termsAccepted: true,
      });
      const sessionToken = signup.sessionToken;
      await api.setupSubscriber(
        {
          vehicle: {
            year: subscriberSignup.year,
            make: subscriberSignup.make,
            model: subscriberSignup.model,
            color: subscriberSignup.color,
          },
          paymentMethodMasked: subscriberSignup.paymentMethodMasked,
        },
        sessionToken
      );
      const nextAuth = {
        userId: signup.userId,
        roles: ['SUBSCRIBER'],
        providerStatus: null,
        subscriberActive: true,
        sessionToken,
      };
      setAuth(nextAuth);
      await loadProfile(frontendConfig, sessionToken);
      setSection('subscriber');
      setSubscriberView('profile');
      setStatusMessage('Subscriber account created.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleProviderSignup() {
    setLoading(true);
    clearMessages();
    try {
      const signup = await api.signup({
        fullName: providerSignup.fullName,
        username: providerSignup.username,
        email: providerSignup.email,
        password: providerSignup.password,
        role: 'PROVIDER',
        termsAccepted: true,
      });
      const sessionToken = signup.sessionToken;
      await api.applyProvider(
        {
          vehicleInfo: {
            year: providerSignup.year,
            make: providerSignup.make,
            model: providerSignup.model,
            color: providerSignup.color,
          },
          documents: {
            license: providerSignup.license,
            registration: providerSignup.registration,
            insurance: providerSignup.insurance,
            helperId: providerSignup.helperId,
          },
          experience: providerSignup.experience,
          services: providerSignup.services,
        },
        sessionToken
      );
      const nextAuth = {
        userId: signup.userId,
        roles: ['PROVIDER'],
        providerStatus: 'PENDING_APPROVAL',
        subscriberActive: false,
        sessionToken,
      };
      setAuth(nextAuth);
      await loadProfile(frontendConfig, sessionToken);
      await loadRequestQueue(frontendConfig, sessionToken);
      setSection('provider');
      setProviderView('profile');
      setStatusMessage('Provider application submitted.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateRequest() {
    setLoading(true);
    clearMessages();
    try {
      const vehicleLabel = profile?.subscriberProfile?.vehicle ? formatVehicle(profile.subscriberProfile.vehicle) : '';
      const payload = await api.createRequest({
        ...requestForm,
        vehicleInfo: vehicleLabel || undefined,
        userId: auth?.userId || null,
        roles: auth?.roles || [],
      });
      upsertSessionRequest(payload);
      setServicePaymentQuote(null);
      setServiceQuoteAccepted(false);
      setPaymentOrder(null);
      setStatusMessage(`Request submitted: ${payload.requestId || payload.id}`);
      if (auth?.roles?.includes('PROVIDER')) {
        await loadRequestQueue(frontendConfig, auth.sessionToken);
      }
      if (auth?.roles?.includes('SUBSCRIBER')) {
        await loadProfile(frontendConfig, auth.sessionToken);
      }
      if (auth?.roles?.includes('SUBSCRIBER')) {
        setSection('subscriber');
        setSubscriberView('status');
      } else {
        setSection('guest');
        setGuestView('status');
      }
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchServiceQuote() {
    const requestId = activeRequestId;
    if (!requestId) {
      setErrorMessage('Submit a request before checking service payment.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.getServicePaymentQuote({ requestId });
      setServicePaymentQuote(payload);
      setServiceQuoteAccepted(false);
      setStatusMessage(`Service price ready: ${payload.amount?.value || '0.00'} ${payload.amount?.currency_code || 'USD'}.`);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function handleAgreeServiceQuote() {
    if (!servicePaymentQuote?.quoteId) {
      setErrorMessage('The current service price is required before agreement.');
      return;
    }
    clearMessages();
    setServiceQuoteAccepted(true);
    setStatusMessage(`Service price accepted: ${servicePaymentQuote.amount?.value || '0.00'} ${servicePaymentQuote.amount?.currency_code || 'USD'}.`);
  }

  async function handleCreatePaymentOrder() {
    if (!activeRequestId) {
      setErrorMessage('Submit a request before creating a payment order.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const useServiceQuote = Boolean(serviceQuoteAccepted && servicePaymentQuote?.quoteId && activeRequestId);
      const payload = await api.createPaypalOrder(
        useServiceQuote
          ? {
              paymentKind: 'service',
              requestId: activeRequestId,
              quoteId: servicePaymentQuote.quoteId,
              quoteAccepted: true,
            }
          : {
              fullName: requestForm.fullName,
              phoneNumber: requestForm.phoneNumber,
              serviceType: requestForm.serviceType,
              location: requestForm.location,
              notes: requestForm.notes,
              paymentKind: 'priority',
            }
      );
      setPaymentOrder(payload);
      patchSessionRequest(activeRequestId, {
        paymentStatus: 'ORDER_CREATED',
        lastPaymentOrderId: payload.orderId || payload.id || null,
      });
      setStatusMessage(
        useServiceQuote
          ? `Service payment order created: ${payload.orderId || payload.id || 'pending approval'}`
          : `Priority payment order created: ${payload.orderId || payload.id || 'pending approval'}`
      );
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCapturePayment() {
    const orderId = paymentOrder?.orderId || paymentOrder?.id;
    if (!orderId) {
      setErrorMessage('Create a payment order before capture.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.capturePaypalOrder({
        orderId,
        requestId: activeRequestId,
      });
      setPaymentOrder((current) => ({ ...(current || {}), ...payload, captured: true }));
      if (payload?.request) {
        upsertSessionRequest(payload.request);
      }
      if (activeRequestId) {
        patchSessionRequest(activeRequestId, {
          paymentStatus: 'CAPTURED',
          amountCollected: Number(servicePaymentQuote?.amount?.value || 0),
          lastPaymentOrderId: orderId,
        });
      }
      setStatusMessage(formatUserFacingMessage(payload.message || `Payment captured for order ${orderId}.`));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminSignin() {
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.adminLogin(adminSignin);
      const nextSession = {
        token: payload.token || null,
        roles: payload.roles || [],
        trustedZone: payload.trustedZone || null,
        twoFactorVerified: Boolean(payload.twoFactorVerified),
        pendingTwoFactor: Boolean(payload.twoFactorRequired),
        locationZone: adminSignin.locationZone,
      };
      setAdminSession(nextSession);
      if (payload.token) {
        await loadAdminDashboard(frontendConfig, nextSession);
        const security = await api.getSecurityStatus().catch(() => null);
        setSecurityStatus(security);
        setStatusMessage('Admin session active.');
        setSection('admin');
        setAdminView('work');
      } else {
        setStatusMessage(formatUserFacingMessage(payload.message || '2FA required.'));
      }
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadProfile(configOverride = frontendConfig, token = auth?.sessionToken) {
    if (!token) {
      setProfile(null);
      return;
    }
    try {
      const nextProfile = await api.getProfile(token);
      setProfile(nextProfile);
    } catch (error) {
      if (error?.status === 404) {
        setProfile(null);
        return;
      }
      throw error;
    }
  }

  async function loadRequestQueue(configOverride = frontendConfig, token = auth?.sessionToken) {
    if (!token) {
      setRequests([]);
      return;
    }
    try {
      const payload = await api.listRequests(token);
      setRequests(Array.isArray(payload.requests) ? payload.requests : []);
    } catch (error) {
      setRequests([]);
      throw error;
    }
  }

  async function loadAdminDashboard(configOverride = frontendConfig, session = adminSession) {
    if (!session?.token) {
      setAdminDashboard(null);
      return;
    }
    const payload = await api.getAdminDashboard(session.token, createAdminHeaders(session));
    setAdminDashboard(payload);
  }

  function createAdminHeaders(session = adminSession) {
    return {
      'x-location-zone': session?.locationZone || 'HOME_BASE',
      ...(session?.twoFactorVerified ? { 'x-2fa-verified': 'true' } : {}),
    };
  }

  async function runProviderAction(requestId, action) {
    const detail = providerActions[requestId] || {};
    if (!auth?.sessionToken || !auth?.roles?.includes('PROVIDER')) {
      setErrorMessage('Sign in as a provider before sending dispatch actions.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const payload = {
        ...(action === 'eta' && detail.eta ? { etaMinutes: Number.parseInt(detail.eta, 10) || null } : {}),
        ...(action === 'soft-contact' && detail.softContact ? { note: detail.softContact } : {}),
        ...(action === 'hard-contact' && detail.hardContact ? { note: detail.hardContact } : {}),
        ...(action === 'note' && detail.note ? { note: detail.note } : {}),
      };
      const result = await api.applyProviderAction(requestId, action, payload, auth.sessionToken);
      if (result?.request) {
        upsertSessionRequest(result.request);
      }
      await loadRequestQueue(frontendConfig, auth.sessionToken);
      setStatusMessage(formatUserFacingMessage(result?.message || `${labelProviderAction(action)} accepted for ${requestId}.`));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function runSubscriberAction(action) {
    if (!auth?.sessionToken || !auth?.roles?.includes('SUBSCRIBER')) {
      setErrorMessage('Sign in as a subscriber before confirming service status.');
      return;
    }
    if (!activeRequestId) {
      setErrorMessage('Create a subscriber request before sending status confirmations.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const result = await api.applyProviderAction(activeRequestId, action, {}, auth.sessionToken);
      if (result?.request) {
        upsertSessionRequest(result.request);
      }
      await loadProfile(frontendConfig, auth.sessionToken);
      setStatusMessage(formatUserFacingMessage(result?.message || `${labelProviderAction(action)} confirmed for ${activeRequestId}.`));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitRequestFeedback() {
    if (!activeRequestId) {
      setErrorMessage('Create or load a request before submitting provider feedback.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const activeRequest = activeSessionRequest || sessionRequests[0] || null;
      const payload = await api.submitRequestFeedback(
        activeRequestId,
        {
          rating: Number.parseInt(feedbackForm.rating, 10) || 8,
          notes: feedbackForm.notes,
          phoneNumber: activeRequest?.phoneNumber || requestForm.phoneNumber,
          fullName: activeRequest?.fullName || requestForm.fullName,
        },
        auth?.sessionToken || null
      );
      if (payload?.request) {
        upsertSessionRequest(payload.request);
        setLatestRequest(payload.request);
      }
      if (auth?.sessionToken) {
        await loadProfile(frontendConfig, auth.sessionToken);
      }
      setFeedbackForm(initialFeedbackForm);
      setStatusMessage(formatUserFacingMessage(payload?.message || 'Provider feedback recorded.'));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveProvider(providerId) {
    if (!adminSession?.token) {
      setErrorMessage('Admin login is required before approving providers.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.approveProvider(
        {
          providerId,
          note: adminNotes.approvals[String(providerId)] || '',
        },
        adminSession.token,
        createAdminHeaders()
      );
      await loadAdminDashboard(frontendConfig, adminSession);
      setStatusMessage(formatUserFacingMessage(payload.message || `Provider ${providerId} approved.`));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleProviderTraining(providerId, status) {
    if (!adminSession?.token) {
      setErrorMessage('Admin login is required before updating provider training.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.updateProviderTraining(
        providerId,
        status === 'COMPLETED'
          ? {
              status: 'COMPLETED',
              note: 'Training completed',
            }
          : {
              status: 'SCHEDULED',
              scheduledFor: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              note: 'Manual roadside retraining',
            },
        adminSession.token,
        createAdminHeaders()
      );
      await loadAdminDashboard(frontendConfig, adminSession);
      if (adminSelectedUserProfile?.user?.id === providerId) {
        const refreshedProfile = await api.getAdminUserProfile(providerId, adminSession.token, createAdminHeaders());
        setAdminSelectedUserProfile(refreshedProfile);
      }
      setStatusMessage(formatUserFacingMessage(payload.message || `Training updated for ${providerId}.`));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminAccountState(userId, accountState) {
    if (!adminSession?.token) {
      setErrorMessage('Admin login is required before changing account state.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.setAdminAccountState(
        userId,
        { accountState },
        adminSession.token,
        createAdminHeaders()
      );
      await loadAdminDashboard(frontendConfig, adminSession);
      if (adminSelectedUserProfile?.user?.id === userId) {
        const refreshedProfile = await api.getAdminUserProfile(userId, adminSession.token, createAdminHeaders());
        setAdminSelectedUserProfile(refreshedProfile);
      }
      setStatusMessage(formatUserFacingMessage(payload.message || `Account state updated for ${userId}.`));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefundRequest(requestId) {
    if (!adminSession?.token) {
      setErrorMessage('Admin login is required before refunding requests.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.refundRequest(
        {
          requestId,
          reason: adminNotes.refunds[String(requestId)] || '',
        },
        adminSession.token,
        createAdminHeaders()
      );
      await loadAdminDashboard(frontendConfig, adminSession);
      setStatusMessage(formatUserFacingMessage(payload.message || `Refund recorded for ${requestId}.`));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCompletePayout(requestId) {
    if (!adminSession?.token) {
      setErrorMessage('Admin login is required before completing payouts.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.completePayout(
        {
          requestId,
          reference: adminNotes.payouts[String(requestId)] || '',
        },
        adminSession.token,
        createAdminHeaders()
      );
      await loadAdminDashboard(frontendConfig, adminSession);
      setStatusMessage(formatUserFacingMessage(payload.message || `Payout completed for ${requestId}.`));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetRequest(requestId) {
    if (!adminSession?.token) {
      setErrorMessage('Admin login is required before resetting requests.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.resetRequest(
        requestId,
        {
          reason: adminNotes.resets[String(requestId)] || '',
        },
        adminSession.token,
        createAdminHeaders()
      );
      await loadAdminDashboard(frontendConfig, adminSession);
      setStatusMessage(formatUserFacingMessage(payload.message || `Request ${requestId} reset.`));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminSearch() {
    if (!adminSession?.token) {
      setErrorMessage('Admin login is required before searching accounts.');
      return;
    }
    if (!adminSearchQuery.trim()) {
      setErrorMessage('Enter a name, email, phone number, service area, or account id.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.searchAdminAccounts(
        adminSearchQuery.trim(),
        adminSearchRole,
        adminSession.token,
        createAdminHeaders()
      );
      setAdminSearchResults(Array.isArray(payload.users) ? payload.users : []);
      setStatusMessage(`Matched ${Array.isArray(payload.users) ? payload.users.length : 0} account(s).`);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadAdminUserProfile(userId) {
    if (!adminSession?.token) {
      setErrorMessage('Admin login is required before loading account profiles.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.getAdminUserProfile(userId, adminSession.token, createAdminHeaders());
      setAdminSelectedUserProfile(payload);
      setStatusMessage(`Loaded account profile for ${payload?.user?.fullName || payload?.user?.email || `user ${userId}`}.`);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function upsertSessionRequest(request) {
    if (!request) {
      return;
    }
    const requestId = request.requestId || request.id;
    setLatestRequest(request);
    setSessionRequests((current) => {
      const next = current.filter((entry) => String(entry.requestId || entry.id) !== String(requestId));
      return [request, ...next];
    });
  }

  function patchSessionRequest(requestId, patch) {
    if (!requestId) {
      return;
    }
    setSessionRequests((current) =>
      current.map((entry) =>
        String(entry.requestId || entry.id) === String(requestId) ? { ...entry, ...patch } : entry
      )
    );
    setLatestRequest((current) =>
      current && String(current.requestId || current.id) === String(requestId) ? { ...current, ...patch } : current
    );
  }

  function recordProviderAction(requestId, field, value) {
    setProviderActions((current) => ({
      ...current,
      [requestId]: {
        ...(current[requestId] || {}),
        [field]: value,
      },
    }));
  }

  function updateAdminNote(kind, id, value) {
    setAdminNotes((current) => ({
      ...current,
      [kind]: {
        ...(current[kind] || {}),
        [String(id)]: value,
      },
    }));
  }

  function prefillRequestFromSubscriber() {
    setRequestForm((current) => ({
      ...current,
      fullName: profile?.fullName || current.fullName,
      notes: profile?.subscriberProfile?.vehicle
        ? `${formatVehicle(profile.subscriberProfile.vehicle)}${current.notes ? ` - ${current.notes}` : ''}`
        : current.notes,
    }));
    setStatusMessage('Subscriber info copied into the request form.');
    setErrorMessage('');
  }

  function handleUserLogout() {
    setAuth(null);
    setProfile(null);
    setRequests([]);
    setProviderActions({});
    setSessionRequests([]);
    setLatestRequest(null);
    setPaymentOrder(null);
    setSigninForm(initialSignin);
    setSection('overview');
    setSubscriberView('access');
    setProviderView('access');
    setStatusMessage('Member session cleared.');
    setErrorMessage('');
  }

  function handleAdminLogout() {
    setAdminSession(null);
    setAdminDashboard(null);
    setAdminSearchQuery('');
    setAdminSearchRole('ALL');
    setAdminSearchResults([]);
    setAdminSelectedUserProfile(null);
    setSecurityStatus(null);
    setAdminSignin(initialAdminSignin);
    setSection('overview');
    setAdminView('access');
    setStatusMessage('Admin session cleared.');
    setErrorMessage('');
  }

  function clearMessages() {
    setStatusMessage('');
    setErrorMessage('');
  }

  function renderScreen() {
    if (section === 'guest') {
      return renderGuestScreen();
    }
    if (section === 'subscriber') {
      return renderSubscriberScreen();
    }
    if (section === 'provider') {
      return renderProviderScreen();
    }
    if (section === 'admin') {
      return renderAdminScreen();
    }
    if (section === 'security') {
      return renderSecurityScreen();
    }
    return renderOverviewScreen();
  }

  function renderOverviewScreen() {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <Image source={homeGraphic} style={styles.heroImage} resizeMode="cover" />
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>AW Roadside Fire</Text>
            <Text style={styles.title}>Role-based Expo variant mapped to live service flows.</Text>
            <Text style={styles.subtitle}>
              Guest request and payment, subscriber profile and request status, provider dispatch and payout view, and admin work surfaces now align with the live AW service routes.
            </Text>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Service Runtime</Text>
          <InputField
            label="Service URL"
            autoCapitalize="none"
            value={backendUrl}
            onChangeText={setBackendUrl}
            placeholder="https://api.your-domain.com"
          />
          <View style={styles.buttonGrid}>
            <Button label="Refresh Service Config" onPress={() => loadBootstrap().catch((error) => setErrorMessage(error.message))} />
          </View>
          <Text style={styles.mutedText}>Variant mode: {compatibilityVariant?.mode || compatibilityManifest?.mode || 'Unverified'}</Text>
          <Text style={styles.mutedText}>Active authority: {compatibilityManifest?.activeVariantId || 'Unknown'}</Text>
          <Text style={styles.mutedText}>Payment mode: {paymentConfig?.mode || frontendConfig?.paypalMode || 'Unavailable'}</Text>
          <Text style={styles.mutedText}>Webhook configured: {paymentConfig?.webhookConfigured ? 'Yes' : 'No'}</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Service Flow</Text>
          <Text style={styles.mutedText}>Guest: request create -> quote -> order create -> capture -> local request status.</Text>
          <Text style={styles.mutedText}>Subscriber: signup/login -> profile -> request -> ETA / arrival / completion confirmations.</Text>
          <Text style={styles.mutedText}>Provider: signup/apply -> approval state -> request queue -> dispatch actions -> payout state.</Text>
          <Text style={styles.mutedText}>Admin: login -> dashboard -> provider approvals -> refund / payout / reset controls.</Text>
        </View>

        <View style={styles.quickGrid}>
          {topNavItems.slice(1).map((item) => (
            <Pressable key={item.id} style={styles.quickCard} onPress={() => setSection(item.id)}>
              <Text style={styles.quickLabel}>{item.label}</Text>
              <Text style={styles.quickBody}>
                {item.id === 'guest' ? 'Open the guest request and payment screens.' : null}
                {item.id === 'subscriber' ? 'Use member signup, profile, request, and status screens.' : null}
                {item.id === 'provider' ? 'Use provider access, profile, work, log, and wallet screens.' : null}
                {item.id === 'admin' ? 'Open admin work, provider, and subscriber management screens.' : null}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    );
  }

  function renderGuestScreen() {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {renderTabBar(guestTabs, guestView, setGuestView)}
        {guestView === 'request' ? (
          <>
            {renderRequestComposer('Get Service Now', 'Fast roadside help starts here, with real-time dispatch flow and pricing confirmed before payment.')}
            <View style={styles.graphicPanel}>
              <Image source={subscriberGraphic} style={styles.secondaryGraphic} resizeMode="cover" />
              <View style={styles.graphicCopy}>
                <Text style={styles.sectionTitle}>Why Get Service Now</Text>
                <Text style={styles.mutedText}>
                  From jump starts to lockouts and tire changes, the goal is simple: get help moving quickly and get you back on your way with confidence.
                </Text>
              </View>
            </View>
          </>
        ) : (
          <>
            {renderRequestStatusPanel('Guest Request Status', false)}
            {renderFeedbackPanel(false)}
            {renderPaymentPanel()}
          </>
        )}
      </ScrollView>
    );
  }

  function renderSubscriberScreen() {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {renderTabBar(subscriberTabs, subscriberView, setSubscriberView)}

        {subscriberView === 'access' ? renderSubscriberAccessScreen() : null}
        {subscriberView === 'profile' ? renderSubscriberProfileScreen() : null}
        {subscriberView === 'request' ? renderSubscriberRequestScreen() : null}
        {subscriberView === 'status' ? renderSubscriberStatusScreen() : null}
      </ScrollView>
    );
  }

  function renderSubscriberAccessScreen() {
    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Subscriber Sign In</Text>
          <Text style={styles.mutedText}>Use the shared member login. Subscriber roles route into the member profile and request screens.</Text>
          {renderSigninFields()}
          <Button label="Subscriber Sign In" onPress={handleSignin} />
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Subscriber Signup</Text>
          <Text style={styles.mutedText}>Monthly fee: {formatOptionalMoney(pricingSource?.subscriberMonthlyFee)}</Text>
          <Text style={styles.mutedText}>Vehicle and payment reference values are written into the subscriber profile at signup.</Text>
          {renderSubscriberSignupFields()}
          <Button label="Create Subscriber Account" onPress={handleSubscriberSignup} />
        </View>
      </>
    );
  }

  function renderSubscriberProfileScreen() {
    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Subscriber Profile</Text>
          <Text style={styles.mutedText}>Session: {auth?.sessionToken ? 'Signed in' : 'Guest'}</Text>
          <Text style={styles.mutedText}>Name: {profile?.fullName || 'No subscriber profile loaded.'}</Text>
          <Text style={styles.mutedText}>Subscriber active: {profile?.subscriberActive || auth?.subscriberActive ? 'Yes' : 'No'}</Text>
          <Text style={styles.mutedText}>Next billing date: {formatDate(profile?.nextBillingDate)}</Text>
          <Text style={styles.mutedText}>Requests in past year: {profile?.requestHistoryCount ?? subscriberRequestHistory.length}</Text>
          <Text style={styles.mutedText}>
            Vehicle: {profile?.subscriberProfile?.vehicle ? formatVehicle(profile.subscriberProfile.vehicle) : 'No subscriber vehicle loaded.'}
          </Text>
          <Text style={styles.mutedText}>
            Saved vehicles: {Array.isArray(profile?.savedVehicles) && profile.savedVehicles.length ? profile.savedVehicles.map(formatVehicle).join(' | ') : 'No saved vehicles.'}
          </Text>
          <View style={styles.buttonGrid}>
            <Button label="Refresh Profile" onPress={() => loadProfile().catch((error) => setErrorMessage(error.message))} kind="secondary" />
            <Button label="Use Profile For Request" onPress={prefillRequestFromSubscriber} />
          </View>
        </View>
      </>
    );
  }

  function renderSubscriberRequestScreen() {
    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Subscriber Request</Text>
          <Text style={styles.mutedText}>
            Subscriber requests stay in the live service flow and unlock ETA, arrival, and completion confirmations.
          </Text>
          <View style={styles.buttonGrid}>
            <Button label="Prefill From Profile" onPress={prefillRequestFromSubscriber} kind="secondary" />
          </View>
        </View>
        {renderRequestComposer('Subscriber Service Request', 'Use your member profile, then submit the request into the service queue.')}
      </>
    );
  }

  function renderSubscriberStatusScreen() {
    return (
      <>
        {renderRequestStatusPanel('Subscriber Request Status', true)}

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Subscriber Confirmation Actions</Text>
          <Text style={styles.mutedText}>These buttons map to subscriber confirmation steps for the active request in this app session.</Text>
          <View style={styles.buttonGrid}>
            <Button label="Accept ETA" onPress={() => runSubscriberAction('subscriber-accept-eta')} kind="secondary" />
            <Button label="Confirm Arrival" onPress={() => runSubscriberAction('confirm-arrived')} kind="secondary" />
            <Button label="Confirm Completion" onPress={() => runSubscriberAction('confirm-completion')} />
          </View>
        </View>

        {renderFeedbackPanel(true)}
        {renderPaymentPanel()}
      </>
    );
  }

  function renderProviderScreen() {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Quick Navigation</Text>
          <Text style={styles.mutedText}>Use these buttons if you opened the provider screens by mistake and need to get back to customer flow without restarting.</Text>
          <View style={styles.buttonGrid}>
            <Button
              label="Guest Request"
              kind="secondary"
              onPress={() => {
                setSection('guest');
                setGuestView('request');
              }}
            />
            <Button label="Overview" kind="secondary" onPress={() => setSection('overview')} />
          </View>
        </View>
        {renderTabBar(providerTabs, providerView, setProviderView)}

        {providerView === 'access' ? renderProviderAccessScreen() : null}
        {providerView === 'info' ? renderProviderInfoScreen() : null}
        {providerView === 'profile' ? renderProviderProfileScreen() : null}
        {providerView === 'work' ? renderProviderWorkScreen() : null}
        {providerView === 'log' ? renderProviderLogScreen() : null}
        {providerView === 'wallet' ? renderProviderWalletScreen() : null}
      </ScrollView>
    );
  }

  function renderProviderAccessScreen() {
    return (
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Provider Sign In</Text>
        <Text style={styles.mutedText}>Provider logins route into the dispatch queue and payout screens. Use the same member sign-in endpoint, then the app pivots on the returned role.</Text>
        {renderSigninFields()}
        <Button label="Provider Sign In" onPress={handleSignin} />
      </View>
    );
  }

  function renderProviderInfoScreen() {
    return (
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Provider Info Form</Text>
        <Text style={styles.mutedText}>Monthly fee: {formatOptionalMoney(pricingSource?.providerMonthlyFee)}</Text>
        <Text style={styles.mutedText}>Vehicle, service selections, and document flags write into the provider application flow.</Text>
        {renderProviderSignupFields()}
        <Button label="Create Provider Account" onPress={handleProviderSignup} />
      </View>
    );
  }

  function renderProviderProfileScreen() {
    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Provider Profile</Text>
          <Text style={styles.mutedText}>Status: {labelUiStatus(uiEventMap, 'providerStatus', profile?.providerStatus || auth?.providerStatus || 'Not signed in')}</Text>
          <Text style={styles.mutedText}>Monthly fee: {formatOptionalMoney(profile?.providerMonthly ?? pricingSource?.providerMonthlyFee)}</Text>
          <Text style={styles.mutedText}>
            Services: {Array.isArray(profile?.services) && profile.services.length ? profile.services.map((service) => labelServiceType(uiEventMap, service)).join(', ') : 'None loaded'}
          </Text>
          <Text style={styles.mutedText}>
            Vehicle: {profile?.providerProfile?.vehicleInfo ? formatVehicle(profile.providerProfile.vehicleInfo) : 'No provider vehicle loaded'}
          </Text>
          <Text style={styles.mutedText}>Rating: {formatRating(profile?.providerRating)}</Text>
          <Text style={styles.mutedText}>Discipline strikes: {profile?.providerDiscipline?.strikeCount ?? 0}</Text>
          <Text style={styles.mutedText}>Training status: {profile?.providerDiscipline?.training?.status || 'NOT_REQUIRED'}</Text>
          <Text style={styles.mutedText}>Selection score: {profile?.providerSelection?.score ?? 'N/A'}</Text>
          <Text style={styles.mutedText}>Service area: {profile?.providerProfile?.serviceArea || 'Not set'}</Text>
          <View style={styles.buttonGrid}>
            <Button label="Refresh Profile" onPress={() => loadProfile().catch((error) => setErrorMessage(error.message))} kind="secondary" />
            <Button label="Refresh Queue" onPress={() => loadRequestQueue().catch((error) => setErrorMessage(error.message))} />
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>PayPal Provider State</Text>
          <Text style={styles.mutedText}>Email: {profile?.providerProfile?.paypal?.email || 'Not linked'}</Text>
          <Text style={styles.mutedText}>Consent: {profile?.providerProfile?.paypal?.consentStatus || 'Unknown'}</Text>
          <Text style={styles.mutedText}>Last payout event: {profile?.providerProfile?.paypal?.payouts?.lastEventType || 'None'}</Text>
          <Text style={styles.mutedText}>Last webhook: {profile?.providerProfile?.paypal?.lastWebhookEventType || 'None'}</Text>
        </View>
      </>
    );
  }

  function renderProviderWorkScreen() {
    if (!auth?.roles?.includes('PROVIDER')) {
      return renderRoleGate('Provider work screen requires a provider session.');
    }

    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Provider Work Screen</Text>
          <Text style={styles.mutedText}>Open queue: {providerQueue.length}</Text>
          <Text style={styles.mutedText}>Assigned to you: {providerOwnedRequests.length}</Text>
        </View>

        {providerQueue.length === 0 ? (
          <View style={styles.panel}>
            <Text style={styles.mutedText}>No provider request queue loaded.</Text>
          </View>
        ) : (
          providerQueue.map((request) => renderProviderQueueCard(request))
        )}
      </>
    );
  }

  function renderProviderLogScreen() {
    if (!auth?.roles?.includes('PROVIDER')) {
      return renderRoleGate('Provider log screen requires a provider session.');
    }

    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Provider Log</Text>
          <Text style={styles.mutedText}>This screen focuses on requests assigned to the signed-in provider and the dispatch note and payout state attached to them.</Text>
        </View>

        {providerOwnedRequests.length === 0 ? (
          <View style={styles.panel}>
            <Text style={styles.mutedText}>No provider-owned requests are visible yet.</Text>
          </View>
        ) : (
          providerOwnedRequests.map((request) => {
            const local = providerActions[request.requestId || request.id] || {};
            const requestId = request.requestId || request.id;
            const notes = Array.isArray(request.noteExchange) ? request.noteExchange : [];
            return (
              <View key={requestId} style={styles.panel}>
                <Text style={styles.sectionTitle}>{labelServiceType(uiEventMap, request.serviceType || 'Service')} Log</Text>
                <Text style={styles.mutedText}>Request: {requestId}</Text>
                <Text style={styles.mutedText}>Status: {labelUiStatus(uiEventMap, 'requestStatus', request.status)}</Text>
                <Text style={styles.mutedText}>Payout status: {labelUiStatus(uiEventMap, 'payoutStatus', request.providerPayoutStatus || 'Unknown')}</Text>
                <Text style={styles.mutedText}>Completed: {formatDate(request.completedAt)}</Text>
                <InputField
                  label="Provider Note"
                  multiline
                  value={local.note || ''}
                  onChangeText={(value) => recordProviderAction(requestId, 'note', value)}
                />
                <View style={styles.buttonGrid}>
                  <Button label="Log Note" onPress={() => runProviderAction(requestId, 'note')} kind="secondary" />
                </View>
                {notes.length === 0 ? (
                  <Text style={styles.mutedText}>No note exchange on this request yet.</Text>
                ) : (
                  notes.slice(0, 4).map((entry, index) => (
                    <View key={`${requestId}-note-${index}`} style={styles.noteRow}>
                      <Text style={styles.noteTitle}>{entry.actorRole || 'USER'}</Text>
                      <Text style={styles.mutedText}>{entry.message || 'No note message.'}</Text>
                      <Text style={styles.noteMeta}>{formatDate(entry.createdAt)}</Text>
                    </View>
                  ))
                )}
              </View>
            );
          })
        )}
      </>
    );
  }

  function renderProviderWalletScreen() {
    if (!auth?.roles?.includes('PROVIDER')) {
      return renderRoleGate('Provider wallet screen requires a provider session.');
    }

    const walletTerms = paymentConfig?.walletDisplayTerms || frontendConfig?.walletDisplayTerms || null;

    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Provider Wallet</Text>
          <Text style={styles.mutedText}>This is a payable summary tied to request payout states and PayPal payout events, not a second cash ledger.</Text>
          <View style={styles.statGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Pending</Text>
              <Text style={styles.statValue}>{formatMoney(providerWallet.pendingAmount)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>On Hold</Text>
              <Text style={styles.statValue}>{formatMoney(providerWallet.onHoldAmount)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Paid Out</Text>
              <Text style={styles.statValue}>{formatMoney(providerWallet.paidAmount)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>PayPal Count</Text>
              <Text style={styles.statValue}>{providerWallet.payoutCount}</Text>
            </View>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>PayPal Payout State</Text>
          <Text style={styles.mutedText}>Partner balance snapshot: {formatPartnerBalance(profile?.providerProfile?.paypal?.partnerBalance)}</Text>
          <Text style={styles.mutedText}>Succeeded payouts: {profile?.providerProfile?.paypal?.payouts?.succeededCount ?? 0}</Text>
          <Text style={styles.mutedText}>Failed payouts: {profile?.providerProfile?.paypal?.payouts?.failedCount ?? 0}</Text>
          <Text style={styles.mutedText}>Held payouts: {profile?.providerProfile?.paypal?.payouts?.heldCount ?? 0}</Text>
          <Text style={styles.mutedText}>Last batch: {profile?.providerProfile?.paypal?.payouts?.lastBatchId || 'None'}</Text>
          <Text style={styles.mutedText}>Last item: {profile?.providerProfile?.paypal?.payouts?.lastItemId || 'None'}</Text>
        </View>

        {walletTerms ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>{walletTerms.title || 'Wallet Display Terms'}</Text>
            <Text style={styles.mutedText}>{walletTerms.summary}</Text>
            <Text style={styles.mutedText}>{walletTerms.thirdPartyResponsibility}</Text>
            <Text style={styles.mutedText}>{walletTerms.expectedParity}</Text>
            <Text style={styles.mutedText}>{walletTerms.discrepancyProcess}</Text>
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Request Payout Lines</Text>
          {providerOwnedRequests.length === 0 ? (
            <Text style={styles.mutedText}>No provider payout lines are available yet.</Text>
          ) : (
            providerOwnedRequests.map((request) => (
              <View key={`wallet-${request.requestId || request.id}`} style={styles.queueCard}>
                <Text style={styles.queueTitle}>{labelServiceType(uiEventMap, request.serviceType || 'Service')} · {request.requestId || request.id}</Text>
                <Text style={styles.mutedText}>Request status: {labelUiStatus(uiEventMap, 'requestStatus', request.status)}</Text>
                <Text style={styles.mutedText}>Payout status: {labelUiStatus(uiEventMap, 'payoutStatus', request.providerPayoutStatus || 'Unknown')}</Text>
                <Text style={styles.mutedText}>Payout amount: {formatMoney(request.providerPayoutAmount || 0)}</Text>
              </View>
            ))
          )}
        </View>
      </>
    );
  }

  function renderAdminScreen() {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Quick Navigation</Text>
          <Text style={styles.mutedText}>Use these buttons to return to the customer flow without restarting the app.</Text>
          <View style={styles.buttonGrid}>
            <Button
              label="Guest Request"
              kind="secondary"
              onPress={() => {
                setSection('guest');
                setGuestView('request');
              }}
            />
            <Button label="Overview" kind="secondary" onPress={() => setSection('overview')} />
          </View>
        </View>
        {renderTabBar(adminTabs, adminView, setAdminView)}

        {adminView === 'access' ? renderAdminAccessScreen() : null}
        {adminView === 'work' ? renderAdminWorkScreen() : null}
        {adminView === 'directory' ? renderAdminDirectoryScreen() : null}
        {adminView === 'providers' ? renderAdminProvidersScreen() : null}
        {adminView === 'subscribers' ? renderAdminSubscribersScreen() : null}
      </ScrollView>
    );
  }

  function renderAdminAccessScreen() {
    return (
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Admin Sign In</Text>
        <Text style={styles.mutedText}>Admin screens depend on `/api/admin/login` and `/api/admin/dashboard`, with trusted-zone and optional 2FA headers.</Text>
        <InputField label="Admin Email" autoCapitalize="none" value={adminSignin.email} onChangeText={(value) => setAdminSignin((current) => ({ ...current, email: value }))} />
        <InputField label="Password" secureTextEntry value={adminSignin.password} onChangeText={(value) => setAdminSignin((current) => ({ ...current, password: value }))} />
        <InputField label="Location Zone" value={adminSignin.locationZone} onChangeText={(value) => setAdminSignin((current) => ({ ...current, locationZone: value }))} />
        <InputField label="2FA Code" value={adminSignin.twoFactorCode} onChangeText={(value) => setAdminSignin((current) => ({ ...current, twoFactorCode: value }))} />
        <Button label="Admin Login" onPress={handleAdminSignin} />
      </View>
    );
  }

  function renderAdminWorkScreen() {
    if (!adminSession?.token) {
      return renderRoleGate('Admin work screen requires an admin session.');
    }

    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Admin Work Screen</Text>
          <Text style={styles.mutedText}>Dashboard status: {adminDashboard ? 'Loaded' : 'Not loaded'}</Text>
          <View style={styles.statGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Requests</Text>
              <Text style={styles.statValue}>{adminDashboard?.requestCount ?? 0}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Pending Providers</Text>
              <Text style={styles.statValue}>{adminDashboard?.stats?.pendingProviders ?? 0}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Payouts Pending</Text>
              <Text style={styles.statValue}>{adminDashboard?.stats?.payoutsPending ?? 0}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Refund Flags</Text>
              <Text style={styles.statValue}>{adminDashboard?.stats?.refundsFlagged ?? 0}</Text>
            </View>
          </View>
          <View style={styles.buttonGrid}>
            <Button label="Refresh Dashboard" onPress={() => loadAdminDashboard().catch((error) => setErrorMessage(error.message))} />
            <Button label="Refresh Security" onPress={() => loadBootstrap().catch((error) => setErrorMessage(error.message))} kind="secondary" />
            <Button label="Admin Logout" onPress={handleAdminLogout} kind="danger" />
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Queue And In-Service</Text>
          <Text style={styles.mutedText}>Open queue: {adminDashboard?.queue?.length ?? 0}</Text>
          <Text style={styles.mutedText}>In service: {adminDashboard?.inService?.length ?? 0}</Text>
          {Array.isArray(adminDashboard?.queue) && adminDashboard.queue.length ? (
            adminDashboard.queue.slice(0, 4).map((request) => (
              <View key={`queue-${request.requestId}`} style={styles.queueCard}>
                <Text style={styles.queueTitle}>{labelServiceType(uiEventMap, request.serviceType || 'Service')} · {request.requestId}</Text>
                <Text style={styles.mutedText}>{request.fullName || 'Unknown customer'} · {request.location || 'No location'}</Text>
                <Text style={styles.mutedText}>Status: {labelUiStatus(uiEventMap, 'requestStatus', request.completionStatus || request.status)}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.mutedText}>No queue entries loaded.</Text>
          )}
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Financial Controls</Text>
          {adminDashboard?.policy?.financial?.walletDisplayTerms ? (
            <>
              <Text style={styles.mutedText}>{adminDashboard.policy.financial.walletDisplayTerms.summary}</Text>
              <Text style={styles.mutedText}>{adminDashboard.policy.financial.walletDisplayTerms.thirdPartyResponsibility}</Text>
              <Text style={styles.mutedText}>{adminDashboard.policy.financial.walletDisplayTerms.expectedParity}</Text>
              <Text style={styles.mutedText}>{adminDashboard.policy.financial.walletDisplayTerms.discrepancyProcess}</Text>
            </>
          ) : null}
          {adminFinancials.length === 0 ? (
            <Text style={styles.mutedText}>No financial records are loaded.</Text>
          ) : (
            adminFinancials.slice(0, 6).map((entry) => (
              <View key={`financial-${entry.requestId}`} style={styles.queueCard}>
                <Text style={styles.queueTitle}>{entry.requestId}</Text>
                <Text style={styles.mutedText}>Customer tier: {entry.customerTier}</Text>
                <Text style={styles.mutedText}>Charged: {formatMoney(entry.amountCharged)}</Text>
                <Text style={styles.mutedText}>Collected: {formatMoney(entry.amountCollected)}</Text>
                <Text style={styles.mutedText}>Provider payout: {formatMoney(entry.providerPayoutAmount)}</Text>
                <Text style={styles.mutedText}>Payout status: {labelUiStatus(uiEventMap, 'payoutStatus', entry.providerPayoutStatus)}</Text>
                <InputField
                  label="Refund Reason"
                  value={adminNotes.refunds[String(entry.requestId)] || ''}
                  onChangeText={(value) => updateAdminNote('refunds', entry.requestId, value)}
                />
                <InputField
                  label="Payout Reference"
                  value={adminNotes.payouts[String(entry.requestId)] || ''}
                  onChangeText={(value) => updateAdminNote('payouts', entry.requestId, value)}
                />
                <InputField
                  label="Reset Reason"
                  value={adminNotes.resets[String(entry.requestId)] || ''}
                  onChangeText={(value) => updateAdminNote('resets', entry.requestId, value)}
                />
                <View style={styles.buttonGrid}>
                  <Button label="Refund" onPress={() => handleRefundRequest(entry.requestId)} kind="danger" />
                  <Button label="Complete Payout" onPress={() => handleCompletePayout(entry.requestId)} kind="secondary" />
                  <Button label="Reset Request" onPress={() => handleResetRequest(entry.requestId)} kind="secondary" />
                </View>
              </View>
            ))
          )}
        </View>
      </>
    );
  }

  function renderAdminDirectoryScreen() {
    if (!adminSession?.token) {
      return renderRoleGate('Admin directory requires an admin session.');
    }

    const profilePayload = adminSelectedUserProfile;
    const user = profilePayload?.user || null;
    const subscriber = profilePayload?.subscriber || null;
    const provider = profilePayload?.provider || null;
    const supportSummary = profilePayload?.supportSummary || null;
    const nextAccountState = user?.accountState === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';

    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Admin Directory Search</Text>
          <Text style={styles.mutedText}>Search providers and subscribers even when the issue is unrelated to an active service request.</Text>
          <InputField label="Search Query" value={adminSearchQuery} onChangeText={setAdminSearchQuery} />
          <InputField label="Role Filter" value={adminSearchRole} onChangeText={(value) => setAdminSearchRole((value || 'ALL').toUpperCase())} />
          <View style={styles.buttonGrid}>
            <Button label="Search Accounts" onPress={handleAdminSearch} />
            <Button
              label="Clear Search"
              kind="secondary"
              onPress={() => {
                setAdminSearchQuery('');
                setAdminSearchRole('ALL');
                setAdminSearchResults([]);
                setAdminSelectedUserProfile(null);
              }}
            />
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Search Results</Text>
          {adminSearchResults.length === 0 ? (
            <Text style={styles.mutedText}>No directory results loaded yet.</Text>
          ) : (
            adminSearchResults.map((entry) => (
              <View key={`admin-directory-${entry.id}`} style={styles.queueCard}>
                <Text style={styles.queueTitle}>{entry.fullName || entry.email || `User ${entry.id}`}</Text>
                <Text style={styles.mutedText}>#{entry.id} · {(entry.roles || []).join(', ') || 'No roles'}</Text>
                <Text style={styles.mutedText}>State: {entry.accountState} · Provider: {entry.providerStatus || 'N/A'}</Text>
                <Text style={styles.mutedText}>Requests: {entry.requestCount || 0} · Active: {entry.activeRequestCount || 0}</Text>
                <Text style={styles.mutedText}>{entry.serviceArea || entry.currentLocation || 'No service-area or location note available.'}</Text>
                <Button label="Open Profile" kind="secondary" onPress={() => handleLoadAdminUserProfile(entry.id)} />
              </View>
            ))
          )}
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Selected Account</Text>
          {!user ? (
            <Text style={styles.mutedText}>Select a result to view account status, support context, and recent request history.</Text>
          ) : (
            <>
              <Text style={styles.queueTitle}>{user.fullName || user.email || `User ${user.id}`}</Text>
              <Text style={styles.mutedText}>#{user.id} · {(user.roles || []).join(', ') || 'No roles'}</Text>
              <Text style={styles.mutedText}>Email: {user.email || 'Not set'}</Text>
              <Text style={styles.mutedText}>Phone: {user.phoneNumber || 'Not set'}</Text>
              <Text style={styles.mutedText}>State: {user.accountState} · Signed up: {formatDate(user.signUpDate)}</Text>
              {supportSummary ? (
                <>
                  <Text style={styles.mutedText}>Customer requests: {supportSummary.customerRequestCount || 0} · Active: {supportSummary.activeCustomerRequests || 0}</Text>
                  <Text style={styles.mutedText}>Provider requests: {supportSummary.providerRequestCount || 0} · Active: {supportSummary.activeProviderRequests || 0}</Text>
                </>
              ) : null}
              {subscriber ? (
                <>
                  <Text style={styles.mutedText}>Subscriber status: {subscriber.subscriptionStatus || 'INACTIVE'}</Text>
                  <Text style={styles.mutedText}>Billing date: {formatDate(subscriber.nextBillingDate)}</Text>
                  <Text style={styles.mutedText}>Saved vehicles: {Array.isArray(subscriber.savedVehicles) && subscriber.savedVehicles.length ? subscriber.savedVehicles.map(formatVehicle).join(' | ') : 'None'}</Text>
                </>
              ) : null}
              {provider ? (
                <>
                  <Text style={styles.mutedText}>Provider status: {labelUiStatus(uiEventMap, 'providerStatus', provider.providerStatus)}</Text>
                  <Text style={styles.mutedText}>Service area: {provider.serviceArea || 'Not set'}</Text>
                  <Text style={styles.mutedText}>Services: {Array.isArray(provider.services) && provider.services.length ? provider.services.map((service) => labelServiceType(uiEventMap, service)).join(', ') : 'None'}</Text>
                  <Text style={styles.mutedText}>Documents ready: {provider.documentStatus?.meetsMinimumRequirements ? 'Yes' : 'No'} · PayPal email: {provider.paypal?.email || 'Not linked'}</Text>
                </>
              ) : null}
              <View style={styles.buttonGrid}>
                <Button
                  label={nextAccountState === 'SUSPENDED' ? 'Suspend User' : 'Reactivate User'}
                  kind="secondary"
                  onPress={() => handleAdminAccountState(user.id, nextAccountState)}
                />
                {provider?.providerStatus === 'PENDING_APPROVAL' ? (
                  <Button label="Approve Provider" onPress={() => handleApproveProvider(user.id)} />
                ) : null}
              </View>

              <Text style={styles.sectionTitle}>Recent Customer Requests</Text>
              {Array.isArray(profilePayload?.recentCustomerRequests) && profilePayload.recentCustomerRequests.length ? (
                profilePayload.recentCustomerRequests.map((entry) => (
                  <View key={`admin-customer-request-${entry.requestId}`} style={styles.queueCard}>
                    <Text style={styles.queueTitle}>{entry.requestId}</Text>
                    <Text style={styles.mutedText}>{labelServiceType(uiEventMap, entry.serviceType || 'Service')}</Text>
                    <Text style={styles.mutedText}>Status: {labelUiStatus(uiEventMap, 'requestStatus', entry.status)}</Text>
                    <Text style={styles.mutedText}>Submitted: {formatDate(entry.submittedAt)}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.mutedText}>No recent customer requests.</Text>
              )}

              <Text style={styles.sectionTitle}>Recent Provider Assignments</Text>
              {Array.isArray(profilePayload?.recentProviderRequests) && profilePayload.recentProviderRequests.length ? (
                profilePayload.recentProviderRequests.map((entry) => (
                  <View key={`admin-provider-request-${entry.requestId}`} style={styles.queueCard}>
                    <Text style={styles.queueTitle}>{entry.requestId}</Text>
                    <Text style={styles.mutedText}>{entry.fullName || 'Customer'} · {labelServiceType(uiEventMap, entry.serviceType || 'Service')}</Text>
                    <Text style={styles.mutedText}>Status: {labelUiStatus(uiEventMap, 'requestStatus', entry.status)}</Text>
                    <Text style={styles.mutedText}>Submitted: {formatDate(entry.submittedAt)}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.mutedText}>No recent provider assignments.</Text>
              )}
            </>
          )}
        </View>
      </>
    );
  }

  function renderAdminProvidersScreen() {
    if (!adminSession?.token) {
      return renderRoleGate('Admin provider view requires an admin session.');
    }

    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Admin Provider View</Text>
          <Text style={styles.mutedText}>Providers loaded: {adminProviders.length}</Text>
        </View>

        {adminProviders.length === 0 ? (
          <View style={styles.panel}>
            <Text style={styles.mutedText}>No providers are loaded.</Text>
          </View>
        ) : (
          adminProviders.map((provider) => (
            <View key={`provider-${provider.id}`} style={styles.panel}>
              <Text style={styles.sectionTitle}>{provider.fullName || provider.email || `Provider ${provider.id}`}</Text>
              <Text style={styles.mutedText}>Status: {labelUiStatus(uiEventMap, 'providerStatus', provider.providerStatus)}</Text>
              <Text style={styles.mutedText}>Account: {provider.accountState}</Text>
              <Text style={styles.mutedText}>Services: {Array.isArray(provider.services) && provider.services.length ? provider.services.map((service) => labelServiceType(uiEventMap, service)).join(', ') : 'None'}</Text>
              <Text style={styles.mutedText}>Document readiness: {provider.documentStatus?.meetsMinimumRequirements ? 'Ready' : 'Missing items'}</Text>
              <Text style={styles.mutedText}>PayPal email: {provider.paypal?.email || 'Not linked'}</Text>
              <Text style={styles.mutedText}>Last payout event: {provider.paypal?.payouts?.lastEventType || 'None'}</Text>
              <Text style={styles.mutedText}>Training: {provider.discipline?.training?.status || 'NOT_REQUIRED'} · Strikes: {provider.discipline?.strikeCount ?? 0}</Text>
              <Text style={styles.mutedText}>Suspension: {provider.discipline?.currentSuspension?.indefinite ? 'Indefinite until training' : provider.discipline?.currentSuspension?.active ? `Active until ${formatDate(provider.discipline?.currentSuspension?.endsAt)}` : 'None active'}</Text>
              <InputField
                label="Approval Note"
                value={adminNotes.approvals[String(provider.id)] || ''}
                onChangeText={(value) => updateAdminNote('approvals', provider.id, value)}
              />
              <View style={styles.buttonGrid}>
                <Button label="Approve Provider" onPress={() => handleApproveProvider(provider.id)} />
                {provider.discipline?.currentSuspension?.indefinite ? (
                  <Button label="Schedule Training" onPress={() => handleProviderTraining(provider.id, 'SCHEDULED')} kind="secondary" />
                ) : null}
                {provider.discipline?.training?.status === 'SCHEDULED' || provider.discipline?.training?.status === 'ENROLLED' ? (
                  <Button label="Mark Training Complete" onPress={() => handleProviderTraining(provider.id, 'COMPLETED')} kind="secondary" />
                ) : null}
              </View>
            </View>
          ))
        )}
      </>
    );
  }

  function renderAdminSubscribersScreen() {
    if (!adminSession?.token) {
      return renderRoleGate('Admin subscriber view requires an admin session.');
    }

    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Admin Subscriber View</Text>
          <Text style={styles.mutedText}>Subscribers loaded: {adminSubscribers.length}</Text>
        </View>

        {adminSubscribers.length === 0 ? (
          <View style={styles.panel}>
            <Text style={styles.mutedText}>No subscribers are loaded.</Text>
          </View>
        ) : (
          adminSubscribers.map((subscriber) => (
            <View key={`subscriber-${subscriber.id}`} style={styles.panel}>
              <Text style={styles.sectionTitle}>{subscriber.fullName || subscriber.email || `Subscriber ${subscriber.id}`}</Text>
              <Text style={styles.mutedText}>Subscription: {subscriber.subscriptionStatus}</Text>
              <Text style={styles.mutedText}>Account state: {subscriber.accountState}</Text>
              <Text style={styles.mutedText}>Next billing: {formatDate(subscriber.nextBillingDate)}</Text>
              <Text style={styles.mutedText}>Saved vehicles: {Array.isArray(subscriber.savedVehicles) && subscriber.savedVehicles.length ? subscriber.savedVehicles.map(formatVehicle).join(' | ') : 'None'}</Text>
              <Text style={styles.mutedText}>Service history count: {subscriber.serviceHistoryCount ?? 0}</Text>
            </View>
          ))
        )}
      </>
    );
  }

  function renderSecurityScreen() {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Security Layer</Text>
          <Text style={styles.mutedText}>Layer: {securityStatus?.layer || securityStatus?.watchdog?.layer || 'Unknown'}</Text>
          <Text style={styles.mutedText}>Integrity: {securityStatus?.watchdog?.integrityOk ? 'READY' : 'CHECK'}</Text>
          <Text style={styles.mutedText}>Scanned: {securityStatus?.watchdog?.scannedAt || 'Not available'}</Text>
          <Button label="Refresh Security Status" onPress={() => loadBootstrap().catch((error) => setErrorMessage(error.message))} />
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Runtime Status</Text>
          <Text style={styles.mutedText}>Protected API: {frontendConfig?.apiBaseUrl || 'Unavailable'}</Text>
          <Text style={styles.mutedText}>Raw API: {frontendConfig?.rawApiBaseUrl || 'Unavailable'}</Text>
          <Text style={styles.mutedText}>Optional priority payment: {formatOptionalMoney(pricingSource?.priorityServicePrice)}</Text>
          <Text style={styles.mutedText}>Compatibility manifest: {frontendConfig?.compatibilityManifestUrl || 'Unavailable'}</Text>
          <Text style={styles.mutedText}>Compatibility repository: {frontendConfig?.compatibilityRepositoryUrl || 'Unavailable'}</Text>
        </View>
      </ScrollView>
    );
  }

  function renderSigninFields() {
    return (
      <View style={styles.fieldStack}>
        <InputField
          label="Username or Email"
          autoCapitalize="none"
          value={signinForm.identifier}
          onChangeText={(value) => setSigninForm((current) => ({ ...current, identifier: value }))}
        />
        <InputField
          label="Password"
          secureTextEntry
          value={signinForm.password}
          onChangeText={(value) => setSigninForm((current) => ({ ...current, password: value }))}
        />
      </View>
    );
  }

  function renderRequestComposer(title, description) {
    const customerTier = title.toLowerCase().includes('subscriber') ? 'SUBSCRIBER' : 'GUEST';
    const serviceCharge = getCurrentServiceCharge(pricingSource, customerTier);
    const priorityPayment = formatOptionalMoney(pricingSource?.priorityServicePrice);
    return (
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.mutedText}>{description}</Text>
        <Text style={styles.mutedText}>
          Current service price: {formatOptionalMoney(serviceCharge)}
        </Text>
        <Text style={styles.mutedText}>
          Optional priority payment: {priorityPayment}
        </Text>
        <View style={styles.serviceGrid}>
          {serviceOptions.map((service) => (
            <ServiceCard
              key={service.id}
              active={requestForm.serviceType === service.id}
              label={service.label}
              price={formatOptionalMoney(serviceCharge)}
              detail={`${service.detail} · Optional priority ${priorityPayment}`}
              onPress={() => setRequestForm((current) => ({ ...current, serviceType: service.id }))}
            />
          ))}
        </View>
        <InputField label="Full Name" value={requestForm.fullName} onChangeText={(value) => setRequestForm((current) => ({ ...current, fullName: value }))} />
        <InputField label="Phone Number" value={requestForm.phoneNumber} onChangeText={(value) => setRequestForm((current) => ({ ...current, phoneNumber: value }))} />
        <InputField label="Exact Service Address" value={requestForm.location} onChangeText={(value) => setRequestForm((current) => ({ ...current, location: value }))} />
        <InputField label="Notes / Nearest Cross Street" multiline value={requestForm.notes} onChangeText={(value) => setRequestForm((current) => ({ ...current, notes: value }))} />
        <Button label="Submit Request" onPress={handleCreateRequest} />
        <Text style={styles.mutedText}>
          Active request: {activeRequestId ? activeRequestId : 'Not submitted yet'}
        </Text>
      </View>
    );
  }

  function renderRequestStatusPanel(title, subscriberMode) {
    return (
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.mutedText}>
          {subscriberMode
            ? 'Subscriber status reads from the subscriber profile history for the past year, with current-session changes merged in.'
            : 'Guest status is session-based in this build and tracks the request created from this app runtime.'}
        </Text>
        {(subscriberMode ? subscriberRequestHistory : sessionRequests).length === 0 ? (
          <Text style={styles.mutedText}>
            {subscriberMode ? 'No subscriber request history is available for the past year.' : 'No request has been submitted in this app session.'}
          </Text>
        ) : (
          (subscriberMode ? subscriberRequestHistory : sessionRequests).map((request) => renderRequestStatusCard(request))
        )}
      </View>
    );
  }

  function renderRequestStatusCard(request) {
    const requestId = request.requestId || request.id;
    return (
      <View key={`session-${requestId}`} style={styles.queueCard}>
        <Text style={styles.queueTitle}>{labelServiceType(uiEventMap, request.serviceType || 'Service')} · {requestId}</Text>
        <Text style={styles.mutedText}>Customer: {request.fullName || 'Unknown'}</Text>
        <Text style={styles.mutedText}>Location: {request.location || 'Unknown'}</Text>
        <Text style={styles.mutedText}>Location access: {request.locationDisclosureLevel || 'MASKED'} · Contact access: {request.contactDisclosureLevel || 'LOCKED'}</Text>
        <Text style={styles.mutedText}>Status: {labelUiStatus(uiEventMap, 'requestStatus', request.status || request.completionStatus || 'Unknown')}</Text>
        <Text style={styles.mutedText}>Payment: {labelUiStatus(uiEventMap, 'paymentStatus', request.paymentStatus || 'NOT_PAID')}</Text>
        <Text style={styles.mutedText}>ETA: {request.etaMinutes ?? 'Not set'} · Soft: {request.softEtaMinutes ?? 'Not set'} · Hard: {request.hardEtaMinutes ?? 'Locked'}</Text>
        <Text style={styles.mutedText}>Provider callback: {request.providerCallbackNumber || 'Available after payment and provider activation'}</Text>
        <Text style={styles.mutedText}>Accepted ETA: {formatDate(request.customerEtaAcceptedAt)}</Text>
        <Text style={styles.mutedText}>Arrival confirmed: {formatDate(request.arrivalConfirmedAt)}</Text>
        <Text style={styles.mutedText}>Completion confirmed: {formatDate(request.completionConfirmedAt)}</Text>
      </View>
    );
  }

  function renderPaymentPanel() {
    return (
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Payment</Text>
        <Text style={styles.mutedText}>Payment mode: {paymentConfig?.mode || frontendConfig?.paypalMode || 'Unavailable'}</Text>
        <Text style={styles.mutedText}>
          Service quote: {servicePaymentQuote?.amount?.value ? `${servicePaymentQuote.amount.value} ${servicePaymentQuote.amount.currency_code}` : 'Not requested'}
        </Text>
        <Text style={styles.mutedText}>Service agreement: {serviceQuoteAccepted ? 'Accepted' : 'Pending'}</Text>
        <Text style={styles.mutedText}>Order status: {labelUiStatus(uiEventMap, 'paymentStatus', paymentOrder?.status || (paymentOrder?.captured ? 'CAPTURED' : 'No active order'))}</Text>
        <View style={styles.buttonGrid}>
          <Button label="Check Service Quote" onPress={handleFetchServiceQuote} kind="secondary" />
          <Button label="Agree To Service Price" onPress={handleAgreeServiceQuote} kind="secondary" />
          <Button label="Create Payment Order" onPress={handleCreatePaymentOrder} kind="secondary" />
          <Button label="Capture Payment" onPress={handleCapturePayment} />
        </View>
      </View>
    );
  }

  function renderFeedbackPanel(subscriberMode) {
    const request = activeSessionRequest || sessionRequests[0] || null;
    const feedback = request?.customerFeedback || null;
    const completed = normalizeValue(request?.status) === 'COMPLETED' || normalizeValue(request?.completionStatus) === 'COMPLETED';

    return (
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Provider Rating</Text>
        <Text style={styles.mutedText}>
          {subscriberMode
            ? 'After service completion, submit a provider rating from 1 to 8 plus service notes.'
            : 'Guest feedback stays tied to the request details stored in this app session.'}
        </Text>
        {!request ? (
          <Text style={styles.mutedText}>No active request is available for feedback yet.</Text>
        ) : feedback ? (
          <>
            <Text style={styles.mutedText}>Recorded rating: {feedback.rating} / 8</Text>
            <Text style={styles.mutedText}>Submitted: {formatDate(feedback.submittedAt)}</Text>
            <Text style={styles.mutedText}>Notes: {feedback.notes || 'No notes provided.'}</Text>
          </>
        ) : !completed ? (
          <Text style={styles.mutedText}>Feedback unlocks after the provider marks the request completed.</Text>
        ) : (
          <>
            <InputField
              label="Rating (1-8)"
              value={feedbackForm.rating}
              onChangeText={(value) => setFeedbackForm((current) => ({ ...current, rating: value.replace(/[^\d]/g, '').slice(0, 1) || '8' }))}
              keyboardType="number-pad"
            />
            <InputField
              label="Service Notes"
              value={feedbackForm.notes}
              onChangeText={(value) => setFeedbackForm((current) => ({ ...current, notes: value }))}
              multiline
            />
            <Button label="Submit Provider Rating" onPress={handleSubmitRequestFeedback} />
          </>
        )}
      </View>
    );
  }

  function renderProviderQueueCard(request) {
    const local = providerActions[request.requestId || request.id] || {};
    const requestId = request.requestId || request.id;
    return (
      <View key={requestId} style={styles.panel}>
        <Text style={styles.sectionTitle}>{labelServiceType(uiEventMap, request.serviceType || 'Service')} · {request.fullName || 'Unknown customer'}</Text>
        <Text style={styles.mutedText}>{request.location || 'No location'}</Text>
        <Text style={styles.mutedText}>Phone: {request.customerCallbackNumber || 'Locked until payment and provider activation'}</Text>
        <Text style={styles.mutedText}>Location access: {request.locationDisclosureLevel || 'MASKED'} · Contact access: {request.contactDisclosureLevel || 'LOCKED'}</Text>
        <Text style={styles.mutedText}>Current status: {labelUiStatus(uiEventMap, 'requestStatus', request.status)}</Text>
        <Text style={styles.mutedText}>Assigned provider: {request.assignedProviderId || 'Unassigned'}</Text>
        <Text style={styles.mutedText}>ETA minutes: {request.etaMinutes ?? 'Not set'} · Soft: {request.softEtaMinutes ?? 'Not set'} · Hard: {request.hardEtaMinutes ?? 'Locked'}</Text>
        <InputField
          label="ETA"
          value={local.eta || ''}
          onChangeText={(value) => recordProviderAction(requestId, 'eta', value)}
        />
        <InputField
          label="Soft Contact Info"
          value={local.softContact || ''}
          onChangeText={(value) => recordProviderAction(requestId, 'softContact', value)}
        />
        <InputField
          label="Hard Contact Info"
          value={local.hardContact || ''}
          onChangeText={(value) => recordProviderAction(requestId, 'hardContact', value)}
        />
        <View style={styles.buttonGrid}>
          <Button label="Accept" onPress={() => runProviderAction(requestId, 'accept')} />
          <Button label="Set ETA" onPress={() => runProviderAction(requestId, 'eta')} kind="secondary" />
          <Button label="Soft Contact" onPress={() => runProviderAction(requestId, 'soft-contact')} kind="secondary" />
          <Button label="Hard Contact" onPress={() => runProviderAction(requestId, 'hard-contact')} kind="secondary" />
          <Button label="Arrived" onPress={() => runProviderAction(requestId, 'arrived')} />
          <Button label="Completed" onPress={() => runProviderAction(requestId, 'completed')} kind="danger" />
        </View>
      </View>
    );
  }

  function renderRoleGate(message) {
    return (
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Session Required</Text>
        <Text style={styles.mutedText}>{message}</Text>
      </View>
    );
  }

  function renderTabBar(items, active, onChange) {
    return (
      <View style={styles.roleTabs}>
        {items.map((item) => (
          <Pressable key={item.id} style={[styles.roleTab, active === item.id ? styles.roleTabActive : null]} onPress={() => onChange(item.id)}>
            <Text style={[styles.roleTabLabel, active === item.id ? styles.roleTabLabelActive : null]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  function renderSubscriberSignupFields() {
    return (
      <View style={styles.fieldStack}>
        <InputField label="Full Name" value={subscriberSignup.fullName} onChangeText={(value) => setSubscriberSignup((current) => ({ ...current, fullName: value }))} />
        <InputField label="Username" autoCapitalize="none" value={subscriberSignup.username} onChangeText={(value) => setSubscriberSignup((current) => ({ ...current, username: value }))} />
        <InputField label="Email" autoCapitalize="none" value={subscriberSignup.email} onChangeText={(value) => setSubscriberSignup((current) => ({ ...current, email: value }))} />
        <InputField label="Password" secureTextEntry value={subscriberSignup.password} onChangeText={(value) => setSubscriberSignup((current) => ({ ...current, password: value }))} />
        <InputField label="Vehicle Year" value={subscriberSignup.year} onChangeText={(value) => setSubscriberSignup((current) => ({ ...current, year: value }))} />
        <InputField label="Vehicle Make" value={subscriberSignup.make} onChangeText={(value) => setSubscriberSignup((current) => ({ ...current, make: value }))} />
        <InputField label="Vehicle Model" value={subscriberSignup.model} onChangeText={(value) => setSubscriberSignup((current) => ({ ...current, model: value }))} />
        <InputField label="Vehicle Color" value={subscriberSignup.color} onChangeText={(value) => setSubscriberSignup((current) => ({ ...current, color: value }))} />
        <InputField label="Payment Reference" value={subscriberSignup.paymentMethodMasked} onChangeText={(value) => setSubscriberSignup((current) => ({ ...current, paymentMethodMasked: value }))} />
      </View>
    );
  }

  function renderProviderSignupFields() {
    return (
      <View style={styles.fieldStack}>
        <InputField label="Full Name" value={providerSignup.fullName} onChangeText={(value) => setProviderSignup((current) => ({ ...current, fullName: value }))} />
        <InputField label="Username" autoCapitalize="none" value={providerSignup.username} onChangeText={(value) => setProviderSignup((current) => ({ ...current, username: value }))} />
        <InputField label="Email" autoCapitalize="none" value={providerSignup.email} onChangeText={(value) => setProviderSignup((current) => ({ ...current, email: value }))} />
        <InputField label="Password" secureTextEntry value={providerSignup.password} onChangeText={(value) => setProviderSignup((current) => ({ ...current, password: value }))} />
        <InputField label="Vehicle Year" value={providerSignup.year} onChangeText={(value) => setProviderSignup((current) => ({ ...current, year: value }))} />
        <InputField label="Vehicle Make" value={providerSignup.make} onChangeText={(value) => setProviderSignup((current) => ({ ...current, make: value }))} />
        <InputField label="Vehicle Model" value={providerSignup.model} onChangeText={(value) => setProviderSignup((current) => ({ ...current, model: value }))} />
        <InputField label="Vehicle Color" value={providerSignup.color} onChangeText={(value) => setProviderSignup((current) => ({ ...current, color: value }))} />
        <InputField label="Experience" multiline value={providerSignup.experience} onChangeText={(value) => setProviderSignup((current) => ({ ...current, experience: value }))} />
        <Text style={styles.label}>Services</Text>
        <View style={styles.pillWrap}>
          {providerServiceOptions.map((service) => {
            const active = providerSignup.services.includes(service);
            return (
              <Pressable
                key={service}
                onPress={() =>
                  setProviderSignup((current) => ({
                    ...current,
                    services: active
                      ? current.services.filter((entry) => entry !== service)
                      : [...current.services, service],
                  }))
                }
                style={[styles.pill, active ? styles.pillActive : null]}
              >
                <Text style={[styles.pillLabel, active ? styles.pillLabelActive : null]}>{labelServiceType(uiEventMap, service)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>A-Dub Roadside Fire</Text>
          <Text style={styles.headerMeta}>Expo dev build variant mapped to live role flows.</Text>
        </View>
        <View style={styles.headerActions}>
          {auth?.sessionToken ? <Button label="Logout" onPress={handleUserLogout} kind="secondary" /> : null}
          {loading ? <ActivityIndicator color={theme.colors.gold} /> : null}
        </View>
      </View>

      <View style={styles.navBar}>
        {navItems.map((item) => (
          <Pressable key={item.id} style={[styles.navPill, section === item.id ? styles.navPillActive : null]} onPress={() => setSection(item.id)}>
            <Text style={[styles.navPillLabel, section === item.id ? styles.navPillLabelActive : null]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      {statusMessage ? <Text style={styles.successBanner}>{statusMessage}</Text> : null}
      {errorMessage ? <Text style={styles.errorBanner}>{errorMessage}</Text> : null}

      {renderScreen()}
    </SafeAreaView>
  );
}

function summarizeProviderWallet(requests, paypalState) {
  const entries = Array.isArray(requests) ? requests : [];
  let pendingAmount = 0;
  let onHoldAmount = 0;
  let paidAmount = 0;

  for (const entry of entries) {
    const amount = Number(entry.providerPayoutAmount || 0);
    const status = normalizeValue(entry.providerPayoutStatus);
    if (status === 'COMPLETED') {
      paidAmount += amount;
    } else if (status === 'ON_HOLD' || status === 'HELD' || status === 'BLOCKED') {
      onHoldAmount += amount;
    } else if (status === 'PENDING' || status === 'PROCESSING' || status === 'UNCLAIMED') {
      pendingAmount += amount;
    }
  }

  return {
    pendingAmount,
    onHoldAmount,
    paidAmount,
    payoutCount: Number(paypalState?.payouts?.succeededCount || 0) + Number(paypalState?.payouts?.failedCount || 0),
  };
}

function mergeRequestCollections(primary, secondary) {
  const merged = new Map();
  for (const collection of [primary, secondary]) {
    for (const entry of Array.isArray(collection) ? collection : []) {
      const requestId = entry?.requestId || entry?.id;
      if (!requestId) {
        continue;
      }
      merged.set(String(requestId), {
        ...merged.get(String(requestId)),
        ...entry,
      });
    }
  }
  return Array.from(merged.values()).sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.requestDate || left.createdAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.requestDate || right.createdAt || 0).getTime();
    return rightTime - leftTime;
  });
}

function normalizeValue(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function labelUiStatus(uiEventMap, group, value) {
  const normalized = normalizeValue(value);
  const map = uiEventMap?.[group] || {};
  return map[normalized] || map[value] || prettifyUiToken(value || 'Unknown');
}

function labelServiceType(uiEventMap, value) {
  const normalized = normalizeValue(value);
  const map = uiEventMap?.serviceTypes || {};
  return map[value] || map[normalized] || prettifyUiToken(value || 'Service');
}

function prettifyUiToken(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim() || 'Unknown';
}

function formatUserFacingMessage(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) {
    return '';
  }

  const normalized = text.toLowerCase();
  if (normalized.includes('backend service quote')) {
    return 'The current service price is required before continuing.';
  }
  if (normalized.includes('backend quote')) {
    return text.replace(/backend quote/gi, 'service price');
  }
  if (normalized.includes('protected backend')) {
    return text.replace(/protected backend/gi, 'dispatch service');
  }
  if (normalized.includes('backend ')) {
    return text.replace(/backend/gi, 'service');
  }
  return text;
}

function formatVehicle(vehicle) {
  if (!vehicle || typeof vehicle !== 'object') {
    return 'Unknown vehicle';
  }
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(' ');
}

function formatMoney(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(numeric);
}

function formatOptionalMoney(value) {
  if (!Number.isFinite(Number(value))) {
    return 'Unavailable';
  }
  return formatMoney(value);
}

function getCurrentServiceCharge(pricing, customerTier) {
  if (!pricing || typeof pricing !== 'object') {
    return null;
  }
  return customerTier === 'SUBSCRIBER'
    ? pricing.subscriberServicePrice
    : pricing.guestServicePrice;
}

function formatDate(value) {
  if (!value) {
    return 'Not available';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRating(summary) {
  if (!summary) {
    return 'No rating data';
  }
  const average = Number(summary.averageRating || 0);
  const count = Number(summary.ratingCount || 0);
  return count > 0 ? `${average.toFixed(1)} / 8 (${count} ratings)` : 'No rating data';
}

function formatPartnerBalance(balance) {
  if (!balance || typeof balance !== 'object') {
    return 'Not available';
  }
  if (balance.amount && typeof balance.amount === 'object') {
    return `${balance.amount.value || '0.00'} ${balance.amount.currency_code || 'USD'}`;
  }
  return 'Not available';
}

function labelProviderAction(action) {
  if (action === 'soft-contact') {
    return 'Soft contact';
  }
  if (action === 'hard-contact') {
    return 'Hard contact';
  }
  if (action === 'subscriber-accept-eta') {
    return 'Accept ETA';
  }
  if (action === 'confirm-arrived') {
    return 'Confirm arrival';
  }
  if (action === 'confirm-completion') {
    return 'Confirm completion';
  }
  if (action === 'eta') {
    return 'ETA';
  }
  return prettifyUiToken(action || 'Action');
}

const styles = StyleSheet.create({
  app: {
    backgroundColor: theme.colors.background,
    flex: 1,
    paddingTop: 12,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  brand: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  headerMeta: {
    color: theme.colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  navBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  navPill: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  navPillActive: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accent,
  },
  navPillLabel: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  navPillLabelActive: {
    color: theme.colors.gold,
  },
  successBanner: {
    backgroundColor: '#173326',
    color: '#9ef0c4',
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
  },
  errorBanner: {
    backgroundColor: '#411b1a',
    color: '#ffb4aa',
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
  },
  screen: {
    flex: 1,
  },
  content: {
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  heroCard: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  heroImage: {
    height: 240,
    width: '100%',
  },
  heroCopy: {
    gap: 8,
    padding: theme.spacing.lg,
  },
  eyebrow: {
    color: theme.colors.gold,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 34,
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  panel: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 19,
    fontWeight: '900',
  },
  mutedText: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  fieldStack: {
    gap: theme.spacing.sm,
  },
  serviceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  graphicPanel: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  secondaryGraphic: {
    height: 240,
    width: '100%',
  },
  graphicCopy: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  queueCard: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
  },
  queueTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  buttonGrid: {
    gap: theme.spacing.sm,
  },
  label: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  pill: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pillActive: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accent,
  },
  pillLabel: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  pillLabelActive: {
    color: theme.colors.gold,
  },
  roleTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  roleTab: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  roleTabActive: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accent,
  },
  roleTabLabel: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  roleTabLabelActive: {
    color: theme.colors.gold,
  },
  quickGrid: {
    gap: theme.spacing.sm,
  },
  quickCard: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: 6,
    padding: theme.spacing.md,
  },
  quickLabel: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  quickBody: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  statCard: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    flexBasis: '47%',
    gap: 6,
    padding: theme.spacing.sm,
  },
  statLabel: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  statValue: {
    color: theme.colors.gold,
    fontSize: 20,
    fontWeight: '900',
  },
  noteRow: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    gap: 4,
    padding: theme.spacing.sm,
  },
  noteTitle: {
    color: theme.colors.gold,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  noteMeta: {
    color: theme.colors.muted,
    fontSize: 11,
  },
});
