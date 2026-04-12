import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type EmptyBusinessStateProps = {
  styles: any;
  colors: { ink: string; muted: string; white: string };
  onCreateBusiness: () => void;
};

export default function EmptyBusinessState({
  styles,
  colors,
  onCreateBusiness,
}: EmptyBusinessStateProps) {
  return (
    <View style={localStyles.container}>
      <View style={localStyles.iconWrap}>
        <Ionicons name="business-outline" size={34} color={colors.ink} />
      </View>
      <Text style={[localStyles.title, { color: colors.ink }]}>No business yet</Text>
      <Text style={[localStyles.subtitle, { color: colors.muted }]}>
        Create your first business profile to get started.
      </Text>
      <TouchableOpacity
        style={[styles.primaryButton, localStyles.button]}
        onPress={onCreateBusiness}
        activeOpacity={0.88}
      >
        <Text style={styles.primaryButtonText}>Create Business</Text>
      </TouchableOpacity>
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 420,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.06)",
    marginBottom: 18,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 10,
    maxWidth: 320,
  },
  button: {
    width: "100%",
    maxWidth: 340,
    marginTop: 26,
  },
});
