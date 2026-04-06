import { ScrollView, StyleSheet, Text, View } from 'react-native';

import Button from '../components/Button';
import InputField from '../components/InputField';
import { theme } from '../theme';

export default function SignupScreen({ signup, setSignup, onBack }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Create account</Text>
      <Text style={styles.subtitle}>
        This is frontend-only. Authentication, billing, and subscriber roles can attach later.
      </Text>

      <View style={styles.panel}>
        <InputField
          label="Full Name"
          placeholder="Enter full name"
          value={signup.fullName}
          onChangeText={(value) => setSignup((current) => ({ ...current, fullName: value }))}
        />
        <InputField
          label="Email"
          placeholder="Enter email"
          value={signup.email}
          onChangeText={(value) => setSignup((current) => ({ ...current, email: value }))}
        />
        <InputField
          label="Phone"
          placeholder="Enter phone number"
          value={signup.phone}
          onChangeText={(value) => setSignup((current) => ({ ...current, phone: value }))}
        />
        <InputField
          label="Password"
          placeholder="Choose password"
          secureTextEntry
          value={signup.password}
          onChangeText={(value) => setSignup((current) => ({ ...current, password: value }))}
        />
      </View>

      <View style={styles.planCard}>
        <Text style={styles.planLabel}>Default Plan</Text>
        <Text style={styles.planValue}>Subscriber</Text>
        <Text style={styles.planMeta}>UI placeholder only until pricing and auth are approved.</Text>
      </View>

      <Button label="Create Account" />
      <Button label="Back" kind="secondary" onPress={onBack} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.background,
    flex: 1,
  },
  content: {
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
  },
  title: {
    color: theme.colors.text,
    fontSize: 30,
    fontWeight: '900',
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
  planCard: {
    backgroundColor: '#371922',
    borderRadius: theme.radius.md,
    gap: 4,
    padding: theme.spacing.md,
  },
  planLabel: {
    color: '#e6b6c7',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  planValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
  },
  planMeta: {
    color: '#d8a5b7',
    fontSize: 13,
  },
});
