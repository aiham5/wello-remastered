import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

type ReviewGroup = {
  businessId: string;
  businessName: string;
  reviews: Array<any>;
};

type ReviewsScreenProps = {
  styles: any;
  colors: { ink: string; muted: string };
  groupedReviews: ReviewGroup[];
  reviewsStatus: { loading: boolean; error: string | null };
  openBusinessReviewsPage: (group: ReviewGroup) => void;
  closeReviewsPage: () => void;
};

export default function ReviewsScreen({
  styles,
  colors,
  groupedReviews,
  reviewsStatus,
  openBusinessReviewsPage,
  closeReviewsPage,
}: ReviewsScreenProps) {
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
              onPress={closeReviewsPage}
              activeOpacity={0.85}
            >
              <Ionicons name="arrow-back" size={22} color={colors.ink} />
            </TouchableOpacity>
            <View style={styles.createBusinessPageHeaderCopy}>
              <Text style={styles.createBusinessPageTitle}>Customer Reviews</Text>
              <Text style={styles.createBusinessPageSubtitle}>
                Read feedback across all of your businesses.
              </Text>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.createBusinessPageContent}
            keyboardShouldPersistTaps="handled"
          >
            {reviewsStatus.error ? <Text style={styles.formError}>{reviewsStatus.error}</Text> : null}
            {reviewsStatus.loading ? (
              <View style={styles.remoteNotice}>
                <Text style={styles.remoteNoticeText}>Loading reviews...</Text>
              </View>
            ) : groupedReviews.length === 0 ? (
              <View style={styles.ownerDashboardEmptyCard}>
                <Text style={styles.ownerDashboardEmptyTitle}>No reviews yet</Text>
                <Text style={styles.ownerDashboardEmptyBody}>
                  Reviews from your businesses will appear here.
                </Text>
              </View>
            ) : (
              groupedReviews.map((group) => (
                <View key={group.businessId} style={styles.createBusinessSectionCard}>
                  <TouchableOpacity
                    style={styles.ownerDashboardSectionHeader}
                    onPress={() => openBusinessReviewsPage(group)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.ownerDashboardSectionTitle}>{group.businessName}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </TouchableOpacity>
                  {group.reviews.length ? (
                    group.reviews.slice(0, 3).map((review) => (
                      <View key={review.id} style={styles.businessPageReviewCard}>
                        <View style={styles.businessPageReviewHeader}>
                          <View style={styles.businessPageReviewHeaderCopy}>
                            <Text style={styles.businessPageReviewName}>
                              {review.reviewerName || "Anonymous"}
                            </Text>
                            <Text style={styles.businessPageReviewDate}>{review.reviewDate || ""}</Text>
                          </View>
                          <View style={styles.businessPageReviewStars}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Ionicons
                                key={star}
                                name={review.rating >= star ? "star" : "star-outline"}
                                size={13}
                                color={review.rating >= star ? colors.ink : colors.muted}
                              />
                            ))}
                          </View>
                        </View>
                        <Text style={styles.businessPageReviewBody}>
                          {review.reviewText || "No written review."}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.formHint}>No reviews yet.</Text>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
