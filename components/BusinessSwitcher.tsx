import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useActiveBusiness } from "../context/ActiveBusinessContext";

type BusinessSwitcherProps = {
  onAddBusiness?: () => void;
  variant?: "default" | "row";
  title?: string;
  subtitle?: string;
};

export default function BusinessSwitcher({
  onAddBusiness,
  variant = "default",
  title = "Switch / Add Business",
  subtitle = "Manage your business accounts",
}: BusinessSwitcherProps) {
  const { activeBusiness, businesses, setActiveBusiness } = useActiveBusiness();
  const [open, setOpen] = useState(false);
  const [pendingAddBusiness, setPendingAddBusiness] = useState(false);
  const addBusinessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingAddBusiness = useCallback((delay = 0) => {
    if (!pendingAddBusiness) return;
    if (addBusinessTimeoutRef.current) {
      clearTimeout(addBusinessTimeoutRef.current);
    }
    addBusinessTimeoutRef.current = setTimeout(() => {
      addBusinessTimeoutRef.current = null;
      setPendingAddBusiness(false);
      onAddBusiness?.();
    }, delay);
  }, [onAddBusiness, pendingAddBusiness]);

  useEffect(() => {
    if (open || !pendingAddBusiness) return;
    flushPendingAddBusiness(220);
  }, [flushPendingAddBusiness, open, pendingAddBusiness]);

  useEffect(() => {
    return () => {
      if (addBusinessTimeoutRef.current) {
        clearTimeout(addBusinessTimeoutRef.current);
      }
    };
  }, []);

  const currentLabel = useMemo(() => {
    if (activeBusiness?.name) return activeBusiness.name;
    if (businesses[0]?.name) return businesses[0].name;
    return "Select business";
  }, [activeBusiness?.name, businesses]);

  return (
    <>
      {variant === "row" ? (
        <TouchableOpacity
          style={styles.rowTrigger}
          activeOpacity={0.88}
          onPress={() => setOpen(true)}
        >
          <View style={styles.rowTriggerIcon}>
            <Ionicons name="swap-horizontal-outline" size={22} color="#667085" />
          </View>
          <View style={styles.rowTriggerCopy}>
            <Text style={styles.rowTriggerTitle}>{title}</Text>
            <Text style={styles.rowTriggerSubtitle}>{subtitle}</Text>
            <Text style={styles.rowTriggerMeta} numberOfLines={1}>
              {currentLabel}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#98A2B3" />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.trigger}
          activeOpacity={0.88}
          onPress={() => setOpen(true)}
        >
          <View style={styles.triggerCopy}>
            <Text style={styles.triggerLabel}>Active business</Text>
            <Text style={styles.triggerName} numberOfLines={1}>
              {currentLabel}
            </Text>
          </View>
          <Text style={styles.triggerChevron}>v</Text>
        </TouchableOpacity>
      )}

      <Modal
        transparent
        visible={open}
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onDismiss={() => flushPendingAddBusiness(0)}
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>Switch business</Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Text style={styles.closeText}>x</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
            >
              {businesses.map((business) => {
                const selected = activeBusiness?.id === business.id;
                return (
                  <TouchableOpacity
                    key={business.id}
                    style={[styles.businessRow, selected && styles.businessRowSelected]}
                    activeOpacity={0.9}
                    onPress={() => {
                      setActiveBusiness(business);
                      setOpen(false);
                    }}
                  >
                    <View style={styles.businessRowCopy}>
                      <Text style={styles.businessName}>{business.name}</Text>
                      <Text style={styles.businessMeta}>
                        {(business.role || "owner").toUpperCase()}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.selectionMark,
                        selected && styles.selectionMarkSelected,
                      ]}
                    >
                      {selected ? "Selected" : "○"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={styles.addButton}
                activeOpacity={0.9}
                onPress={() => {
                  setPendingAddBusiness(true);
                  setOpen(false);
                }}
              >
                <Text style={styles.addButtonIcon}>+</Text>
                <Text style={styles.addButtonText}>Add Business</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.3)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 18,
    maxHeight: "70%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#101828",
  },
  list: {
    maxHeight: 360,
  },
  listContent: {
    gap: 10,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  triggerCopy: {
    flex: 1,
    paddingRight: 12,
  },
  triggerLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#667085",
    marginBottom: 2,
  },
  triggerName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#101828",
  },
  triggerChevron: {
    fontSize: 18,
    fontWeight: "700",
    color: "#667085",
  },
  rowTrigger: {
    minHeight: 94,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5EAF1",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowColor: "rgba(15, 23, 42, 0.12)",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 5,
  },
  rowTriggerIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: "#F2F5FA",
    alignItems: "center",
    justifyContent: "center",
  },
  rowTriggerCopy: {
    flex: 1,
    gap: 2,
  },
  rowTriggerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#101828",
  },
  rowTriggerSubtitle: {
    fontSize: 13,
    fontWeight: "500",
    color: "#667085",
  },
  rowTriggerMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: "#98A2B3",
  },
  closeText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#101828",
  },
  businessRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E4E7EC",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
  },
  businessRowSelected: {
    borderColor: "#2F80FF",
    backgroundColor: "#F5F9FF",
  },
  businessRowCopy: {
    flex: 1,
    paddingRight: 12,
  },
  businessName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#101828",
  },
  businessMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: "#667085",
  },
  selectionMark: {
    fontSize: 12,
    fontWeight: "700",
    color: "#98A2B3",
  },
  selectionMarkSelected: {
    color: "#2F80FF",
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#BFD4FF",
    backgroundColor: "#F5F9FF",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 6,
  },
  addButtonIcon: {
    fontSize: 18,
    fontWeight: "700",
    color: "#2F80FF",
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#2F80FF",
  },
});
