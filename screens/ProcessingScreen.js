import { StyleSheet, Text, View } from 'react-native';

import Button from '../components/Button';
import { theme } from '../theme';

export default function ProcessingScreen({ selectedService, onCancel, onNext }) {
  return (
    <View style={styles.screen}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>Dispatch Pending</Text>
      </View>
      <Text style={styles.title}>Finding help nearby...</Text>
      <Text style={styles.subtitle}>
        Preparing the next step for your {selectedService} request.
      </Text>

      <View style={styles.card}>
        <Text style={styles.icon}>🚗</Text>
        <Text style={styles.cardTitle}>Searching providers</Text>
        <Text style={styles.cardMeta}>
          Presentational only. No live dispatch connection is attached yet.
        </Text>
      </View>

      <Button label="Continue to Signup" onPress={onNext} />
      <Button label="Cancel Request" kind="danger" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    flex: 1,
    gap: theme.spacing.md,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  badge: {
    backgroundColor: theme.colors.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  badgeText: {
    color: theme.colors.gold,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.text,
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  card: {
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    gap: theme.spacing.sm,
    padding: theme.spacing.xl,
    width: '100%',
  },
  icon: {
    fontSize: 56,
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  cardMeta: {
    color: theme.colors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
});
