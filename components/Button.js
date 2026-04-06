import { Pressable, StyleSheet, Text } from 'react-native';

import { theme } from '../theme';

export default function Button({ label, onPress, kind = 'primary' }) {
  return (
    <Pressable onPress={onPress} style={[styles.base, kind === 'secondary' ? styles.secondary : null, kind === 'danger' ? styles.danger : null]}>
      <Text style={[styles.label, kind === 'secondary' ? styles.secondaryLabel : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingVertical: 18,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderColor: theme.colors.line,
    borderWidth: 1,
  },
  danger: {
    backgroundColor: theme.colors.danger,
  },
  label: {
    color: '#101010',
    fontSize: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  secondaryLabel: {
    color: theme.colors.text,
  },
});
