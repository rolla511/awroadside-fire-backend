import React, { useEffect, useState } from 'react';
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

const homeArt = require('./assets/images/roadside-home.png');
const subscriberArt = require('./assets/images/roadside-subscriber.png');

const DEFAULT_ENV_BASE_URL =
  typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_BASE_URL?.trim?.() || '' : '';
const RECORDED_RUNTIME_URL = DEFAULT_ENV_BASE_URL || 'https://awroadside-fire-backend-1.onrender.com';

const PRIMARY_SCREENS = [
  { id: 'home', label: 'Home' },
  { id: 'request', label: 'Request' },
  { id: 'provider', label: 'Provider' },
  { id: 'account', label: 'Account' },
];

const SERVICE_OPTIONS = [
  { id: 'Jump Start', detail: 'Battery restart with provider dispatch.' },
  { id: 'Lockout', detail: 'Vehicle entry support with damage awareness.' },
  { id: 'Tire Change', detail: 'Roadside tire change or swap support.' },
  { id: 'Gas Delivery', detail: 'Fuel delivery dispatch and arrival tracking.' },
  { id: 'Battery Install', detail: 'Battery replacement after backend quote.' },
];

const PROVIDER_ACTIONS = [
  { id: 'accept', label: 'Accept' },
  { id: 'eta', label: 'ETA 25m' },
  { id: 'soft-contact', label: 'Soft ETA' },
  { id: 'hard-contact', label: 'Hard ETA' },
  { id: 'arrived', label: 'Arrived' },
  { id: 'completed', label: 'Complete' },
];

const PROVIDER_SERVICES = ['LOCKOUT', 'JUMP_START', 'TIRE', 'FUEL', 'BATTERY'];

const PROVIDER_QUESTIONS = [
  { id: 'jumpstartProcedure', label: 'How do you safely perform a jumpstart?' },
  { id: 'jackPlacement', label: 'Where do you place a jack on a car?' },
  { id: 'specialtyVehicleJack', label: 'What kind of jack do you use on BMW, van, truck, or Benz platforms?' },
  { id: 'spoolDefinition', label: 'What is a spool?' },
  { id: 'frozenLugNut', label: 'How do you remove a frozen lug nut?' },
  { id: 'lockoutTools', label: 'What tools do you use to perform a lockout?' },
  { id: 'lockoutDamagePrevention', label: 'What is the best way to prevent damage during a lockout?' },
  { id: 'incorrectLockoutDamage', label: 'What damages can happen if a lockout is performed incorrectly?' },
  { id: 'tirePlugKnowledge', label: 'Do you know how to plug a tire?' },
  {
    id: 'severeDamageDecision',
    label:
      'If service can cause severe damage, do you stop and inform the customer or continue anyway?',
  },
];

const initialRequestForm = {
  fullName: '',
  phoneNumber: '',
  serviceType: SERVICE_OPTIONS[0].id,
  location: '',
  notes: '',
  year: '',
  make: '',
  model: '',
  color: '',
};

const initialSigninForm = {
  identifier: '',
  password: '',
};

const initialSubscriberForm = {
  fullName: '',
  phoneNumber: '',
  username: '',
  email: '',
  password: '',
  year: '',
  make: '',
  model: '',
  color: '',
  paymentMethodMasked: '',
  billingZip: '',
  subscriberTermsAccepted: true,
  dispatchOnlyLiabilityAccepted: true,
  noRefundPolicyAccepted: true,
};

const initialProviderForm = {
  fullName: '',
  phoneNumber: '',
  username: '',
  email: '',
  password: '',
  companyName: '',
  year: '',
  make: '',
  model: '',
  color: '',
  experience: '',
  serviceArea: '',
  currentLocation: '',
  mondayHours: '08:00-18:00',
  tuesdayHours: '08:00-18:00',
  equipment: 'air wedge, long reach, floor jack',
  licenseNumber: '',
  registrationNumber: '',
  insuranceNumber: '',
  helperIdNumber: '',
  providerTermsAccepted: true,
  providerLiabilityAccepted: true,
  assessmentAnswers: Object.fromEntries(PROVIDER_QUESTIONS.map((item) => [item.id, ''])),
};

const initialAdminForm = {
  email: 'admin@adub.com',
  password: '',
  locationZone: 'HOME_BASE',
  twoFactorCode: '',
};

