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
const DEFAULT_BACKEND_URL = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_BASE_URL?.trim?.() || '' : '';

const baseNavItems = [
  { id: 'home', label: 'Home' },
  { id: 'subscriber', label: 'Subscriber' },
  { id: 'provider', label: 'Provider' },
  { id: 'admin', label: 'Admin' },
];

const serviceOptions = [
  { id: 'Jump Start', label: 'Jump Start', detail: 'Battery assistance' },
  { id: 'Lockout', label: 'Lockout', detail: 'Vehicle entry' },
  { id: 'Tire Change', label: 'Tire Change', detail: 'Wheel swap' },
  { id: 'Gas Delivery', label: 'Gas Delivery', detail: 'Fuel drop' },
  { id: 'Battery Install', label: 'Battery Install', detail: 'Install support' },
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

export default function App() {
  const [screen, setScreen] = useState('home');
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
  const [requests, setRequests] = useState([]);
  const [providerActions, setProviderActions] = useState({});
  const [latestRequest, setLatestRequest] = useState(null);
  const [servicePaymentQuote, setServicePaymentQuote] = useState(null);
  const [serviceQuoteAccepted, setServiceQuoteAccepted] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [requestForm, setRequestForm] = useState(initialRequestForm);
  const [signinForm, setSigninForm] = useState(initialSignin);
  const [subscriberSignup, setSubscriberSignup] = useState(initialSubscriberSignup);
  const [providerSignup, setProviderSignup] = useState(initialProviderSignup);
  const [adminSignin, setAdminSignin] = useState(initialAdminSignin);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const navItems = adminSession?.token ? [...baseNavItems, { id: 'security', label: 'Security' }] : baseNavItems;
  const api = createApiClient({
    baseUrl: backendUrl,
    getToken: () => auth?.sessionToken || null,
  });

  useEffect(() => {
    if (!backendUrl.trim()) {
      setStatusMessage('Set the backend URL for this build before refreshing runtime config.');
      return;
    }
    loadBootstrap().catch((error) => {
      setErrorMessage(error.message);
    });
  }, []);

  async function loadBootstrap() {
    if (!backendUrl.trim()) {
      clearMessages();
      setStatusMessage('Set the backend URL for this build before refreshing runtime config.');
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
      setStatusMessage('Backend connected.');
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
        setScreen('provider');
      } else {
        setScreen('subscriber');
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
      setScreen('subscriber');
      setProfile((current) => ({
        ...(current || {}),
        subscriberProfile: {
          membershipPrice: 5,
          vehicle: {
            year: subscriberSignup.year,
            make: subscriberSignup.make,
            model: subscriberSignup.model,
            color: subscriberSignup.color,
          },
          paymentMethodMasked: subscriberSignup.paymentMethodMasked,
        },
      }));
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
      setProfile((current) => ({
        ...(current || {}),
        providerStatus: 'PENDING_APPROVAL',
        services: providerSignup.services,
        providerProfile: {
          vehicleInfo: {
            year: providerSignup.year,
            make: providerSignup.make,
            model: providerSignup.model,
            color: providerSignup.color,
          },
        },
      }));
      setScreen('provider');
      setStatusMessage('Provider application submitted.');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGuestRequest() {
    setLoading(true);
    clearMessages();
    try {
      const payload = await api.createRequest({
        ...requestForm,
        userId: auth?.userId || null,
        roles: auth?.roles || [],
      });
      setLatestRequest(payload);
      setServicePaymentQuote(null);
      setServiceQuoteAccepted(false);
      setPaymentOrder(null);
      setStatusMessage(`Request submitted: ${payload.requestId || payload.id}`);
      if (auth?.roles?.includes('PROVIDER')) {
        await loadRequestQueue(frontendConfig, auth.sessionToken);
      }
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchServiceQuote() {
    const requestId = latestRequest?.requestId || latestRequest?.id;
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
      setStatusMessage(`Backend quote ready: ${payload.amount?.value || '0.00'} ${payload.amount?.currency_code || 'USD'}.`);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function handleAgreeServiceQuote() {
    if (!servicePaymentQuote?.quoteId) {
      setErrorMessage('Backend service quote is required before agreement.');
      return;
    }
    clearMessages();
    setServiceQuoteAccepted(true);
    setStatusMessage(`Service quote accepted: ${servicePaymentQuote.amount?.value || '0.00'} ${servicePaymentQuote.amount?.currency_code || 'USD'}.`);
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
      } else {
        setStatusMessage(payload.message || '2FA required.');
      }
      setScreen('admin');
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
    const payload = await api.getAdminDashboard(session.token, {
      'x-location-zone': session.locationZone || 'HOME_BASE',
      ...(session.twoFactorVerified ? { 'x-2fa-verified': 'true' } : {}),
    });
    setAdminDashboard(payload);
  }

  async function handleCreatePaymentOrder() {
    if (!latestRequest?.requestId && !latestRequest?.id) {
      setErrorMessage('Submit a request before creating a payment order.');
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const requestId = latestRequest?.requestId || latestRequest?.id;
      const useServiceQuote = Boolean(serviceQuoteAccepted && servicePaymentQuote?.quoteId && requestId);
      const payload = await api.createPaypalOrder(
        useServiceQuote
          ? {
              paymentKind: 'service',
              requestId,
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
      const payload = await api.capturePaypalOrder({ orderId });
      setPaymentOrder((current) => ({ ...(current || {}), ...payload, captured: true }));
      setStatusMessage(payload.message || `Payment captured for order ${orderId}.`);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function handleUserLogout() {
    setAuth(null);
    setProfile(null);
    setRequests([]);
    setProviderActions({});
    setLatestRequest(null);
    setPaymentOrder(null);
    setSigninForm(initialSignin);
    setScreen('home');
    setStatusMessage('Member session cleared.');
    setErrorMessage('');
  }

  function handleAdminLogout() {
    setAdminSession(null);
    setAdminDashboard(null);
    setSecurityStatus(null);
    setAdminSignin(initialAdminSignin);
    setScreen('home');
    setStatusMessage('Admin session cleared.');
    setErrorMessage('');
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
      };
      const result = await api.applyProviderAction(requestId, action, payload, auth.sessionToken);
      await loadRequestQueue(frontendConfig, auth.sessionToken);
      setStatusMessage(result?.message || `${labelProviderAction(action)} accepted for ${requestId}.`);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function clearMessages() {
    setStatusMessage('');
    setErrorMessage('');
  }

  function renderScreen() {
    if (screen === 'request') {
      return renderRequestScreen();
    }
    if (screen === 'subscriber') {
      return renderSubscriberScreen();
    }
    if (screen === 'provider') {
      return renderProviderScreen();
    }
    if (screen === 'admin') {
      return renderAdminScreen();
    }
    if (screen === 'security') {
      return renderSecurityScreen();
    }
    return renderHomeScreen();
  }

  function renderHomeScreen() {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <Image source={homeGraphic} style={styles.heroImage} resizeMode="cover" />
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>AW Roadside Fire</Text>
            <Text style={styles.title}>Welcome to AW Roadside Fire.</Text>
            <Text style={styles.subtitle}>
              Good service is a priority, and your safety is always our first concern.
            </Text>
          </View>
        </View>

        {__DEV__ ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Backend Runtime</Text>
            <InputField
              label="Backend URL"
              autoCapitalize="none"
              value={backendUrl}
              onChangeText={setBackendUrl}
              placeholder="https://api.your-domain.com"
            />
            <Button label="Refresh Backend Config" onPress={() => loadBootstrap().catch((error) => setErrorMessage(error.message))} />
            <Text style={styles.mutedText}>Variant mode: {compatibilityVariant?.mode || compatibilityManifest?.mode || 'Unverified'}</Text>
            <Text style={styles.mutedText}>Active authority: {compatibilityManifest?.activeVariantId || 'Unknown'}</Text>
          </View>
        ) : null}

        {renderRequestWorkPanel('Guest Request')}

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Member / Provider Sign In</Text>
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
          <Button label="Sign In" onPress={handleSignin} />
        </View>

        <View style={styles.dualGrid}>
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Subscriber Signup</Text>
            <Text style={styles.mutedText}>Monthly fee: {formatMoney(5)}</Text>
            <Text style={styles.mutedText}>By creating a subscriber account, you accept the current member terms and stored vehicle/payment profile rules.</Text>
            {renderSubscriberSignupFields()}
            <Button label="Create Subscriber Account" onPress={handleSubscriberSignup} />
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Provider Signup</Text>
            <Text style={styles.mutedText}>Application fee: {formatMoney(5.99)}</Text>
            <Text style={styles.mutedText}>By applying as a provider, you accept provider verification, fee, dispatch, and future policy update terms.</Text>
            {renderProviderSignupFields()}
            <Button label="Create Provider Account" onPress={handleProviderSignup} />
          </View>
        </View>
      </ScrollView>
    );
  }

  function renderRequestScreen() {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {renderRequestWorkPanel('Guest / Customer Request')}

        <View style={styles.graphicPanel}>
          <Image source={subscriberGraphic} style={styles.secondaryGraphic} resizeMode="cover" />
          <View style={styles.graphicCopy}>
            <Text style={styles.sectionTitle}>Subscriber Profile</Text>
            <Text style={styles.mutedText}>
              {profile?.subscriberProfile?.vehicle
                ? `${profile.subscriberProfile.vehicle.year} ${profile.subscriberProfile.vehicle.make} ${profile.subscriberProfile.vehicle.model} ${profile.subscriberProfile.vehicle.color}`
                : 'No subscriber vehicle profile loaded.'}
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  function renderSubscriberScreen() {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Subscriber Info</Text>
          <Text style={styles.mutedText}>Session: {auth?.sessionToken ? 'Signed in' : 'Guest'}</Text>
          <Text style={styles.mutedText}>Name: {profile?.fullName || (auth?.userId ? `User ${auth.userId}` : 'Not signed in')}</Text>
          <Text style={styles.mutedText}>Subscriber active: {profile?.subscriberActive || auth?.subscriberActive ? 'Yes' : 'No'}</Text>
          <Text style={styles.mutedText}>
            Vehicle: {profile?.subscriberProfile?.vehicle
              ? `${profile.subscriberProfile.vehicle.year} ${profile.subscriberProfile.vehicle.make} ${profile.subscriberProfile.vehicle.model} ${profile.subscriberProfile.vehicle.color}`
              : 'No subscriber vehicle loaded.'}
          </Text>
          <View style={styles.buttonGrid}>
            <Button label="Refresh Subscriber Profile" onPress={() => loadProfile().catch((error) => setErrorMessage(error.message))} kind="secondary" />
            <Button label="Use Profile For Request" onPress={prefillRequestFromSubscriber} />
          </View>
        </View>

        {renderRequestWorkPanel('Subscriber Request')}
      </ScrollView>
    );
  }

  function renderRequestWorkPanel(title) {
    const guestServiceBasePrice = paymentConfig?.serviceBasePrice || frontendConfig?.serviceBasePrice || 55;
    const priorityAddOnPrice = paymentConfig?.priorityServicePrice || frontendConfig?.priorityServicePrice || 25;

    return (
      <>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.mutedText}>
            Guest service base rate: {formatMoney(guestServiceBasePrice)}
          </Text>
          <Text style={styles.mutedText}>
            Optional priority dispatch add-on: {formatMoney(priorityAddOnPrice)}. This is not the full service price.
          </Text>
          <Text style={styles.mutedText}>Service payment stays locked until the backend records a hard ETA and returns a quote.</Text>
          <View style={styles.serviceGrid}>
            {serviceOptions.map((service) => (
              <ServiceCard
                key={service.id}
                active={requestForm.serviceType === service.id}
                label={service.label}
                price={formatMoney(guestServiceBasePrice)}
                detail={service.detail}
                onPress={() => setRequestForm((current) => ({ ...current, serviceType: service.id }))}
              />
            ))}
          </View>
          <InputField label="Full Name" value={requestForm.fullName} onChangeText={(value) => setRequestForm((current) => ({ ...current, fullName: value }))} />
          <InputField label="Phone Number" value={requestForm.phoneNumber} onChangeText={(value) => setRequestForm((current) => ({ ...current, phoneNumber: value }))} />
          <InputField label="Location" value={requestForm.location} onChangeText={(value) => setRequestForm((current) => ({ ...current, location: value }))} />
          <InputField label="Notes" multiline value={requestForm.notes} onChangeText={(value) => setRequestForm((current) => ({ ...current, notes: value }))} />
          <Button label="Submit Request" onPress={handleGuestRequest} />
          <Text style={styles.mutedText}>
            Request status: {latestRequest?.requestId || latestRequest?.id ? `Submitted as ${latestRequest.requestId || latestRequest.id}` : 'Not submitted yet'}
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Payment</Text>
          <Text style={styles.mutedText}>
            Payment mode: {paymentConfig?.paypalMode || frontendConfig?.paypalMode || 'Unavailable'}
          </Text>
          <Text style={styles.mutedText}>
            Service quote: {servicePaymentQuote?.amount?.value ? `${servicePaymentQuote.amount.value} ${servicePaymentQuote.amount.currency_code}` : 'Not requested'}
          </Text>
          <Text style={styles.mutedText}>Priority add-on: {formatMoney(priorityAddOnPrice)}</Text>
          <Text style={styles.mutedText}>Service agreement: {serviceQuoteAccepted ? 'Accepted' : 'Pending'}</Text>
          <Text style={styles.mutedText}>
            Order status: {paymentOrder?.status || (paymentOrder?.captured ? 'CAPTURED' : 'No active order')}
          </Text>
          <View style={styles.buttonGrid}>
            <Button label="Check Service Quote" onPress={handleFetchServiceQuote} kind="secondary" />
            <Button label="Agree To Service Price" onPress={handleAgreeServiceQuote} kind="secondary" />
            <Button label="Create Payment Order" onPress={handleCreatePaymentOrder} kind="secondary" />
            <Button label="Capture Payment" onPress={handleCapturePayment} />
          </View>
        </View>
      </>
    );
  }

  function prefillRequestFromSubscriber() {
    setRequestForm((current) => ({
      ...current,
      fullName: profile?.fullName || current.fullName,
      notes: profile?.subscriberProfile?.vehicle
        ? `${profile.subscriberProfile.vehicle.year} ${profile.subscriberProfile.vehicle.make} ${profile.subscriberProfile.vehicle.model} ${profile.subscriberProfile.vehicle.color}${current.notes ? ` - ${current.notes}` : ''}`
        : current.notes,
    }));
    setStatusMessage('Subscriber info copied into the request form.');
    setErrorMessage('');
  }

  function renderProviderScreen() {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Provider Profile</Text>
          <Text style={styles.mutedText}>
            Status: {profile?.providerStatus || auth?.providerStatus || 'Not signed in'}
          </Text>
          <Text style={styles.mutedText}>
            Services: {Array.isArray(profile?.services) && profile.services.length ? profile.services.join(', ') : 'None loaded'}
          </Text>
          <Text style={styles.mutedText}>
            Vehicle: {profile?.providerProfile?.vehicleInfo
              ? `${profile.providerProfile.vehicleInfo.year} ${profile.providerProfile.vehicleInfo.make} ${profile.providerProfile.vehicleInfo.model} ${profile.providerProfile.vehicleInfo.color}`
              : 'No provider vehicle loaded'}
          </Text>
          <Button
            label="Refresh Provider Queue"
            onPress={() => loadRequestQueue().catch((error) => setErrorMessage(error.message))}
            kind="secondary"
          />
          <Text style={styles.mutedText}>Provider monthly fee: {formatMoney(profile?.providerMonthly || 5.99)}</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Provider Dispatch Screen</Text>
          <Text style={styles.mutedText}>
            Dispatch actions are routed to the protected backend. ETA, contact, arrived, and completed depend on provider session authority.
          </Text>
          {requests.length === 0 ? (
            <Text style={styles.mutedText}>No request queue loaded.</Text>
          ) : (
            requests.map((request) => {
              const local = providerActions[request.requestId || request.id] || {};
              const requestId = request.requestId || request.id;
              return (
                <View key={requestId} style={styles.queueCard}>
                  <Text style={styles.queueTitle}>{request.serviceType} · {request.fullName}</Text>
                  <Text style={styles.mutedText}>{request.location}</Text>
                  <Text style={styles.mutedText}>Phone: {request.phoneNumber}</Text>
                  <Text style={styles.mutedText}>Current status: {request.status}</Text>
                  <Text style={styles.mutedText}>ETA minutes: {request.etaMinutes ?? 'Not set'}</Text>
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
            })
          )}
        </View>
      </ScrollView>
    );
  }

  function renderAdminScreen() {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Admin Sign In</Text>
          <InputField label="Admin Email" autoCapitalize="none" value={adminSignin.email} onChangeText={(value) => setAdminSignin((current) => ({ ...current, email: value }))} />
          <InputField label="Password" secureTextEntry value={adminSignin.password} onChangeText={(value) => setAdminSignin((current) => ({ ...current, password: value }))} />
          <InputField label="Location Zone" value={adminSignin.locationZone} onChangeText={(value) => setAdminSignin((current) => ({ ...current, locationZone: value }))} />
          <InputField label="2FA Code" value={adminSignin.twoFactorCode} onChangeText={(value) => setAdminSignin((current) => ({ ...current, twoFactorCode: value }))} />
          <Button label="Admin Login" onPress={handleAdminSignin} />
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Admin Backend Controls</Text>
          <Text style={styles.mutedText}>Email path: admin@adub.com</Text>
          <Text style={styles.mutedText}>Dashboard status: {adminDashboard ? 'Loaded' : 'Not loaded'}</Text>
          <Text style={styles.mutedText}>Request count: {adminDashboard?.requestCount ?? 0}</Text>
          <Text style={styles.mutedText}>Payment configured: {adminDashboard?.paymentConfigured ? 'Yes' : 'No'}</Text>
          <View style={styles.buttonGrid}>
            <Button label="Refresh Dashboard" onPress={() => loadAdminDashboard().catch((error) => setErrorMessage(error.message))} />
            <Button label="Refresh Security" onPress={() => loadBootstrap().catch((error) => setErrorMessage(error.message))} kind="secondary" />
            <Button label="Admin Logout" onPress={handleAdminLogout} kind="danger" />
          </View>
        </View>
      </ScrollView>
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
          <Text style={styles.mutedText}>
            Optional priority add-on: {formatMoney(frontendConfig?.priorityServicePrice || 25)}
          </Text>
          <Text style={styles.mutedText}>Compatibility manifest: {frontendConfig?.compatibilityManifestUrl || 'Unavailable'}</Text>
          <Text style={styles.mutedText}>Compatibility repository: {frontendConfig?.compatibilityRepositoryUrl || 'Unavailable'}</Text>
        </View>
      </ScrollView>
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
                <Text style={[styles.pillLabel, active ? styles.pillLabelActive : null]}>{service}</Text>
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
          <Text style={styles.headerMeta}>Mobile rebuild from cloud graphics and backend rules.</Text>
        </View>
        <View style={styles.headerActions}>
          {auth?.sessionToken ? <Button label="Logout" onPress={handleUserLogout} kind="secondary" /> : null}
          {loading ? <ActivityIndicator color={theme.colors.gold} /> : null}
        </View>
      </View>

      <View style={styles.navBar}>
        {navItems.map((item) => (
          <Pressable key={item.id} style={[styles.navPill, screen === item.id ? styles.navPillActive : null]} onPress={() => setScreen(item.id)}>
            <Text style={[styles.navPillLabel, screen === item.id ? styles.navPillLabelActive : null]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      {statusMessage ? <Text style={styles.successBanner}>{statusMessage}</Text> : null}
      {errorMessage ? <Text style={styles.errorBanner}>{errorMessage}</Text> : null}

      {renderScreen()}
    </SafeAreaView>
  );
}

function formatMoney(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(numeric);
}

function labelProviderAction(action) {
  if (action === 'soft-contact') {
    return 'Soft contact';
  }
  if (action === 'hard-contact') {
    return 'Hard contact';
  }
  if (action === 'eta') {
    return 'ETA';
  }
  return String(action || 'Provider action')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (value) => value.toUpperCase());
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
  dualGrid: {
    gap: theme.spacing.md,
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
});
