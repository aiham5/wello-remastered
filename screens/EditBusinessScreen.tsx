import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

type EditBusinessScreenProps = {
  styles: any;
  colors: { ink: string; muted: string; pine: string };
  AutoFocusInput: any;
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  handleFormChange: (key: string, value: any) => void;
  editBusinessCategoryMenuOpen: boolean;
  setEditBusinessCategoryMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  categoryOptions: Array<{ key: string; label: string }>;
  getCategoryPickerLabel: (key: string, customLabel?: string) => string;
  editAddressLoading: boolean;
  editAddressError: string | null;
  editAddressResults: any[];
  addressLookupEnabled: boolean;
  addressLookupUnavailableCopy: string;
  handleAddressChange: (value: string) => void;
  handleSelectSuggestion: (result: any) => void;
  editBusinessImage: any;
  setEditBusinessImage: React.Dispatch<React.SetStateAction<any>>;
  editBusinessImageStatus: { uploading: boolean; error: string | null };
  setEditBusinessImageStatus: React.Dispatch<
    React.SetStateAction<{ uploading: boolean; error: string | null }>
  >;
  handlePickEditBusinessImage: () => void;
  renderBusinessHoursEditor: (args: any) => React.ReactNode;
  editHoursSchedule: any;
  setEditHoursSchedule: React.Dispatch<React.SetStateAction<any>>;
  tagOptions: Array<{ value: string; label: string }>;
  selectedEditTags: Set<string>;
  businessSaveBusy: boolean;
  formMessage: { type?: string; text?: string } | null;
  handleSaveBusiness: () => void;
  closeEditBusinessPage: () => void;
};

