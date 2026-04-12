import React from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

type CreateOfferScreenProps = {
  styles: any;
  colors: { ink: string; muted: string; white: string };
  privacyPolicyUrl: string;
  AutoFocusInput: any;
  offerForm: any;
  setOfferForm: React.Dispatch<React.SetStateAction<any>>;
  offerError: string | null;
  offerBusy: boolean;
  offerNotice: { type?: string; text?: string } | null;
  ownerCommissionRateLabel: string;
  offerCreateHonorChecked: boolean;
  setOfferCreateHonorChecked: React.Dispatch<React.SetStateAction<boolean>>;
  openOfferDatePicker: (field: string) => void;
  openOfferTimePicker: (field: string) => void;
  getOfferDateOptionLabel: (value: string) => string;
  offerExpiryTimeOptions: Array<{ value: string; label: string }>;
  canCreateOffer: boolean;
  createOfferGateError: string | null;
  handleCreateOffer: () => void;
  closeCreateOfferPage: () => void;
  clearOfferFeedback: () => void;
};

export default function CreateOfferScreen({
  styles,
  colors,
  privacyPolicyUrl,
  AutoFocusInput,
  offerForm,
  setOfferForm,
  offerError,
  offerBusy,
  offerNotice,
  ownerCommissionRateLabel,
  offerCreateHonorChecked,
  setOfferCreateHonorChecked,
  openOfferDatePicker,
  openOfferTimePicker,
  getOfferDateOptionLabel,
  offerExpiryTimeOptions,
  canCreateOffer,
  createOfferGateError,
  handleCreateOffer,
  closeCreateOfferPage,
  clearOfferFeedback,
}: CreateOfferScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.createBusinessPageOverlay} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.createBusinessPageSurface}>
          <View style={[styles.createBusinessPageHeader, insets.top > 0 && { paddingTop: 8 }]}>
            <TouchableOpacity
              style={styles.createBusinessPageBackButton}
              onPress={closeCreateOfferPage}
              activeOpacity={0.85}
            >
              <Ionicons name="arrow-back" size={22} color={colors.ink} />
            </TouchableOpacity>
            <View style={styles.createBusinessPageHeaderCopy}>
              <Text style={styles.createBusinessPageTitle}>Create Offer</Text>
              <Text style={styles.createBusinessPageSubtitle}>
                Your commission is {ownerCommissionRateLabel} on verified receipts from this
                offer.
              </Text>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.createBusinessPageContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.createBusinessSectionCard}>
              <Text style={styles.createBusinessSectionTitle}>Offer Details</Text>
              <Text style={styles.formLabel}>Offer title</Text>
              <AutoFocusInput
                style={styles.formInput}
                placeholder="Example: 20% off first visit"
                placeholderTextColor={colors.muted}
                value={offerForm.title}
                onChangeText={(value: string) => {
                  setOfferForm((prev: any) => ({ ...prev, title: value }));
                  clearOfferFeedback();
                }}
                maxLength={64}
                returnKeyType="next"
              />
            </View>

            <View style={styles.createBusinessSectionCard}>
              <Text style={styles.createBusinessSectionTitle}>Validity</Text>
              <View style={styles.formRow}>
                <View style={styles.formField}>
                  <TouchableOpacity
                    style={[styles.formInput, styles.selectInput]}
                    onPress={() => openOfferDatePicker("startDate")}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.selectInputText}>
                      {offerForm.startsDate
                        ? getOfferDateOptionLabel(offerForm.startsDate)
                        : "Start date"}
                    </Text>
                    <Ionicons name="calendar-outline" size={16} color={colors.muted} />
                  </TouchableOpacity>
                </View>
                <View style={styles.formField}>
                  <TouchableOpacity
                    style={[
                      styles.formInput,
                      styles.selectInput,
                      !offerForm.startsDate && styles.formInputDisabled,
                    ]}
                    onPress={() => openOfferTimePicker("startTime")}
                    activeOpacity={0.8}
                    disabled={!offerForm.startsDate}
                  >
                    <Text style={styles.selectInputText}>
                      {offerForm.startsDate
                        ? offerExpiryTimeOptions.find(
                            (option) => option.value === offerForm.startsTime,
                          )?.label || "Start time"
                        : "Start time"}
                    </Text>
                    <Ionicons name="time-outline" size={16} color={colors.muted} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.formRow}>
                <View style={styles.formField}>
                  <TouchableOpacity
                    style={[styles.formInput, styles.selectInput]}
                    onPress={() => openOfferDatePicker("endDate")}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.selectInputText}>
                      {offerForm.expiresDate
                        ? getOfferDateOptionLabel(offerForm.expiresDate)
                        : "End date"}
                    </Text>
                    <Ionicons name="calendar-outline" size={16} color={colors.muted} />
                  </TouchableOpacity>
                </View>
                <View style={styles.formField}>
                  <TouchableOpacity
                    style={[
                      styles.formInput,
                      styles.selectInput,
                      !offerForm.expiresDate && styles.formInputDisabled,
                    ]}
                    onPress={() => openOfferTimePicker("endTime")}
                    activeOpacity={0.8}
                    disabled={!offerForm.expiresDate}
                  >
                    <Text style={styles.selectInputText}>
                      {offerForm.expiresDate
                        ? offerExpiryTimeOptions.find(
                            (option) => option.value === offerForm.expiresTime,
                          )?.label || "End time"
                        : "End time"}
                    </Text>
                    <Ionicons name="time-outline" size={16} color={colors.muted} />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.formHint}>
                Optional. Set when this offer starts and ends, including both times.
              </Text>
            </View>

            <View style={styles.createBusinessSectionCard}>
              <Text style={styles.createBusinessSectionTitle}>Conditions</Text>
              <View style={styles.legalChecklist}>
                <TouchableOpacity
                  style={styles.legalCheckRow}
                  onPress={() => {
                    setOfferCreateHonorChecked((prev) => !prev);
                    clearOfferFeedback();
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={
                      offerCreateHonorChecked ? "checkmark-circle" : "ellipse-outline"
                    }
                    size={18}
                    color={offerCreateHonorChecked ? colors.ink : colors.muted}
                  />
                  <Text style={styles.legalCheckText}>
                    I confirm this offer is accurate and my business will honor it exactly as
                    published.
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={styles.legalLinkButton}
                onPress={() => Linking.openURL(privacyPolicyUrl).catch(() => null)}
              >
                <Text style={styles.legalLinkText}>Review Privacy Policy</Text>
              </TouchableOpacity>
              {offerError ? <Text style={styles.formError}>{offerError}</Text> : null}
              {!canCreateOffer && createOfferGateError ? (
                <Text style={[styles.formError, { marginTop: 10 }]}>
                  {createOfferGateError}
                </Text>
              ) : null}
              {offerNotice?.text ? (
                <Text
                  style={[
                    offerNotice?.type === "success" ? styles.formSuccess : styles.formHint,
                    { marginTop: 10 },
                  ]}
                >
                  {offerNotice.text}
                </Text>
              ) : null}
            </View>
          </ScrollView>

          <View
            style={[
              styles.createBusinessFooter,
              insets.bottom > 0 && { paddingBottom: insets.bottom },
            ]}
          >
            <TouchableOpacity style={styles.secondaryButton} onPress={closeCreateOfferPage}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                (offerBusy || !canCreateOffer) && styles.primaryButtonDisabled,
              ]}
              onPress={handleCreateOffer}
              disabled={offerBusy || !canCreateOffer}
            >
              <Text style={styles.primaryButtonText}>
                {offerBusy
                  ? "Creating..."
                  : canCreateOffer
                    ? "Create Offer"
                    : "Stripe setup required"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
