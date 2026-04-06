import { useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import HomeScreen from './screens/HomeScreen';
import ProcessingScreen from './screens/ProcessingScreen';
import SignupScreen from './screens/SignupScreen';
import { theme } from './theme';

const initialRequest = {
  fullName: '',
  phone: '',
  vehicle: '',
  location: '',
  notes: '',
};

const initialSignup = {
  fullName: '',
  email: '',
  phone: '',
  password: '',
};

export default function App() {
  const [screen, setScreen] = useState('HOME');
  const [selectedService, setSelectedService] = useState('lockout');
  const [form, setForm] = useState(initialRequest);
  const [signup, setSignup] = useState(initialSignup);

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="light" />
      {screen === 'HOME' ? (
        <HomeScreen
          selectedService={selectedService}
          setSelectedService={setSelectedService}
          form={form}
          setForm={setForm}
          onRequest={() => setScreen('PROCESSING')}
          onSignup={() => setScreen('SIGNUP')}
        />
      ) : null}

      {screen === 'PROCESSING' ? (
        <ProcessingScreen
          selectedService={selectedService}
          onCancel={() => setScreen('HOME')}
          onNext={() => setScreen('SIGNUP')}
        />
      ) : null}

      {screen === 'SIGNUP' ? (
        <SignupScreen signup={signup} setSignup={setSignup} onBack={() => setScreen('HOME')} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
});
