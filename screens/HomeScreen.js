import { ScrollView, StyleSheet, Text, View } from 'react-native';

import Button from '../components/Button';
import InputField from '../components/InputField';
import ServiceCard from '../components/ServiceCard';
import { theme } from '../theme';

const services = [
  { id: 'lockout', label: 'Lockout', price: '$55', detail: 'Guest rate' },
  { id: 'jump', label: 'Jump Start', price: '$45', detail: 'Flat rate' },
  { id: 'tire', label: 'Flat Tire', price: '$60', detail: 'Basic roadside' },
  { id: 'tow', label: 'Tow', price: '$95', detail: 'Base dispatch' },
];

export default function HomeScreen({ selectedService, setSelectedService, form, setForm, onRequest, onSignup }) {
  const currentPrice = services.find((item) => item.id === selectedService)?.price ?? '$55';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.brand}>awroadside-fire</Text>
        <Text style={styles.title}>Roadside help with a cleaner guest flow.</Text>
        <Text style={styles.subtitle}>
          This frontend package is upload-ready and intentionally avoids backend assumptions.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Select Service</Text>
        <View style={styles.serviceGrid}>
          {services.map((service) => (
            <ServiceCard
              key={service.id}
              active={service.id === selectedService}
              label={service.label}
              price={service.price}
              detail={service.detail}
              onPress={() => setSelectedService(service.id)}
            />
          ))}
        </View>
      </View>

      <View style={styles.priceBox}>
        <Text style={styles.priceLabel}>Current Guest Price</Text>
        <Text style={styles.priceValue}>{currentPrice} FLAT RATE</Text>
        <Text style={styles.priceMeta}>Display-only until pricing is approved.</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Request Service</Text>
        <View style={styles.form}>
          <InputField
            label="Full Name"
            placeholder="Enter full name"
            value={form.fullName}
            onChangeText={(value) => setForm((current) => ({ ...current, fullName: value }))}
          />
          <InputField
            label="Phone Number"
            placeholder="Enter phone number"
            value={form.phone}
            onChangeText={(value) => setForm((current) => ({ ...current, phone: value }))}
          />
          <InputField
            label="Vehicle Info"
            placeholder="Year, make, model"
            value={form.vehicle}
            onChangeText={(value) => setForm((current) => ({ ...current, vehicle: value }))}
          />
          <InputField
            label="Location"
            placeholder="Current location"
            value={form.location}
            onChangeText={(value) => setForm((current) => ({ ...current, location: value }))}
          />
          <InputField
            label="Notes"
            placeholder="Landmarks, codes, or extra details"
            multiline
            value={form.notes}
            onChangeText={(value) => setForm((current) => ({ ...current, notes: value }))}
          />
        </View>
      </View>

      <Button label="Request Service" onPress={onRequest} />
      <Button label="Create Account" kind="secondary" onPress={onSignup} />

      <Text style={styles.terms}>
        By requesting service, you agree to contact and dispatch terms.
      </Text>
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
  hero: {
    gap: theme.spacing.sm,
  },
  brand: {
    color: theme.colors.gold,
    fontSize: 28,
    fontWeight: '900',
  },
  title: {
    color: theme.colors.text,
    fontSize: 30,
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
    gap: theme.spacing.md,
    padding: theme.spacing.md,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  serviceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  priceBox: {
    alignItems: 'center',
    backgroundColor: theme.colors.panelSoft,
    borderRadius: theme.radius.md,
    gap: 4,
    padding: theme.spacing.lg,
  },
  priceLabel: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  priceValue: {
    color: theme.colors.gold,
    fontSize: 28,
    fontWeight: '900',
  },
  priceMeta: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  form: {
    gap: theme.spacing.sm,
  },
  terms: {
    color: theme.colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
