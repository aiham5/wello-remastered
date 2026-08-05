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

type AddBusinessScreenProps = {
  styles: any;
  modalTopInset: number;
  colors: { ink: string; muted: string; pine: string };
  privacyPolicyUrl: string;
  AutoFocusInput: any;
  createBusinessForm: any;
  setCreateBusinessForm: React.Dispatch<React.SetStateAction<any>>;
  createBusinessCategoryMenuOpen: boolean;
  setCreateBusinessCategoryMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  categoryOptions: Array<{ key: string; label: string }>;
  categoryOtherKey: string;
  getCategoryPickerLabel: (key: string, customLabel?: string) => string;
  createAddressLoading: boolean;
  createAddressError: string | null;
  createAddressResults: any[];
  addressLookupEnabled: boolean;
  addressLookupUnavailableCopy: string;
  handleCreateAddressChange: (value: string) => void;
  handleSelectCreateSuggestion: (result: any) => void;
  createBusinessImage: any;
  setCreateBusinessImage: React.Dispatch<React.SetStateAction<any>>;
  createBusinessImageStatus: { uploading: boolean; error: string | null };
  setCreateBusinessImageStatus: React.Dispatch<
    React.SetStateAction<{ uploading: boolean; error: string | null }>
  >;
  handlePickCreateBusinessImage: () => void;
  renderBusinessHoursEditor: (args: any) => React.ReactNode;
  createHoursSchedule: any;
  setCreateHoursSchedule: React.Dispatch<React.SetStateAction<any>>;
  tagOptions: Array<{ value: string; label: string }>;
  selectedCreateTags: Set<string>;
  createBusinessAuthorizedChecked: boolean;
  setCreateBusinessAuthorizedChecked: React.Dispatch<React.SetStateAction<boolean>>;
  createBusinessHonorOffersChecked: boolean;
  setCreateBusinessHonorOffersChecked: React.Dispatch<React.SetStateAction<boolean>>;
  createBusinessError: string | null;
  setCreateBusinessError: React.Dispatch<React.SetStateAction<string | null>>;
  createBusinessBusy: boolean;
  handleCreateBusinessProfile: () => void;
  closeCreateBusinessPage: () => void;
};