export default function App() {
  const [screen, setScreen] = useState('home');
  const [accountView, setAccountView] = useState('signin');
  const [providerView, setProviderView] = useState('signin');
  const [requestView, setRequestView] = useState('compose');
  const [apiBaseUrl, setApiBaseUrl] = useState(RECORDED_RUNTIME_URL);
  const [runtimeDraft, setRuntimeDraft] = useState(RECORDED_RUNTIME_URL);
  const [systemOpen, setSystemOpen] = useState(false);
  const [systemTapCount, setSystemTapCount] = useState(0);
  const [boot, setBoot] = useState({
    loading: false,
    error: '',
    health: null,
    config: null,
    payment: null,
    security: null,
  });
  const [auth, setAuth] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [adminDashboard, setAdminDashboard] = useState(null);
  const [latestRequest, setLatestRequest] = useState(null);
  const [providerQueue, setProviderQueue] = useState([]);
  const [serviceQuote, setServiceQuote] = useState(null);
  const [serviceQuoteAccepted, setServiceQuoteAccepted] = useState(false);
  const [requestForm, setRequestForm] = useState(initialRequestForm);
  const [memberSignin, setMemberSignin] = useState(initialSigninForm);
  const [providerSignin, setProviderSignin] = useState(initialSigninForm);
  const [subscriberForm, setSubscriberForm] = useState(initialSubscriberForm);
  const [providerForm, setProviderForm] = useState(initialProviderForm);
  const [adminForm, setAdminForm] = useState(initialAdminForm);
  const [messages, setMessages] = useState({});
  const [busy, setBusy] = useState({});

  useEffect(() => {
    refreshRuntime();
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!auth?.roles?.includes('SUBSCRIBER')) {
      return;
    }
    setRequestForm((current) => hydrateRequestFromProfile(current, auth));
  }, [auth?.userId, auth?.subscriberActive]);

  const api = () =>
    createApiClient({
      baseUrl: apiBaseUrl,
      getToken: () => auth?.sessionToken || null,
    });

  function setMessage(key, value) {
    setMessages((current) => ({ ...current, [key]: value }));
  }

  function setBusyState(key, value) {
    setBusy((current) => ({ ...current, [key]: value }));
  }

  function revealSystem() {
    setSystemTapCount((current) => {
      const next = current + 1;
      if (next >= 6) {
        setSystemOpen((open) => !open);
        return 0;
      }
      return next;
    });
  }

  async function refreshRuntime() {
    if (!apiBaseUrl) {
      setBoot((current) => ({ ...current, error: 'Backend URL is not set.', loading: false }));
      return;
    }

    setBoot((current) => ({ ...current, loading: true, error: '' }));
    try {
      const client = api();
      const [health, config, payment, security] = await Promise.all([
        client.getHealth(),
        client.getFrontendConfig(),
        client.getPaymentConfig(),
        client.getSecurityStatus(),
      ]);
      setBoot({
        loading: false,
        error: '',
        health,
        config,
        payment,
        security,
      });
    } catch (error) {
      setBoot((current) => ({
        ...current,
        loading: false,
        error: error.message,
      }));
    }
  }

  async function hydrateProfile(tokenOverride = null) {
    const token = tokenOverride || auth?.sessionToken;
    if (!token) {
      return null;
    }
    const profile = await api().getProfile(token);
    setAuth((current) => ({
      ...(current || {}),
      ...profile,
      roles: profile.roles || current?.roles || [],
      sessionToken: token,
    }));
    return profile;
  }

  function signOutUser() {
    setAuth(null);
    setLatestRequest(null);
    setServiceQuote(null);
    setServiceQuoteAccepted(false);
    setProviderQueue([]);
    setRequestView('compose');
    setAccountView('signin');
    setProviderView('signin');
    setScreen('home');
    setMessage('account', 'Signed out.');
  }

  async function handleMemberSignin() {
    setBusyState('memberSignin', true);
    setMessage('memberSignin', '');
    try {
      const payload = await api().login(memberSignin);
      setAuth({
        ...payload,
        roles: payload.roles || [],
        sessionToken: payload.sessionToken || null,
      });
      await hydrateProfile(payload.sessionToken || null);
      setScreen('account');
      setAccountView('profile');
      setMessage('memberSignin', 'Member signed in.');
    } catch (error) {
      setMessage('memberSignin', error.message);
    } finally {
      setBusyState('memberSignin', false);
    }
  }

  async function handleProviderSignin() {
    setBusyState('providerSignin', true);
    setMessage('providerSignin', '');
    try {
      const payload = await api().login(providerSignin);
      setAuth({
        ...payload,
        roles: payload.roles || [],
        sessionToken: payload.sessionToken || null,
      });
      await hydrateProfile(payload.sessionToken || null);
      setScreen('provider');
      setProviderView('dispatch');
      setMessage('providerSignin', 'Provider signed in.');
      await handleProviderQueue(payload.sessionToken || null);
    } catch (error) {
      setMessage('providerSignin', error.message);
    } finally {
      setBusyState('providerSignin', false);
    }
  }

  async function handleSubscriberSignup() {
    setBusyState('subscriberSignup', true);
    setMessage('subscriberSignup', '');
    try {
      const signup = await api().signup({
        fullName: subscriberForm.fullName,
        phoneNumber: subscriberForm.phoneNumber,
        username: subscriberForm.username,
        email: subscriberForm.email,
        password: subscriberForm.password,
        role: 'SUBSCRIBER',
        termsAccepted: true,
        subscriberTermsAccepted: subscriberForm.subscriberTermsAccepted,
      });

      await api().setupSubscriber(
        {
          vehicle: {
            year: subscriberForm.year,
            make: subscriberForm.make,
            model: subscriberForm.model,
            color: subscriberForm.color,
          },
          paymentMethodMasked: subscriberForm.paymentMethodMasked || '****1111',
          paymentProvider: 'paypal',
          billingZip: subscriberForm.billingZip,
          subscriberTermsAccepted: subscriberForm.subscriberTermsAccepted,
          dispatchOnlyLiabilityAccepted: subscriberForm.dispatchOnlyLiabilityAccepted,
          noRefundPolicyAccepted: subscriberForm.noRefundPolicyAccepted,
        },
        signup.sessionToken || null
      );

      setAuth({
        ...signup,
        roles: signup.roles || ['SUBSCRIBER'],
        subscriberActive: true,
        sessionToken: signup.sessionToken || null,
      });
      await hydrateProfile(signup.sessionToken || null);
      setScreen('account');
      setAccountView('profile');
      setMessage('subscriberSignup', 'Subscriber membership activated.');
    } catch (error) {
      setMessage('subscriberSignup', error.message);
    } finally {
      setBusyState('subscriberSignup', false);
    }
  }

  async function handleProviderSignup() {
    setBusyState('providerSignup', true);
    setMessage('providerSignup', '');
    try {
      const signup = await api().signup({
        fullName: providerForm.fullName,
        phoneNumber: providerForm.phoneNumber,
        username: providerForm.username,
        email: providerForm.email,
        password: providerForm.password,
        role: 'PROVIDER',
        termsAccepted: true,
        providerTermsAccepted: providerForm.providerTermsAccepted,
        providerLiabilityAccepted: providerForm.providerLiabilityAccepted,
      });

      await api().uploadProviderDocuments(
        {
          documents: buildProviderDocumentsPayload(providerForm),
        },
        signup.sessionToken || null
      );

      const payload = await api().applyProvider(
        {
          providerTermsAccepted: providerForm.providerTermsAccepted,
          providerLiabilityAccepted: providerForm.providerLiabilityAccepted,
          providerInfo: {
            legalName: providerForm.fullName,
            phoneNumber: providerForm.phoneNumber,
            email: providerForm.email,
            companyName: providerForm.companyName,
          },
          vehicleInfo: {
            year: providerForm.year,
            make: providerForm.make,
            model: providerForm.model,
            color: providerForm.color,
          },
          experience: providerForm.experience,
          serviceArea: providerForm.serviceArea,
          currentLocation: providerForm.currentLocation,
          hoursOfService: {
            timezone: 'America/New_York',
            monday: providerForm.mondayHours,
            tuesday: providerForm.tuesdayHours,
          },
          equipment: splitCsv(providerForm.equipment),
          assessmentAnswers: providerForm.assessmentAnswers,
          services: PROVIDER_SERVICES,
          rates: {
            ratingTotal: 0,
            ratingCount: 0,
          },
        },
        signup.sessionToken || null
      );

      setAuth({
        ...signup,
        roles: signup.roles || ['PROVIDER'],
        providerStatus: payload.providerStatus || 'PENDING_APPROVAL',
        sessionToken: signup.sessionToken || null,
      });
      await hydrateProfile(signup.sessionToken || null);
      setScreen('provider');
      setProviderView('application');
      setMessage('providerSignup', 'Provider profile submitted for approval.');
    } catch (error) {
      setMessage('providerSignup', error.message);
    } finally {
      setBusyState('providerSignup', false);
    }
  }

  async function submitRequest() {
    setBusyState('requestSubmit', true);
    setMessage('requestSubmit', '');
    try {
      const payload = await api().createRequest(
        {
          userId: auth?.userId || null,
          roles: auth?.roles || [],
          subscriberActive: Boolean(auth?.subscriberActive),
          fullName: requestForm.fullName,
          phoneNumber: requestForm.phoneNumber,
          serviceType: requestForm.serviceType,
          location: requestForm.location,
          notes: requestForm.notes,
          vehicleInfo: {
            year: requestForm.year,
            make: requestForm.make,
            model: requestForm.model,
            color: requestForm.color,
          },
          termsAccepted: true,
          dispatchOnlyLiabilityAccepted: true,
          noRefundPolicyAccepted: true,
        },
        auth?.sessionToken || null
      );

      const request = payload.request || payload;
      setLatestRequest(request);
      setServiceQuote(null);
      setServiceQuoteAccepted(false);
      setRequestView('status');
      setScreen('request');
      setMessage(
        'requestSubmit',
        `Request ${request.requestId || request.id || ''} submitted. Waiting for provider acceptance.`
      );
    } catch (error) {
      setMessage('requestSubmit', error.message);
    } finally {
      setBusyState('requestSubmit', false);
    }
  }

  async function handleAcceptEta() {
    if (!latestRequest?.requestId && !latestRequest?.id) {
      setMessage('requestStatus', 'No request loaded.');
      return;
    }
    setBusyState('acceptEta', true);
    setMessage('requestStatus', '');
    try {
      const requestId = latestRequest.requestId || latestRequest.id;
      const payload = await api().applyProviderAction(
        requestId,
        'subscriber-accept-eta',
        { userId: auth?.userId || null, actorRole: 'SUBSCRIBER' },
        auth?.sessionToken || null
      );
      const request = payload.request || latestRequest;
      setLatestRequest(request);
      setRequestView('payment');
      setMessage('requestStatus', 'ETA accepted. You can now review the backend service quote.');
    } catch (error) {
      setMessage('requestStatus', error.message);
    } finally {
      setBusyState('acceptEta', false);
    }
  }

  async function handleArrivalConfirm() {
    await runCustomerAction('confirm-arrived', 'Arrival confirmed.');
  }

  async function handleCompletionConfirm() {
    await runCustomerAction('confirm-completion', 'Completion confirmed.');
  }

  async function runCustomerAction(action, successMessage) {
    if (!latestRequest?.requestId && !latestRequest?.id) {
      setMessage('requestStatus', 'No request loaded.');
      return;
    }
    setBusyState(action, true);
    setMessage('requestStatus', '');
    try {
      const requestId = latestRequest.requestId || latestRequest.id;
      const payload = await api().applyProviderAction(
        requestId,
        action,
        { userId: auth?.userId || null, actorRole: 'SUBSCRIBER' },
        auth?.sessionToken || null
      );
      setLatestRequest(payload.request || latestRequest);
      setMessage('requestStatus', successMessage);
    } catch (error) {
      setMessage('requestStatus', error.message);
    } finally {
      setBusyState(action, false);
    }
  }

  async function handleLoadQuote() {
    if (!latestRequest?.requestId && !latestRequest?.id) {
      setMessage('quote', 'Submit a request first.');
      return;
    }
    setBusyState('quote', true);
    setMessage('quote', '');
    try {
      const payload = await api().getServicePaymentQuote(
        { requestId: latestRequest.requestId || latestRequest.id },
        auth?.sessionToken || null
      );
      setServiceQuote(payload);
      setServiceQuoteAccepted(false);
      setMessage('quote', `Quote ready for ${payload.amount?.value || '--'} ${payload.amount?.currency_code || 'USD'}.`);
    } catch (error) {
      setMessage('quote', error.message);
    } finally {
      setBusyState('quote', false);
    }
  }

  async function handleCreateServiceOrder() {
    if (!serviceQuote) {
      setMessage('quote', 'Load the backend quote first.');
      return;
    }
    if (!serviceQuoteAccepted) {
      setMessage('quote', 'Acknowledge the backend quote before payment.');
      return;
    }
    setBusyState('serviceOrder', true);
    setMessage('quote', '');
    try {
      const payload = await api().createPaypalOrder(
        {
          paymentKind: 'service',
          requestId: serviceQuote.requestId,
          quoteId: serviceQuote.quoteId,
          quoteAccepted: true,
        },
        auth?.sessionToken || null
      );
      setMessage('quote', `Payment order created: ${payload.orderId}.`);
    } catch (error) {
      setMessage('quote', error.message);
    } finally {
      setBusyState('serviceOrder', false);
    }
  }

  async function handleProviderQueue(tokenOverride = null) {
    setBusyState('providerQueue', true);
    setMessage('providerQueue', '');
    try {
      const payload = await api().listRequests(tokenOverride || auth?.sessionToken || null);
      const requests = Array.isArray(payload.requests) ? payload.requests : [];
      setProviderQueue(requests);
      setMessage('providerQueue', `${requests.length} request(s) in queue.`);
    } catch (error) {
      setMessage('providerQueue', error.message);
    } finally {
      setBusyState('providerQueue', false);
    }
  }

  async function handleProviderAction(requestId, action) {
    setBusyState(`provider-${requestId}-${action}`, true);
    setMessage('providerQueue', '');
    try {
      const payload = buildProviderActionPayload(action);
      const response = await api().applyProviderAction(
        requestId,
        action,
        payload,
        auth?.sessionToken || null
      );
      setMessage(
        'providerQueue',
        response.committed === false
          ? `${formatActionLabel(action)} accepted as pending backend work.`
          : `${formatActionLabel(action)} committed to the request.`
      );
      await handleProviderQueue();
    } catch (error) {
      setMessage('providerQueue', error.message);
    } finally {
      setBusyState(`provider-${requestId}-${action}`, false);
    }
  }

  async function handleAdminLogin() {
    setBusyState('adminLogin', true);
    setMessage('adminLogin', '');
    try {
      const payload = await api().adminLogin(adminForm);
      setAdmin({
        token: payload.token || null,
        locationZone: adminForm.locationZone || null,
        roles: payload.roles || [],
        twoFactorVerified: Boolean(payload.twoFactorVerified),
      });
      setMessage('adminLogin', payload.twoFactorRequired ? payload.message : 'Admin session ready.');
      if (payload.token) {
        await handleAdminDashboard(payload.token, adminForm.locationZone || null, Boolean(payload.twoFactorVerified));
      }
    } catch (error) {
      setMessage('adminLogin', error.message);
    } finally {
      setBusyState('adminLogin', false);
    }
  }

  async function handleAdminDashboard(
    token = admin?.token || null,
    locationZone = admin?.locationZone || null,
    twoFactorVerified = admin?.twoFactorVerified || false
  ) {
    if (!token) {
      return;
    }
    setBusyState('adminDashboard', true);
    setMessage('adminDashboard', '');
    try {
      const payload = await api().getAdminDashboard(token, {
        ...(locationZone ? { 'x-location-zone': locationZone } : {}),
        ...(twoFactorVerified ? { 'x-2fa-verified': 'true' } : {}),
      });
      setAdminDashboard(payload);
    } catch (error) {
      setMessage('adminDashboard', error.message);
    } finally {
      setBusyState('adminDashboard', false);
    }
  }

  function renderHome() {
    return (
      <>
        <HeroPanel
          title="Roadside help with a clear path."
          copy="Request service, manage membership, or work provider dispatch without fighting through mixed screens or hidden steps."
          onPrimary={() => {
            setScreen('request');
            setRequestView('compose');
          }}
          onSecondary={() => {
            setScreen('account');
            setAccountView(auth?.sessionToken ? 'profile' : 'join');
          }}
        />

        <MetricsRow
          items={[
            {
              label: 'Dispatch',
              value: boot.health?.status?.toUpperCase() || 'OFF',
              detail: boot.config?.securityLayer || 'Protected backend',
            },
            {
              label: 'Priority',
              value: formatUsd(boot.config?.priorityServicePrice || 25),
              detail: 'Guest request entry point',
            },
            {
              label: 'Membership',
              value: formatUsd(boot.payment?.subscriberMonthlyFee || 5),
              detail: 'Subscriber monthly fee',
            },
          ]}
        />

        <Section
          title="Choose Your Path"
          subtitle="Each path leads somewhere specific so the app feels usable from the first screen."
        >
          <View style={styles.pathGrid}>
            <JourneyTile
              eyebrow="Guest"
              title="Request help now"
              detail="Guest roadside request with dispatch-only platform liability."
              onPress={() => {
                setScreen('request');
                setRequestView('compose');
              }}
            />
            <JourneyTile
              eyebrow="Subscriber"
              title="Member access"
              detail="Join, sign in, accept ETA, and manage service from one member path."
              onPress={() => {
                setScreen('account');
                setAccountView(auth?.sessionToken ? 'profile' : 'join');
              }}
            />
            <JourneyTile
              eyebrow="Provider"
              title="Provider work"
              detail="Application, verification, queue, and service log separated from customer screens."
              onPress={() => {
                setScreen('provider');
                setProviderView(auth?.roles?.includes('PROVIDER') ? 'dispatch' : 'apply');
              }}
            />
          </View>
        </Section>

        <Section
          title="Quick Guest Request"
          subtitle="This stays lightweight on the home screen, then opens the full request journey."
        >
          <ServicePicker
            selected={requestForm.serviceType}
            onSelect={(serviceType) => setRequestForm((current) => ({ ...current, serviceType }))}
          />
          <InputField
            label="Full Name"
            value={requestForm.fullName}
            onChangeText={(value) => setRequestForm((current) => ({ ...current, fullName: value }))}
          />
          <TwoColumnFields
            left={
              <InputField
                label="Phone Number"
                value={requestForm.phoneNumber}
                onChangeText={(value) => setRequestForm((current) => ({ ...current, phoneNumber: value }))}
              />
            }
            right={
              <InputField
                label="Location"
                value={requestForm.location}
                onChangeText={(value) => setRequestForm((current) => ({ ...current, location: value }))}
              />
            }
          />
          <Button
            label="Open Full Request Flow"
            onPress={() => {
              setScreen('request');
              setRequestView('compose');
            }}
          />
        </Section>
      </>
    );
  }

  function renderRequest() {
    const isSubscriber = auth?.roles?.includes('SUBSCRIBER');
    const currentRequest = latestRequest;
    const hasEta = Number.isFinite(Number(currentRequest?.etaMinutes));
    const canConfirmArrival = currentRequest?.status === 'ARRIVED' && !currentRequest?.arrivalConfirmedAt;
    const canConfirmCompletion = currentRequest?.status === 'COMPLETED' && !currentRequest?.completionConfirmedAt;

    return (
      <>
        <Section
          title="Request Journey"
          subtitle="Compose the request, follow backend status, accept ETA, then move into payment and confirmation."
        >
          <StageRail
            value={requestView}
            items={[
              { id: 'compose', label: 'Compose' },
              { id: 'status', label: 'Status' },
              { id: 'payment', label: 'Payment' },
            ]}
            onSelect={setRequestView}
          />
        </Section>

        {requestView === 'compose' ? (
          <Section
            title="Request Details"
            subtitle={
              isSubscriber
                ? 'Subscriber request with membership pricing and backend quote flow.'
                : 'Guest request with dispatch-only platform liability and service charge.'
            }
          >
            <ServicePicker
              selected={requestForm.serviceType}
              onSelect={(serviceType) => setRequestForm((current) => ({ ...current, serviceType }))}
            />
            <InputField
              label="Full Name"
              value={requestForm.fullName}
              onChangeText={(value) => setRequestForm((current) => ({ ...current, fullName: value }))}
            />
            <TwoColumnFields
              left={
                <InputField
                  label="Phone Number"
                  value={requestForm.phoneNumber}
                  onChangeText={(value) => setRequestForm((current) => ({ ...current, phoneNumber: value }))}
                />
              }
              right={
                <InputField
                  label="Location"
                  value={requestForm.location}
                  onChangeText={(value) => setRequestForm((current) => ({ ...current, location: value }))}
                />
              }
            />
            <TwoColumnFields
              left={
                <InputField
                  label="Vehicle Year"
                  value={requestForm.year}
                  onChangeText={(value) => setRequestForm((current) => ({ ...current, year: value }))}
                />
              }
              right={
                <InputField
                  label="Vehicle Make"
                  value={requestForm.make}
                  onChangeText={(value) => setRequestForm((current) => ({ ...current, make: value }))}
                />
              }
            />
            <TwoColumnFields
              left={
                <InputField
                  label="Vehicle Model"
                  value={requestForm.model}
                  onChangeText={(value) => setRequestForm((current) => ({ ...current, model: value }))}
                />
              }
              right={
                <InputField
                  label="Vehicle Color"
                  value={requestForm.color}
                  onChangeText={(value) => setRequestForm((current) => ({ ...current, color: value }))}
                />
              }
            />
            <InputField
              label="Notes"
              multiline
              value={requestForm.notes}
              onChangeText={(value) => setRequestForm((current) => ({ ...current, notes: value }))}
            />
            <PolicyBox
              title="Dispatch Terms"
              body="AW Roadside manages the dispatch transaction. Independent providers remain responsible for their actual roadside services, and the no-refund policy applies once payment is submitted."
            />
            <Button
              label={busy.requestSubmit ? 'Submitting...' : isSubscriber ? 'Submit Subscriber Request' : 'Submit Guest Request'}
              onPress={submitRequest}
            />
            <Message text={messages.requestSubmit} success={messages.requestSubmit?.includes('submitted')} />
          </Section>
        ) : null}

        {requestView !== 'compose' ? (
          <>
            <Section title="Current Status" subtitle="Track the request, provider ETA, and confirmation steps from one clean status view.">
              <RequestStatusCard request={currentRequest} />
              <Message text={messages.requestStatus} success={messages.requestStatus?.includes('confirmed') || messages.requestStatus?.includes('accepted')} />
              <View style={styles.inlineButtonStack}>
                {isSubscriber && hasEta && !currentRequest?.customerEtaAcceptedAt ? (
                  <Button
                    label={busy.acceptEta ? 'Accepting ETA...' : 'Accept ETA'}
                    onPress={handleAcceptEta}
                  />
                ) : null}
                {canConfirmArrival ? (
                  <Button
                    label={busy['confirm-arrived'] ? 'Confirming...' : 'Confirm Arrival'}
                    kind="secondary"
                    onPress={handleArrivalConfirm}
                  />
                ) : null}
                {canConfirmCompletion ? (
                  <Button
                    label={busy['confirm-completion'] ? 'Confirming...' : 'Confirm Completion'}
                    kind="secondary"
                    onPress={handleCompletionConfirm}
                  />
                ) : null}
              </View>
            </Section>

            <Section
              title="Payment and Quote"
              subtitle="The backend controls when quote and payment are available. The app should make that progression obvious."
            >
              <View style={styles.inlineButtonStack}>
                <Button
                  label={busy.quote ? 'Loading Quote...' : 'Load Backend Quote'}
                  onPress={handleLoadQuote}
                />
                <Button
                  label={serviceQuoteAccepted ? 'Quote Accepted' : 'Acknowledge Quote'}
                  kind="secondary"
                  onPress={() => {
                    if (!serviceQuote) {
                      setMessage('quote', 'Load a backend quote first.');
                      return;
                    }
                    setServiceQuoteAccepted(true);
                    setMessage('quote', 'Backend quote acknowledged in the app.');
                  }}
                />
                <Button
                  label={busy.serviceOrder ? 'Creating Order...' : 'Create Payment Order'}
                  kind="secondary"
                  onPress={handleCreateServiceOrder}
                />
              </View>
              <Message
                text={messages.quote || (!boot.payment?.enabled ? 'PayPal is not configured on the backend yet.' : '')}
                success={messages.quote?.includes('Quote ready') || messages.quote?.includes('acknowledged') || messages.quote?.includes('created')}
              />
              <KeyValueList
                rows={[
                  ['Quote ID', serviceQuote?.quoteId || '--'],
                  ['Amount', serviceQuote ? `${serviceQuote.amount?.value || '--'} ${serviceQuote.amount?.currency_code || 'USD'}` : '--'],
                  ['Status', serviceQuote?.status || '--'],
                  ['ETA Accepted', currentRequest?.customerEtaAcceptedAt ? 'Yes' : 'No'],
                  ['No Refund Policy', boot.payment?.noRefundPolicy ? 'Active' : 'Unavailable'],
                ]}
              />
            </Section>
          </>
        ) : null}
      </>
    );
  }

  function renderProvider() {
    const providerSignedIn = auth?.roles?.includes('PROVIDER');

    return (
      <>
        <Section
          title="Provider Journey"
          subtitle="Application, approval, dispatch, and service logging belong in one provider-specific flow."
        >
          <StageRail
            value={providerView}
            items={
              providerSignedIn
                ? [
                    { id: 'dispatch', label: 'Dispatch' },
                    { id: 'log', label: 'Service Log' },
                  ]
                : [
                    { id: 'signin', label: 'Sign In' },
                    { id: 'apply', label: 'Apply' },
                  ]
            }
            onSelect={setProviderView}
          />
        </Section>

        {!providerSignedIn && providerView === 'signin' ? (
          <Section title="Provider Sign In" subtitle="Provider entry should be clean, not merged into customer account setup.">
            <InputField
              label="Username or Email"
              autoCapitalize="none"
              autoCorrect={false}
              value={providerSignin.identifier}
              onChangeText={(value) => setProviderSignin((current) => ({ ...current, identifier: value }))}
            />
            <InputField
              label="Password"
              secureTextEntry
              value={providerSignin.password}
              onChangeText={(value) => setProviderSignin((current) => ({ ...current, password: value }))}
            />
            <Button label={busy.providerSignin ? 'Signing In...' : 'Provider Sign In'} onPress={handleProviderSignin} />
            <Message text={messages.providerSignin} success={messages.providerSignin === 'Provider signed in.'} />
          </Section>
        ) : null}

        {!providerSignedIn && providerView === 'apply' ? (
          <>
            <Section
              title="Provider Profile"
              subtitle="This is the real onboarding path: identity, vehicle, service area, hours, document upload markers, and safety answers."
            >
              <Image source={subscriberArt} style={styles.sideImage} resizeMode="cover" />
              <InputField
                label="Full Name"
                value={providerForm.fullName}
                onChangeText={(value) => setProviderForm((current) => ({ ...current, fullName: value }))}
              />
              <TwoColumnFields
                left={
                  <InputField
                    label="Phone Number"
                    value={providerForm.phoneNumber}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, phoneNumber: value }))}
                  />
                }
                right={
                  <InputField
                    label="Company"
                    value={providerForm.companyName}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, companyName: value }))}
                  />
                }
              />
              <TwoColumnFields
                left={
                  <InputField
                    label="Username"
                    autoCapitalize="none"
                    value={providerForm.username}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, username: value }))}
                  />
                }
                right={
                  <InputField
                    label="Email"
                    autoCapitalize="none"
                    value={providerForm.email}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, email: value }))}
                  />
                }
              />
              <InputField
                label="Password"
                secureTextEntry
                value={providerForm.password}
                onChangeText={(value) => setProviderForm((current) => ({ ...current, password: value }))}
              />
              <TwoColumnFields
                left={
                  <InputField
                    label="Vehicle Year"
                    value={providerForm.year}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, year: value }))}
                  />
                }
                right={
                  <InputField
                    label="Vehicle Make"
                    value={providerForm.make}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, make: value }))}
                  />
                }
              />
              <TwoColumnFields
                left={
                  <InputField
                    label="Vehicle Model"
                    value={providerForm.model}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, model: value }))}
                  />
                }
                right={
                  <InputField
                    label="Vehicle Color"
                    value={providerForm.color}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, color: value }))}
                  />
                }
              />
              <InputField
                label="Service Area"
                value={providerForm.serviceArea}
                onChangeText={(value) => setProviderForm((current) => ({ ...current, serviceArea: value }))}
              />
              <TwoColumnFields
                left={
                  <InputField
                    label="Current Location"
                    value={providerForm.currentLocation}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, currentLocation: value }))}
                  />
                }
                right={
                  <InputField
                    label="Equipment"
                    value={providerForm.equipment}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, equipment: value }))}
                  />
                }
              />
              <TwoColumnFields
                left={
                  <InputField
                    label="Monday Hours"
                    value={providerForm.mondayHours}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, mondayHours: value }))}
                  />
                }
                right={
                  <InputField
                    label="Tuesday Hours"
                    value={providerForm.tuesdayHours}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, tuesdayHours: value }))}
                  />
                }
              />
              <InputField
                label="Experience"
                multiline
                value={providerForm.experience}
                onChangeText={(value) => setProviderForm((current) => ({ ...current, experience: value }))}
              />
            </Section>

            <Section title="Document Markers" subtitle="These values are written into `.txt` upload records for backend verification.">
              <InputField
                label="License Number"
                value={providerForm.licenseNumber}
                onChangeText={(value) => setProviderForm((current) => ({ ...current, licenseNumber: value }))}
              />
              <TwoColumnFields
                left={
                  <InputField
                    label="Registration Number"
                    value={providerForm.registrationNumber}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, registrationNumber: value }))}
                  />
                }
                right={
                  <InputField
                    label="Insurance Number"
                    value={providerForm.insuranceNumber}
                    onChangeText={(value) => setProviderForm((current) => ({ ...current, insuranceNumber: value }))}
                  />
                }
              />
              <InputField
                label="Helper ID Number"
                value={providerForm.helperIdNumber}
                onChangeText={(value) => setProviderForm((current) => ({ ...current, helperIdNumber: value }))}
              />
            </Section>

            <Section
              title="Safety Assessment"
              subtitle="The provider flow should feel serious. These answers drive backend approval readiness."
            >
              {PROVIDER_QUESTIONS.map((question) => (
                <InputField
                  key={question.id}
                  label={question.label}
                  multiline
                  value={providerForm.assessmentAnswers[question.id]}
                  onChangeText={(value) =>
                    setProviderForm((current) => ({
                      ...current,
                      assessmentAnswers: {
                        ...current.assessmentAnswers,
                        [question.id]: value,
                      },
                    }))
                  }
                />
              ))}
              <ToggleRow
                label="Provider terms accepted"
                value={providerForm.providerTermsAccepted}
                onPress={() =>
                  setProviderForm((current) => ({
                    ...current,
                    providerTermsAccepted: !current.providerTermsAccepted,
                  }))
                }
              />
              <ToggleRow
                label="Provider liability accepted"
                value={providerForm.providerLiabilityAccepted}
                onPress={() =>
                  setProviderForm((current) => ({
                    ...current,
                    providerLiabilityAccepted: !current.providerLiabilityAccepted,
                  }))
                }
              />
              <Button label={busy.providerSignup ? 'Submitting...' : 'Submit Provider Application'} onPress={handleProviderSignup} />
              <Message
                text={messages.providerSignup}
                success={messages.providerSignup === 'Provider profile submitted for approval.'}
              />
            </Section>
          </>
        ) : null}

        {providerSignedIn && providerView === 'dispatch' ? (
          <>
            <Section title="Provider Dispatch" subtitle="Queue, current status, and service actions should feel operational.">
              <KeyValueList
                rows={[
                  ['Provider', auth?.fullName || auth?.email || '--'],
                  ['Status', auth?.providerStatus || '--'],
                  ['Service Area', auth?.providerProfile?.serviceArea || '--'],
                  ['Current Location', auth?.providerProfile?.currentLocation || '--'],
                ]}
              />
              <Button label={busy.providerQueue ? 'Refreshing Queue...' : 'Refresh Queue'} onPress={() => handleProviderQueue()} />
              <Message text={messages.providerQueue} success={messages.providerQueue?.includes('request(s)')} />
            </Section>

            {providerQueue.length ? (
              providerQueue.map((entry) => (
                <Section
                  key={entry.requestId || entry.id}
                  title={`${entry.serviceType || 'Service'} · ${entry.fullName || 'Customer'}`}
                  subtitle={`${entry.location || 'No location'} · ${entry.status || 'UNKNOWN'}`}
                >
                  <KeyValueList
                    rows={[
                      ['Vehicle', entry.vehicleInfo || '--'],
                      ['ETA', entry.etaMinutes ? `${entry.etaMinutes} min` : '--'],
                      ['Payment', entry.paymentStatus || '--'],
                    ]}
                  />
                  <View style={styles.chipGrid}>
                    {PROVIDER_ACTIONS.map((action) => (
                      <ActionChip
                        key={action.id}
                        label={action.label}
                        onPress={() => handleProviderAction(entry.requestId || entry.id, action.id)}
                      />
                    ))}
                  </View>
                </Section>
              ))
            ) : (
              <Section title="Queue" subtitle="No requests loaded yet.">
                <Text style={styles.helperText}>
                  Approved providers should see work here after the backend queue populates.
                </Text>
              </Section>
            )}
          </>
        ) : null}

        {providerSignedIn && providerView === 'log' ? (
          <Section title="Service Log" subtitle="Keep completed work, payout details, and service history in one provider-facing record.">
            <KeyValueList
              rows={[
                ['Approved', auth?.providerStatus === 'APPROVED' ? 'Yes' : 'Pending'],
                ['Hours', auth?.providerProfile?.hoursOfService?.days?.monday || '--'],
                ['Equipment', Array.isArray(auth?.providerProfile?.equipment) ? auth.providerProfile.equipment.join(', ') : '--'],
                ['Average Rating', String(auth?.providerRating?.averageRating || auth?.providerProfile?.rates?.averageRating || 0)],
              ]}
            />
            <Text style={styles.helperText}>
              Completed service records, payout calculations, and time/location logs should be rendered here after request completion data is returned by the backend.
            </Text>
          </Section>
        ) : null}
      </>
    );
  }

  function renderAccount() {
    const signedIn = Boolean(auth?.sessionToken);

    return (
      <>
        <Section
          title="Member Journey"
          subtitle="Sign in and join should feel deliberate, not mixed with provider or internal controls."
        >
          <StageRail
            value={signedIn ? 'profile' : accountView}
            items={
              signedIn
                ? [
                    { id: 'profile', label: 'Profile' },
                    { id: 'service', label: 'Service' },
                  ]
                : [
                    { id: 'signin', label: 'Sign In' },
                    { id: 'join', label: 'Join' },
                  ]
            }
            onSelect={setAccountView}
          />
        </Section>

        {!signedIn && accountView === 'signin' ? (
          <Section title="Member Sign In" subtitle="Use your subscriber credentials to return to your request and account flow.">
            <InputField
              label="Username or Email"
              autoCapitalize="none"
              autoCorrect={false}
              value={memberSignin.identifier}
              onChangeText={(value) => setMemberSignin((current) => ({ ...current, identifier: value }))}
            />
            <InputField
              label="Password"
              secureTextEntry
              value={memberSignin.password}
              onChangeText={(value) => setMemberSignin((current) => ({ ...current, password: value }))}
            />
            <Button label={busy.memberSignin ? 'Signing In...' : 'Member Sign In'} onPress={handleMemberSignin} />
            <Message text={messages.memberSignin} success={messages.memberSignin === 'Member signed in.'} />
          </Section>
        ) : null}

        {!signedIn && accountView === 'join' ? (
          <>
            <Section title="Subscriber Membership" subtitle="Subscriber setup should read like a real membership flow.">
              <Image source={subscriberArt} style={styles.sideImage} resizeMode="cover" />
              <InputField
                label="Full Name"
                value={subscriberForm.fullName}
                onChangeText={(value) => setSubscriberForm((current) => ({ ...current, fullName: value }))}
              />
              <TwoColumnFields
                left={
                  <InputField
                    label="Phone Number"
                    value={subscriberForm.phoneNumber}
                    onChangeText={(value) => setSubscriberForm((current) => ({ ...current, phoneNumber: value }))}
                  />
                }
                right={
                  <InputField
                    label="Username"
                    autoCapitalize="none"
                    value={subscriberForm.username}
                    onChangeText={(value) => setSubscriberForm((current) => ({ ...current, username: value }))}
                  />
                }
              />
              <InputField
                label="Email"
                autoCapitalize="none"
                value={subscriberForm.email}
                onChangeText={(value) => setSubscriberForm((current) => ({ ...current, email: value }))}
              />
              <InputField
                label="Password"
                secureTextEntry
                value={subscriberForm.password}
                onChangeText={(value) => setSubscriberForm((current) => ({ ...current, password: value }))}
              />
              <TwoColumnFields
                left={
                  <InputField
                    label="Vehicle Year"
                    value={subscriberForm.year}
                    onChangeText={(value) => setSubscriberForm((current) => ({ ...current, year: value }))}
                  />
                }
                right={
                  <InputField
                    label="Vehicle Make"
                    value={subscriberForm.make}
                    onChangeText={(value) => setSubscriberForm((current) => ({ ...current, make: value }))}
                  />
                }
              />
              <TwoColumnFields
                left={
                  <InputField
                    label="Vehicle Model"
                    value={subscriberForm.model}
                    onChangeText={(value) => setSubscriberForm((current) => ({ ...current, model: value }))}
                  />
                }
                right={
                  <InputField
                    label="Vehicle Color"
                    value={subscriberForm.color}
                    onChangeText={(value) => setSubscriberForm((current) => ({ ...current, color: value }))}
                  />
                }
              />
              <TwoColumnFields
                left={
                  <InputField
                    label="Payment Method"
                    placeholder="****1111"
                    value={subscriberForm.paymentMethodMasked}
                    onChangeText={(value) => setSubscriberForm((current) => ({ ...current, paymentMethodMasked: value }))}
                  />
                }
                right={
                  <InputField
                    label="Billing ZIP"
                    value={subscriberForm.billingZip}
                    onChangeText={(value) => setSubscriberForm((current) => ({ ...current, billingZip: value }))}
                  />
                }
              />
              <PolicyBox
                title={`Subscriber Terms · ${formatUsd(boot.payment?.subscriberMonthlyFee || 5)}/month`}
                body="Platform liability is limited to dispatch management. Independent providers are liable for damages from their own services, and the no-refund policy applies after payment submission."
              />
              <ToggleRow
                label="Subscriber terms accepted"
                value={subscriberForm.subscriberTermsAccepted}
                onPress={() =>
                  setSubscriberForm((current) => ({
                    ...current,
                    subscriberTermsAccepted: !current.subscriberTermsAccepted,
                  }))
                }
              />
              <ToggleRow
                label="Dispatch-only liability accepted"
                value={subscriberForm.dispatchOnlyLiabilityAccepted}
                onPress={() =>
                  setSubscriberForm((current) => ({
                    ...current,
                    dispatchOnlyLiabilityAccepted: !current.dispatchOnlyLiabilityAccepted,
                  }))
                }
              />
              <ToggleRow
                label="No-refund policy accepted"
                value={subscriberForm.noRefundPolicyAccepted}
                onPress={() =>
                  setSubscriberForm((current) => ({
                    ...current,
                    noRefundPolicyAccepted: !current.noRefundPolicyAccepted,
                  }))
                }
              />
              <Button
                label={busy.subscriberSignup ? 'Creating Membership...' : 'Activate Subscriber Membership'}
                onPress={handleSubscriberSignup}
              />
              <Message
                text={messages.subscriberSignup}
                success={messages.subscriberSignup === 'Subscriber membership activated.'}
              />
            </Section>
          </>
        ) : null}

        {signedIn ? (
          <>
            <Section title="Member Profile" subtitle="Signed-in member state, membership details, and stored vehicle data.">
              <KeyValueList
                rows={[
                  ['Member', auth?.fullName || auth?.email || '--'],
                  ['Roles', auth?.roles?.join(' / ') || '--'],
                  ['Membership', auth?.subscriberActive ? 'Active' : 'Inactive'],
                  ['Next Billing', auth?.nextBillingDate || '--'],
                  ['Payment', auth?.subscriberProfile?.paymentInfo?.paymentMethodMasked || auth?.subscriberProfile?.paymentMethodMasked || '--'],
                ]}
              />
              <View style={styles.inlineButtonStack}>
                <Button
                  label="Open Request Journey"
                  onPress={() => {
                    setScreen('request');
                    setRequestView('status');
                  }}
                />
                <Button label="Sign Out" kind="secondary" onPress={signOutUser} />
              </View>
              <Message text={messages.account} success={messages.account === 'Signed out.'} />
            </Section>

            <Section title="Member Service Controls" subtitle="The member flow should move naturally into request status and confirmations.">
              <KeyValueList
                rows={[
                  ['Current Request', latestRequest?.requestId || '--'],
                  ['Service', latestRequest?.serviceType || '--'],
                  ['Status', latestRequest?.status || '--'],
                  ['ETA Accepted', latestRequest?.customerEtaAcceptedAt ? 'Yes' : 'No'],
                ]}
              />
            </Section>
          </>
        ) : null}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.app}>
        <ScrollView contentContainerStyle={styles.content}>
          <Header
            title="AW Roadside"
            subtitle="Mobile assistance"
            role={auth?.roles?.join(' / ') || 'Guest'}
            live={boot.loading ? 'BOOT' : boot.health?.status?.toUpperCase() || 'OFF'}
            onSecretTap={revealSystem}
          />

          {boot.loading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={theme.colors.gold} />
              <Text style={styles.loadingText}>Connecting to roadside service...</Text>
            </View>
          ) : null}

          {boot.error ? <Message text={boot.error} success={false} /> : null}

          {screen === 'home' ? renderHome() : null}
          {screen === 'request' ? renderRequest() : null}
          {screen === 'provider' ? renderProvider() : null}
          {screen === 'account' ? renderAccount() : null}

          {systemOpen ? (
            <HiddenSystemPanel
              runtimeDraft={runtimeDraft}
              setRuntimeDraft={setRuntimeDraft}
              onApplyRuntime={() => setApiBaseUrl(runtimeDraft.trim().replace(/\/$/, ''))}
              onUseRecordedRuntime={() => {
                setRuntimeDraft(RECORDED_RUNTIME_URL);
                setApiBaseUrl(RECORDED_RUNTIME_URL);
              }}
              boot={boot}
              adminForm={adminForm}
              setAdminForm={setAdminForm}
              adminDashboard={adminDashboard}
              busy={busy}
              messages={messages}
              onAdminLogin={handleAdminLogin}
              onAdminDashboard={handleAdminDashboard}
            />
          ) : null}
        </ScrollView>

        <View style={styles.bottomNav}>
          {PRIMARY_SCREENS.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setScreen(item.id)}
              style={[styles.navItem, screen === item.id ? styles.navItemActive : null]}
            >
              <Text style={[styles.navLabel, screen === item.id ? styles.navLabelActive : null]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

function Header({ title, subtitle, role, live, onSecretTap }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Pressable onPress={onSecretTap}>
          <Text style={styles.eyebrow}>AW Roadside Fire</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </Pressable>
      </View>
      <View style={styles.liveBadge}>
        <Text style={styles.liveLabel}>Role</Text>
        <Text style={styles.liveValue}>{role}</Text>
        <Text style={styles.liveState}>{live}</Text>
      </View>
    </View>
  );
}

