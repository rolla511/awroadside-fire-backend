import { Pressable, StyleSheet, Text } from 'react-native';

import { theme } from '../theme';

export default function ServiceCard({ active, label, price, detail, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.card, active ? styles.activeCard : null]}>
      <Text style={[styles.label, active ? styles.activeLabel : null]}>{label}</Text>
      <Text style={styles.price}>{price}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.panel,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    gap: 4,
    minWidth: '47%',
    padding: theme.spacing.sm,
  },
  activeCard: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accent,
  },
  label: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  activeLabel: {
    color: '#fff3ea',
  },
  price: {
    color: theme.colors.gold,
    fontSize: 20,
    fontWeight: '900',
  },
  detail: {
    color: theme.colors.muted,
    fontSize: 12,
  },
});
