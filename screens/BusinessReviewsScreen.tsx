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

type BusinessReviewsScreenProps = {
  styles: any;
  colors: { ink: string; muted: string };
  businessName: string;
  reviews: Array<any>;
  closeBusinessReviewsPage: () => void;
};

export default function BusinessReviewsScreen({
  styles,
  colors,
  businessName,
  reviews,
  closeBusinessReviewsPage,
}: BusinessReviewsScreenProps) {
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
              onPress={closeBusinessReviewsPage}
              activeOpacity={0.85}
            >
              <Ionicons name="arrow-back" size={22} color={colors.ink} />
            </TouchableOpacity>
            <View style={styles.createBusinessPageHeaderCopy}>
              <Text style={styles.createBusinessPageTitle}>{businessName || "Business Reviews"}</Text>
              <Text style={styles.createBusinessPageSubtitle}>
                Read-only review history for this business.
              </Text>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.createBusinessPageContent}
            keyboardShouldPersistTaps="handled"
          >
            {reviews.length === 0 ? (
              <View style={styles.ownerDashboardEmptyCard}>
                <Text style={styles.ownerDashboardEmptyTitle}>No reviews yet</Text>
                <Text style={styles.ownerDashboardEmptyBody}>
                  Reviews for this business will appear here.
                </Text>
              </View>
            ) : (
              reviews.map((review) => (
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
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