function HeroPanel({ title, copy, onPrimary, onSecondary }) {
  return (
    <View style={styles.hero}>
      <Image source={homeArt} style={styles.heroImage} resizeMode="cover" />
      <View style={styles.heroOverlay} />
      <View style={styles.heroCopyBlock}>
        <Text style={styles.heroEyebrow}>Protected Dispatch</Text>
        <Text style={styles.heroTitle}>{title}</Text>
        <Text style={styles.heroText}>{copy}</Text>
        <View style={styles.heroButtons}>
          <Button label="Request Help" onPress={onPrimary} />
          <Button label="Member Access" kind="secondary" onPress={onSecondary} />
        </View>
      </View>
    </View>
  );
}

function MetricsRow({ items }) {
  return (
    <View style={styles.metricsRow}>
      {items.map((item) => (
        <View key={item.label} style={styles.metricCard}>
          <Text style={styles.metricLabel}>{item.label}</Text>
          <Text style={styles.metricValue}>{item.value}</Text>
          <Text style={styles.metricDetail}>{item.detail}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function JourneyTile({ eyebrow, title, detail, onPress }) {
  return (
    <Pressable style={styles.journeyTile} onPress={onPress}>
      <Text style={styles.journeyEyebrow}>{eyebrow}</Text>
      <Text style={styles.journeyTitle}>{title}</Text>
      <Text style={styles.journeyDetail}>{detail}</Text>
    </Pressable>
  );
}

function StageRail({ items, value, onSelect }) {
  return (
    <View style={styles.stageRail}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          style={[styles.stagePill, item.id === value ? styles.stagePillActive : null]}
          onPress={() => onSelect(item.id)}
        >
          <Text style={[styles.stageLabel, item.id === value ? styles.stageLabelActive : null]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ServicePicker({ selected, onSelect }) {
  return (
    <View style={styles.serviceGrid}>
      {SERVICE_OPTIONS.map((option) => (
        <ServiceCard
          key={option.id}
          active={selected === option.id}
          label={option.id}
          price=""
          detail={option.detail}
          onPress={() => onSelect(option.id)}
        />
      ))}
    </View>
  );
}

function RequestStatusCard({ request }) {
  return (
    <View style={styles.statusCard}>
      <KeyValueList
        rows={[
          ['Reference', request?.requestId || request?.id || '--'],
          ['Service', request?.serviceType || '--'],
          ['Status', request?.status || '--'],
          ['ETA', request?.etaMinutes ? `${request.etaMinutes} min` : '--'],
          ['Payment', request?.paymentStatus || '--'],
        ]}
      />
    </View>
  );
}

function PolicyBox({ title, body }) {
  return (
    <View style={styles.policyBox}>
      <Text style={styles.policyTitle}>{title}</Text>
      <Text style={styles.policyBody}>{body}</Text>
    </View>
  );
}

function ToggleRow({ label, value, onPress }) {
  return (
    <Pressable style={[styles.toggleRow, value ? styles.toggleRowActive : null]} onPress={onPress}>
      <View style={[styles.toggleDot, value ? styles.toggleDotActive : null]} />
      <Text style={styles.toggleLabel}>{label}</Text>
      <Text style={styles.toggleState}>{value ? 'On' : 'Off'}</Text>
    </Pressable>
  );
}

function ActionChip({ label, onPress }) {
  return (
    <Pressable style={styles.actionChip} onPress={onPress}>
      <Text style={styles.actionChipLabel}>{label}</Text>
    </Pressable>
  );
}

function HiddenSystemPanel({
  runtimeDraft,
  setRuntimeDraft,
  onApplyRuntime,
  onUseRecordedRuntime,
  boot,
  adminForm,
  setAdminForm,
  adminDashboard,
  busy,
  messages,
  onAdminLogin,
  onAdminDashboard,
}) {
  return (
    <Section title="System Controls" subtitle="Hidden runtime and admin panel. Keep this off the public app surface.">
      <KeyValueList
        rows={[
          ['Recorded Runtime', RECORDED_RUNTIME_URL],
          ['Current Runtime', runtimeDraft || '--'],
          ['Runtime Health', boot.health?.status || '--'],
          ['PayPal', boot.payment?.enabled ? 'Ready' : 'Offline'],
        ]}
      />
      <InputField
        label="Runtime URL"
        autoCapitalize="none"
        autoCorrect={false}
        value={runtimeDraft}
        onChangeText={setRuntimeDraft}
      />
      <View style={styles.inlineButtonStack}>
        <Button label="Use Recorded" kind="secondary" onPress={onUseRecordedRuntime} />
        <Button label="Apply Runtime" onPress={onApplyRuntime} />
      </View>

      <InputField
        label="Admin Email"
        autoCapitalize="none"
        value={adminForm.email}
        onChangeText={(value) => setAdminForm((current) => ({ ...current, email: value }))}
      />
      <InputField
        label="Admin Password"
        secureTextEntry
        value={adminForm.password}
        onChangeText={(value) => setAdminForm((current) => ({ ...current, password: value }))}
      />
      <TwoColumnFields
        left={
          <InputField
            label="Location Zone"
            value={adminForm.locationZone}
            onChangeText={(value) => setAdminForm((current) => ({ ...current, locationZone: value }))}
          />
        }
        right={
          <InputField
            label="2FA Code"
            value={adminForm.twoFactorCode}
            onChangeText={(value) => setAdminForm((current) => ({ ...current, twoFactorCode: value }))}
          />
        }
      />
      <View style={styles.inlineButtonStack}>
        <Button label={busy.adminLogin ? 'Logging In...' : 'Admin Login'} onPress={onAdminLogin} />
        <Button label="Refresh Admin" kind="secondary" onPress={() => onAdminDashboard()} />
      </View>
      <Message text={messages.adminLogin} success={messages.adminLogin === 'Admin session ready.'} />
      <Message text={messages.adminDashboard} success={false} />
      {adminDashboard ? (
        <KeyValueList
          rows={[
            ['Requests', String(adminDashboard.requestCount ?? 0)],
            ['Queue', String(adminDashboard.queue?.length ?? 0)],
            ['In Service', String(adminDashboard.inService?.length ?? 0)],
            ['Pending Providers', String(adminDashboard.stats?.pendingProviders ?? 0)],
          ]}
        />
      ) : null}
    </Section>
  );
}

function KeyValueList({ rows }) {
  return (
    <View style={styles.valuePanel}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.valueRow}>
          <Text style={styles.valueLabel}>{label}</Text>
          <Text style={styles.valueValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function Message({ text, success }) {
  if (!text) {
    return null;
  }
  return (
    <View style={[styles.message, success ? styles.messageSuccess : styles.messageError]}>
      <Text style={styles.messageText}>{text}</Text>
    </View>
  );
}

function TwoColumnFields({ left, right }) {
  return (
    <View style={styles.twoColumn}>
      <View style={styles.column}>{left}</View>
      <View style={styles.column}>{right}</View>
    </View>
  );
}

function hydrateRequestFromProfile(current, auth) {
  const vehicle = Array.isArray(auth?.savedVehicles) && auth.savedVehicles.length ? auth.savedVehicles[0] : {};
  return {
    ...current,
    fullName: auth?.fullName || current.fullName,
    phoneNumber: auth?.phoneNumber || current.phoneNumber,
    year: vehicle?.year || current.year,
    make: vehicle?.make || current.make,
    model: vehicle?.model || current.model,
    color: vehicle?.color || current.color,
  };
}

function buildProviderDocumentsPayload(form) {
  return {
    license: createTextDocument('license', form.licenseNumber || 'license-on-file'),
    registration: createTextDocument('registration', form.registrationNumber || 'registration-on-file'),
    insurance: createTextDocument('insurance', form.insuranceNumber || 'insurance-on-file'),
    helperId: createTextDocument('helperId', form.helperIdNumber || 'helper-id-pending'),
  };
}

function createTextDocument(label, value) {
  return {
    fileName: `${label}.txt`,
    contentType: 'text/plain',
    documentNumber: value,
    note: `${label}: ${value}`,
  };
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildProviderActionPayload(action) {
  if (action === 'eta') {
    return { etaMinutes: 25, note: 'mobile-provider-eta', actorRole: 'PROVIDER' };
  }
  return { note: `mobile-provider-${action}`, actorRole: 'PROVIDER' };
}

function formatUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '$0.00';
  }
  return `$${amount.toFixed(2)}`;
}

function formatActionLabel(action) {
  return String(action)
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  app: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    gap: 18,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 110,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerCopy: {
    flex: 1,
    paddingRight: 12,
  },
  eyebrow: {
    color: theme.colors.gold,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.text,
    fontSize: 30,
    fontWeight: '900',
    marginTop: 2,
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  liveBadge: {
    alignItems: 'flex-end',
    backgroundColor: theme.colors.panelSoft,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    minWidth: 96,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  liveLabel: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  liveValue: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  liveState: {
    color: theme.colors.gold,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 6,
  },
  hero: {
    borderColor: theme.colors.line,
    borderRadius: 28,
    borderWidth: 1,
    minHeight: 260,
    overflow: 'hidden',
    position: 'relative',
  },
  heroImage: {
    height: '100%',
    position: 'absolute',
    width: '100%',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 9, 19, 0.52)',
  },
  heroCopyBlock: {
    justifyContent: 'flex-end',
    minHeight: 260,
    padding: 20,
  },
  heroEyebrow: {
    color: theme.colors.gold,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: '900',
    marginTop: 8,
  },
  heroText: {
    color: '#d7e0ec',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    maxWidth: 320,
  },
  heroButtons: {
    gap: 10,
    marginTop: 18,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: '30%',
    padding: 14,
  },
  metricLabel: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 6,
  },
  metricDetail: {
    color: '#c4d0de',
    fontSize: 12,
    marginTop: 6,
  },
  section: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    padding: 18,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  sectionSubtitle: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  sectionBody: {
    gap: 12,
    marginTop: 16,
  },
  pathGrid: {
    gap: 10,
  },
  journeyTile: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: 16,
  },
  journeyEyebrow: {
    color: theme.colors.gold,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  journeyTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 6,
  },
  journeyDetail: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  stageRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  stagePill: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  stagePillActive: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accent,
  },
  stageLabel: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  stageLabelActive: {
    color: theme.colors.text,
  },
  serviceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  valuePanel: {
    gap: 10,
  },
  valueRow: {
    borderBottomColor: 'rgba(255,255,255,0.06)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  valueLabel: {
    color: theme.colors.muted,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  valueValue: {
    color: theme.colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'right',
  },
  statusCard: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: 14,
  },
  policyBox: {
    backgroundColor: '#162434',
    borderColor: '#355270',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: 14,
  },
  policyTitle: {
    color: '#f3f7fc',
    fontSize: 13,
    fontWeight: '900',
  },
  policyBody: {
    color: '#d7e0ec',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  toggleRow: {
    alignItems: 'center',
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  toggleRowActive: {
    borderColor: theme.colors.accent,
  },
  toggleDot: {
    backgroundColor: 'transparent',
    borderColor: theme.colors.line,
    borderRadius: 999,
    borderWidth: 2,
    height: 18,
    width: 18,
  },
  toggleDotActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  toggleLabel: {
    color: theme.colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  toggleState: {
    color: theme.colors.gold,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  actionChip: {
    backgroundColor: theme.colors.panelSoft,
    borderColor: theme.colors.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionChipLabel: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  inlineButtonStack: {
    gap: 10,
  },
  message: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  messageSuccess: {
    backgroundColor: 'rgba(50, 97, 58, 0.25)',
    borderColor: 'rgba(115, 240, 162, 0.38)',
  },
  messageError: {
    backgroundColor: 'rgba(123, 26, 30, 0.28)',
    borderColor: 'rgba(215, 52, 58, 0.45)',
  },
  messageText: {
    color: theme.colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
  twoColumn: {
    flexDirection: 'row',
    gap: 10,
  },
  column: {
    flex: 1,
  },
  sideImage: {
    borderRadius: theme.radius.md,
    height: 148,
    width: '100%',
  },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  loadingText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  helperText: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  bottomNav: {
    backgroundColor: '#09111b',
    borderTopColor: 'rgba(255,255,255,0.06)',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  navItem: {
    alignItems: 'center',
    borderRadius: 16,
    flex: 1,
    paddingVertical: 10,
  },
  navItemActive: {
    backgroundColor: theme.colors.accentSoft,
  },
  navLabel: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  navLabelActive: {
    color: theme.colors.text,
  },
});