export default function AddBusinessScreen({
  styles,
  modalTopInset,
  colors,
  privacyPolicyUrl,
  AutoFocusInput,
  createBusinessForm,
  setCreateBusinessForm,
  createBusinessCategoryMenuOpen,
  setCreateBusinessCategoryMenuOpen,
  categoryOptions,
  categoryOtherKey,
  getCategoryPickerLabel,
  createAddressLoading,
  createAddressError,
  createAddressResults,
  addressLookupEnabled,
  addressLookupUnavailableCopy,
  handleCreateAddressChange,
  handleSelectCreateSuggestion,
  createBusinessImage,
  setCreateBusinessImage,
  createBusinessImageStatus,
  setCreateBusinessImageStatus,
  handlePickCreateBusinessImage,
  renderBusinessHoursEditor,
  createHoursSchedule,
  setCreateHoursSchedule,
  tagOptions,
  selectedCreateTags,
  createBusinessAuthorizedChecked,
  setCreateBusinessAuthorizedChecked,
  createBusinessHonorOffersChecked,
  setCreateBusinessHonorOffersChecked,
  createBusinessError,
  setCreateBusinessError,
  createBusinessBusy,
  handleCreateBusinessProfile,
  closeCreateBusinessPage,
}: AddBusinessScreenProps) {
  const insets = useSafeAreaInsets();
  const [specialtyMenuOpen, setSpecialtyMenuOpen] = useState(false);
  const [otherSpecialty, setOtherSpecialty] = useState("");
  const industryOptions = [
    { key: "trades", label: "Home Service" },
    { key: "auto", label: "Auto Service" },
  ];
  const specialtyOptions: Record<string, string[]> = {
    trades: [
      "Electrician",
      "Plumber",
      "HVAC",
      "Roofing",
      "Handyman",
      "Painter",
      "Drywall",
      "Remodeling",
      "Carpentry",
      "Garage Door",
      "Repairs",
      "Appliance Repair",
      "Other",
    ],
    auto: [
      "Mechanic",
      "Mobile Mechanic",
      "Oil Shop",
      "Tire Shop",
      "Body Shop",
      "Towing Service",
      "Auto Glass",
      "Tint/Wraps",
      "Detailing",
      "Gas Station",
      "Other",
    ],
  };
  const selectedIndustry = ["auto", "trades"].includes(
    createBusinessForm.categoryKey,
  )
    ? createBusinessForm.categoryKey
    : "";
  const selectedSpecialty = String(
    createBusinessForm.categoryCustomLabel || "",
  ).trim();
  const isOtherSpecialty =
    selectedSpecialty === "Other" || selectedSpecialty.startsWith("Other:");
  const specialtyPickerLabel = isOtherSpecialty
    ? "Other"
    : selectedSpecialty || "Select specialty";

  return (
    <SafeAreaView
      style={styles.createBusinessPageOverlay}
      edges={["top", "bottom"]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.createBusinessPageSurface}>
        <View
          style={[
            styles.createBusinessPageHeader,
            insets.top > 0 && {
              paddingTop: 8,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.createBusinessPageBackButton}
            onPress={closeCreateBusinessPage}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-back" size={22} color={colors.ink} />
          </TouchableOpacity>
          <View style={styles.createBusinessPageHeaderCopy}>
            <Text style={styles.createBusinessPageTitle}>Add Business</Text>
            <Text style={styles.createBusinessPageSubtitle}>
              Create another business profile for this account.
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

            <Text style={styles.formLabel}>What do you do?</Text>
            <TouchableOpacity
              style={[styles.formInput, styles.selectInput]}
              onPress={() => setCreateBusinessCategoryMenuOpen((prev) => !prev)}
              activeOpacity={0.8}
            >
              <Text style={styles.selectInputText}>
                {industryOptions.find((option) => option.key === selectedIndustry)
                    ?.label || "Select Home Service or Auto Service"}
              </Text>
              <Ionicons
                name={createBusinessCategoryMenuOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.muted}
              />
            </TouchableOpacity>
            {createBusinessCategoryMenuOpen ? (
              <View style={styles.selectMenu}>
                {industryOptions.map((option) => {
                  const isActive = selectedIndustry === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={[
                        styles.selectMenuOption,
                        isActive && styles.selectMenuOptionActive,
                      ]}
                      onPress={() => {
                        setCreateBusinessForm((prev: any) => ({
                          ...prev,
                          categoryKey: option.key,
                          categoryCustomLabel: "",
                        }));
                        setCreateBusinessCategoryMenuOpen(false);
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
                    {specialtyPickerLabel}
                  </Text>
                  <Ionicons
                    name={specialtyMenuOpen ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.muted}
                  />
                </TouchableOpacity>
                {specialtyMenuOpen ? (
                  <View style={styles.selectMenu}>
                    {(specialtyOptions[selectedIndustry] || []).map((specialty) => {
                      const isActive = selectedSpecialty === specialty;
                      return (
                        <TouchableOpacity
                          key={specialty}
                          style={[
                            styles.selectMenuOption,
                            isActive && styles.selectMenuOptionActive,
                          ]}
                          onPress={() => {
                            setCreateBusinessForm((prev: any) => ({
                              ...prev,
                              categoryCustomLabel: specialty,
                            }));
                            if (specialty !== "Other") setOtherSpecialty("");
                            setSpecialtyMenuOpen(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.selectMenuOptionText,
                              isActive && styles.selectMenuOptionTextActive,
                            ]}
                          >
                            {specialty}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
                {isOtherSpecialty ? (
                  <AutoFocusInput
                    style={styles.formInput}
                    placeholder="Describe what your business does"
                    placeholderTextColor={colors.muted}
                    value={otherSpecialty}
                    onChangeText={(value: string) => {
                      setOtherSpecialty(value);
                      setCreateBusinessForm((prev: any) => ({
                        ...prev,
                        categoryCustomLabel: value.trim()
                          ? `Other: ${value}`
                          : "Other",
                      }));
                    }}
                  />
                ) : null}
              </>
            ) : null}

            <Text style={styles.formLabel}>
              Business name (this will show as your profile name)
            </Text>
            <AutoFocusInput
              style={styles.formInput}
              placeholder="Company name"
              placeholderTextColor={colors.muted}
              value={createBusinessForm.name}
              onChangeText={(value: string) =>
                setCreateBusinessForm((prev: any) => ({
                  ...prev,
                  name: value,
                }))
              }
            />

            <View style={styles.offerPhotoHeader}>
              <Text style={styles.formLabel}>Business photo</Text>
              {createBusinessImage?.uri ? (
                <TouchableOpacity
                  style={styles.offerRemoveButton}
                  onPress={() => {
                    setCreateBusinessImage(null);
                    setCreateBusinessImageStatus({
                      uploading: false,
                      error: null,
                    });
                  }}
                >
                  <Text style={styles.offerRemoveButtonText}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {createBusinessImageStatus.error ? (
              <Text style={styles.formError}>{createBusinessImageStatus.error}</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.offerUploadFrame, styles.offerUploadFrameInteractive]}
              onPress={handlePickCreateBusinessImage}
              disabled={createBusinessImageStatus.uploading}
              activeOpacity={0.85}
            >
              {createBusinessImage?.uri ? (
                <>
                  <Image
                    source={{ uri: createBusinessImage.uri }}
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
              {createBusinessImageStatus.uploading ? (
                <View style={styles.offerUploadBusy}>
                  <ActivityIndicator color={colors.pine} />
                </View>
              ) : null}
            </TouchableOpacity>
            <Text style={styles.formHint}>
              This photo is used for the business card in Discover and is
              separate from offer photos.
            </Text>

            <Text style={styles.formLabel}>Tell customers why they should hire you</Text>
            <AutoFocusInput
              style={[styles.formInput, styles.descriptorInput]}
              placeholder="Describe your experience, specialties, and what sets your work apart."
              placeholderTextColor={colors.muted}
              value={createBusinessForm.description || ""}
              onChangeText={(value: string) =>
                setCreateBusinessForm((prev: any) => ({
                  ...prev,
                  description: value,
                }))
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
                { value: "shop", label: "I have a shop" },
                { value: "travel", label: "I travel to customers" },
                { value: "both", label: "Both" },
              ].map((option) => {
                const currentMode =
                  createBusinessForm.locationMode ||
                  (createBusinessForm.hasBusinessLocation === false
                    ? "travel"
                    : "shop");
                const isActive = currentMode === option.value;
                return (
                  <TouchableOpacity
                    key={option.label}
                    style={[
                      styles.tagOptionPill,
                      isActive && styles.tagOptionPillActive,
                    ]}
                    onPress={() =>
                      setCreateBusinessForm((prev: any) => ({
                        ...prev,
                        locationMode: option.value,
                        hasBusinessLocation: option.value !== "travel",
                      }))
                    }
                  >
                    <Text
                      style={[
                        styles.tagOptionText,
                        isActive && styles.tagOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {createBusinessForm.locationMode === "travel" ? (
              <Text style={styles.formHint}>
                Enter your home or service-area base so we can place you nearby
                on the map. Your exact address stays private and is never shown
                to customers.
              </Text>
            ) : null}
            {createBusinessForm.locationMode === "both" ? (
              <Text style={styles.formHint}>
                Enter your shop address. Customers can get directions to your
                shop and will also know that you travel to them.
              </Text>
            ) : null}
            <Text style={styles.formLabel}>
              {createBusinessForm.locationMode === "travel"
                ? "Home or service-area base"
                : "Business address"}
            </Text>
            <AutoFocusInput
              style={styles.formInput}
              placeholder="Street address"
              placeholderTextColor={colors.muted}
              value={createBusinessForm.address}
              onChangeText={handleCreateAddressChange}
            />
            {!addressLookupEnabled ? (
              <Text style={styles.formHint}>{addressLookupUnavailableCopy}</Text>
            ) : null}
            {createAddressLoading ? (
              <Text style={styles.formHint}>Searching addresses...</Text>
            ) : null}
            {createAddressError ? (
              <Text style={styles.formError}>{createAddressError}</Text>
            ) : null}
            {createAddressResults.length > 0 ? (
              <View style={styles.suggestionList}>
                {createAddressResults.map((result) => (
                  <TouchableOpacity
                    key={result.place_id}
                    style={styles.suggestionItem}
                    onPress={() => handleSelectCreateSuggestion(result)}
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
                  value={createBusinessForm.city}
                  onChangeText={(value: string) =>
                    setCreateBusinessForm((prev: any) => ({
                      ...prev,
                      city: value,
                    }))
                  }
                />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>State</Text>
                <AutoFocusInput
                  style={styles.formInput}
                  placeholder="State"
                  placeholderTextColor={colors.muted}
                  value={createBusinessForm.state}
                  onChangeText={(value: string) =>
                    setCreateBusinessForm((prev: any) => ({
                      ...prev,
                      state: value,
                    }))
                  }
                />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Zip code</Text>
                <AutoFocusInput
                  style={styles.formInput}
                  placeholder="ZIP code"
                  placeholderTextColor={colors.muted}
                  value={createBusinessForm.postalCode}
                  onChangeText={(value: string) =>
                    setCreateBusinessForm((prev: any) => ({
                      ...prev,
                      postalCode: value,
                    }))
                  }
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
              value={createBusinessForm.phone}
              onChangeText={(value: string) =>
                setCreateBusinessForm((prev: any) => ({
                  ...prev,
                  phone: value,
                }))
              }
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.createBusinessSectionCard}>
            <Text style={styles.createBusinessSectionTitle}>Hours</Text>
            {renderBusinessHoursEditor({
              schedule: createHoursSchedule,
              setSchedule: setCreateHoursSchedule,
              scope: "create",
            })}
            <Text style={styles.formHint}>
              Set open or closed for each day and choose a time range for open
              days.
            </Text>
          </View>

          {createBusinessError ? (
            <Text style={styles.formError}>{createBusinessError}</Text>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.createBusinessFooter,
            insets.bottom > 0 && { paddingBottom: insets.bottom },
          ]}
        >
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={closeCreateBusinessPage}
          >
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              createBusinessBusy && styles.primaryButtonDisabled,
            ]}
            onPress={handleCreateBusinessProfile}
            disabled={createBusinessBusy}
          >
            <Text style={styles.primaryButtonText}>
              {createBusinessBusy ? "Creating..." : "Create profile"}
            </Text>
          </TouchableOpacity>
        </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