export default function EditBusinessScreen({
  styles,
  colors,
  AutoFocusInput,
  formData,
  setFormData,
  handleFormChange,
  editBusinessCategoryMenuOpen,
  setEditBusinessCategoryMenuOpen,
  categoryOptions,
  getCategoryPickerLabel,
  editAddressLoading,
  editAddressError,
  editAddressResults,
  addressLookupEnabled,
  addressLookupUnavailableCopy,
  handleAddressChange,
  handleSelectSuggestion,
  editBusinessImage,
  setEditBusinessImage,
  editBusinessImageStatus,
  setEditBusinessImageStatus,
  handlePickEditBusinessImage,
  renderBusinessHoursEditor,
  editHoursSchedule,
  setEditHoursSchedule,
  tagOptions,
  selectedEditTags,
  businessSaveBusy,
  formMessage,
  handleSaveBusiness,
  closeEditBusinessPage,
}: EditBusinessScreenProps) {
  const insets = useSafeAreaInsets();
  const [specialtyMenuOpen, setSpecialtyMenuOpen] = useState(false);
  const [otherSpecialty, setOtherSpecialty] = useState("");
  const industryOptions = [
    { key: "trades", label: "Home" },
    { key: "auto", label: "Auto" },
  ];
  const specialtyOptions: Record<string, string[]> = {
    trades: [
      "Electrician", "Plumber", "HVAC", "Roofing", "Handyman", "Painter",
      "Drywall", "Remodeling", "Carpentry", "Garage Door", "Repairs",
      "Appliance Repair", "Other",
    ],
    auto: [
      "Mechanic", "Mobile Mechanic", "Oil Shop", "Tire Shop", "Body Shop",
      "Towing Service", "Auto Glass", "Tint/Wraps", "Detailing", "Gas Station",
      "Other",
    ],
  };
  const selectedIndustry = ["auto", "trades"].includes(formData.categoryKey)
    ? formData.categoryKey
    : "";
  const selectedSpecialty = String(formData.categoryCustomLabel || "").trim();
  const isOtherSpecialty =
    selectedSpecialty === "Other" || selectedSpecialty.startsWith("Other:");

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
              onPress={closeEditBusinessPage}
              activeOpacity={0.85}
            >
              <Ionicons name="arrow-back" size={22} color={colors.ink} />
            </TouchableOpacity>
            <View style={styles.createBusinessPageHeaderCopy}>
              <Text style={styles.createBusinessPageTitle}>Edit Business</Text>
              <Text style={styles.createBusinessPageSubtitle}>
                Update your business details and save your changes.
              </Text>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.createBusinessPageContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.createBusinessSectionCard}>
              <Text style={styles.createBusinessSectionTitle}>Business Info</Text>

              <Text style={styles.formLabel}>
                Business name (this will show as your profile name)
              </Text>
              <AutoFocusInput
                style={styles.formInput}
                placeholder="Company name"
                placeholderTextColor={colors.muted}
                value={formData.name}
                onChangeText={(value: string) => handleFormChange("name", value)}
              />

              <Text style={styles.formLabel}>What do you do?</Text>
              <TouchableOpacity
                style={[styles.formInput, styles.selectInput]}
                onPress={() => setEditBusinessCategoryMenuOpen((prev) => !prev)}
                activeOpacity={0.8}
              >
                <Text style={styles.selectInputText}>
                  {industryOptions.find((option) => option.key === selectedIndustry)
                    ?.label || "Select Home or Auto"}
                </Text>
                <Ionicons
                  name={editBusinessCategoryMenuOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.muted}
                />
              </TouchableOpacity>
              {editBusinessCategoryMenuOpen ? (
                <View style={styles.selectMenu}>
                  {industryOptions.map((option) => {
                    const isActive = formData.categoryKey === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[
                          styles.selectMenuOption,
                          isActive && styles.selectMenuOptionActive,
                        ]}
                        onPress={() => {
                          handleFormChange("categoryKey", option.key);
                          handleFormChange("categoryCustomLabel", "");
                          setEditBusinessCategoryMenuOpen(false);
                          setSpecialtyMenuOpen(false);
                          setOtherSpecialty("");
                        }}
                      >
                        <Text
                          style={[
                            styles.selectMenuOptionText,
                            isActive && styles.selectMenuOptionTextActive,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}

              {selectedIndustry ? (
                <>
                  <Text style={styles.formLabel}>Your specialty</Text>
                  <TouchableOpacity
                    style={[styles.formInput, styles.selectInput]}
                    onPress={() => setSpecialtyMenuOpen((prev) => !prev)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.selectInputText}>
                      {isOtherSpecialty ? "Other" : selectedSpecialty || "Select specialty"}
                    </Text>
                    <Ionicons
                      name={specialtyMenuOpen ? "chevron-up" : "chevron-down"}
                      size={16}
                      color={colors.muted}
                    />
                  </TouchableOpacity>
                  {specialtyMenuOpen ? (
                    <View style={styles.selectMenu}>
                      {(specialtyOptions[selectedIndustry] || []).map((specialty) => (
                        <TouchableOpacity
                          key={specialty}
                          style={[
                            styles.selectMenuOption,
                            selectedSpecialty === specialty && styles.selectMenuOptionActive,
                          ]}
                          onPress={() => {
                            handleFormChange("categoryCustomLabel", specialty);
                            if (specialty !== "Other") setOtherSpecialty("");
                            setSpecialtyMenuOpen(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.selectMenuOptionText,
                              selectedSpecialty === specialty &&
                                styles.selectMenuOptionTextActive,
                            ]}
                          >
                            {specialty}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                  {isOtherSpecialty ? (
                    <AutoFocusInput
                      style={styles.formInput}
                      placeholder="Describe what your business does"
                      placeholderTextColor={colors.muted}
                      value={otherSpecialty || selectedSpecialty.replace(/^Other:\s*/i, "")}
                      onChangeText={(value: string) => {
                        setOtherSpecialty(value);
                        handleFormChange(
                          "categoryCustomLabel",
                          value.trim() ? `Other: ${value}` : "Other",
                        );
                      }}
                    />
                  ) : null}
                </>
              ) : null}

              <View style={styles.offerPhotoHeader}>
                <Text style={styles.formLabel}>Business photo</Text>
                {editBusinessImage?.uri || formData.imageUrl ? (
                  <TouchableOpacity
                    style={styles.offerRemoveButton}
                    onPress={() => {
                      setEditBusinessImage(null);
                      setEditBusinessImageStatus({ uploading: false, error: null });
                      handleFormChange("imageUrl", "");
                    }}
                  >
                    <Text style={styles.offerRemoveButtonText}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {editBusinessImageStatus.error ? (
                <Text style={styles.formError}>{editBusinessImageStatus.error}</Text>
              ) : null}
              <TouchableOpacity
                style={[styles.offerUploadFrame, styles.offerUploadFrameInteractive]}
                onPress={handlePickEditBusinessImage}
                disabled={editBusinessImageStatus.uploading}
                activeOpacity={0.85}
              >
                {editBusinessImage?.uri || formData.imageUrl ? (
                  <>
                    <Image
                      source={{ uri: editBusinessImage?.uri || formData.imageUrl }}
                      style={styles.offerUploadPreview}
                      resizeMode="cover"
                    />
                    <View style={styles.offerUploadOverlay}>
                      <Text style={styles.offerUploadOverlayText}>
                        Tap to replace business photo
                      </Text>
                    </View>
                  </>
                ) : (
                  <View style={styles.offerUploadPlaceholder}>
                    <Ionicons name="image-outline" size={18} color={colors.muted} />
                    <Text style={styles.offerUploadHint}>
                      Tap to choose a business cover photo.
                    </Text>
                  </View>
                )}
                {editBusinessImageStatus.uploading ? (
                  <View style={styles.offerUploadBusy}>
                    <ActivityIndicator color={colors.pine} />
                  </View>
                ) : null}
              </TouchableOpacity>
              <Text style={styles.formLabel}>
                Tell customers why they should hire you
              </Text>
              <AutoFocusInput
                style={[styles.formInput, styles.descriptorInput]}
                placeholder="Describe your experience, specialties, and what sets your work apart."
                placeholderTextColor={colors.muted}
                value={formData.description || ""}
                onChangeText={(value: string) =>
                  handleFormChange("description", value)
                }
                multiline
                textAlignVertical="top"
              />
              <Text style={styles.formHint}>
                Describe your experience and specialties. A strong profile helps
                customers trust your work and can help you get hired more often.
              </Text>
            </View>

            <View style={styles.createBusinessSectionCard}>
              <Text style={styles.createBusinessSectionTitle}>Location</Text>
              <Text style={styles.formLabel}>Do you have a business location?</Text>
              <View style={styles.tagOptionRow}>
                {[
                  { value: true, label: "Yes" },
                  { value: false, label: "No, I travel to customers" },
                ].map((option) => {
                  const active = (formData.hasBusinessLocation !== false) === option.value;
                  return (
                    <TouchableOpacity
                      key={option.label}
                      style={[styles.tagOptionPill, active && styles.tagOptionPillActive]}
                      onPress={() => handleFormChange("hasBusinessLocation", option.value)}
                    >
                      <Text style={[styles.tagOptionText, active && styles.tagOptionTextActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {formData.hasBusinessLocation === false ? (
                <Text style={styles.formHint}>
                  Enter your home or service-area base so we can place you nearby
                  on the map. Your exact address is never shown to customers.
                </Text>
              ) : null}
              <Text style={styles.formLabel}>
                {formData.hasBusinessLocation === false
                  ? "Home or service-area base"
                  : "Business address"}
              </Text>
              <AutoFocusInput
                style={styles.formInput}
                placeholder="Street address"
                placeholderTextColor={colors.muted}
                value={formData.address}
                onChangeText={handleAddressChange}
              />
              {!addressLookupEnabled ? (
                <Text style={styles.formHint}>{addressLookupUnavailableCopy}</Text>
              ) : null}
              {editAddressLoading ? (
                <Text style={styles.formHint}>Searching addresses...</Text>
              ) : null}
              {editAddressError ? <Text style={styles.formError}>{editAddressError}</Text> : null}
              {editAddressResults.length > 0 ? (
                <View style={styles.suggestionList}>
                  {editAddressResults.map((result) => (
                    <TouchableOpacity
                      key={result.place_id}
                      style={styles.suggestionItem}
                      onPress={() => handleSelectSuggestion(result)}
                    >
                      <Text style={styles.suggestionTitle}>
                        {result.structured_formatting?.main_text || result.description}
                      </Text>
                      {result.structured_formatting?.secondary_text ? (
                        <Text style={styles.suggestionSubtitle}>
                          {result.structured_formatting.secondary_text}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              <View style={styles.formRow}>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>City</Text>
                  <AutoFocusInput
                    style={styles.formInput}
                    placeholder="City"
                    placeholderTextColor={colors.muted}
                    value={formData.city}
                    onChangeText={(value: string) => handleFormChange("city", value)}
                  />
                </View>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>State</Text>
                  <AutoFocusInput
                    style={styles.formInput}
                    placeholder="State"
                    placeholderTextColor={colors.muted}
                    value={formData.state}
                    onChangeText={(value: string) => handleFormChange("state", value)}
                  />
                </View>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Zip code</Text>
                  <AutoFocusInput
                    style={styles.formInput}
                    placeholder="ZIP code"
                    placeholderTextColor={colors.muted}
                    value={formData.postalCode}
                    onChangeText={(value: string) => handleFormChange("postalCode", value)}
                    keyboardType="number-pad"
                  />
                </View>
              </View>
            </View>

            <View style={styles.createBusinessSectionCard}>
              <Text style={styles.createBusinessSectionTitle}>Contact</Text>
              <Text style={styles.formLabel}>Phone</Text>
              <AutoFocusInput
                style={styles.formInput}
                placeholder="(555) 123-4567"
                placeholderTextColor={colors.muted}
                value={formData.phone}
                onChangeText={(value: string) => handleFormChange("phone", value)}
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.createBusinessSectionCard}>
              <Text style={styles.createBusinessSectionTitle}>Hours</Text>
              {renderBusinessHoursEditor({
                schedule: editHoursSchedule,
                setSchedule: setEditHoursSchedule,
                scope: "edit",
              })}
            </View>

            {formMessage?.text ? (
              <View style={styles.createBusinessSectionCard}>
                <Text
                  style={formMessage.type === "error" ? styles.formError : styles.formSuccess}
                >
                  {formMessage.text}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View
            style={[
              styles.createBusinessFooter,
              insets.bottom > 0 && { paddingBottom: insets.bottom },
            ]}
          >
            <TouchableOpacity style={styles.secondaryButton} onPress={closeEditBusinessPage}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, businessSaveBusy && styles.primaryButtonDisabled]}
              onPress={handleSaveBusiness}
              disabled={businessSaveBusy}
            >
              <Text style={styles.primaryButtonText}>
                {businessSaveBusy ? "Saving..." : "Save Changes"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
