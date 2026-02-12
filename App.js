import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppState,
  Animated,
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PinchGestureHandler,
  State as GestureState,
} from "react-native-gesture-handler";
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import MapView, { Marker } from "react-native-maps";
import { LinearGradient } from "expo-linear-gradient";
import * as Font from "expo-font";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";
import * as Clipboard from "expo-clipboard";
import { toByteArray } from "base64-js";
import { createClient } from "@supabase/supabase-js";
import * as Location from "expo-location";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import {
  create as createPlaidLink,
  destroy as destroyPlaidLink,
  open as openPlaidLink,
  LinkIOSPresentationStyle,
  LinkLogLevel,
} from "react-native-plaid-link-sdk";
import {
  supabase,
  refreshSupabaseClient,
  getAccessTokenWithFallback,
  refreshAccessTokenWithRefreshToken,
  clearSupabaseSession,
} from "./lib/supabase";
import { getEnv } from "./lib/env";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
const IS_COMPACT = SCREEN_WIDTH < 360;
const IS_NARROW = SCREEN_WIDTH < 420;
const IS_SHORT = SCREEN_HEIGHT < 700;
const SHEET_MIN = IS_SHORT ? 140 : 160;
const SHEET_MAX = Math.min(SCREEN_HEIGHT * 0.72, IS_SHORT ? 560 : 620);
const SAFE_TOP =
  Platform.OS === "android"
    ? (StatusBar.currentHeight || 0) + (IS_COMPACT ? 8 : 12)
    : IS_COMPACT
      ? 8
      : 12;
const CARD_WIDTH = Math.min(280, Math.max(210, Math.round(SCREEN_WIDTH * 0.7)));
const CARD_GAP = Math.round(Math.max(10, SCREEN_WIDTH * 0.03));
const OFFER_IMAGE_ASPECT = 2 / 1;
const OFFER_UPLOAD_WIDTH = 1200;
const OFFER_UPLOAD_HEIGHT = Math.round(OFFER_UPLOAD_WIDTH / OFFER_IMAGE_ASPECT);
const CARD_MEDIA_HEIGHT = Math.round(
  (CARD_WIDTH - (IS_COMPACT ? 28 : 32)) / OFFER_IMAGE_ASPECT,
);
const CARD_MEDIA_FULL_HEIGHT = Math.round(CARD_WIDTH / OFFER_IMAGE_ASPECT);
const QR_SIZE = Math.min(200, Math.max(130, Math.round(SCREEN_WIDTH * 0.42)));
const SCANNER_FRAME = Math.min(
  300,
  Math.max(210, Math.round(SCREEN_HEIGHT * 0.32)),
);
const SCANNER_CARD_WIDTH = Math.max(280, SCREEN_WIDTH - 40);
const SCANNER_CARD_HEIGHT = SCANNER_FRAME + (IS_COMPACT ? 160 : 180);
// How close the customer must be to redeem. Keep this strict, but not so strict
// that normal GPS drift blocks legitimate in-store redemptions.
const REDEEM_RADIUS_METERS = 40;
const REDEEM_BLOCKED_MESSAGE = "You need to be in store to redeem.";
const PLAID_AUTO_VERIFY_COPY =
  "Cashback is automatically verified when purchases are visible through your linked bank.";
const PLAID_FALLBACK_COPY =
  "Some cards or banks may require receipt upload for verification.";
const PLAID_PENDING_COPY =
  "Cashback may appear as pending while verification completes.";
const COMMISSION_RATE_PERCENT = 10;
const CASHBACK_RATE_PERCENT = 5;
const CASHBACK_BASE_RATE_BPS = 500;
const NEW_WINDOW_MS = 1000 * 60 * 60 * 24 * 10;
const ADDRESS_DEBOUNCE_MS = 300;
const GOOGLE_PLACES_KEY = getEnv("EXPO_PUBLIC_GOOGLE_MAPS_API_KEY");
const SUPABASE_URL = getEnv("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = getEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY");
const PLAID_ANDROID_PACKAGE_NAME =
  Constants.expoConfig?.android?.package ||
  Constants.manifest2?.extra?.expoClient?.android?.package ||
  "com.wellopartners.wello";
const ANDROID_MARKER_SIZE = 34;
const ANDROID_MARKER_SELECTED_SIZE = 44;
const CONFETTI_PIECES = 20;
const NOTIFICATION_DEFAULTS = {
  new_offer: true,
  expiring_offer: true,
  nearby_offer: true,
};
const NAV_PILL_MIN = IS_COMPACT ? 78 : 90;
const NAV_GAP = IS_COMPACT ? 6 : 8;
const NAV_PADDING = IS_COMPACT ? 8 : 10;
const TIME_SELECT_MAX = Math.min(160, Math.round(SCREEN_WIDTH * 0.42));
const TIME_SELECT_MIN = IS_COMPACT ? 80 : 96;
const TIME_MERIDIEM_WIDTH = IS_COMPACT ? 68 : 80;
const OFFERS_REFRESH_INTERVAL_MS = 1000 * 60 * 2;
const REFRESH_MIN_INTERVAL_MS = 1000 * 15;
const LIVE_POLL_MS = 1000 * 30;
const LIVE_DEBOUNCE_MS = 1200;
const RECEIPT_PREVIEW_HEIGHT = Math.min(SCREEN_HEIGHT * 0.78, 760);
const RECEIPT_PREVIEW_WIDTH = Math.min(SCREEN_WIDTH - 24, 720);
const RECEIPT_PREVIEW_MAX_ZOOM = 6;
const TIME_OPTIONS = [
  "12:00",
  "12:30",
  "1:00",
  "1:30",
  "2:00",
  "2:30",
  "3:00",
  "3:30",
  "4:00",
  "4:30",
  "5:00",
  "5:30",
  "6:00",
  "6:30",
  "7:00",
  "7:30",
  "8:00",
  "8:30",
  "9:00",
  "9:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
];
const CONFETTI_COLORS = [
  "#F8C27A",
  "#F59E8B",
  "#8EC5F8",
  "#9DE3C1",
  "#F6A6C9",
  "#F2D36B",
  "#7FB7E8",
  "#C0E8B4",
];

const FONT_REGULAR = "Rubik-Regular";
const FONT_MEDIUM = "Rubik-Medium";
const FONT_SEMIBOLD = "Rubik-SemiBold";
const FONT_BOLD = "Rubik-Bold";
const FONT_DISPLAY = FONT_SEMIBOLD;
const FONT_TEXT = FONT_REGULAR;

const COLORS = {
  ink: "#0F172A",
  cream: "#F4F6F9",
  sand: "#D7DEE8",
  mint: "#E3EBF5",
  coral: "#1F4E8C",
  sun: "#E8D6B6",
  pine: "#12283A",
  white: "#FFFFFF",
  shadow: "rgba(15, 23, 42, 0.12)",
  muted: "#5C6B7A",
};

const daysAgo = (days) => Date.now() - days * 24 * 60 * 60 * 1000;

function ConfettiDrizzle({ active, width, height, style }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: CONFETTI_PIECES }, (_, index) => {
        const size = 6 + (index % 4) * 2;
        const spread = Math.max(120, width - 16);
        return {
          id: index,
          size,
          color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
          x: Math.round(((index + 0.4) / CONFETTI_PIECES) * spread),
          delay: (index % 6) * 160,
          duration: 2400 + (index % 5) * 420,
        };
      }),
    [width],
  );
  const fallValues = useRef(
    pieces.map((_, index) => new Animated.Value(-20 - (index % 4) * 12)),
  ).current;

  useEffect(() => {
    if (!active) {
      fallValues.forEach((value, index) => {
        value.stopAnimation(() => {
          value.setValue(-20 - (index % 4) * 12);
        });
      });
      return;
    }

    const loops = [];
    const timeouts = [];

    fallValues.forEach((value, index) => {
      const piece = pieces[index];
      value.setValue(-20 - (index % 4) * 12);
      const startLoop = () => {
        const loop = Animated.loop(
          Animated.timing(value, {
            toValue: height + 24,
            duration: piece.duration,
            useNativeDriver: true,
          }),
          { resetBeforeIteration: true },
        );
        loop.start();
        loops[index] = loop;
      };

      if (piece.delay) {
        timeouts.push(setTimeout(startLoop, piece.delay));
      } else {
        startLoop();
      }
    });

    return () => {
      timeouts.forEach((timeoutId) => clearTimeout(timeoutId));
      loops.forEach((loop) => loop?.stop());
    };
  }, [active, fallValues, pieces, height]);

  if (!active) return null;

  return (
    <View style={[styles.confettiOverlay, style]} pointerEvents="none">
      {pieces.map((piece, index) => (
        <Animated.View
          key={`confetti-${piece.id}`}
          style={[
            styles.confettiPiece,
            {
              backgroundColor: piece.color,
              width: piece.size,
              height: piece.size * 1.4,
              left: piece.x,
              transform: [{ translateY: fallValues[index] }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const BUSINESSES = [
  {
    id: "1",
    name: "Sunrise Cafe",
    category: "Cafe and Bakery",
    categoryKey: "cafe",
    offer: "Buy 1 latte, get a croissant",
    qrCode: "WELLO-1-9FQ7K2A1",
    distance: "0.6 mi",
    rating: 4.8,
    tags: ["breakfast", "wifi", "open"],
    isOpen: true,
    hours: "7:00 AM - 6:00 PM",
    createdAt: daysAgo(3),
    coordinate: { latitude: 40.7138, longitude: -74.0065 },
    approved: true,
    rejected: false,
    source: "seed",
  },
  {
    id: "2",
    name: "Harbor Fitness",
    category: "Activities & Entertainment",
    categoryKey: "activity",
    offer: "First month 30% off",
    qrCode: "WELLO-2-L4M8Z0T7",
    distance: "1.1 mi",
    rating: 4.9,
    tags: ["classes", "movement", "community"],
    isOpen: true,
    hours: "5:30 AM - 9:00 PM",
    createdAt: daysAgo(8),
    coordinate: { latitude: 40.7119, longitude: -74.0018 },
    approved: true,
    rejected: false,
    source: "seed",
  },
  {
    id: "3",
    name: "Cedar Auto Spa",
    category: "Carwash / Auto Cosmetic",
    categoryKey: "auto",
    offer: "Deluxe wash w/ ceramic coat",
    qrCode: "WELLO-3-7P2X5N9C",
    distance: "0.9 mi",
    rating: 4.6,
    tags: ["ceramic", "detail", "shine"],
    isOpen: true,
    hours: "8:00 AM - 8:00 PM",
    createdAt: daysAgo(14),
    coordinate: { latitude: 40.7152, longitude: -74.0083 },
    approved: true,
    rejected: false,
    source: "seed",
  },
  {
    id: "4",
    name: "Luna Nail Studio",
    category: "Barbershop / Salon",
    categoryKey: "barbersalon",
    offer: "Free gloss with any set",
    qrCode: "WELLO-4-K3T8Q1B6",
    distance: "1.4 mi",
    rating: 4.9,
    tags: ["gel", "walk-in", "new"],
    isOpen: false,
    hours: "10:00 AM - 7:00 PM",
    createdAt: daysAgo(2),
    coordinate: { latitude: 40.7096, longitude: -74.0105 },
    approved: true,
    rejected: false,
    source: "seed",
  },
  {
    id: "5",
    name: "Rivertown Cafe & Bar",
    category: "Drink places",
    categoryKey: "drink",
    offer: "Evening cocktail flight $18",
    qrCode: "WELLO-5-M9R2V7D4",
    distance: "0.5 mi",
    rating: 4.9,
    tags: ["cocktails", "cozy", "live"],
    isOpen: true,
    hours: "3:00 PM - 11:00 PM",
    createdAt: daysAgo(6),
    coordinate: { latitude: 40.7145, longitude: -74.0034 },
    approved: true,
    rejected: false,
    source: "seed",
  },
  {
    id: "6",
    name: "Steel & Stone Auto Detail",
    category: "Carwash / Auto Cosmetic",
    categoryKey: "auto",
    offer: "Bundle any 2 services",
    qrCode: "WELLO-6-J5C1Y8W3",
    distance: "1.8 mi",
    rating: 4.5,
    tags: ["detail", "finish"],
    isOpen: true,
    hours: "10:00 AM - 8:00 PM",
    createdAt: daysAgo(20),
    coordinate: { latitude: 40.7121, longitude: -74.0121 },
    approved: true,
    rejected: false,
    source: "seed",
  },
  {
    id: "7",
    name: "Harbor Barbers",
    category: "Barbershop",
    categoryKey: "barber",
    offer: "Free line-up with any cut",
    qrCode: "WELLO-7-H2N6F9S4",
    distance: "1.0 mi",
    rating: 4.6,
    tags: ["fade", "appointments", "open"],
    isOpen: true,
    hours: "9:00 AM - 6:30 PM",
    createdAt: daysAgo(9),
    coordinate: { latitude: 40.7107, longitude: -74.0042 },
    approved: true,
    rejected: false,
    source: "seed",
  },
  {
    id: "8",
    name: "Riverfront Grill",
    category: "Restaurant",
    categoryKey: "restaurant",
    offer: "Lunch special $14",
    qrCode: "WELLO-8-Q4B7U1X9",
    distance: "0.8 mi",
    rating: 4.7,
    tags: ["patio", "happy-hour", "open"],
    isOpen: true,
    hours: "11:00 AM - 10:00 PM",
    createdAt: daysAgo(1),
    coordinate: { latitude: 40.7161, longitude: -74.005 },
    approved: true,
    rejected: false,
    source: "seed",
  },
];

const OFFER_SEEDS = BUSINESSES.flatMap((business, index) => [
  {
    id: `seed-${business.id}-main`,
    businessId: business.id,
    title: business.offer || "Local offer",
    description: "Tap to redeem this in-store offer.",
    offerType: "discount",
    imageUrl: "",
    active: true,
    approvalStatus: "approved",
    createdAt: daysAgo(index + 1),
    business,
  },
]);

const BUSINESS_ANALYTICS = {
  1: { views: 1840, saves: 312, redemptions: 86, reach: "6.2k" },
  2: { views: 1620, saves: 276, redemptions: 63, reach: "5.4k" },
  3: { views: 1180, saves: 198, redemptions: 41, reach: "4.1k" },
  4: { views: 980, saves: 146, redemptions: 38, reach: "3.2k" },
  5: { views: 1540, saves: 284, redemptions: 59, reach: "5.8k" },
  6: { views: 1320, saves: 224, redemptions: 47, reach: "4.6k" },
  7: { views: 1410, saves: 246, redemptions: 52, reach: "5.1k" },
  8: { views: 1760, saves: 298, redemptions: 74, reach: "6.0k" },
};
const DEFAULT_ANALYTICS = { views: 0, saves: 0, redemptions: 0, reach: "0" };

const MAP_REGION = {
  latitude: 40.7128,
  longitude: -74.006,
  latitudeDelta: 0.055,
  longitudeDelta: 0.045,
};

const mapSupabaseBusiness = (row, index) => {
  const categoryKey = row.category_key || "restaurant";
  const categoryConfig = getCategoryConfig(categoryKey);
  const latitude = row.latitude !== null ? Number(row.latitude) : null;
  const longitude = row.longitude !== null ? Number(row.longitude) : null;
  const hasCoordinates =
    Number.isFinite(latitude) && Number.isFinite(longitude);
  const safeIndex = Number.isFinite(index) ? index : 0;
  const fallbackCoordinate = {
    latitude: MAP_REGION.latitude + safeIndex * 0.002,
    longitude: MAP_REGION.longitude - safeIndex * 0.002,
  };
  return {
    id: String(row.id || index + 1),
    ownerId: row.owner_id || null,
    name: row.name || "Wello business",
    address: row.address || "",
    category: row.category_label || categoryConfig.display,
    categoryKey,
    offer: row.offer_highlight || "New offer available",
    distance: "--",
    rating: Number.isFinite(Number(row.rating)) ? Number(row.rating) : null,
    tags: Array.isArray(row.tags) && row.tags.length ? row.tags : ["local"],
    isOpen: row.is_open ?? true,
    hours: row.hours || "Hours available upon request",
    phone: row.phone || "",
    city: row.city || "",
    state: row.state || "",
    postalCode: row.postal_code || "",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : daysAgo(5),
    coordinate: hasCoordinates ? { latitude, longitude } : null,
    fallbackCoordinate,
    hasCoordinates,
    approved: row.approval_status === "approved",
    rejected: row.approval_status === "rejected",
    qrCode: row.qr_code || "",
    stripeAccountId: row.stripe_account_id || null,
    stripeCustomerId: row.stripe_customer_id || null,
    stripePaymentMethodId: row.stripe_payment_method_id || null,
    stripePaymentMethodBrand: row.stripe_payment_method_brand || null,
    stripePaymentMethodLast4: row.stripe_payment_method_last4 || null,
    stripeChargesEnabled: row.stripe_charges_enabled ?? false,
    stripePayoutsEnabled: row.stripe_payouts_enabled ?? false,
    stripeOnboardedAt: row.stripe_onboarded_at
      ? new Date(row.stripe_onboarded_at).getTime()
      : null,
    commissionRateCents: Number.isFinite(Number(row.commission_rate_cents))
      ? Number(row.commission_rate_cents)
      : 0,
    commissionEnabled: row.commission_enabled ?? true,
    source: "supabase",
  };
};

const mapSupabaseOffer = (row) => ({
  id: String(row.id),
  businessId: row.business_id,
  title: row.title || "",
  description: row.description || "",
  offerType: row.offer_type || "",
  imageUrl: row.image_url || "",
  active: row.active ?? true,
  approvalStatus: row.approval_status || "approved",
  redemptionLimitPeriod: row.redemption_limit_period || null,
  redemptionLimitCount: Number.isFinite(Number(row.redemption_limit_count))
    ? Number(row.redemption_limit_count)
    : null,
  createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  business: row.business || null,
});

const mapSupabaseRedemption = (row) => ({
  id: String(row.id),
  createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  businessId: row.business_id || null,
  offerId: row.offer_id || null,
  offer: row.offer || null,
  business: row.business || null,
  purchaseVerification: (() => {
    const verification = Array.isArray(row.purchase_verifications)
      ? row.purchase_verifications[0]
      : row.purchase_verifications;
    if (!verification) return null;
    return {
      id: String(verification.id),
      source: verification.source || null,
      status: verification.status || null,
      reasonCode: verification.reason_code || null,
      reasonDetail: verification.reason_detail || null,
      lastCheckedAt: verification.last_checked_at
        ? new Date(verification.last_checked_at).getTime()
        : null,
      confirmedAt: verification.confirmed_at
        ? new Date(verification.confirmed_at).getTime()
        : null,
      rejectedAt: verification.rejected_at
        ? new Date(verification.rejected_at).getTime()
        : null,
    };
  })(),
  receipt: (() => {
    const receipt = Array.isArray(row.receipt_uploads)
      ? row.receipt_uploads[0]
      : row.receipt_uploads;
    if (!receipt) return null;
    const cashbackEvent = (() => {
      const events = Array.isArray(receipt.cashback_events)
        ? receipt.cashback_events
        : receipt.cashback_events
          ? [receipt.cashback_events]
          : [];
      return events[0] || null;
    })();
    return {
      id: String(receipt.id),
      storagePath: receipt.storage_path || "",
      verificationSource: receipt.verification_source || "receipt",
      verificationReference: receipt.verification_reference || null,
      reviewStatus: receipt.review_status || null,
      uploadedAt: receipt.uploaded_at
        ? new Date(receipt.uploaded_at).getTime()
        : Date.now(),
      cashbackCents: Number(cashbackEvent?.amount_cents) || 0,
      cashbackStatus: cashbackEvent?.status || null,
    };
  })(),
});

const mapSupabaseReview = (row) => ({
  id: String(row.id),
  businessId: row.business_id || null,
  redemptionId: row.redemption_id || null,
  offerId: row.offer_id || null,
  rating: Number(row.rating) || 0,
  reviewText: row.review_text || "",
  createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
});

const computeAverageRating = (reviews) => {
  const values = (reviews || [])
    .map((review) => Number(review.rating))
    .filter((rating) => Number.isFinite(rating) && rating > 0);
  if (!values.length) return null;
  return values.reduce((sum, rating) => sum + rating, 0) / values.length;
};

const formatDisplayName = (email) => {
  if (!email) return "Wello Member";
  const fallbackName = email.split("@")[0] || "Wello Member";
  return fallbackName
    .replace(/[._-]+/g, " ")
    .split(" ")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
};

const formatHistoryTimestamp = (value) => {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  const dateLabel = date.toLocaleDateString();
  const timeLabel = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  // Use an explicit unicode middle dot to avoid mojibake ("Â·") on some devices/builds.
  return `${dateLabel} \u00b7 ${timeLabel}`;
};

const HISTORY_ACCENT_PALETTE = [
  "#0EA5E9", // sky
  "#22C55E", // green
  "#F97316", // orange
  "#A855F7", // violet
  "#F43F5E", // rose
  "#14B8A6", // teal
];

const hexToRgba = (hex, alpha) => {
  const raw = String(hex || "").replace("#", "").trim();
  const normalized =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (normalized.length !== 6) return `rgba(15, 23, 42, ${alpha})`;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const stableHash = (value) => {
  const input = String(value || "");
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const pickHistoryAccent = (key) => {
  const idx = stableHash(key) % HISTORY_ACCENT_PALETTE.length;
  return HISTORY_ACCENT_PALETTE[idx];
};

const getInitials = (value) => {
  const name = String(value || "").trim();
  if (!name) return "W";
  const parts = name
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "W";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].slice(0, 1) + parts[1].slice(0, 1)).toUpperCase();
};

const formatOfferDate = (value) => {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return date.toLocaleDateString();
};

const formatReceiptTime = (value) => {
  if (!value) return "--";
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatPurchaseVerificationReason = (reasonCode, reasonDetail) => {
  if (reasonDetail) return reasonDetail;
  switch (String(reasonCode || "").trim()) {
    case "bank_not_linked":
      return "Link a bank for automatic verification, or upload a receipt.";
    case "transaction_pending":
      return "Matching transaction found but still pending settlement.";
    case "transaction_delayed":
      return "Transaction data is delayed. Upload a receipt if needed now.";
    case "merchant_mismatch":
      return "Merchant details could not be matched confidently.";
    case "amount_mismatch":
      return "Amount could not be matched confidently.";
    case "identity_mismatch":
      return "Account ownership check did not match.";
    case "receipt_under_review":
      return "Receipt uploaded and pending review.";
    case "receipt_rejected":
      return "Receipt review was rejected.";
    default:
      return "";
  }
};

const formatBusinessHours = (startTime, startMeridiem, endTime, endMeridiem) =>
  `${startTime} ${startMeridiem} - ${endTime} ${endMeridiem}`;

const mergeVerificationCopy = (...parts) => {
  const unique = [];
  parts.forEach((part) => {
    const text = String(part || "").trim();
    if (!text) return;
    if (!unique.includes(text)) unique.push(text);
  });
  return unique.join("\n\n");
};

const isTransientProfileUpsertRls = (message) => {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("row-level security policy") ||
    text.includes("violates row-level security policy") ||
    text.includes("permission denied")
  );
};

const parseBusinessHours = (value) => {
  if (!value) return null;
  const normalized = String(value).replace(/[â€“â€”]/g, "-");
  const parts = normalized
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const parsePart = (part) => {
    const match = part.match(/^(\d{1,2}(?::\d{2})?)\s*(AM|PM)?$/i);
    if (!match) return null;
    return {
      time: match[1],
      meridiem: (match[2] || "AM").toUpperCase(),
    };
  };
  const start = parsePart(parts[0]);
  const end = parsePart(parts[1]);
  if (!start || !end) return null;
  return {
    startTime: start.time,
    startMeridiem: start.meridiem,
    endTime: end.time,
    endMeridiem: end.meridiem,
  };
};

const levenshteinDistance = (value, target) => {
  const a = String(value || "");
  const b = String(target || "");
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
    }
  }
  return rows[a.length][b.length];
};

const OFFER_TYPE_LABELS = {
  bogo: "BOGO",
  discount: "Discount",
  bundle: "Bundle",
  freebie: "Freebie",
  event: "Event",
};

const normalizeOfferType = (input) => {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const aliases = {
    "buy one get one": "bogo",
    buy1get1: "bogo",
    b1g1: "bogo",
    "2 for 1": "bogo",
    "2for1": "bogo",
    "two for one": "bogo",
    "two-for-one": "bogo",
    bogo: "bogo",
    discount: "discount",
    "percent off": "discount",
    "percentage off": "discount",
    promo: "discount",
    bundle: "bundle",
    free: "freebie",
    freebie: "freebie",
    event: "event",
  };
  if (aliases[lower]) return OFFER_TYPE_LABELS[aliases[lower]];
  const entries = Object.entries(OFFER_TYPE_LABELS);
  for (const [, label] of entries) {
    const labelLower = label.toLowerCase();
    if (labelLower.includes(lower) || lower.includes(labelLower)) {
      return label;
    }
  }
  let bestLabel = raw;
  let bestScore = Number.POSITIVE_INFINITY;
  entries.forEach(([key, label]) => {
    const labelLower = label.toLowerCase();
    const score = Math.min(
      levenshteinDistance(lower, key),
      levenshteinDistance(lower, labelLower),
    );
    if (score < bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  });
  const threshold = Math.max(2, Math.floor(raw.length * 0.3));
  return bestScore <= threshold ? bestLabel : raw;
};

const normalizeTagsInput = (value) =>
  String(value || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

const clampValue = (value, min, max) => Math.min(max, Math.max(min, value));

const decodeJwtPayloadClient = (token) => {
  if (!token) return null;
  const parts = String(token).split(".");
  if (parts.length < 2) return null;
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    const bytes = toByteArray(padded);
    const json = String.fromCharCode(...bytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout`)), ms),
    ),
  ]);

const safeLocalSignOut = async () => {
  try {
    await clearSupabaseSession();
  } catch (error) {
    console.warn("Failed to clear Supabase session", error?.message);
  }
  try {
    await withTimeout(
      supabase.auth.signOut({ scope: "local" }),
      8000,
      "signOut",
    );
  } catch (error) {
    console.warn("Supabase signOut failed", error?.message);
  }
};

const callStripeFunction = async (functionName, payload) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { data: null, error: "Supabase is not configured.", status: null };
  }
  const refreshResult = refreshSupabaseClient();
  if (!refreshResult.ok) {
    return { data: null, error: refreshResult.error, status: null };
  }

  const tokenResult = await getAccessTokenWithFallback(6000);
  let accessToken = tokenResult.accessToken;
  if (!accessToken) {
    const refreshed = await refreshAccessTokenWithRefreshToken(6000, {
      persist: false,
    });
    accessToken = refreshed?.accessToken || "";
  }
  if (!accessToken) {
    return { data: null, error: "Sign in again to continue.", status: null };
  }

  const tokenPayload = decodeJwtPayloadClient(accessToken);
  const issuer = tokenPayload?.iss || "";
  const expectedIssuer = SUPABASE_URL
    ? `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1`
    : "";
  const refreshForStripe = async () =>
    refreshAccessTokenWithRefreshToken(6000, { persist: false });
  if (expectedIssuer && issuer && issuer !== expectedIssuer) {
    const refreshed = await refreshForStripe();
    if (refreshed?.accessToken) {
      accessToken = refreshed.accessToken;
    } else {
      return {
        data: null,
        error: "Session belongs to a different project. Please sign in again.",
        status: null,
      };
    }
  }
  const exp = Number(tokenPayload?.exp);
  if (Number.isFinite(exp) && exp * 1000 < Date.now()) {
    const refreshed = await refreshForStripe();
    if (refreshed?.accessToken) {
      accessToken = refreshed.accessToken;
    } else {
      return {
        data: null,
        error: "Session expired. Please sign in again.",
        status: null,
      };
    }
  }

  const runRequest = async (token) => {
    const startTime = Date.now();
    const body = { ...(payload || {}) };
    const response = await withTimeout(
      supabase.functions.invoke(functionName, {
        body,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      12000,
      "stripe_invoke",
    );
    if (!response?.error) {
      let parsedData = response?.data ?? null;
      if (typeof parsedData === "string") {
        try {
          parsedData = parsedData ? JSON.parse(parsedData) : null;
        } catch {
          parsedData = response?.data ?? null;
        }
      }
      return {
        ok: true,
        status: 200,
        parsed: parsedData,
        rawText:
          typeof parsedData === "string"
            ? parsedData
            : parsedData
              ? JSON.stringify(parsedData)
              : "",
        errorMessage: null,
        durationMs: Date.now() - startTime,
      };
    }

    const err = response.error;
    const context = err?.context;
    const status = context?.status ?? null;
    let rawText = "";
    let parsed = null;
    if (context?.text) {
      try {
        rawText = await context.text();
      } catch {
        rawText = "";
      }
    }
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = null;
    }
    const baseErrorMessage =
      parsed?.error ||
      parsed?.message ||
      err?.message ||
      (status
        ? `Stripe request failed (${status}).`
        : "Stripe request failed.");
    const errorMessage =
      parsed?.phase && typeof parsed.phase === "string"
        ? `${baseErrorMessage} (phase: ${parsed.phase})`
        : baseErrorMessage;
    return {
      ok: false,
      status,
      parsed,
      rawText,
      errorMessage,
      durationMs: Date.now() - startTime,
    };
  };

  try {
    let attempt = await runRequest(accessToken);
    const rawTextLower = String(attempt.rawText || "").toLowerCase();
    const parsedMessage = String(
      attempt.parsed?.message || attempt.parsed?.error || "",
    ).toLowerCase();
    const isAuthFailure =
      attempt.status === 401 ||
      rawTextLower.includes("invalid jwt") ||
      rawTextLower.includes("jwt expired") ||
      rawTextLower.includes("unauthorized") ||
      rawTextLower.includes("missing authorization") ||
      parsedMessage.includes("invalid jwt") ||
      parsedMessage.includes("jwt expired") ||
      parsedMessage.includes("unauthorized") ||
      parsedMessage.includes("missing authorization");

    if (!attempt.ok && isAuthFailure) {
      try {
        const refreshResult = await refreshAccessTokenWithRefreshToken(6000, {
          persist: false,
        });
        const refreshedToken = refreshResult?.accessToken || "";
        if (refreshedToken) {
          attempt = await runRequest(refreshedToken);
        }
      } catch (_error) {}
    }

    if (!attempt.ok) {
      console.warn("Stripe function failed", {
        functionName,
        status: attempt.status,
        error: attempt.errorMessage,
        parsed: attempt.parsed,
        raw: attempt.rawText,
      });
      return {
        data: null,
        error: attempt.errorMessage,
        status: attempt.status,
        details: attempt.parsed ?? null,
      };
    }
    return {
      data: attempt.parsed ?? null,
      error: null,
      status: attempt.status,
      details: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error?.message || "Stripe request failed.",
      status: null,
      details: null,
    };
  }
};

const callPlaidFunction = async (functionName, payload) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { data: null, error: "Supabase is not configured.", status: null };
  }
  const refreshResult = refreshSupabaseClient();
  if (!refreshResult.ok) {
    return { data: null, error: refreshResult.error, status: null };
  }

  const tokenResult = await getAccessTokenWithFallback(6000);
  let accessToken = tokenResult.accessToken;
  if (!accessToken) {
    const refreshed = await refreshAccessTokenWithRefreshToken(6000, {
      persist: false,
    });
    accessToken = refreshed?.accessToken || "";
  }
  if (!accessToken) {
    return { data: null, error: "Sign in again to continue.", status: null };
  }

  const tokenPayload = decodeJwtPayloadClient(accessToken);
  const issuer = tokenPayload?.iss || "";
  const expectedIssuer = SUPABASE_URL
    ? `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1`
    : "";
  const refreshForPlaid = async () =>
    refreshAccessTokenWithRefreshToken(6000, { persist: false });
  if (expectedIssuer && issuer && issuer !== expectedIssuer) {
    const refreshed = await refreshForPlaid();
    if (refreshed?.accessToken) {
      accessToken = refreshed.accessToken;
    } else {
      return {
        data: null,
        error: "Session belongs to a different project. Please sign in again.",
        status: null,
      };
    }
  }
  const exp = Number(tokenPayload?.exp);
  if (Number.isFinite(exp) && exp * 1000 < Date.now()) {
    const refreshed = await refreshForPlaid();
    if (refreshed?.accessToken) {
      accessToken = refreshed.accessToken;
    } else {
      return {
        data: null,
        error: "Session expired. Please sign in again.",
        status: null,
      };
    }
  }

  const runRequest = async (token) => {
    const startTime = Date.now();
    const body = { ...(payload || {}) };
    const response = await withTimeout(
      supabase.functions.invoke(functionName, {
        body,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      12000,
      "plaid_invoke",
    );
    if (!response?.error) {
      let parsedData = response?.data ?? null;
      if (typeof parsedData === "string") {
        try {
          parsedData = parsedData ? JSON.parse(parsedData) : null;
        } catch {
          parsedData = response?.data ?? null;
        }
      }
      return {
        ok: true,
        status: 200,
        parsed: parsedData,
        rawText:
          typeof parsedData === "string"
            ? parsedData
            : parsedData
              ? JSON.stringify(parsedData)
              : "",
        errorMessage: null,
        durationMs: Date.now() - startTime,
      };
    }

    const err = response.error;
    const context = err?.context;
    const status = context?.status ?? null;
    let rawText = "";
    let parsed = null;
    if (context?.text) {
      try {
        rawText = await context.text();
      } catch {
        rawText = "";
      }
    }
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = null;
    }
    const baseErrorMessage =
      parsed?.error ||
      parsed?.message ||
      err?.message ||
      (status
        ? `Verification request failed (${status}).`
        : "Verification request failed.");
    return {
      ok: false,
      status,
      parsed,
      rawText,
      errorMessage: baseErrorMessage,
      durationMs: Date.now() - startTime,
    };
  };

  try {
    let attempt = await runRequest(accessToken);
    const rawTextLower = String(attempt.rawText || "").toLowerCase();
    const parsedMessage = String(
      attempt.parsed?.message || attempt.parsed?.error || "",
    ).toLowerCase();
    const isAuthFailure =
      attempt.status === 401 ||
      rawTextLower.includes("invalid jwt") ||
      rawTextLower.includes("jwt expired") ||
      rawTextLower.includes("unauthorized") ||
      rawTextLower.includes("missing authorization") ||
      parsedMessage.includes("invalid jwt") ||
      parsedMessage.includes("jwt expired") ||
      parsedMessage.includes("unauthorized") ||
      parsedMessage.includes("missing authorization");

    if (!attempt.ok && isAuthFailure) {
      try {
        const refreshed = await refreshAccessTokenWithRefreshToken(6000, {
          persist: false,
        });
        const refreshedToken = refreshed?.accessToken || "";
        if (refreshedToken) {
          attempt = await runRequest(refreshedToken);
        }
      } catch (_error) {}
    }

    if (!attempt.ok) {
      console.warn("Plaid function failed", {
        functionName,
        status: attempt.status,
        error: attempt.errorMessage,
        parsed: attempt.parsed,
        raw: attempt.rawText,
      });
      return {
        data: null,
        error: attempt.errorMessage,
        status: attempt.status,
        details: attempt.parsed ?? null,
      };
    }
    return {
      data: attempt.parsed ?? null,
      error: null,
      status: attempt.status,
      details: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error?.message || "Verification request failed.",
      status: null,
      details: null,
    };
  }
};

const callR2Presign = async (payload) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { data: null, error: "Supabase is not configured.", status: null };
  }
  const refreshResult = refreshSupabaseClient();
  if (!refreshResult.ok) {
    return { data: null, error: refreshResult.error, status: null };
  }
  let tokenResult = await getAccessTokenWithFallback(6000);
  let accessToken = tokenResult.accessToken;
  if (!accessToken) {
    return { data: null, error: "Sign in again to continue.", status: null };
  }
  const tokenPayload = decodeJwtPayloadClient(accessToken);
  const expectedIssuer = SUPABASE_URL
    ? `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1`
    : "";
  const exp = Number(tokenPayload?.exp);
  const isExpired = Number.isFinite(exp) && exp * 1000 < Date.now();
  const issuerMismatch =
    expectedIssuer && tokenPayload?.iss && tokenPayload.iss !== expectedIssuer;
  if (isExpired || issuerMismatch) {
    const refreshed = await refreshAccessTokenWithRefreshToken(6000, {
      persist: false,
    });
    if (refreshed?.accessToken) {
      accessToken = refreshed.accessToken;
      tokenResult = refreshed;
    }
  }
  try {
    console.log("R2 presign request", {
      action: payload?.action,
      key: payload?.key,
    });
    const runInvoke = async (token) => {
      const response = await withTimeout(
        supabase.functions.invoke("r2-presign", {
          body: { ...(payload || {}) },
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        12000,
        "r2_invoke",
      );
      if (!response?.error) {
        let parsedData = response?.data ?? null;
        if (typeof parsedData === "string") {
          try {
            parsedData = parsedData ? JSON.parse(parsedData) : null;
          } catch {
            parsedData = response?.data ?? null;
          }
        }
        return {
          ok: true,
          status: 200,
          parsed: parsedData,
          rawText:
            typeof parsedData === "string"
              ? parsedData
              : parsedData
                ? JSON.stringify(parsedData)
                : "",
        };
      }
      const err = response.error;
      const context = err?.context;
      const status = context?.status ?? null;
      let rawText = "";
      let parsed = null;
      if (context?.text) {
        try {
          rawText = await context.text();
        } catch {
          rawText = "";
        }
      }
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsed = null;
      }
      return { ok: false, status, parsed, rawText };
    };

    let attempt = await runInvoke(accessToken);
    const rawLower = String(attempt.rawText || "").toLowerCase();
    const isAuthError =
      attempt.status === 401 ||
      rawLower.includes("invalid jwt") ||
      rawLower.includes("jwt expired") ||
      rawLower.includes("unauthorized");
    if (!attempt.ok && isAuthError) {
      const refreshed = await refreshAccessTokenWithRefreshToken(6000, {
        persist: false,
      });
      if (refreshed?.accessToken) {
        accessToken = refreshed.accessToken;
        attempt = await runInvoke(refreshed.accessToken);
      }
    }
    if (!attempt.ok) {
      console.warn("R2 presign failed", {
        status: attempt.status,
        message: attempt.parsed?.error || attempt.parsed?.message,
        raw: attempt.rawText,
      });
      return {
        data: null,
        error:
          attempt.parsed?.error ||
          attempt.parsed?.message ||
          attempt.rawText ||
          "Unable to sign receipt URL.",
        status: attempt.status || null,
      };
    }
    console.log("R2 presign success", {
      action: payload?.action,
      key: payload?.key,
    });
    return { data: attempt.parsed, error: null, status: attempt.status };
  } catch (error) {
    console.warn("R2 presign exception", error?.message);
    return {
      data: null,
      error: error?.message || "Unable to sign receipt URL.",
      status: null,
    };
  }
};

const formatStripeError = (error) => {
  if (!error) return "";
  const message = String(error);
  if (message.includes("does not have access to account")) {
    return "Stripe account mismatch. Please reconnect your Stripe account.";
  }
  return message
    .replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_****")
    .replace(/acct_[A-Za-z0-9]+/g, "acct_****");
};

// Note: avoid dynamic `import()` here. Metro can intermittently fail to include
// dynamically imported modules in dev, causing "Requiring unknown module" at runtime.
const loadImageManipulator = async () => ImageManipulator;

const formatMetricValue = (value) => {
  if (value === null || value === undefined) return "â€”";
  if (typeof value === "number") return value.toLocaleString();
  const text = String(value).trim();
  return text.length ? text : "â€”";
};

const formatCurrencyFromCents = (cents) => {
  const amount = Number.isFinite(Number(cents)) ? Number(cents) : 0;
  return `$${(amount / 100).toFixed(2)}`;
};

const computeContainedSize = (
  viewportWidth,
  viewportHeight,
  imageWidth,
  imageHeight,
) => {
  const vw = Number(viewportWidth) || 0;
  const vh = Number(viewportHeight) || 0;
  const iw = Number(imageWidth) || 0;
  const ih = Number(imageHeight) || 0;
  if (!vw || !vh) return { width: 0, height: 0 };
  if (!iw || !ih) return { width: vw, height: vh };
  const scale = Math.min(vw / iw, vh / ih);
  return { width: iw * scale, height: ih * scale };
};

const openMapsForBusiness = async (business) => {
  if (!business) return;
  const latitude =
    business.coordinate?.latitude ?? business.latitude ?? business.lat ?? null;
  const longitude =
    business.coordinate?.longitude ??
    business.longitude ??
    business.lng ??
    null;
  const addressParts = [
    business.address,
    business.city,
    business.state,
    business.postalCode,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  const address = addressParts.join(", ");
  const destination =
    latitude && longitude
      ? `${latitude},${longitude}`
      : address
        ? encodeURIComponent(address)
        : null;
  if (!destination) return;

  // Prefer native maps apps over web on iOS to avoid App Store prompts.
  const destinationParam = encodeURIComponent(
    latitude && longitude ? `${latitude},${longitude}` : address,
  );
  const googleWebUrl = `https://www.google.com/maps/dir/?api=1&destination=${destinationParam}`;

  if (Platform.OS === "ios") {
    const appleMapsUrl =
      latitude && longitude
        ? `maps://?daddr=${latitude},${longitude}`
        : `maps://?daddr=${destinationParam}`;
    try {
      await Linking.openURL(appleMapsUrl);
      return;
    } catch (error) {
      // Fall back to the web if the scheme is blocked (rare).
      await Linking.openURL(googleWebUrl).catch(() => null);
      return;
    }
  }

  if (Platform.OS === "android") {
    const navigationUrl =
      latitude && longitude
        ? `google.navigation:q=${encodeURIComponent(`${latitude},${longitude}`)}`
        : `google.navigation:q=${destinationParam}`;
    try {
      await Linking.openURL(navigationUrl);
      return;
    } catch (error) {
      const geoUrl =
        latitude && longitude
          ? `geo:${latitude},${longitude}?q=${encodeURIComponent(
              `${latitude},${longitude}`,
            )}`
          : `geo:0,0?q=${destinationParam}`;
      await Linking.openURL(geoUrl).catch(() =>
        Linking.openURL(googleWebUrl).catch(() => null),
      );
      return;
    }
  }

  Linking.openURL(googleWebUrl).catch(() => null);
};

const parseClockMinutes = (time, meridiem) => {
  if (!time) return null;
  const [hoursRaw, minutesRaw = "0"] = String(time).split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const normalizedHours = ((hours % 12) + 12) % 12;
  const isPm = String(meridiem).toUpperCase() === "PM";
  return (normalizedHours + (isPm ? 12 : 0)) * 60 + minutes;
};

const isBusinessOpenNow = (value) => {
  const parsed = parseBusinessHours(value);
  if (!parsed) return null;
  const start = parseClockMinutes(parsed.startTime, parsed.startMeridiem);
  const end = parseClockMinutes(parsed.endTime, parsed.endMeridiem);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return true;
  if (end > start) {
    return current >= start && current <= end;
  }
  return current >= start || current <= end;
};

const parseAddressComponents = (components = []) => {
  const get = (type) =>
    components.find((component) => component.types.includes(type))?.long_name ||
    "";
  const streetNumber = get("street_number");
  const route = get("route");
  const street = [streetNumber, route].filter(Boolean).join(" ").trim();
  return {
    street,
    city: get("locality"),
    state: get("administrative_area_level_1"),
    postalCode: get("postal_code"),
  };
};

const MAP_STYLE = [
  {
    featureType: "all",
    elementType: "labels.text.fill",
    stylers: [{ color: "#4B5563" }],
  },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#E2E8F0" }],
  },
  {
    featureType: "poi",
    elementType: "geometry.fill",
    stylers: [{ color: "#EEF2F7" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry.fill",
    stylers: [{ color: "#D7E6DD" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#F5F7FB" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#D7DEE8" }],
  },
  {
    featureType: "water",
    elementType: "geometry.fill",
    stylers: [{ color: "#CFE3F1" }],
  },
];

const TAG_OPTIONS = [
  { value: "bogo", label: "BOGO" },
  { value: "free-item", label: "Free item" },
  { value: "bundle", label: "Bundle" },
  { value: "limited-time", label: "Limited time" },
  { value: "new-customer", label: "New customer" },
];

const FILTERS = [
  { key: "open", label: "Open now" },
  { key: "top", label: "Top rated" },
  { key: "new", label: "New offers" },
  { key: "family", label: "Entertainment" },
  ...TAG_OPTIONS.map((tag) => ({
    key: `tag:${tag.value}`,
    label: tag.label,
  })),
];

const CATEGORY_OPTIONS = [
  { key: "cafe", label: "Cafes" },
  { key: "drink", label: "Drinks" },
  { key: "restaurant", label: "Restaurants/Food" },
  { key: "barbersalon", label: "Barbershops/Salons" },
  { key: "activity", label: "Activities/Entertainment" },
  { key: "auto", label: "Carwash/Auto Cosmetic" },
];

const CATEGORY_CONFIG = {
  cafe: {
    label: "CA",
    color: "#C45B3C",
    display: "Cafe",
    icon: "cafe",
  },
  drink: {
    label: "DR",
    color: "#3F6DF6",
    display: "Drinks",
    icon: "water",
  },
  restaurant: {
    label: "FO",
    color: "#B33E2A",
    display: "Restaurant / Food",
    icon: "restaurant",
  },
  barbersalon: {
    label: "BA",
    color: "#0F172A",
    display: "Barbershop / Salon",
    icon: "cut",
  },
  activity: {
    label: "AC",
    color: "#9A4FFF",
    display: "Activities / Entertainment",
    icon: "play-circle",
  },
  auto: {
    label: "AU",
    color: "#196A55",
    display: "Carwash / Auto Cosmetic",
    icon: "car",
  },
  default: {
    label: "LO",
    color: COLORS.coral,
    display: "Local",
    icon: "pin",
  },
};

function getCategoryConfig(categoryKey) {
  return CATEGORY_CONFIG[categoryKey] || CATEGORY_CONFIG.default;
}

const OFFER_IMAGE_BUCKET = "offer-images";
const LEGACY_RECEIPT_BUCKET = "receipt-images";
const RECEIPT_UPLOAD_WINDOW_MS = 1000 * 60 * 60 * 24;
const RECEIPT_URL_TTL_SECONDS = 60 * 60;

const getImagePickerMediaTypes = () => {
  if (ImagePicker.MediaType?.Images) {
    return [ImagePicker.MediaType.Images];
  }
  return undefined;
};

const isImageAsset = (asset) => {
  if (!asset) return false;
  if (asset.type && asset.type !== "image") return false;
  if (asset.mimeType && !asset.mimeType.startsWith("image/")) return false;
  return true;
};

const getCenteredOfferCrop = (width, height) => {
  if (!width || !height) return null;
  const targetAspect = OFFER_IMAGE_ASPECT;
  const currentAspect = width / height;
  let cropWidth = width;
  let cropHeight = height;
  if (currentAspect > targetAspect) {
    cropHeight = height;
    cropWidth = Math.round(height * targetAspect);
  } else if (currentAspect < targetAspect) {
    cropWidth = width;
    cropHeight = Math.round(width / targetAspect);
  }
  const originX = Math.max(0, Math.round((width - cropWidth) / 2));
  const originY = Math.max(0, Math.round((height - cropHeight) / 2));
  return {
    originX,
    originY,
    width: cropWidth,
    height: cropHeight,
  };
};

const normalizeOfferImage = async (asset) => {
  if (!asset?.uri) {
    return { image: null, error: "Invalid image selection." };
  }
  const manipulator = await loadImageManipulator();
  if (!manipulator?.manipulateAsync) {
    return {
      image: {
        uri: asset.uri,
        mimeType: asset.mimeType || "image/jpeg",
        fileName: `offer-${Date.now()}.jpg`,
        base64: asset.base64 || null,
      },
      error: null,
    };
  }
  try {
    const crop = getCenteredOfferCrop(asset.width, asset.height);
    const actions = crop
      ? [
          { crop },
          {
            resize: { width: OFFER_UPLOAD_WIDTH, height: OFFER_UPLOAD_HEIGHT },
          },
        ]
      : [
          {
            resize: { width: OFFER_UPLOAD_WIDTH, height: OFFER_UPLOAD_HEIGHT },
          },
        ];
    const result = await manipulator.manipulateAsync(asset.uri, actions, {
      compress: 0.85,
      format: manipulator.SaveFormat.JPEG,
      base64: true,
    });
    return {
      image: {
        uri: result.uri,
        mimeType: "image/jpeg",
        fileName: `offer-${Date.now()}.jpg`,
        base64: result.base64 || null,
      },
      error: null,
    };
  } catch (error) {
    return {
      image: null,
      error: error?.message || "Unable to process the image.",
    };
  }
};

const normalizeReceiptImage = async (asset) => {
  if (!asset?.uri) {
    return { image: null, error: "Invalid image selection." };
  }
  const manipulator = await loadImageManipulator();
  if (!manipulator?.manipulateAsync) {
    return {
      image: {
        uri: asset.uri,
        mimeType: asset.mimeType || "image/jpeg",
        fileName: `receipt-${Date.now()}.jpg`,
        base64: asset.base64 || null,
      },
      error: null,
    };
  }
  try {
    const maxWidth = 1600;
    const resize =
      asset.width && asset.width > maxWidth
        ? [{ resize: { width: maxWidth } }]
        : [];
    const result = await manipulator.manipulateAsync(asset.uri, resize, {
      compress: 0.85,
      format: manipulator.SaveFormat.JPEG,
      base64: true,
    });
    return {
      image: {
        uri: result.uri,
        mimeType: "image/jpeg",
        fileName: `receipt-${Date.now()}.jpg`,
        base64: result.base64 || null,
      },
      error: null,
    };
  } catch (error) {
    return {
      image: null,
      error: error?.message || "Unable to process the receipt image.",
    };
  }
};

const uploadOfferImage = async (image, businessId) => {
  if (!image?.uri && !image?.base64) return { url: null, error: null };
  const safeBusinessId = String(businessId || "business").replace(
    /[^a-zA-Z0-9-]/g,
    "",
  );
  const uri = image.uri || "";
  const rawName = image.fileName || uri.split("/").pop() || "offer.jpg";
  const cleanedName = rawName.split("?")[0];
  const extension = cleanedName.split(".").pop()?.toLowerCase() || "jpg";
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const filePath = `${safeBusinessId}/${fileName}`;

  try {
    const contentType =
      image.mimeType ||
      (extension === "jpg" || extension === "jpeg"
        ? "image/jpeg"
        : `image/${extension}`);
    const base64 =
      image.base64 ||
      (uri
        ? await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          })
        : "");
    if (!base64) {
      return { url: null, error: "Unable to read image data." };
    }
    const normalizedBase64 = base64.includes(",")
      ? base64.split(",")[1]
      : base64;
    const data = toByteArray(normalizedBase64);
    const { error } = await supabase.storage
      .from(OFFER_IMAGE_BUCKET)
      .upload(filePath, data, {
        contentType,
        upsert: false,
      });
    if (error) {
      return { url: null, error: error.message || "Upload failed." };
    }
    const { data: publicData } = supabase.storage
      .from(OFFER_IMAGE_BUCKET)
      .getPublicUrl(filePath);
    return { url: publicData?.publicUrl || null, error: null };
  } catch (error) {
    return { url: null, error: error?.message || "Upload failed." };
  }
};

const uploadReceiptImage = async (image, businessId, redemptionId) => {
  if (!image?.uri && !image?.base64) return { path: null, error: null };
  const safeBusinessId = String(businessId || "business").replace(
    /[^a-zA-Z0-9-]/g,
    "",
  );
  const safeRedemptionId = String(redemptionId || "redemption").replace(
    /[^a-zA-Z0-9-]/g,
    "",
  );
  const uri = image.uri || "";
  const rawName = image.fileName || uri.split("/").pop() || "receipt.jpg";
  const cleanedName = rawName.split("?")[0];
  const extension = cleanedName.split(".").pop()?.toLowerCase() || "jpg";
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const filePath = `receipts/${safeBusinessId}/${safeRedemptionId}/${fileName}`;

  try {
    const contentType =
      image.mimeType ||
      (extension === "jpg" || extension === "jpeg"
        ? "image/jpeg"
        : `image/${extension}`);
    const base64 =
      image.base64 ||
      (uri
        ? await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          })
        : "");
    if (!base64) {
      return { path: null, error: "Unable to read image data." };
    }
    const {
      data: signData,
      error: signError,
      status: signStatus,
    } = await callR2Presign({
      action: "upload",
      key: filePath,
      contentType,
    });
    if (signError || !signData?.signedUrl) {
      return {
        path: null,
        error: signError || "Unable to authorize receipt upload.",
        debug: `presign upload failed (${signStatus ?? "no-status"}): ${
          signError || "unknown"
        }`,
      };
    }
    const normalizedBase64 = base64.includes(",")
      ? base64.split(",")[1]
      : base64;
    const data = toByteArray(normalizedBase64);
    const uploadResponse = await fetch(signData.signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      body: data,
    });
    if (!uploadResponse.ok) {
      return {
        path: null,
        error: "Upload failed.",
        debug: `r2 upload failed (${uploadResponse.status})`,
      };
    }
    return { path: filePath, error: null };
  } catch (error) {
    return {
      path: null,
      error: error?.message || "Upload failed.",
      debug: error?.message || "upload_exception",
    };
  }
};

const createReceiptSignedUrl = async (path) => {
  if (!path) return null;
  const { data, error } = await callR2Presign({
    action: "download",
    key: path,
  });
  if (!error && data?.signedUrl) {
    return data.signedUrl;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const { data: legacyData } = await supabase.storage
      .from(LEGACY_RECEIPT_BUCKET)
      .createSignedUrl(path, RECEIPT_URL_TTL_SECONDS);
    return legacyData?.signedUrl || null;
  } catch {
    return null;
  }
};

const insertReceiptUploadRecord = async ({
  redemptionId,
  businessId,
  userId,
  storagePath,
}) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { data: null, error: "Supabase is not configured." };
  }
  try {
    let tokenResult = await getAccessTokenWithFallback(6000);
    let accessToken = tokenResult.accessToken;
    if (!accessToken) {
      const refreshed = await refreshAccessTokenWithRefreshToken(6000, {
        persist: false,
      });
      accessToken = refreshed?.accessToken || "";
    }
    if (!accessToken) {
      return { data: null, error: "Sign in again to continue." };
    }

    const restClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const payload = {
      redemption_id: redemptionId,
      business_id: businessId,
      user_id: userId,
      storage_path: storagePath,
    };
    const insertResponse = await withTimeout(
      restClient
        .from("receipt_uploads")
        .insert(payload)
        .select("id, uploaded_at, storage_path")
        .maybeSingle(),
      12000,
      "receipt_insert",
    );
    if (!insertResponse.error) {
      return {
        data: insertResponse.data,
        error: null,
        status: insertResponse.status,
      };
    }

    const message =
      insertResponse.error?.message ||
      `Unable to save receipt (${insertResponse.status || "no-status"}).`;
    const lowered = String(message).toLowerCase();
    if (
      insertResponse.status === 409 ||
      insertResponse.error?.code === "23505" ||
      lowered.includes("duplicate") ||
      lowered.includes("unique")
    ) {
      const lookupResponse = await withTimeout(
        restClient
          .from("receipt_uploads")
          .select("id, uploaded_at, storage_path")
          .eq("redemption_id", redemptionId)
          .order("uploaded_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        12000,
        "receipt_lookup",
      );
      if (!lookupResponse.error && lookupResponse.data) {
        return {
          data: lookupResponse.data,
          error: null,
          status: lookupResponse.status ?? insertResponse.status,
          duplicate: true,
        };
      }
    }

    return { data: null, error: message, status: insertResponse.status };
  } catch (error) {
    return {
      data: null,
      error: error?.message || "Unable to save receipt.",
      status: null,
    };
  }
};

const getOfferImagePath = (url) => {
  if (!url) return null;
  const token = `/storage/v1/object/public/${OFFER_IMAGE_BUCKET}/`;
  const index = url.indexOf(token);
  if (index === -1) return null;
  return url.slice(index + token.length).split("?")[0];
};

const removeOfferImageByUrl = async (url) => {
  if (!url || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const path = getOfferImagePath(url);
  if (!path) return null;
  const { error } = await supabase.storage
    .from(OFFER_IMAGE_BUCKET)
    .remove([path]);
  return error?.message || null;
};

function getPendingEditLabel(field) {
  switch (field) {
    case "name":
      return "Business name";
    case "address":
      return "Address";
    case "categoryKey":
      return "Category";
    case "offer":
      return "Offer";
    case "city":
      return "City";
    case "state":
      return "State";
    case "postalCode":
      return "Zip code";
    default:
      return "Detail";
  }
}

function formatCashbackRateLabel(percentValue) {
  const value = Number(percentValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label}% cashback`;
}

function formatPercentOnlyLabel(percentValue) {
  const value = Number(percentValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label}%`;
}

function OfferCard({ item, onPress, onRedeem, selected, cashbackRatePercent }) {
  const category = getCategoryConfig(item.categoryKey);
  const ratingLabel =
    item.rating && Number.isFinite(item.rating) ? item.rating.toFixed(1) : null;
  const offerTitle = item.offerTitle || item.offer;
  const offerDescription = item.offerDescription || "";
  const offerTypeLabel = item.offerType
    ? normalizeOfferType(item.offerType)
    : "Offer";
  const redemptionLimitCount = Number(item.redemptionLimitCount);
  const redemptionLimitPeriod = String(item.redemptionLimitPeriod || "");
  const limitMeta = useMemo(() => {
    const isDay = redemptionLimitPeriod === "day";
    const isWeek = redemptionLimitPeriod === "week";
    const isLimited =
      Number.isFinite(redemptionLimitCount) &&
      redemptionLimitCount > 0 &&
      (isDay || isWeek);
    const periodLabel = isDay ? "day" : isWeek ? "week" : "";
    const count = isLimited ? redemptionLimitCount : 0;
    const mode = isLimited ? (count === 1 ? "once" : "max") : "unlimited";
    const label =
      mode === "unlimited"
        ? "Unlimited"
        : mode === "once"
          ? `Once/${periodLabel}`
          : `Max ${count}/${periodLabel}`;
    const icon = (() => {
      if (mode === "unlimited") return "infinite";
      if (isDay) return mode === "once" ? "sunny-outline" : "time-outline";
      return mode === "once" ? "calendar-outline" : "calendar-clear-outline";
    })();
    const badgeStyle =
      mode === "unlimited"
        ? styles.cardLimitBadgeUnlimited
        : mode === "once" && isDay
          ? styles.cardLimitBadgeOnceDay
          : mode === "max" && isDay
            ? styles.cardLimitBadgeMaxDay
            : mode === "once" && isWeek
              ? styles.cardLimitBadgeOnceWeek
              : styles.cardLimitBadgeMaxWeek;
    const textStyle =
      mode === "unlimited"
        ? styles.cardLimitTextUnlimited
        : mode === "once" && isDay
          ? styles.cardLimitTextOnceDay
          : mode === "max" && isDay
            ? styles.cardLimitTextMaxDay
            : mode === "once" && isWeek
              ? styles.cardLimitTextOnceWeek
              : styles.cardLimitTextMaxWeek;
    return { label, icon, badgeStyle, textStyle };
  }, [redemptionLimitCount, redemptionLimitPeriod]);
  const hoursValue = item.hours || item.business?.hours || "";
  const openFromHours = isBusinessOpenNow(hoursValue);
  const isOpen =
    openFromHours === null
      ? (item.isOpen ?? item.business?.isOpen ?? true)
      : openFromHours;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const visibleTags = tags.slice(0, 2);
  const extraTagCount = tags.length - visibleTags.length;
  const cashbackLabel = useMemo(() => {
    return formatPercentOnlyLabel(cashbackRatePercent);
  }, [cashbackRatePercent]);
  return (
    <View style={styles.cardShell}>
      <TouchableOpacity
        style={[styles.card, selected && styles.cardSelected]}
        onPress={onPress}
        activeOpacity={0.85}
      >
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardName} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.cardHeaderBadges}>
              {cashbackLabel ? (
                <View style={styles.cardCashbackBadge}>
                  <Ionicons
                    name="cash-outline"
                    size={13}
                    color="#065F46"
                    style={styles.cardCashbackIcon}
                  />
                  <Text style={styles.cardCashbackText}>{cashbackLabel}</Text>
                </View>
              ) : null}
              <View style={[styles.cardLimitBadgeTop, limitMeta.badgeStyle]}>
                <Ionicons
                  name={limitMeta.icon}
                  size={15}
                  color={
                    StyleSheet.flatten(limitMeta.textStyle)?.color || COLORS.coral
                  }
                />
              </View>
            </View>
          </View>
          <Text style={styles.cardCategory}>{category.display}</Text>
          {offerTitle ? (
            <Text style={styles.cardOfferTitle} numberOfLines={1}>
              {offerTitle}
            </Text>
          ) : null}
          {offerDescription ? (
            <Text style={styles.cardOffer} numberOfLines={2}>
              {offerDescription}
            </Text>
          ) : null}
          <TouchableOpacity
            style={[
              styles.redeemButton,
              !isOpen && styles.redeemButtonDisabled,
            ]}
            onPress={onRedeem}
            activeOpacity={0.85}
            disabled={!isOpen}
          >
            <Text
              style={[
                styles.redeemButtonText,
                !isOpen && styles.redeemButtonTextDisabled,
              ]}
            >
              {isOpen ? "Redeem offer" : "Closed now"}
            </Text>
          </TouchableOpacity>
          <Pressable
            style={({ pressed }) => [
              styles.directionsButton,
              pressed && styles.directionsButtonPressed,
            ]}
            onPress={() => openMapsForBusiness(item.business || item)}
          >
            <Ionicons name="navigate" size={14} color={COLORS.pine} />
            <Text style={styles.directionsButtonText}>Directions</Text>
          </Pressable>
          <View style={styles.cardMetaRow}>
            <Text style={styles.cardMeta}>{offerTypeLabel}</Text>
            <Text style={styles.cardMeta}>
              {ratingLabel ? `Rating ${ratingLabel}` : "Not rated yet"}
            </Text>
          </View>
        </View>
        <View style={styles.cardMedia}>
          {tags.length > 0 && (
            <View style={styles.cardMediaOverlay}>
              {visibleTags.map((tag) => (
                <View key={tag} style={[styles.tagPill, styles.tagPillOverlay]}>
                  <Text style={[styles.tagText, styles.tagTextOverlay]}>
                    {tag}
                  </Text>
                </View>
              ))}
              {extraTagCount > 0 && (
                <View style={[styles.tagPill, styles.tagPillOverlay]}>
                  <Text style={[styles.tagText, styles.tagTextOverlay]}>
                    +{extraTagCount}
                  </Text>
                </View>
              )}
            </View>
          )}
          {item.imageUrl ? (
            <Image
              source={{ uri: item.imageUrl }}
              style={styles.cardMediaImage}
              resizeMode="cover"
              onError={(event) => {
                console.warn("Wello offer image load failed:", {
                  uri: item.imageUrl,
                  error: event.nativeEvent?.error,
                });
              }}
            />
          ) : (
            <>
              <Ionicons name="image-outline" size={18} color={COLORS.muted} />
              <Text style={styles.cardMediaLabel}>Offer image</Text>
            </>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}

export default function App() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [fontError, setFontError] = useState(null);
  const mapRef = useRef(null);
  const cardListRef = useRef(null);
  const sheetScrollRef = useRef(null);
  const bottomSheetRef = useRef(null);
  const sheetIndexRef = useRef(0);
  const isMountedRef = useRef(true);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("discover");
  const [activeFilters, setActiveFilters] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [mapRegion, setMapRegion] = useState(MAP_REGION);
  const initialBusinesses = SUPABASE_URL && SUPABASE_ANON_KEY ? [] : BUSINESSES;
  const initialOffers = SUPABASE_URL && SUPABASE_ANON_KEY ? [] : OFFER_SEEDS;
  const [businesses, setBusinesses] = useState(initialBusinesses);
  const [offers, setOffers] = useState(initialOffers);
  const defaultOwnerId =
    SUPABASE_URL && SUPABASE_ANON_KEY
      ? null
      : BUSINESSES.find((business) => business.approved && !business.rejected)
          ?.id ||
        BUSINESSES[0]?.id ||
        null;
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState(null);
  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpError, setSignUpError] = useState(null);
  const [businessEmail, setBusinessEmail] = useState("");
  const [businessPassword, setBusinessPassword] = useState("");
  const [businessOwnerName, setBusinessOwnerName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessCategoryKey, setBusinessCategoryKey] = useState("restaurant");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessAddressCoords, setBusinessAddressCoords] = useState(null);
  const [businessAddressCity, setBusinessAddressCity] = useState("");
  const [businessAddressState, setBusinessAddressState] = useState("");
  const [businessAddressPostal, setBusinessAddressPostal] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessHoursStart, setBusinessHoursStart] = useState("");
  const [businessHoursStartMeridiem, setBusinessHoursStartMeridiem] =
    useState("AM");
  const [businessHoursEnd, setBusinessHoursEnd] = useState("");
  const [businessHoursEndMeridiem, setBusinessHoursEndMeridiem] =
    useState("PM");
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState("start");
  const [businessSignUpError, setBusinessSignUpError] = useState(null);
  const [businessAddressResults, setBusinessAddressResults] = useState([]);
  const [businessAddressLoading, setBusinessAddressLoading] = useState(false);
  const [businessAddressError, setBusinessAddressError] = useState(null);
  const businessAddressRequestRef = useRef(0);
  const businessAddressSelectionRef = useRef(false);
  const [authView, setAuthView] = useState("menu");
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileCompany, setProfileCompany] = useState("");
  const [profileMessage, setProfileMessage] = useState(null);
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoState, setPromoState] = useState({
    loading: false,
    error: null,
    success: null,
    code: null,
    cashbackRateBps: CASHBACK_BASE_RATE_BPS,
  });
  const [accountRole, setAccountRole] = useState("consumer");
  const [authUserId, setAuthUserId] = useState(null);
  const [authBusinessDraft, setAuthBusinessDraft] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerBusiness, setScannerBusiness] = useState(null);
  const [scannerOffer, setScannerOffer] = useState(null);
  const [scannerStatus, setScannerStatus] = useState(null);
  const [scannerMessage, setScannerMessage] = useState(null);
  const [redeemGate, setRedeemGate] = useState({
    allowed: true,
    reason: null,
    distanceMeters: null,
  });
  const [redeemGateBusy, setRedeemGateBusy] = useState(false);
  const redemptionLoggedRef = useRef(false);
  const [notificationPreferences, setNotificationPreferences] = useState(
    NOTIFICATION_DEFAULTS,
  );
  const [preferencesStatus, setPreferencesStatus] = useState({
    loading: false,
    error: null,
  });
  const [notificationPermissionStatus, setNotificationPermissionStatus] =
    useState("undetermined");
  const [expoPushToken, setExpoPushToken] = useState(null);
  const [tokenError, setTokenError] = useState(null);
  const geocodeCacheRef = useRef(new Map());
  const hydrateBusinessCoordinatesRef = useRef(null);
  const lastLocationHashRef = useRef("");
  const lastRefreshRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const liveSyncRef = useRef({
    channel: null,
    interval: null,
    debounce: null,
    inFlight: false,
  });
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [isEditingBusiness, setIsEditingBusiness] = useState(false);
  const [businessSaveBusy, setBusinessSaveBusy] = useState(false);
  const [remoteStatus, setRemoteStatus] = useState({
    loading: false,
    error: null,
  });
  const [offerStatus, setOfferStatus] = useState({
    loading: false,
    error: null,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [pendingOfferStatus, setPendingOfferStatus] = useState({
    loading: false,
    error: null,
  });
  const [pendingOffers, setPendingOffers] = useState([]);
  const [changeRequestStatus, setChangeRequestStatus] = useState({
    loading: false,
    error: null,
  });
  const [changeRequests, setChangeRequests] = useState([]);
  const [profileStatus, setProfileStatus] = useState({
    loading: false,
    error: null,
  });
  const [profileList, setProfileList] = useState([]);
  const [redemptionStatus, setRedemptionStatus] = useState({
    loading: false,
    error: null,
  });
  const [redemptionHistory, setRedemptionHistory] = useState([]);
  const [expandedHistoryGroups, setExpandedHistoryGroups] = useState({});
  const [reviewStatus, setReviewStatus] = useState({
    loading: false,
    error: null,
  });
  const [userReviews, setUserReviews] = useState([]);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [receiptsModalOpen, setReceiptsModalOpen] = useState(false);
  const [expandedReceiptOffers, setExpandedReceiptOffers] = useState({});
  const [expandedOwnerOffers, setExpandedOwnerOffers] = useState({});
  const [ownerOffersModalOpen, setOwnerOffersModalOpen] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [receiptNoticeOpen, setReceiptNoticeOpen] = useState(false);
  const receiptNoticeShownRef = useRef(false);
  const [expandedAdminEdits, setExpandedAdminEdits] = useState({});
  const [expandedAdminOffers, setExpandedAdminOffers] = useState({});
  const [expandedAdminBusinesses, setExpandedAdminBusinesses] = useState({});
  const [showReachTooltip, setShowReachTooltip] = useState(false);
  const [infoTooltip, setInfoTooltip] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [reviewError, setReviewError] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [businessDetailOpen, setBusinessDetailOpen] = useState(false);
  const [businessDetail, setBusinessDetail] = useState(null);
  const [businessDetailStatus, setBusinessDetailStatus] = useState({
    loading: false,
    error: null,
  });
  const [businessDetailReviews, setBusinessDetailReviews] = useState([]);
  const [businessDetailOffers, setBusinessDetailOffers] = useState([]);
  const [businessDetailOffersStatus, setBusinessDetailOffersStatus] = useState({
    loading: false,
    error: null,
  });
  const [supervisorSearch, setSupervisorSearch] = useState("");
  const [supervisorStatus, setSupervisorStatus] = useState({
    loading: false,
    error: null,
    success: null,
  });
  const [adminActionStatus, setAdminActionStatus] = useState({
    loading: false,
    error: null,
    success: null,
  });
  const [ownerBusinessId, setOwnerBusinessId] = useState(defaultOwnerId);
  const [androidMarkerIcons, setAndroidMarkerIcons] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    addressPlaceId: null,
    addressCoords: null,
    city: "",
    state: "",
    postalCode: "",
    categoryKey: "restaurant",
    offer: "",
    hours: "",
    tags: "",
    isOpen: true,
  });
  const [createBusinessForm, setCreateBusinessForm] = useState({
    name: "",
    address: "",
    addressCoords: null,
    city: "",
    state: "",
    postalCode: "",
    categoryKey: "restaurant",
    offer: "",
    phone: "",
    tags: "",
  });
  const [createBusinessBusy, setCreateBusinessBusy] = useState(false);
  const [createBusinessError, setCreateBusinessError] = useState(null);
  const [createHoursStart, setCreateHoursStart] = useState("");
  const [createHoursStartMeridiem, setCreateHoursStartMeridiem] =
    useState("AM");
  const [createHoursEnd, setCreateHoursEnd] = useState("");
  const [createHoursEndMeridiem, setCreateHoursEndMeridiem] = useState("PM");
  const [editHoursStart, setEditHoursStart] = useState("");
  const [editHoursStartMeridiem, setEditHoursStartMeridiem] = useState("AM");
  const [editHoursEnd, setEditHoursEnd] = useState("");
  const [editHoursEndMeridiem, setEditHoursEndMeridiem] = useState("PM");
  const [createAddressResults, setCreateAddressResults] = useState([]);
  const [createAddressLoading, setCreateAddressLoading] = useState(false);
  const [createAddressError, setCreateAddressError] = useState(null);
  const createAddressRequestRef = useRef(0);
  const createAddressSelectionRef = useRef(false);
  const [offerForm, setOfferForm] = useState({
    title: "",
    description: "",
    type: "",
    redemptionLimitMode: "unlimited", // unlimited | day | week | custom
    redemptionLimitCount: "1",
    redemptionLimitPeriod: "day", // day | week (custom only)
  });
  const [offerImage, setOfferImage] = useState(null);
  const [editOfferOpen, setEditOfferOpen] = useState(false);
  const [editOfferDraft, setEditOfferDraft] = useState({
    id: null,
    title: "",
    description: "",
    type: "",
    imageUrl: "",
  });
  const [editOfferImage, setEditOfferImage] = useState(null);
  const [editOfferStatus, setEditOfferStatus] = useState({
    saving: false,
    error: null,
  });
  const [ownerOffersList, setOwnerOffersList] = useState([]);
  const [ownerOffersStatus, setOwnerOffersStatus] = useState({
    loading: false,
    error: null,
  });
  const [offerImageStatus, setOfferImageStatus] = useState({
    uploading: false,
    error: null,
  });
  const [ownerAnalytics, setOwnerAnalytics] = useState({
    redemptions: null,
    views: null,
    reach: null,
  });
  const [ownerAnalyticsStatus, setOwnerAnalyticsStatus] = useState({
    loading: false,
    error: null,
  });

  const [billingMetrics, setBillingMetrics] = useState({
    monthCents: 0,
    pendingCents: 0,
    totalCents: 0,
    paidCents: 0,
    verifiedGrossCents: 0,
    verifiedMonthCents: 0,
    periodStart: null,
    periodEnd: null,
    periodTotalCents: 0,
    periodPaidCents: 0,
    periodVerifiedGrossCents: 0,
    updatedAt: null,
  });
  const [billingStatus, setBillingStatus] = useState({
    loading: false,
    error: null,
  });
  const [stripeActionStatus, setStripeActionStatus] = useState({
    loading: false,
    error: null,
    success: null,
  });
  const [cashoutStatus, setCashoutStatus] = useState({
    connected: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    accountId: null,
    requirementsDue: [],
    disabledReason: null,
  });
  const [cashbackBalance, setCashbackBalance] = useState({
    availableCents: 0,
    paidCents: 0,
    totalCents: 0,
    updatedAt: null,
  });
  const [cashbackBalanceState, setCashbackBalanceState] = useState({
    loading: false,
    error: null,
  });
  const [cashoutStatusState, setCashoutStatusState] = useState({
    loading: false,
    error: null,
  });
  const [cashoutActionStatus, setCashoutActionStatus] = useState({
    loading: false,
    error: null,
    success: null,
  });
  const [cashoutAmountText, setCashoutAmountText] = useState("");
  const cashoutPreview = useMemo(() => {
    const availableCents = Number(cashbackBalance.availableCents) || 0;
    const cleaned = String(cashoutAmountText || "").trim();
    if (!cleaned) {
      return {
        mode: "max",
        amountCents: availableCents,
        label:
          availableCents > 0
            ? `Cash out ${formatCurrencyFromCents(availableCents)}`
            : "Cash out now",
      };
    }
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { mode: "invalid", amountCents: 0, label: "Cash out now" };
    }
    const cents = Math.round(parsed * 100);
    if (cents <= 0 || cents > availableCents) {
      return { mode: "invalid", amountCents: 0, label: "Cash out now" };
    }
    return {
      mode: "custom",
      amountCents: cents,
      label: `Cash out ${formatCurrencyFromCents(cents)}`,
    };
  }, [cashoutAmountText, cashbackBalance.availableCents]);
  const [receiptUploadStatus, setReceiptUploadStatus] = useState({
    uploading: false,
    error: null,
    targetId: null,
  });
  const [purchaseVerifyStatus, setPurchaseVerifyStatus] = useState({
    loading: false,
    targetId: null,
    error: null,
    success: null,
  });
  const [plaidLinkState, setPlaidLinkState] = useState({
    loading: false,
    linked: false,
    linkedCount: 0,
    error: null,
  });
  const [plaidLinkAction, setPlaidLinkAction] = useState("idle");
  const [verificationPrompt, setVerificationPrompt] = useState({
    visible: false,
    title: "",
    message: "",
    primaryLabel: "Upload receipt",
    secondaryLabel: "Later",
    entry: null,
  });
  const [receiptUploadOverlay, setReceiptUploadOverlay] = useState({
    visible: false,
    phase: "idle", // idle | uploading | success | error
    title: "",
    message: "",
  });
  const [receiptUploadConfetti, setReceiptUploadConfetti] = useState(false);
  const receiptUploadTimersRef = useRef({ hide: null, confetti: null });
  const [receiptDebug, setReceiptDebug] = useState(null);
  const [businessReceiptStatus, setBusinessReceiptStatus] = useState({
    loading: false,
    error: null,
  });
  const [businessReceipts, setBusinessReceipts] = useState([]);
  const [businessRedemptionStatus, setBusinessRedemptionStatus] = useState({
    loading: false,
    error: null,
  });
  const [businessRedemptions, setBusinessRedemptions] = useState([]);
  const [viewsModalOpen, setViewsModalOpen] = useState(false);
  const [viewsBreakdownStatus, setViewsBreakdownStatus] = useState({
    loading: false,
    error: null,
  });
  const [viewsBreakdown, setViewsBreakdown] = useState([]);
  const [tagSaveStatus, setTagSaveStatus] = useState({
    saving: false,
    error: null,
    success: null,
  });
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerError, setOfferError] = useState(null);
  const [offerNotice, setOfferNotice] = useState(null);
  const [formMessage, setFormMessage] = useState(null);
  const [addressResults, setAddressResults] = useState([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState(null);
  const addressRequestRef = useRef(0);
  const addressSelectionRef = useRef(false);
  const reachTooltipTimerRef = useRef(null);
  const viewedOfferIdsRef = useRef(new Set());
  // Use percentage snap points to keep behavior consistent across iOS/Android
  // and avoid device-specific pixel rounding jitter.
  const sheetSnapPoints = useMemo(() => {
    // Slightly taller collapsed state on short screens so the handle/search
    // does not feel cramped.
    const min = IS_SHORT ? "24%" : "22%";
    const max = "78%";
    return [min, max];
  }, []);
  const handleSheetChange = useCallback((index) => {
    sheetIndexRef.current = Number.isFinite(index) ? index : 0;
  }, []);
  const renderSheetHandle = useCallback(() => {
    return (
      <View style={styles.sheetHandle}>
        <View style={styles.handleBar} />
        <Text style={styles.sheetHint}>Swipe up to explore offers</Text>
      </View>
    );
  }, []);
  const receiptPinchScale = useRef(new Animated.Value(1)).current;
  const receiptBaseScale = useRef(new Animated.Value(1)).current;
  const receiptPanX = useRef(new Animated.Value(0)).current;
  const receiptPanY = useRef(new Animated.Value(0)).current;
  const receiptBaseX = useRef(new Animated.Value(0)).current;
  const receiptBaseY = useRef(new Animated.Value(0)).current;
  const receiptBaseScaleValue = useRef(1);
  const receiptBaseXValue = useRef(0);
  const receiptBaseYValue = useRef(0);
  const receiptViewportSizeRef = useRef({
    width: RECEIPT_PREVIEW_WIDTH,
    height: RECEIPT_PREVIEW_HEIGHT,
  });
  const receiptImageSizeRef = useRef({ width: 0, height: 0 });
  const [receiptViewportSize, setReceiptViewportSize] = useState(
    receiptViewportSizeRef.current,
  );
  const [receiptImageSize, setReceiptImageSize] = useState(
    receiptImageSizeRef.current,
  );
  const receiptPinchRef = useRef(null);
  const receiptPanRef = useRef(null);
  const receiptScale = Animated.multiply(receiptBaseScale, receiptPinchScale);
  const receiptTranslateX = Animated.add(receiptBaseX, receiptPanX);
  const receiptTranslateY = Animated.add(receiptBaseY, receiptPanY);

  useEffect(() => {
    return () => {
      const timers = receiptUploadTimersRef.current;
      if (timers.hide) clearTimeout(timers.hide);
      if (timers.confetti) clearTimeout(timers.confetti);
    };
  }, []);

  useEffect(() => {
    return () => {
      destroyPlaidLink().catch(() => null);
    };
  }, []);

  const upsertProfileWithRetry = useCallback(async (payload) => {
    let { error } = await supabase.from("profiles").upsert(payload);
    if (!error) return null;
    if (!isTransientProfileUpsertRls(error?.message)) {
      return error;
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
    try {
      await refreshAccessTokenWithRefreshToken(4000, { persist: false });
    } catch {
      // Ignore refresh errors and still try one final upsert.
    }
    const retry = await supabase.from("profiles").upsert(payload);
    return retry.error || null;
  }, []);

  const hydrateProfile = useCallback(async (user, roleOverride = null) => {
    if (!user) return "consumer";
    const email = user.email || "";
    if (email) {
      setAuthEmail(email);
    }
    setAuthUserId(user.id);
    const fallbackName = formatDisplayName(email);
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name, email, role, phone, company")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      console.warn("Wello profile fetch failed:", error.message);
    }
    const metadata = user.user_metadata || {};
    const metadataRole = metadata.role;
    const metadataName = metadata.full_name || metadata.name || "";
    const metadataPhone = metadata.phone || "";
    const metadataCompany = metadata.company || "";
    const metadataDraft = metadata.business_draft || null;
    let nextRole = roleOverride || data?.role || metadataRole || "consumer";
    const validRoles = ["consumer", "business_owner", "admin", "supervisor"];
    if (!validRoles.includes(nextRole)) {
      nextRole = "consumer";
    }
    const fullName = data?.full_name || metadataName || fallbackName;
    const profileEmailValue = data?.email || email;
    const profilePhoneValue = data?.phone || metadataPhone || "";
    const profileCompanyValue = data?.company || metadataCompany || "";

    if (!data || roleOverride) {
      const upsertError = await upsertProfileWithRetry({
        id: user.id,
        email: profileEmailValue,
        full_name: fullName,
        role: nextRole,
        phone: profilePhoneValue || null,
        company: profileCompanyValue || null,
      });
      if (upsertError && !data) {
        console.warn("Wello profile upsert failed:", upsertError.message);
        nextRole = roleOverride || "consumer";
      }
    }

    setProfileName(fullName);
    setProfileEmail(profileEmailValue);
    setProfilePhone(profilePhoneValue);
    setProfileCompany(profileCompanyValue);
    setAuthBusinessDraft(metadataDraft);
    setAccountRole(nextRole);
    return nextRole;
  }, [upsertProfileWithRetry]);

  const cashbackRatePercent = useMemo(() => {
    if (accountRole !== "consumer") return CASHBACK_RATE_PERCENT;
    const bps = Number(promoState.cashbackRateBps);
    if (!Number.isFinite(bps) || bps <= 0) return CASHBACK_RATE_PERCENT;
    return Math.round((bps / 100) * 100) / 100;
  }, [accountRole, promoState.cashbackRateBps]);

  const callAuthedEdgeFunction = useCallback(
    async (functionName, payload, options = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return { data: null, error: "Supabase is not configured.", status: null };
      }
      const refreshResult = refreshSupabaseClient();
      if (!refreshResult.ok) {
        return { data: null, error: refreshResult.error, status: null };
      }

      const timeoutMs = Number(options?.timeoutMs) || 12000;
      const tokenResult = await getAccessTokenWithFallback(6000);
      let accessToken = tokenResult.accessToken;
      if (!accessToken) {
        const refreshed = await refreshAccessTokenWithRefreshToken(6000, {
          persist: false,
        });
        accessToken = refreshed?.accessToken || "";
      }
      if (!accessToken) {
        return { data: null, error: "Sign in again to continue.", status: null };
      }

      try {
        const response = await withTimeout(
          supabase.functions.invoke(functionName, {
            body: { ...(payload || {}) },
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
          timeoutMs,
          "edge_invoke",
        );

        if (!response?.error) {
          let parsedData = response?.data ?? null;
          if (typeof parsedData === "string") {
            try {
              parsedData = parsedData ? JSON.parse(parsedData) : null;
            } catch {
              parsedData = response?.data ?? null;
            }
          }
          return { data: parsedData, error: null, status: 200 };
        }

        const err = response.error;
        const context = err?.context;
        const status = context?.status ?? null;
        let rawText = "";
        if (context?.text) {
          try {
            rawText = await context.text();
          } catch {
            rawText = "";
          }
        }
        let parsed = null;
        try {
          parsed = rawText ? JSON.parse(rawText) : null;
        } catch {
          parsed = null;
        }
        const message =
          parsed?.error ||
          parsed?.message ||
          err?.message ||
          (status ? `Request failed (${status}).` : "Request failed.");
        return { data: null, error: message, status };
      } catch (error) {
        return {
          data: null,
          error: error?.message || "Request failed.",
          status: null,
        };
      }
    },
    [],
  );

  const loadPromoStatus = useCallback(async () => {
    if (accountRole !== "consumer") {
      setPromoState((prev) => ({
        ...prev,
        loading: false,
        error: null,
        success: null,
        code: null,
        cashbackRateBps: CASHBACK_BASE_RATE_BPS,
      }));
      return;
    }
    if (!isSignedIn) {
      setPromoState((prev) => ({
        ...prev,
        loading: false,
        error: null,
        success: null,
        code: null,
        cashbackRateBps: CASHBACK_BASE_RATE_BPS,
      }));
      return;
    }
    setPromoState((prev) => ({ ...prev, loading: true, error: null }));
    const { data, error } = await callAuthedEdgeFunction("promo-get", {});
    if (error) {
      setPromoState((prev) => ({
        ...prev,
        loading: false,
        error,
        success: null,
      }));
      return;
    }
    const rateBps = Number(data?.cashbackRateBps) || CASHBACK_BASE_RATE_BPS;
    const code = data?.promo?.code ? String(data.promo.code) : null;
    setPromoState((prev) => ({
      ...prev,
      loading: false,
      error: null,
      success: null,
      code,
      cashbackRateBps: rateBps,
    }));
  }, [accountRole, isSignedIn, callAuthedEdgeFunction]);

  const handleApplyPromoCode = useCallback(async () => {
    if (accountRole !== "consumer") {
      setPromoState((prev) => ({
        ...prev,
        loading: false,
        error: "Promo codes are available on personal accounts only.",
        success: null,
      }));
      return;
    }
    if (!isSignedIn) {
      setPromoState((prev) => ({
        ...prev,
        loading: false,
        error: "Sign in to apply a promo code.",
        success: null,
      }));
      return;
    }
    const code = String(promoCodeInput || "").trim();
    setPromoState((prev) => ({
      ...prev,
      loading: true,
      error: null,
      success: null,
    }));
    const { data, error } = await callAuthedEdgeFunction("promo-apply", {
      code,
    });
    if (error) {
      setPromoState((prev) => ({
        ...prev,
        loading: false,
        error,
        success: null,
      }));
      return;
    }
    const nextRateBps =
      Number(data?.promo?.cashbackRateBps) ||
      Number(data?.cashbackRateBps) ||
      CASHBACK_BASE_RATE_BPS;
    const nextCode = data?.promo?.code ? String(data.promo.code) : null;
    setPromoState((prev) => ({
      ...prev,
      loading: false,
      error: null,
      success: nextCode
        ? `Promo applied. Cashback is now ${(nextRateBps / 100).toFixed(2)}% of commission.`
        : "Promo updated.",
      code: nextCode,
      cashbackRateBps: nextRateBps,
    }));
    if (!nextCode) {
      setPromoCodeInput("");
    }
  }, [accountRole, isSignedIn, promoCodeInput, callAuthedEdgeFunction]);

  const handleClearPromoCode = useCallback(async () => {
    setPromoCodeInput("");
    setPromoState((prev) => ({
      ...prev,
      loading: true,
      error: null,
      success: null,
    }));
    const { error } = await callAuthedEdgeFunction("promo-apply", { code: "" });
    if (error) {
      setPromoState((prev) => ({
        ...prev,
        loading: false,
        error,
        success: null,
      }));
      return;
    }
    setPromoState((prev) => ({
      ...prev,
      loading: false,
      error: null,
      success: "Promo removed.",
      code: null,
      cashbackRateBps: CASHBACK_BASE_RATE_BPS,
    }));
  }, [callAuthedEdgeFunction]);

  useEffect(() => {
    let isMounted = true;
    Font.loadAsync({
      "Rubik-Regular": require("./assets/rubik/static/Rubik-Regular.ttf"),
      "Rubik-Medium": require("./assets/rubik/static/Rubik-Medium.ttf"),
      "Rubik-SemiBold": require("./assets/rubik/static/Rubik-SemiBold.ttf"),
      "Rubik-Bold": require("./assets/rubik/static/Rubik-Bold.ttf"),
    })
      .then(() => {
        if (isMounted) {
          setFontsLoaded(true);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setFontError(error);
          setFontsLoaded(true);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const resetAuthState = useCallback(() => {
    setIsSignedIn(false);
    setAccountRole("consumer");
    setAuthUserId(null);
    setAuthEmail("");
    setProfileEmail("");
    setProfileName("");
    setProfilePhone("");
    setProfileCompany("");
    setAuthBusinessDraft(null);
    setOwnerBusinessId(null);
  }, []);

  const forceSignOut = useCallback(
    async (reason) => {
      await safeLocalSignOut();
      resetAuthState();
      if (reason) {
        setCashoutStatusState({ loading: false, error: reason });
      }
    },
    [resetAuthState],
  );

  useEffect(() => {
    let isMounted = true;
    const safetyTimer = setTimeout(() => {
      if (isMounted) setSessionReady(true);
    }, 4000);
    const loadSession = async () => {
      try {
        const refreshResult = refreshSupabaseClient();
        if (!refreshResult.ok) {
          if (isMounted) {
            resetAuthState();
            setSessionReady(true);
          }
          return;
        }
        const tokenResult = await getAccessTokenWithFallback(8000);
        const session = tokenResult.session;
        if (!isMounted) return;
        if (session?.user) {
          const nextRole = await hydrateProfile(session.user);
          setIsSignedIn(true);
          if (nextRole === "consumer") {
            loadPromoStatus().catch(() => {});
          } else {
            setPromoState((prev) => ({
              ...prev,
              loading: false,
              error: null,
              success: null,
              code: null,
              cashbackRateBps: CASHBACK_BASE_RATE_BPS,
            }));
          }
        } else {
          resetAuthState();
        }
      } catch (error) {
        if (isMounted) {
          resetAuthState();
        }
      } finally {
        if (isMounted) setSessionReady(true);
        clearTimeout(safetyTimer);
      }
    };
    loadSession();
    const refreshResult = refreshSupabaseClient();
    const authListener = refreshResult.ok
      ? supabase.auth.onAuthStateChange(async (_event, session) => {
          if (!isMounted) return;
          if (session?.user) {
            const nextRole = await hydrateProfile(session.user);
            setIsSignedIn(true);
            if (nextRole === "consumer") {
              loadPromoStatus().catch(() => {});
            } else {
              setPromoState((prev) => ({
                ...prev,
                loading: false,
                error: null,
                success: null,
                code: null,
                cashbackRateBps: CASHBACK_BASE_RATE_BPS,
              }));
            }
          } else {
            resetAuthState();
          }
        })
      : null;
    return () => {
      isMounted = false;
      clearTimeout(safetyTimer);
      authListener?.data?.subscription?.unsubscribe();
    };
  }, [hydrateProfile, resetAuthState, loadPromoStatus]);

  useEffect(() => {
    let isMounted = true;
    const loadInitialLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!isMounted) return;
        const nextRegion = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          latitudeDelta: MAP_REGION.latitudeDelta,
          longitudeDelta: MAP_REGION.longitudeDelta,
        };
        setMapRegion(nextRegion);
        mapRef.current?.animateToRegion(nextRegion, 700);
      } catch (error) {
        // Keep default region if location lookup fails.
      }
    };
    loadInitialLocation();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleKeyboardShow = (event) => {
      const height = event?.endCoordinates?.height || 0;
      setKeyboardInset(height);
    };
    const handleKeyboardHide = () => {
      setKeyboardInset(0);
    };
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(
      showEvent,
      handleKeyboardShow,
    );
    const hideSubscription = Keyboard.addListener(
      hideEvent,
      handleKeyboardHide,
    );
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const AutoFocusInput = useMemo(() => {
    const Component = React.forwardRef((props, ref) => (
      <TextInput ref={ref} {...props} />
    ));
    Component.displayName = "AutoFocusInput";
    return Component;
  }, []);

  const ownerBusiness = useMemo(() => {
    if (authUserId) {
      return (
        businesses.find((business) => business.ownerId === authUserId) || null
      );
    }
    if (!ownerBusinessId) return null;
    return (
      businesses.find((business) => business.id === ownerBusinessId) || null
    );
  }, [businesses, ownerBusinessId, authUserId]);

  const resolvedOwnerBusiness = useMemo(() => {
    if (ownerBusiness) return ownerBusiness;
    if (authUserId) return null;
    if (!ownerBusinessId) return null;
    return (
      businesses.find((business) => business.id === ownerBusinessId) || null
    );
  }, [ownerBusiness, authUserId, ownerBusinessId, businesses]);

  const resolveStripeBusiness = useCallback(async () => {
    if (resolvedOwnerBusiness?.id) return resolvedOwnerBusiness;
    if (!authUserId || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    const { data, error } = await supabase
      .from("businesses")
      .select(
        [
          "id",
          "owner_id",
          "name",
          "address",
          "city",
          "state",
          "postal_code",
          "phone",
          "category_key",
          "category_label",
          "offer_highlight",
          "hours",
          "tags",
          "latitude",
          "longitude",
          "qr_code",
          "is_open",
          "approval_status",
          "status",
          "stripe_account_id",
          "stripe_customer_id",
          "stripe_payment_method_id",
          "stripe_payment_method_brand",
          "stripe_payment_method_last4",
          "stripe_charges_enabled",
          "stripe_payouts_enabled",
          "stripe_onboarded_at",
          "commission_rate_cents",
          "commission_enabled",
          "created_at",
        ].join(","),
      )
      .eq("owner_id", authUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const mapped = mapSupabaseBusiness(data, 0);
    setBusinesses((prev) => {
      const next = prev.filter((business) => business.id !== mapped.id);
      next.unshift(mapped);
      return next.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    });
    setOwnerBusinessId(mapped.id);
    return mapped;
  }, [resolvedOwnerBusiness, authUserId]);

  const handleStripeConnect = useCallback(async () => {
    const targetBusiness = await resolveStripeBusiness();
    if (!targetBusiness?.id) {
      setStripeActionStatus({
        loading: false,
        error:
          "No business profile found for this account. Create your business profile first.",
        success: null,
      });
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setStripeActionStatus({
        loading: false,
        error: "Supabase is not configured for Stripe.",
        success: null,
      });
      return;
    }
    setStripeActionStatus({ loading: true, error: null, success: null });
    const { data, error } = await callStripeFunction(
      "stripe-create-account-link",
      { businessId: targetBusiness.id },
    );
    if (error || !data?.url) {
      const errorMessage =
        typeof error === "string"
          ? error
          : error?.message || data?.error || "Unable to start onboarding.";
      setStripeActionStatus({
        loading: false,
        error: errorMessage,
        success: null,
      });
      return;
    }
    if (data?.accountId) {
      setBusinesses((prev) =>
        prev.map((business) =>
          business.id === targetBusiness.id
            ? { ...business, stripeAccountId: data.accountId }
            : business,
        ),
      );
    }
    setStripeActionStatus({
      loading: false,
      error: null,
      success: "Stripe onboarding opened.",
    });
    Linking.openURL(data.url).catch(() => null);
  }, [resolveStripeBusiness]);

  const handleStripePaymentSetup = useCallback(async () => {
    const targetBusiness = await resolveStripeBusiness();
    if (!targetBusiness?.id) {
      setStripeActionStatus({
        loading: false,
        error:
          "No business profile found for this account. Create your business profile first.",
        success: null,
      });
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setStripeActionStatus({
        loading: false,
        error: "Supabase is not configured for Stripe.",
        success: null,
      });
      return;
    }
    setStripeActionStatus({ loading: true, error: null, success: null });
    const { data, error } = await callStripeFunction(
      "stripe-create-setup-session",
      { businessId: targetBusiness.id },
    );
    if (error || !data?.url) {
      const errorMessage =
        typeof error === "string"
          ? error
          : error?.message || data?.error || "Unable to open payment setup.";
      setStripeActionStatus({
        loading: false,
        error: errorMessage,
        success: null,
      });
      return;
    }
    setStripeActionStatus({
      loading: false,
      error: null,
      success: "Payment setup opened.",
    });
    Linking.openURL(data.url).catch(() => null);
  }, [resolveStripeBusiness]);

  const handleStripeManage = useCallback(async () => {
    const targetBusiness = await resolveStripeBusiness();
    if (!targetBusiness?.id) {
      setStripeActionStatus({
        loading: false,
        error:
          "No business profile found for this account. Create your business profile first.",
        success: null,
      });
      return;
    }
    if (
      !targetBusiness?.stripeCustomerId &&
      !targetBusiness?.stripePaymentMethodId
    ) {
      setStripeActionStatus({
        loading: false,
        error: "Add a payment method before opening the billing portal.",
        success: null,
      });
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setStripeActionStatus({
        loading: false,
        error: "Supabase is not configured for Stripe.",
        success: null,
      });
      return;
    }
    setStripeActionStatus({ loading: true, error: null, success: null });
    const { data, error } = await callStripeFunction(
      "stripe-create-login-link",
      { businessId: targetBusiness.id },
    );
    if (error || !data?.url) {
      const errorMessage =
        typeof error === "string"
          ? error
          : error?.message || data?.error || "Unable to open Stripe dashboard.";
      setStripeActionStatus({
        loading: false,
        error: errorMessage,
        success: null,
      });
      return;
    }
    setStripeActionStatus({
      loading: false,
      error: null,
      success: "Stripe dashboard opened.",
    });
    Linking.openURL(data.url).catch(() => null);
  }, [resolveStripeBusiness]);

  const loadCashoutStatus = useCallback(
    async ({ silent } = {}) => {
      if (!isSignedIn) return;
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
      if (!silent) {
        setCashoutStatusState({ loading: true, error: null });
      }
      const { data, error, status } = await callStripeFunction(
        "stripe-get-cashout-status",
        {},
      );
      const errorText = String(error || "").toLowerCase();
      const isAuthFailure =
        status === 401 ||
        errorText.includes("invalid jwt") ||
        errorText.includes("jwt expired") ||
        errorText.includes("unauthorized") ||
        errorText.includes("missing authorization") ||
        errorText.includes("401");
      if (error && isAuthFailure) {
        if (!silent) {
          setCashoutStatusState({
            loading: false,
            error: "Session invalid. Please sign in again.",
          });
        }
        return;
      }
      if (error) {
        setCashoutStatusState({
          loading: false,
          error:
            typeof error === "string"
              ? error
              : error?.message || "Unable to load cashout status.",
        });
        return;
      }
      setCashoutStatus({
        connected: Boolean(data?.connected),
        payoutsEnabled: Boolean(data?.payoutsEnabled),
        detailsSubmitted: Boolean(data?.detailsSubmitted),
        accountId: data?.accountId || null,
        requirementsDue: Array.isArray(data?.requirementsDue)
          ? data.requirementsDue
          : [],
        disabledReason: data?.disabledReason || null,
      });
      setCashoutStatusState({ loading: false, error: null });
    },
    [isSignedIn],
  );

  const loadCashbackBalance = useCallback(
    async ({ silent } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
      if (!isSignedIn || !authUserId) {
        setCashbackBalance({
          availableCents: 0,
          paidCents: 0,
          totalCents: 0,
          updatedAt: Date.now(),
        });
        setCashbackBalanceState({ loading: false, error: null });
        return;
      }
      if (!silent) {
        setCashbackBalanceState({ loading: true, error: null });
      }
      const { data, error } = await supabase
        .from("cashback_events")
        .select("amount_cents, status")
        .eq("user_id", authUserId);
      if (error) {
        setCashbackBalanceState({
          loading: false,
          error: error.message || "Unable to load cashback.",
        });
        return;
      }
      let availableCents = 0;
      let paidCents = 0;
      let totalCents = 0;
      (Array.isArray(data) ? data : []).forEach((row) => {
        const amount = Number(row?.amount_cents) || 0;
        if (!amount) return;
        totalCents += amount;
        if (row?.status === "paid") {
          paidCents += amount;
          return;
        }
        if (row?.status === "available") {
          availableCents += amount;
        }
      });
      setCashbackBalance({
        availableCents,
        paidCents,
        totalCents,
        updatedAt: Date.now(),
      });
      if (!silent) {
        setCashbackBalanceState({ loading: false, error: null });
      } else {
        setCashbackBalanceState((prev) =>
          prev.error ? prev : { loading: false, error: null },
        );
      }
    },
    [authUserId, isSignedIn],
  );

  const handleCashoutConnect = useCallback(async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setCashoutActionStatus({
        loading: false,
        error: "Supabase is not configured for payouts.",
        success: null,
      });
      return;
    }
    setCashoutActionStatus({ loading: true, error: null, success: null });
    const { data, error, status } = await callStripeFunction(
      "stripe-create-cashout-link",
      {},
    );
    const errorText = String(error || "").toLowerCase();
    const isAuthFailure =
      status === 401 ||
      errorText.includes("invalid jwt") ||
      errorText.includes("jwt expired") ||
      errorText.includes("unauthorized") ||
      errorText.includes("missing authorization") ||
      errorText.includes("401");
    if (error && isAuthFailure) {
      setCashoutActionStatus({
        loading: false,
        error: "Session invalid. Please sign in again.",
        success: null,
      });
      return;
    }
    if (error || !data?.url) {
      const errorMessage =
        typeof error === "string"
          ? error
          : error?.message || data?.error || "Unable to start onboarding.";
      setCashoutActionStatus({
        loading: false,
        error: errorMessage,
        success: null,
      });
      return;
    }
    setCashoutActionStatus({
      loading: false,
      error: null,
      success: "Stripe onboarding opened.",
    });
    Linking.openURL(data.url).catch(() => null);
  }, []);

  const handleCashoutManage = useCallback(async () => {
    if (!cashoutStatus.connected) {
      setCashoutActionStatus({
        loading: false,
        error: "Link a bank account first.",
        success: null,
      });
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setCashoutActionStatus({
        loading: false,
        error: "Supabase is not configured for payouts.",
        success: null,
      });
      return;
    }
    setCashoutActionStatus({ loading: true, error: null, success: null });
    const { data, error, status } = await callStripeFunction(
      "stripe-create-cashout-login-link",
      {},
    );
    const errorText = String(error || "").toLowerCase();
    const isAuthFailure =
      status === 401 ||
      errorText.includes("invalid jwt") ||
      errorText.includes("jwt expired") ||
      errorText.includes("unauthorized") ||
      errorText.includes("missing authorization") ||
      errorText.includes("401");
    if (error && isAuthFailure) {
      setCashoutActionStatus({
        loading: false,
        error: "Session invalid. Please sign in again.",
        success: null,
      });
      return;
    }
    if (error || !data?.url) {
      const errorMessage =
        typeof error === "string"
          ? error
          : error?.message || data?.error || "Unable to open Stripe dashboard.";
      setCashoutActionStatus({
        loading: false,
        error: errorMessage,
        success: null,
      });
      return;
    }
    setCashoutActionStatus({
      loading: false,
      error: null,
      success: "Stripe dashboard opened.",
    });
    Linking.openURL(data.url).catch(() => null);
  }, [cashoutStatus.connected]);

  const handleCashoutPayout = useCallback(async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setCashoutActionStatus({
        loading: false,
        error: "Supabase is not configured for payouts.",
        success: null,
      });
      return;
    }
    if (!cashoutStatus.connected || !cashoutStatus.payoutsEnabled) {
      setCashoutActionStatus({
        loading: false,
        error: "Link and verify a bank account first.",
        success: null,
      });
      return;
    }
    if ((Number(cashbackBalance.availableCents) || 0) <= 0) {
      setCashoutActionStatus({
        loading: false,
        error: "No cashback available to cash out.",
        success: null,
      });
      return;
    }

    const availableCents = Number(cashbackBalance.availableCents) || 0;
    const cleaned = String(cashoutAmountText || "").trim();
    let amountCentsToCashout = availableCents;

    if (cleaned) {
      const parsed = Number(cleaned);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setCashoutActionStatus({
          loading: false,
          error: "Enter a valid cashout amount.",
          success: null,
        });
        return;
      }
      amountCentsToCashout = Math.round(parsed * 100);
      if (amountCentsToCashout <= 0) {
        setCashoutActionStatus({
          loading: false,
          error: "Enter a valid cashout amount.",
          success: null,
        });
        return;
      }
      if (amountCentsToCashout > availableCents) {
        setCashoutActionStatus({
          loading: false,
          error: `Max cashout is ${formatCurrencyFromCents(availableCents)}.`,
          success: null,
        });
        return;
      }
    }

    if (amountCentsToCashout <= 0) {
      setCashoutActionStatus({
        loading: false,
        error: "No cashback available to cash out.",
        success: null,
      });
      return;
    }

    setCashoutActionStatus({ loading: true, error: null, success: null });
    const { data, error, status, details } = await callStripeFunction(
      "stripe-create-cashout-payout",
      { amountCents: amountCentsToCashout },
    );
    if (error || !data?.success) {
      if (status === 429) {
        const nextEligibleAt =
          details?.nextEligibleAt || data?.nextEligibleAt || null;
        const nextLabel = nextEligibleAt
          ? new Date(nextEligibleAt).toLocaleDateString()
          : "next week";
        setCashoutActionStatus({
          loading: false,
          error: `Cashout is limited to once per week. Try again on ${nextLabel}.`,
          success: null,
        });
        return;
      }
      setCashoutActionStatus({
        loading: false,
        error:
          typeof error === "string"
            ? error
            : error?.message || "Unable to cash out right now.",
        success: null,
      });
      return;
    }

    await loadCashbackBalance({ silent: true });
    setCashoutActionStatus({
      loading: false,
      error: null,
      success: `Cashout started: ${formatCurrencyFromCents(
        Number(data.amountCents) || 0,
      )}.`,
    });
    setCashoutAmountText("");
  }, [
    cashoutStatus.connected,
    cashoutStatus.payoutsEnabled,
    cashbackBalance.availableCents,
    cashoutAmountText,
    loadCashbackBalance,
  ]);

  useEffect(() => {
    const scaleSub = receiptBaseScale.addListener(({ value }) => {
      receiptBaseScaleValue.current = value;
    });
    const xSub = receiptBaseX.addListener(({ value }) => {
      receiptBaseXValue.current = value;
    });
    const ySub = receiptBaseY.addListener(({ value }) => {
      receiptBaseYValue.current = value;
    });
    return () => {
      receiptBaseScale.removeListener(scaleSub);
      receiptBaseX.removeListener(xSub);
      receiptBaseY.removeListener(ySub);
    };
  }, [receiptBaseScale, receiptBaseX, receiptBaseY]);

  const trackOfferView = useCallback(
    async (businessId, offerId) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
      if (!authUserId || !businessId || !offerId) return;
      const key = String(offerId);
      if (viewedOfferIdsRef.current.has(key)) return;
      viewedOfferIdsRef.current.add(key);
      const { error } = await supabase.from("offer_views").insert({
        business_id: businessId,
        offer_id: offerId,
        user_id: authUserId,
      });
      if (error) {
        console.warn("Wello offer view insert failed:", error.message);
        viewedOfferIdsRef.current.delete(key);
      }
    },
    [authUserId],
  );

  const loadBillingMetrics = useCallback(
    async (businessId, { silent } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !businessId) return;
      if (!silent) {
        setBillingStatus({ loading: true, error: null });
      }

      const now = new Date();
      const periodStartDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
      );
      const periodEndDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
      );
      const periodStart = periodStartDate.toISOString().slice(0, 10);
      const periodEnd = periodEndDate.toISOString().slice(0, 10);

      const [eventsResult, receiptsResult] = await Promise.all([
        supabase
          .from("commission_events")
          .select("amount_cents, created_at, status")
          .eq("business_id", businessId),
        supabase
          .from("receipt_uploads")
          .select("receipt_total_cents, reviewed_at, uploaded_at")
          .eq("business_id", businessId)
          .eq("review_status", "verified"),
      ]);
      if (eventsResult.error) {
        setBillingStatus({
          loading: false,
          error: eventsResult.error.message || "Unable to load billing.",
        });
        return;
      }
      if (receiptsResult.error) {
        setBillingStatus({
          loading: false,
          error: receiptsResult.error.message || "Unable to load receipts.",
        });
        return;
      }
      const rows = Array.isArray(eventsResult.data) ? eventsResult.data : [];
      const receiptRows = Array.isArray(receiptsResult.data)
        ? receiptsResult.data
        : [];
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      let monthCents = 0;
      let pendingCents = 0;
      let totalCents = 0;
      let paidCents = 0;
      let periodTotalCents = 0;
      let periodPaidCents = 0;
      rows.forEach((row) => {
        const amount = Number(row?.amount_cents) || 0;
        if (row?.status === "failed") return;
        totalCents += amount;
        if (row?.status === "pending") pendingCents += amount;
        if (row?.status === "paid") paidCents += amount;
        if (row?.created_at && new Date(row.created_at) >= monthStart) {
          monthCents += amount;
        }
        if (
          row?.created_at &&
          new Date(row.created_at) >= periodStartDate &&
          new Date(row.created_at) < periodEndDate
        ) {
          periodTotalCents += amount;
          if (row?.status === "paid") periodPaidCents += amount;
        }
      });
      let verifiedGrossCents = 0;
      let verifiedMonthCents = 0;
      let periodVerifiedGrossCents = 0;
      receiptRows.forEach((row) => {
        const amount = Number(row?.receipt_total_cents) || 0;
        verifiedGrossCents += amount;
        const stamp = row?.reviewed_at || row?.uploaded_at;
        if (stamp && new Date(stamp) >= monthStart) {
          verifiedMonthCents += amount;
        }
        if (stamp) {
          const stampDate = new Date(stamp);
          if (stampDate >= periodStartDate && stampDate < periodEndDate) {
            periodVerifiedGrossCents += amount;
          }
        }
      });
      setBillingMetrics({
        monthCents,
        pendingCents,
        totalCents,
        paidCents,
        verifiedGrossCents,
        verifiedMonthCents,
        periodStart,
        periodEnd,
        periodTotalCents,
        periodPaidCents,
        periodVerifiedGrossCents,
        updatedAt: Date.now(),
      });
      if (!silent) {
        setBillingStatus({ loading: false, error: null });
      } else {
        setBillingStatus((prev) =>
          prev.error ? prev : { loading: false, error: null },
        );
      }
    },
    [],
  );

  const loadOwnerAnalytics = useCallback(
    async (businessId, { silent } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !businessId) return;
      if (!silent) {
        setOwnerAnalyticsStatus({ loading: true, error: null });
      }
      const { data, error } = await supabase
        .from("redemptions")
        .select("id")
        .eq("business_id", businessId);
      if (error) {
        setOwnerAnalyticsStatus({
          loading: false,
          error: error.message || "Unable to load analytics.",
        });
        console.warn("Wello analytics load failed:", error.message);
        return;
      }
      const count = Array.isArray(data) ? data.length : 0;
      const { data: viewRows, error: viewError } = await supabase
        .from("offer_views")
        .select("user_id")
        .eq("business_id", businessId);
      if (viewError) {
        setOwnerAnalyticsStatus({
          loading: false,
          error: viewError.message || "Unable to load analytics.",
        });
        console.warn("Wello analytics view load failed:", viewError.message);
        return;
      }
      const viewsCount = Array.isArray(viewRows) ? viewRows.length : 0;
      const reachCount = Array.isArray(viewRows)
        ? new Set(viewRows.map((row) => row.user_id).filter((value) => value))
            .size
        : 0;
      setOwnerAnalytics({
        redemptions: count,
        views: viewsCount,
        reach: reachCount,
      });
      if (!silent) {
        setOwnerAnalyticsStatus({ loading: false, error: null });
      } else {
        setOwnerAnalyticsStatus((prev) =>
          prev.error ? prev : { loading: false, error: null },
        );
      }
    },
    [],
  );

  const loadOfferViewsBreakdown = useCallback(
    async (businessIdOverride = null) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return;
      }
      const targetBusinessId =
        businessIdOverride || ownerBusiness?.id || ownerBusinessId;
      if (!targetBusinessId) {
        setViewsBreakdownStatus({
          loading: false,
          error: "Business not ready.",
        });
        return;
      }
      setViewsBreakdownStatus({ loading: true, error: null });
      try {
        const { data, error } = await supabase
          .from("offer_views")
          .select("offer_id")
          .eq("business_id", targetBusinessId);
        if (error) {
          setViewsBreakdownStatus({
            loading: false,
            error: error.message || "Unable to load view details.",
          });
          return;
        }
        const counts = new Map();
        (data || []).forEach((row) => {
          if (!row.offer_id) return;
          counts.set(row.offer_id, (counts.get(row.offer_id) || 0) + 1);
        });
        let baseOffers = ownerOffers;
        if (!baseOffers.length) {
          const { data: ownedOffers, error: ownedOffersError } = await supabase
            .from("offers")
            .select("id, title")
            .eq("business_id", targetBusinessId);
          if (!ownedOffersError && Array.isArray(ownedOffers)) {
            baseOffers = ownedOffers;
          }
        }
        const items = [];
        const baseOfferMap = new Map(
          (baseOffers || []).map((offer) => [
            String(offer.id),
            offer.title || "Offer",
          ]),
        );
        (baseOffers || []).forEach((offer) => {
          const id = String(offer.id);
          items.push({
            id,
            title: offer.title || "Offer",
            count: counts.get(id) || 0,
          });
          counts.delete(id);
        });
        counts.forEach((count, id) => {
          items.push({
            id,
            title: baseOfferMap.get(id) || "Offer (archived)",
            count,
          });
        });
        items.sort((a, b) => b.count - a.count);
        setViewsBreakdown(items);
        setViewsBreakdownStatus({ loading: false, error: null });
      } catch (error) {
        setViewsBreakdownStatus({
          loading: false,
          error: error?.message || "Unable to load view details.",
        });
      }
    },
    [ownerBusiness?.id, ownerBusinessId, ownerOffers],
  );

  const mergeBusinesses = useCallback((nextBusinesses) => {
    setBusinesses((prev) => {
      const map = new Map(prev.map((business) => [business.id, business]));
      nextBusinesses.forEach((business) => {
        const existing = map.get(business.id);
        if (existing) {
          const nextRating = Number.isFinite(business.rating)
            ? business.rating
            : Number.isFinite(existing.rating)
              ? existing.rating
              : null;
          const nextDistance =
            business.distance && business.distance !== "--"
              ? business.distance
              : existing.distance || business.distance;
          map.set(business.id, {
            ...existing,
            ...business,
            rating: nextRating,
            distance: nextDistance,
            coordinate: business.hasCoordinates
              ? business.coordinate
              : existing.coordinate || business.coordinate,
            hasCoordinates: business.hasCoordinates || existing.hasCoordinates,
          });
        } else {
          map.set(business.id, business);
        }
      });
      return Array.from(map.values()).sort(
        (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      );
    });
  }, []);

  const loadRemoteBusinesses = useCallback(
    async ({ silent } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        if (!silent) {
          setRemoteStatus({
            loading: false,
            error: "Supabase is not configured for businesses yet.",
          });
        }
        return;
      }
      if (!silent) {
        setRemoteStatus({ loading: true, error: null });
      }
      const { data, error } = await supabase
        .from("businesses")
        .select(
          [
            "id",
            "owner_id",
            "name",
            "address",
            "city",
            "state",
            "postal_code",
            "phone",
            "category_key",
            "category_label",
            "offer_highlight",
            "hours",
            "tags",
            "latitude",
            "longitude",
            "qr_code",
            "is_open",
            "approval_status",
            "status",
            "stripe_account_id",
            "stripe_customer_id",
            "stripe_payment_method_id",
            "stripe_payment_method_brand",
            "stripe_payment_method_last4",
            "stripe_charges_enabled",
            "stripe_payouts_enabled",
            "stripe_onboarded_at",
            "commission_rate_cents",
            "commission_enabled",
            "created_at",
          ].join(","),
        )
        .order("created_at", { ascending: false });

      if (error) {
        if (!silent) {
          setRemoteStatus({
            loading: false,
            error: error.message || "Unable to load businesses.",
          });
        }
        return;
      }

      const mapped = Array.isArray(data) ? data.map(mapSupabaseBusiness) : [];
      if (mapped.length) {
        mergeBusinesses(mapped);
        hydrateBusinessCoordinatesRef.current?.(mapped);
      }
      if (!silent) {
        setRemoteStatus({ loading: false, error: null });
      }
    },
    [mergeBusinesses],
  );

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    loadRemoteBusinesses();
    loadBusinessRatings({ silent: true });
  }, [loadRemoteBusinesses, loadBusinessRatings]);

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    loadRemoteOffers();
  }, [loadRemoteOffers]);

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const intervalId = setInterval(() => {
      loadRemoteBusinesses({ silent: true });
      loadRemoteOffers({ silent: true });
      loadBusinessRatings({ silent: true });
      if (ownerBusiness?.id) {
        loadOwnerOffers(ownerBusiness.id);
        loadOwnerAnalytics(ownerBusiness.id, { silent: true });
        loadBillingMetrics(ownerBusiness.id, { silent: true });
      }
    }, OFFERS_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [
    loadRemoteBusinesses,
    loadRemoteOffers,
    loadBusinessRatings,
    loadOwnerOffers,
    loadOwnerAnalytics,
    loadBillingMetrics,
    ownerBusiness?.id,
  ]);

  useEffect(() => {
    if (!ownerBusiness?.id) return;
    loadOwnerOffers(ownerBusiness.id);
    loadOwnerAnalytics(ownerBusiness.id, { silent: true });
    loadBillingMetrics(ownerBusiness.id, { silent: true });
  }, [
    ownerBusiness?.id,
    loadOwnerOffers,
    loadOwnerAnalytics,
    loadBillingMetrics,
  ]);

  useEffect(() => {
    if (activeTab !== "business" || !ownerBusiness?.id) return;
    loadOwnerAnalytics(ownerBusiness.id, { silent: false });
    loadBillingMetrics(ownerBusiness.id, { silent: false });
  }, [activeTab, ownerBusiness?.id, loadOwnerAnalytics, loadBillingMetrics]);

  useEffect(() => {
    if (!viewsModalOpen) return;
    loadOfferViewsBreakdown(ownerBusiness?.id || ownerBusinessId);
  }, [viewsModalOpen, loadOfferViewsBreakdown]);

  useEffect(() => {
    if (!receiptsModalOpen) return;
    if (!ownerBusiness?.id) return;
    loadBusinessReceipts(ownerBusiness.id, { silent: true });
    loadBusinessRedemptions(ownerBusiness.id, { silent: true });
  }, [
    receiptsModalOpen,
    ownerBusiness?.id,
    loadBusinessReceipts,
    loadBusinessRedemptions,
  ]);

  useEffect(() => {
    if (!ownerOffersModalOpen) return;
    if (!ownerBusiness?.id) return;
    loadOwnerOffers(ownerBusiness.id, { silent: false });
  }, [ownerOffersModalOpen, ownerBusiness?.id, loadOwnerOffers]);

  useEffect(
    () => () => {
      if (reachTooltipTimerRef.current) {
        clearTimeout(reachTooltipTimerRef.current);
      }
    },
    [],
  );

  const triggerReachTooltip = useCallback(() => {
    setShowReachTooltip(true);
    if (reachTooltipTimerRef.current) {
      clearTimeout(reachTooltipTimerRef.current);
    }
    reachTooltipTimerRef.current = setTimeout(() => {
      setShowReachTooltip(false);
    }, 2600);
  }, []);

  const openInfoTooltip = useCallback((title, body) => {
    setInfoTooltip({ title, body });
  }, []);

  const closeInfoTooltip = useCallback(() => {
    setInfoTooltip(null);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    let isMounted = true;
    const loadAndroidMarkerIcons = async () => {
      try {
        const entries = Object.entries(CATEGORY_CONFIG);
        const normal = {};
        const halo = {};
        await Promise.all(
          entries.map(async ([key, config]) => {
            if (!config?.icon) return;
            const [normalSource, haloSource] = await Promise.all([
              Ionicons.getImageSource(
                config.icon,
                ANDROID_MARKER_SIZE,
                config.color,
              ),
              Ionicons.getImageSource(
                config.icon,
                ANDROID_MARKER_SELECTED_SIZE,
                COLORS.white,
              ),
            ]);
            if (normalSource) normal[key] = normalSource;
            if (haloSource) halo[key] = haloSource;
          }),
        );
        if (isMounted) {
          setAndroidMarkerIcons({ normal, halo });
        }
      } catch (error) {
        if (isMounted) {
          setAndroidMarkerIcons(null);
        }
      }
    };
    loadAndroidMarkerIcons();
    return () => {
      isMounted = false;
    };
  }, []);

  // Avoid per-frame JS listeners on Android (they can cause stutter). We keep
  // sheet state in refs and only update them when committing a snap.

  useEffect(() => {
    if (!GOOGLE_PLACES_KEY) {
      setAddressResults([]);
      setAddressLoading(false);
      return;
    }
    const query = formData.address.trim();
    if (addressSelectionRef.current) {
      addressSelectionRef.current = false;
      setAddressLoading(false);
      return;
    }
    if (query.length < 3) {
      setAddressResults([]);
      setAddressLoading(false);
      return;
    }

    setAddressLoading(true);
    const requestId = ++addressRequestRef.current;
    const timeout = setTimeout(() => {
      fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
          query,
        )}&types=address&key=${GOOGLE_PLACES_KEY}`,
      )
        .then((response) => response.json())
        .then((data) => {
          if (addressRequestRef.current !== requestId) return;
          if (
            data.status &&
            data.status !== "OK" &&
            data.status !== "ZERO_RESULTS"
          ) {
            setAddressError(
              data.error_message || "Unable to load suggestions.",
            );
            setAddressResults([]);
          } else {
            setAddressError(null);
            setAddressResults(data.predictions || []);
          }
          setAddressLoading(false);
        })
        .catch(() => {
          if (addressRequestRef.current !== requestId) return;
          setAddressError("Unable to load suggestions.");
          setAddressResults([]);
          setAddressLoading(false);
        });
    }, ADDRESS_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [formData.address]);

  useEffect(() => {
    if (!GOOGLE_PLACES_KEY) {
      setBusinessAddressResults([]);
      setBusinessAddressLoading(false);
      return;
    }
    const query = businessAddress.trim();
    if (businessAddressSelectionRef.current) {
      businessAddressSelectionRef.current = false;
      setBusinessAddressLoading(false);
      return;
    }
    if (query.length < 3) {
      setBusinessAddressResults([]);
      setBusinessAddressLoading(false);
      return;
    }

    setBusinessAddressLoading(true);
    const requestId = ++businessAddressRequestRef.current;
    const timeout = setTimeout(() => {
      fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
          query,
        )}&types=address&key=${GOOGLE_PLACES_KEY}`,
      )
        .then((response) => response.json())
        .then((data) => {
          if (businessAddressRequestRef.current !== requestId) return;
          if (
            data.status &&
            data.status !== "OK" &&
            data.status !== "ZERO_RESULTS"
          ) {
            setBusinessAddressError(
              data.error_message || "Unable to load suggestions.",
            );
            setBusinessAddressResults([]);
          } else {
            setBusinessAddressError(null);
            setBusinessAddressResults(data.predictions || []);
          }
          setBusinessAddressLoading(false);
        })
        .catch(() => {
          if (businessAddressRequestRef.current !== requestId) return;
          setBusinessAddressError("Unable to load suggestions.");
          setBusinessAddressResults([]);
          setBusinessAddressLoading(false);
        });
    }, ADDRESS_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [businessAddress]);

  const approvedBusinesses = useMemo(
    () =>
      businesses.filter((business) => business.approved && !business.rejected),
    [businesses],
  );
  const publicOffers = useMemo(
    () =>
      offers.filter(
        (offer) => offer.active && offer.approvalStatus === "approved",
      ),
    [offers],
  );
  const offerCards = useMemo(() => {
    const businessMap = new Map(
      businesses.map((business) => [business.id, business]),
    );
    return publicOffers
      .map((offer) => {
        const business = businessMap.get(offer.businessId) || offer.business;
        if (!business) return null;
        const categoryKey =
          business.categoryKey || business.category_key || "restaurant";
        const categoryLabel =
          business.category ||
          business.category_label ||
          getCategoryConfig(categoryKey).display;
        const offerTitle = offer.title || business.offer || "New offer";
        const offerType = offer.offerType || offer.offer_type || "";
        const offerDescription = offer.description || "";
        const searchText = [
          business.name,
          categoryLabel,
          offerTitle,
          offerDescription,
          offerType,
          business.tags?.join(" ") || "",
        ]
          .join(" ")
          .toLowerCase();
        const openFromHours = isBusinessOpenNow(business.hours);
        const isOpen =
          openFromHours === null ? (business.isOpen ?? true) : openFromHours;
        return {
          id: offer.id,
          offerId: offer.id,
          businessId: business.id,
          business,
          name: business.name,
          categoryKey,
          offer: offerTitle,
          offerTitle,
          offerDescription,
          offerType,
          distance: business.distance || "--",
          rating: Number.isFinite(business.rating) ? business.rating : null,
          tags: business.tags || [],
          imageUrl: offer.imageUrl,
          redemptionLimitPeriod: offer.redemptionLimitPeriod,
          redemptionLimitCount: offer.redemptionLimitCount,
          searchText,
          isOpen,
          offerCreatedAt: offer.createdAt,
        };
      })
      .filter(Boolean);
  }, [publicOffers, businesses]);

  const filteredOfferCards = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const base = offerCards.filter((card) => {
      const matchesFilters = activeFilters.every((filterKey) => {
        switch (filterKey) {
          case "open":
            return Boolean(card.isOpen);
          case "family":
            return ["cafe", "activity"].includes(
              String(card.categoryKey || "").toLowerCase(),
            );
          default: {
            if (filterKey.startsWith("tag:")) {
              const tagValue = filterKey.replace("tag:", "");
              const tags = Array.isArray(card.tags) ? card.tags : [];
              return tags
                .map((tag) => String(tag || "").toLowerCase())
                .includes(tagValue);
            }
            return true;
          }
        }
      });
      if (!matchesFilters) return false;
      if (!trimmed) return true;
      return card.searchText.includes(trimmed);
    });

    const wantsTop = activeFilters.includes("top");
    const wantsNew = activeFilters.includes("new");

    let filtered = base;
    if (wantsTop) {
      filtered = filtered.filter(
        (card) => Number.isFinite(card.rating) && card.rating >= 4.0,
      );
      if (!filtered.length) {
        filtered = base;
      }
    }
    if (wantsNew) {
      const newFiltered = filtered.filter(
        (card) =>
          card.offerCreatedAt &&
          Date.now() - card.offerCreatedAt <= NEW_WINDOW_MS,
      );
      if (newFiltered.length) {
        filtered = newFiltered;
      }
    }

    const sorted = [...filtered];
    if (wantsTop && wantsNew) {
      sorted.sort((a, b) => {
        const ratingDelta = (b.rating || 0) - (a.rating || 0);
        if (ratingDelta !== 0) return ratingDelta;
        return (b.offerCreatedAt || 0) - (a.offerCreatedAt || 0);
      });
    } else if (wantsTop) {
      sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (wantsNew) {
      sorted.sort((a, b) => (b.offerCreatedAt || 0) - (a.offerCreatedAt || 0));
    }
    return sorted;
  }, [offerCards, activeFilters, query]);

  const filteredBusinesses = useMemo(() => {
    const visibleBusinessIds = new Set(
      filteredOfferCards.map((card) => card.businessId),
    );
    return approvedBusinesses.filter((business) =>
      visibleBusinessIds.has(business.id),
    );
  }, [approvedBusinesses, filteredOfferCards]);

  const ownerOffers = useMemo(() => {
    if (!ownerBusiness?.id) return [];
    return offers.filter((offer) => offer.businessId === ownerBusiness.id);
  }, [offers, ownerBusiness?.id]);
  const offerTypeSuggestion = normalizeOfferType(offerForm.type);
  const showOfferTypeSuggestion =
    offerForm.type &&
    offerTypeSuggestion &&
    offerTypeSuggestion.toLowerCase() !== offerForm.type.trim().toLowerCase();

  const canRequestEdits =
    Boolean(ownerBusiness) && !ownerBusiness?.pendingEdits;
  const canEditBusiness = isEditingBusiness && !ownerBusiness?.pendingEdits;
  const canEditTags = Boolean(ownerBusiness);
  const tagsDirty = useMemo(() => {
    if (!ownerBusiness) return false;
    const currentTags = Array.isArray(ownerBusiness.tags)
      ? ownerBusiness.tags
          .map((tag) =>
            String(tag || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean)
      : [];
    const nextTags = normalizeTagsInput(formData.tags);
    return currentTags.join(",") !== nextTags.join(",");
  }, [ownerBusiness, formData.tags]);
  const selectedBusinessTags = useMemo(
    () => new Set(normalizeTagsInput(formData.tags)),
    [formData.tags],
  );
  const selectedCreateTags = useMemo(
    () => new Set(normalizeTagsInput(createBusinessForm.tags)),
    [createBusinessForm.tags],
  );

  const ownerMetrics = useMemo(() => {
    if (!ownerBusiness) return DEFAULT_ANALYTICS;
    const fallback = BUSINESS_ANALYTICS[ownerBusiness.id] || DEFAULT_ANALYTICS;
    return {
      views: ownerAnalytics.views ?? fallback.views ?? DEFAULT_ANALYTICS.views,
      redemptions:
        ownerAnalytics.redemptions ??
        fallback.redemptions ??
        DEFAULT_ANALYTICS.redemptions,
      reach: ownerAnalytics.reach ?? fallback.reach ?? DEFAULT_ANALYTICS.reach,
    };
  }, [ownerBusiness, ownerAnalytics]);

  const pendingEditBusinesses = useMemo(
    () => businesses.filter((business) => business.pendingEdits),
    [businesses],
  );
  const isAdmin = accountRole === "admin";
  const isSupervisor = accountRole === "supervisor";
  const isOwner = accountRole === "business_owner";
  const isStaff = isAdmin || isSupervisor;
  const showHistoryTab = !isOwner && !isStaff;
  const showCashoutTab = showHistoryTab;
  const roleLabel = isAdmin
    ? "Admin"
    : isSupervisor
      ? "Supervisor"
      : isOwner
        ? "Owner"
        : "Member";
  const visibleTabs = useMemo(
    () =>
      [
        { key: "discover", label: "Discover", show: true },
        { key: "history", label: "History", show: showHistoryTab },
        { key: "cashout", label: "Cash out", show: showCashoutTab },
        { key: "business", label: "Dashboard", show: isOwner },
        { key: "admin", label: "Admin", show: isStaff },
        { key: "profile", label: "Profile", show: true },
      ].filter((tab) => tab.show),
    [isOwner, isStaff, showHistoryTab, showCashoutTab],
  );
  const navContainerWidth = useMemo(() => {
    const count = visibleTabs.length || 1;
    const baseWidth =
      count * NAV_PILL_MIN + (count - 1) * NAV_GAP + NAV_PADDING * 2 + 4;
    const maxWidth = SCREEN_WIDTH - (IS_COMPACT ? 16 : 24);
    if (count <= 2) {
      return Math.min(baseWidth, maxWidth);
    }
    return maxWidth;
  }, [visibleTabs.length]);

  const profileInitials = useMemo(() => {
    const base = (profileName || profileEmail || "W").trim();
    if (!base) return "W";
    const parts = base.split(" ").filter(Boolean);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }, [profileName, profileEmail]);

  const pendingBusinesses = useMemo(
    () =>
      businesses.filter((business) => !business.approved && !business.rejected),
    [businesses],
  );
  const adminBusinesses = useMemo(
    () =>
      businesses
        .filter((business) => business.source === "supabase")
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [businesses],
  );
  const adminOffers = useMemo(
    () =>
      offers
        .filter(
          (offer) =>
            offer.businessId && !String(offer.id || "").startsWith("seed-"),
        )
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [offers],
  );
  const averageRating = useMemo(() => {
    const rated = approvedBusinesses.filter(
      (business) => business.rating && Number.isFinite(business.rating),
    );
    if (!rated.length) return "--";
    const sum = rated.reduce((acc, business) => acc + business.rating, 0);
    return (sum / rated.length).toFixed(1);
  }, [approvedBusinesses]);
  const filteredProfiles = useMemo(() => {
    const trimmed = supervisorSearch.trim().toLowerCase();
    if (!trimmed) return profileList;
    return profileList.filter((profile) => {
      const haystack = [
        profile.full_name,
        profile.email,
        profile.phone,
        profile.company,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [profileList, supervisorSearch]);

  const reviewedBusinessIds = useMemo(() => {
    const ids = new Set();
    userReviews.forEach((review) => {
      if (review.businessId) {
        ids.add(String(review.businessId));
      }
    });
    return ids;
  }, [userReviews]);

  const latestRedemptionByBusiness = useMemo(() => {
    const map = new Map();
    redemptionHistory.forEach((entry) => {
      if (!entry.businessId) return;
      const existing = map.get(entry.businessId);
      if (!existing || (entry.createdAt || 0) > (existing.createdAt || 0)) {
        map.set(entry.businessId, entry);
      }
    });
    return map;
  }, [redemptionHistory]);

  const isReceiptWindowOpen = (entry) => {
    if (!entry?.createdAt) return false;
    return Date.now() - entry.createdAt <= RECEIPT_UPLOAD_WINDOW_MS;
  };

  const historyGroups = useMemo(() => {
    const grouped = new Map();
    redemptionHistory.forEach((entry) => {
      const businessName = entry.business?.name || "Wello business";
      const key = entry.businessId || businessName;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          businessId: entry.businessId || null,
          businessName,
          entries: [],
          lastRedeemed: 0,
        });
      }
      const group = grouped.get(key);
      group.entries.push(entry);
      const createdAt = entry.createdAt || 0;
      if (createdAt > group.lastRedeemed) {
        group.lastRedeemed = createdAt;
      }
    });
    const list = Array.from(grouped.values());
    list.forEach((group) => {
      group.entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const businessKey = group.businessId || group.key;
      const hasReview = reviewedBusinessIds.has(String(businessKey));
      group.pendingEntries = hasReview ? [] : group.entries.slice(0, 1);
      group.pendingCount = hasReview ? 0 : group.pendingEntries.length;
      group.receiptPendingCount = group.entries.reduce((total, entry) => {
        const hasReceipt = Boolean(entry.receipt?.id);
        const verificationStatus = entry.purchaseVerification?.status || null;
        const canFallback =
          verificationStatus === "pending" || verificationStatus === "rejected";
        if (!hasReceipt && (isReceiptWindowOpen(entry) || canFallback)) {
          return total + 1;
        }
        return total;
      }, 0);
    });
    return list.sort((a, b) => (b.lastRedeemed || 0) - (a.lastRedeemed || 0));
  }, [redemptionHistory, reviewedBusinessIds]);

  const receiptOfferGroups = useMemo(() => {
    const grouped = new Map();
    businessReceipts.forEach((receipt) => {
      const key = receipt.offerId || receipt.offerTitle || "offer";
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          offerId: receipt.offerId || null,
          offerTitle: receipt.offerTitle || "Offer",
          receipts: [],
          lastUploadedAt: 0,
        });
      }
      const group = grouped.get(key);
      group.receipts.push(receipt);
      if ((receipt.uploadedAt || 0) > group.lastUploadedAt) {
        group.lastUploadedAt = receipt.uploadedAt || 0;
      }
    });
    const list = Array.from(grouped.values());
    list.forEach((group) => {
      group.receipts.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    });
    return list.sort(
      (a, b) => (b.lastUploadedAt || 0) - (a.lastUploadedAt || 0),
    );
  }, [businessReceipts]);

  const pendingRedemptionGroups = useMemo(() => {
    const grouped = new Map();
    businessRedemptions.forEach((entry) => {
      if (entry.receipt?.id) return;
      const key = entry.offerId || entry.offer?.title || "offer";
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          offerId: entry.offerId || null,
          offerTitle: entry.offer?.title || "Offer",
          entries: [],
          lastRedeemed: 0,
        });
      }
      const group = grouped.get(key);
      group.entries.push(entry);
      if ((entry.createdAt || 0) > group.lastRedeemed) {
        group.lastRedeemed = entry.createdAt || 0;
      }
    });
    const list = Array.from(grouped.values());
    list.forEach((group) => {
      group.entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    });
    return list.sort((a, b) => (b.lastRedeemed || 0) - (a.lastRedeemed || 0));
  }, [businessRedemptions]);

  const pendingReviewCount = useMemo(
    () =>
      historyGroups.reduce(
        (total, group) => total + (group.pendingCount ? 1 : 0),
        0,
      ),
    [historyGroups],
  );
  const pendingReceiptCount = useMemo(
    () =>
      redemptionHistory.reduce((total, entry) => {
        const hasReceipt = Boolean(entry.receipt?.id);
        const verificationStatus = entry.purchaseVerification?.status || null;
        const canFallback =
          verificationStatus === "pending" || verificationStatus === "rejected";
        if (!hasReceipt && (isReceiptWindowOpen(entry) || canFallback)) {
          return total + 1;
        }
        return total;
      }, 0),
    [redemptionHistory],
  );
  const pendingHistoryCount = pendingReviewCount + pendingReceiptCount;

  useEffect(() => {
    if (!businesses.length) return;
    if (authUserId) {
      const owned = businesses.find(
        (business) => business.ownerId === authUserId,
      );
      if (owned?.id && ownerBusinessId !== owned.id) {
        setOwnerBusinessId(owned.id);
      }
      return;
    }
    const exists = ownerBusinessId
      ? businesses.some((business) => business.id === ownerBusinessId)
      : false;
    if (!exists && businesses[0]?.id) {
      setOwnerBusinessId(businesses[0].id);
    }
  }, [businesses, ownerBusinessId, authUserId]);

  useEffect(() => {
    if (activeTab === "admin" && isAdmin) {
      loadProfiles();
    }
  }, [activeTab, isAdmin, loadProfiles]);

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    if (activeTab === "admin" && isStaff) {
      loadChangeRequests({ status: "pending" });
      loadPendingOffers();
    }
  }, [
    activeTab,
    isStaff,
    loadChangeRequests,
    loadPendingOffers,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  ]);

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    if (activeTab === "business" && isOwner && ownerBusiness?.id) {
      loadChangeRequests({ businessId: ownerBusiness.id, status: "pending" });
    }
  }, [
    activeTab,
    isOwner,
    ownerBusiness?.id,
    loadChangeRequests,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  ]);

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    if (activeTab === "business" && isOwner && ownerBusiness?.id) {
      loadBusinessReceipts(ownerBusiness.id);
      loadBusinessRedemptions(ownerBusiness.id);
    }
  }, [
    activeTab,
    isOwner,
    ownerBusiness?.id,
    loadBusinessReceipts,
    loadBusinessRedemptions,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  ]);

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    if (activeTab === "cashout" && isSignedIn) {
      loadCashoutStatus({});
      loadCashbackBalance({});
    }
  }, [
    activeTab,
    isSignedIn,
    loadCashoutStatus,
    loadCashbackBalance,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  ]);

  useEffect(() => {
    if (isSignedIn && authUserId) return;
    setCashbackBalance({
      availableCents: 0,
      paidCents: 0,
      totalCents: 0,
      updatedAt: Date.now(),
    });
    setCashbackBalanceState({ loading: false, error: null });
    setPlaidLinkState({
      loading: false,
      linked: false,
      linkedCount: 0,
      error: null,
    });
  }, [authUserId, isSignedIn]);

  useEffect(() => {
    if (activeTab === "admin" && !isStaff) {
      setActiveTab("discover");
    }
    if (activeTab === "business" && !isOwner) {
      setActiveTab("discover");
    }
    if (activeTab === "history" && (isOwner || isStaff)) {
      setActiveTab("discover");
    }
    if (activeTab === "cashout" && (isOwner || isStaff)) {
      setActiveTab("discover");
    }
  }, [activeTab, isOwner, isStaff]);

  const buildFormFromBusiness = (business) => ({
    name: business?.name || "",
    address: business?.address || "",
    addressPlaceId: null,
    addressCoords: business?.coordinate || null,
    city: business?.city || "",
    state: business?.state || "",
    postalCode: business?.postalCode || "",
    categoryKey: business?.categoryKey || "restaurant",
    offer: business?.offer || "",
    hours: business?.hours || "",
    tags: business?.tags?.join(", ") || "",
    isOpen: business?.isOpen ?? true,
  });

  useEffect(() => {
    if (activeTab !== "business" || !ownerBusiness) return;
    setFormData(buildFormFromBusiness(ownerBusiness));
    setFormMessage(null);
    setIsEditingBusiness(false);
    const parsed = parseBusinessHours(ownerBusiness.hours);
    if (parsed) {
      setEditHoursStart(parsed.startTime);
      setEditHoursStartMeridiem(parsed.startMeridiem);
      setEditHoursEnd(parsed.endTime);
      setEditHoursEndMeridiem(parsed.endMeridiem);
    } else {
      setEditHoursStart("");
      setEditHoursEnd("");
    }
  }, [activeTab, ownerBusiness?.id]);

  useEffect(() => {
    if (activeTab !== "business" || ownerBusiness || !isOwner) return;
    setCreateBusinessForm((prev) => ({
      ...prev,
      name: prev.name || profileCompany || profileName,
      phone: prev.phone || profilePhone,
    }));
  }, [
    activeTab,
    ownerBusiness,
    isOwner,
    profileCompany,
    profileName,
    profilePhone,
  ]);

  useEffect(() => {
    if (activeTab !== "business" || ownerBusiness || !isOwner) return;
    if (!authBusinessDraft) return;
    setCreateBusinessForm((prev) => ({
      ...prev,
      name: prev.name || authBusinessDraft.name || "",
      address: prev.address || authBusinessDraft.address || "",
      addressCoords:
        prev.addressCoords || authBusinessDraft.addressCoords || null,
      city: prev.city || authBusinessDraft.city || "",
      state: prev.state || authBusinessDraft.state || "",
      postalCode: prev.postalCode || authBusinessDraft.postalCode || "",
      categoryKey:
        prev.categoryKey || authBusinessDraft.categoryKey || "restaurant",
      phone: prev.phone || authBusinessDraft.phone || "",
    }));
    if (!createHoursStart && authBusinessDraft.hours) {
      const parts = authBusinessDraft.hours.split(" - ");
      if (parts.length === 2) {
        const [start, end] = parts;
        const [startTime, startMeridiem] = start.trim().split(" ");
        const [endTime, endMeridiem] = end.trim().split(" ");
        if (startTime) setCreateHoursStart(startTime);
        if (startMeridiem) setCreateHoursStartMeridiem(startMeridiem);
        if (endTime) setCreateHoursEnd(endTime);
        if (endMeridiem) setCreateHoursEndMeridiem(endMeridiem);
      }
    }
  }, [activeTab, ownerBusiness, isOwner, authBusinessDraft, createHoursStart]);

  useEffect(() => {
    if (!isEditingBusiness) return;
    if (!editHoursStart || !editHoursEnd) return;
    setFormData((prev) => ({
      ...prev,
      hours: formatBusinessHours(
        editHoursStart,
        editHoursStartMeridiem,
        editHoursEnd,
        editHoursEndMeridiem,
      ),
    }));
  }, [
    isEditingBusiness,
    editHoursStart,
    editHoursStartMeridiem,
    editHoursEnd,
    editHoursEndMeridiem,
  ]);

  useEffect(() => {
    if (!GOOGLE_PLACES_KEY) {
      setCreateAddressResults([]);
      setCreateAddressLoading(false);
      return;
    }
    const query = createBusinessForm.address.trim();
    if (createAddressSelectionRef.current) {
      createAddressSelectionRef.current = false;
      setCreateAddressLoading(false);
      return;
    }
    if (query.length < 3) {
      setCreateAddressResults([]);
      setCreateAddressLoading(false);
      return;
    }

    setCreateAddressLoading(true);
    const requestId = ++createAddressRequestRef.current;
    const timeout = setTimeout(() => {
      fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
          query,
        )}&types=address&key=${GOOGLE_PLACES_KEY}`,
      )
        .then((response) => response.json())
        .then((data) => {
          if (createAddressRequestRef.current !== requestId) return;
          if (
            data.status &&
            data.status !== "OK" &&
            data.status !== "ZERO_RESULTS"
          ) {
            setCreateAddressError(
              data.error_message || "Unable to load suggestions.",
            );
            setCreateAddressResults([]);
          } else {
            setCreateAddressError(null);
            setCreateAddressResults(data.predictions || []);
          }
          setCreateAddressLoading(false);
        })
        .catch(() => {
          if (createAddressRequestRef.current !== requestId) return;
          setCreateAddressError("Unable to load suggestions.");
          setCreateAddressResults([]);
          setCreateAddressLoading(false);
        });
    }, ADDRESS_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [createBusinessForm.address]);

  useEffect(() => {
    if (!authUserId) return;
    registerForPushNotificationsAsync();
  }, [authUserId, registerForPushNotificationsAsync]);

  useEffect(() => {
    loadNotificationPreferences();
  }, [loadNotificationPreferences]);

  useEffect(() => {
    if (!mapRegion?.latitude || !mapRegion?.longitude) return;
    const hash = `${mapRegion.latitude.toFixed(4)}:${mapRegion.longitude.toFixed(4)}`;
    if (lastLocationHashRef.current === hash) return;
    lastLocationHashRef.current = hash;
    upsertUserLocation({
      latitude: mapRegion.latitude,
      longitude: mapRegion.longitude,
    });
  }, [mapRegion, upsertUserLocation]);

  const ensureSupabaseReady = (setError) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setError("Supabase is not configured yet.");
      return false;
    }
    const refreshResult = refreshSupabaseClient();
    if (!refreshResult.ok) {
      setError(refreshResult.error || "Supabase is not ready yet.");
      return false;
    }
    return true;
  };

  const upsertNotificationToken = useCallback(
    async (token) => {
      if (!authUserId || !token) return;
      if (!ensureSupabaseReady(() => null)) return;
      const deviceInfo =
        Device.modelName || Device.deviceName || Device.osName || Platform.OS;

      // Professional behavior: register via Edge Function using service role.
      // This avoids RLS issues when a device token needs to move between accounts.
      const { error: fnError } = await supabase.functions.invoke(
        "push-register-token",
        {
          body: {
            expoPushToken: token,
            platform: Platform.OS,
            deviceInfo,
          },
        },
      );

      if (!fnError) return;

      // Fallback (keeps dev builds usable if the function isn't deployed yet).
      await supabase.from("notification_tokens").upsert(
        {
          user_id: authUserId,
          expo_push_token: token,
          platform: Platform.OS,
          device_info: deviceInfo,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "expo_push_token" },
      );
    },
    [authUserId],
  );

  const registerForPushNotificationsAsync = useCallback(async () => {
    if (!Device.isDevice) {
      setNotificationPermissionStatus("unsupported");
      return;
    }
    try {
      setTokenError(null);
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      const { status: existingStatus } =
        await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== "granted") {
        setNotificationPermissionStatus("denied");
        setTokenError(
          "Notifications are disabled. Enable them in Settings.",
        );
        return;
      }
      setNotificationPermissionStatus("granted");
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ||
        Constants?.easConfig?.projectId ||
        "0359ea52-8164-4fc8-bbc3-7b1ee9d1e5bb";
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId,
      });
      const token = tokenData.data;
      setExpoPushToken(token);
      await upsertNotificationToken(token);
    } catch (error) {
      setNotificationPermissionStatus("denied");
      const raw = String(error?.message || "");
      const isFirebaseInitError =
        Platform.OS === "android" &&
        raw.toLowerCase().includes("default firebaseapp is not initialized");
      setTokenError(
        isFirebaseInitError
          ? "Android push isn't configured yet (FCM). Add google-services.json (Firebase) to the app config and rebuild the dev build."
          : raw || "Unable to register for notifications.",
      );
    }
  }, [authUserId, upsertNotificationToken]);

  const loadNotificationPreferences = useCallback(async () => {
    if (!authUserId) return;
    if (!ensureSupabaseReady(() => null)) return;
    setPreferencesStatus({ loading: true, error: null });
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("new_offer, expiring_offer, nearby_offer")
      .eq("user_id", authUserId)
      .maybeSingle();
    if (!error && data) {
      setNotificationPreferences({
        new_offer: data.new_offer ?? NOTIFICATION_DEFAULTS.new_offer,
        expiring_offer:
          data.expiring_offer ?? NOTIFICATION_DEFAULTS.expiring_offer,
        nearby_offer: data.nearby_offer ?? NOTIFICATION_DEFAULTS.nearby_offer,
      });
    }
    setPreferencesStatus({
      loading: false,
      error: error?.message || null,
    });
  }, [authUserId]);

  const saveNotificationPreferences = useCallback(
    async (nextPreferences) => {
      if (!authUserId) return;
      if (!ensureSupabaseReady(() => null)) return;
      setPreferencesStatus({ loading: true, error: null });
      const { error } = await supabase.from("notification_preferences").upsert({
        user_id: authUserId,
        new_offer:
          typeof nextPreferences.new_offer === "boolean"
            ? nextPreferences.new_offer
            : NOTIFICATION_DEFAULTS.new_offer,
        expiring_offer:
          typeof nextPreferences.expiring_offer === "boolean"
            ? nextPreferences.expiring_offer
            : NOTIFICATION_DEFAULTS.expiring_offer,
        nearby_offer:
          typeof nextPreferences.nearby_offer === "boolean"
            ? nextPreferences.nearby_offer
            : NOTIFICATION_DEFAULTS.nearby_offer,
        updated_at: new Date().toISOString(),
      });
      setPreferencesStatus({
        loading: false,
        error: error?.message || null,
      });
    },
    [authUserId],
  );

  const upsertUserLocation = useCallback(
    async (coords) => {
      if (
        !coords ||
        !coords.latitude ||
        !coords.longitude ||
        !authUserId ||
        !ensureSupabaseReady(() => null)
      ) {
        return;
      }
      await supabase.from("user_locations").upsert({
        user_id: authUserId,
        latitude: coords.latitude,
        longitude: coords.longitude,
        recorded_at: new Date().toISOString(),
      });
    },
    [authUserId],
  );

  const handlePreferenceToggle = useCallback(
    (key, value) => {
      const nextPreferences = { ...notificationPreferences, [key]: value };
      setNotificationPreferences(nextPreferences);
      saveNotificationPreferences(nextPreferences);
    },
    [notificationPreferences, saveNotificationPreferences],
  );

  const handleSignIn = async () => {
    if (!signInEmail.trim() || !signInPassword.trim()) {
      setSignInError("Email and password are required.");
      return;
    }
    if (!ensureSupabaseReady(setSignInError)) return;
    setAuthBusy(true);
    setSignInError(null);
    try {
      const email = signInEmail.trim().toLowerCase();
      // Clear any stale local session keys before attempting a fresh sign-in.
      // This helps when the app was backgrounded and the auth state/storage got wedged.
      await clearSupabaseSession();
      refreshSupabaseClient(true);

      const runSignIn = () =>
        withTimeout(
          supabase.auth.signInWithPassword({
            email,
            password: signInPassword,
          }),
          12000,
          "signIn",
        );

      let result;
      try {
        result = await runSignIn();
      } catch (error) {
        const message = String(error?.message || "");
        const isTimeout =
          message.includes("signIn timeout") ||
          message.includes("fetch timeout") ||
          message.toLowerCase().includes("abort");
        if (!isTimeout) throw error;

        // Self-heal: rebuild the client and retry once.
        await clearSupabaseSession();
        refreshSupabaseClient(true);
        result = await runSignIn();
      }

      const { data, error } = result || {};
      if (error) {
        setSignInError(error.message || "Unable to sign in.");
        return;
      }
      if (!data.user) {
        setSignInError("Unable to sign in.");
        return;
      }
      // Let auth listener hydrate profile once session context is fully ready.
      setAuthUserId(data.user.id);
      setAuthEmail(data.user.email || email);
      setProfileEmail(data.user.email || email);
      setProfileName(formatDisplayName(data.user.email || email));
      setProfilePhone("");
      setProfileCompany("");
      setAccountRole("consumer");
      setIsSignedIn(true);
      setSignInPassword("");
    } catch (error) {
      const raw = String(error?.message || "");
      const friendly =
        raw.includes("timeout") || raw.toLowerCase().includes("abort")
          ? "Sign in timed out. Check your connection and try again."
          : raw || "Unable to sign in.";
      setSignInError(friendly);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!signUpName.trim()) {
      setSignUpError("Full name is required.");
      return;
    }
    if (!signUpEmail.trim() || !signUpPassword.trim()) {
      setSignUpError("Email and password are required.");
      return;
    }
    if (!ensureSupabaseReady(setSignUpError)) return;
    setAuthBusy(true);
    setSignUpError(null);
    try {
      const email = signUpEmail.trim().toLowerCase();
      const { data, error } = await supabase.auth.signUp({
        email,
        password: signUpPassword,
        options: {
          data: {
            full_name: signUpName.trim(),
            role: "consumer",
          },
        },
      });
      if (error) {
        setSignUpError(error.message || "Unable to create account.");
        return;
      }
      if (!data.user) {
        setSignUpError("Check your email to confirm your account.");
        return;
      }
      await hydrateProfile(data.user, "consumer");
      setIsSignedIn(true);
      setSignUpPassword("");
      setSignUpName("");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleBusinessSignUp = async () => {
    if (!businessEmail.trim() || !businessPassword.trim()) {
      setBusinessSignUpError("Email and password are required.");
      return;
    }
    if (!businessOwnerName.trim()) {
      setBusinessSignUpError("Full name is required.");
      return;
    }
    if (!businessName.trim() || !businessAddress.trim()) {
      setBusinessSignUpError("Business name and address are required.");
      return;
    }
    if (!businessPhone.trim()) {
      setBusinessSignUpError("Phone number is required.");
      return;
    }
    if (!businessHoursStart || !businessHoursEnd) {
      setBusinessSignUpError("Operating hours are required.");
      return;
    }
    if (!ensureSupabaseReady(setBusinessSignUpError)) return;
    setAuthBusy(true);
    setBusinessSignUpError(null);
    try {
      const email = businessEmail.trim().toLowerCase();
      const hoursValue = formatBusinessHours(
        businessHoursStart,
        businessHoursStartMeridiem,
        businessHoursEnd,
        businessHoursEndMeridiem,
      );
      let signupCoords = businessAddressCoords;
      if (!signupCoords && businessAddress.trim()) {
        signupCoords = await geocodeAddress(businessAddress.trim());
        if (signupCoords) {
          setBusinessAddressCoords(signupCoords);
        }
      }
      const businessDraft = {
        name: businessName.trim(),
        address: businessAddress.trim(),
        phone: businessPhone.trim(),
        categoryKey: businessCategoryKey,
        hours: hoursValue,
        city: businessAddressCity.trim(),
        state: businessAddressState.trim(),
        postalCode: businessAddressPostal.trim(),
        addressCoords: signupCoords,
      };
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password: businessPassword,
        options: {
          data: {
            role: "business_owner",
            full_name: businessOwnerName.trim(),
            phone: businessPhone.trim(),
            company: businessName.trim(),
            business_draft: businessDraft,
          },
        },
      });
      if (signUpError) {
        setBusinessSignUpError(
          signUpError.message || "Unable to create account.",
        );
        return;
      }
      if (!data.user) {
        setBusinessSignUpError("Check your email to confirm your account.");
        return;
      }

      if (data.session) {
        const profileUpsertError = await upsertProfileWithRetry({
          id: data.user.id,
          email,
          full_name: businessOwnerName.trim(),
          phone: businessPhone.trim() || null,
          company: businessName.trim(),
          role: "business_owner",
        });
        if (profileUpsertError) {
          console.warn(
            "Wello profile upsert failed:",
            profileUpsertError.message,
          );
        }
      }

      if (data.session) {
        await hydrateProfile(data.user, "business_owner");
      } else {
        setBusinessSignUpError(
          "Check your email to confirm, then sign in to finish your profile.",
        );
        return;
      }

      const categoryConfig = getCategoryConfig(businessCategoryKey);
      const { data: businessRows, error: businessError } = await supabase
        .from("businesses")
        .insert({
          owner_id: data.user.id,
          name: businessName.trim(),
          address: businessAddress.trim(),
          city: businessAddressCity.trim() || null,
          state: businessAddressState.trim() || null,
          postal_code: businessAddressPostal.trim() || null,
          phone: businessPhone.trim() || null,
          category_key: businessCategoryKey,
          category_label: categoryConfig.display,
          hours: hoursValue,
          approval_status: "pending",
          status: "active",
          is_open: true,
          latitude: signupCoords?.latitude ?? null,
          longitude: signupCoords?.longitude ?? null,
        })
        .select(
          [
            "id",
            "owner_id",
            "name",
            "address",
            "city",
            "state",
            "postal_code",
            "phone",
            "category_key",
            "category_label",
            "offer_highlight",
            "hours",
            "tags",
            "latitude",
            "longitude",
            "qr_code",
            "is_open",
            "approval_status",
            "status",
            "stripe_account_id",
            "stripe_customer_id",
            "stripe_payment_method_id",
            "stripe_payment_method_brand",
            "stripe_payment_method_last4",
            "stripe_charges_enabled",
            "stripe_payouts_enabled",
            "stripe_onboarded_at",
            "commission_rate_cents",
            "commission_enabled",
            "created_at",
          ].join(","),
        )
        .limit(1);

      if (businessError) {
        setBusinessSignUpError(
          "Account created, but business profile needs review.",
        );
      } else if (businessRows?.[0]) {
        const mapped = mapSupabaseBusiness(businessRows[0], 0);
        setBusinesses((prev) => [mapped, ...prev]);
        setOwnerBusinessId(mapped.id);
      }

      setIsSignedIn(true);
      setBusinessPassword("");
      setBusinessOwnerName("");
      setBusinessName("");
      setBusinessAddress("");
      setBusinessAddressCoords(null);
      setBusinessAddressCity("");
      setBusinessAddressState("");
      setBusinessAddressPostal("");
      setBusinessPhone("");
      setBusinessHoursStart("");
      setBusinessHoursEnd("");
      setBusinessHoursStartMeridiem("AM");
      setBusinessHoursEndMeridiem("PM");
    } finally {
      setAuthBusy(false);
    }
  };

  const openTimePicker = (target) => {
    setTimePickerTarget(target);
    setTimePickerVisible(true);
  };

  const handleSelectTime = (time) => {
    if (timePickerTarget === "start") {
      setBusinessHoursStart(time);
    } else if (timePickerTarget === "end") {
      setBusinessHoursEnd(time);
    } else if (timePickerTarget === "editStart") {
      setEditHoursStart(time);
    } else if (timePickerTarget === "editEnd") {
      setEditHoursEnd(time);
    } else if (timePickerTarget === "createStart") {
      setCreateHoursStart(time);
    } else if (timePickerTarget === "createEnd") {
      setCreateHoursEnd(time);
    }
    setTimePickerVisible(false);
  };

  const handleProfileSave = async () => {
    if (!ensureSupabaseReady(setProfileMessage)) return;
    if (!authUserId) {
      setProfileMessage("Sign in to update your profile.");
      return;
    }
    setProfileMessage(null);
    try {
      const payload = {
        id: authUserId,
        full_name: profileName.trim() || null,
        email: profileEmail.trim().toLowerCase() || null,
        phone: profilePhone.trim() || null,
        company: profileCompany.trim() || null,
      };
      const { error } = await supabase.from("profiles").upsert(payload);
      if (error) {
        setProfileMessage(error.message || "Unable to save profile.");
        return;
      }
      setProfileList((prev) =>
        prev.map((profile) =>
          profile.id === authUserId ? { ...profile, ...payload } : profile,
        ),
      );
      setProfileMessage("Profile updated.");
    } catch (error) {
      setProfileMessage("Unable to save profile.");
    }
  };

  const handleSignOut = () => {
    void forceSignOut();
    setIsSignedIn(false);
    setSignInPassword("");
    setSignUpPassword("");
    setBusinessPassword("");
    setAccountRole("consumer");
    setAuthUserId(null);
    setAuthEmail("");
    setProfileName("");
    setProfileEmail("");
    setProfilePhone("");
    setProfileCompany("");
    viewedOfferIdsRef.current = new Set();
    setAuthBusinessDraft(null);
    setSignInError(null);
    setSignUpError(null);
    setBusinessSignUpError(null);
    setSignInEmail("");
    setSignUpEmail("");
    setBusinessEmail("");
    setBusinessName("");
    setBusinessAddress("");
    setBusinessAddressCoords(null);
    setBusinessAddressCity("");
    setBusinessAddressState("");
    setBusinessAddressPostal("");
    setBusinessPhone("");
    setBusinessHoursStart("");
    setBusinessHoursEnd("");
    setBusinessHoursStartMeridiem("AM");
    setBusinessHoursEndMeridiem("PM");
    setCreateBusinessForm({
      name: "",
      address: "",
      addressCoords: null,
      city: "",
      state: "",
      postalCode: "",
      categoryKey: "restaurant",
      offer: "",
      phone: "",
      tags: "",
    });
    setCreateBusinessError(null);
    setCreateHoursStart("");
    setCreateHoursEnd("");
    setCreateHoursStartMeridiem("AM");
    setCreateHoursEndMeridiem("PM");
    setTimePickerVisible(false);
    setTimePickerTarget("start");
    setAuthView("menu");
    setActiveTab("discover");
    setOfferForm({
      title: "",
      description: "",
      type: "",
      redemptionLimitMode: "unlimited",
      redemptionLimitCount: "1",
      redemptionLimitPeriod: "day",
    });
    setOfferImage(null);
    setOfferError(null);
    setOfferBusy(false);
    setRedemptionHistory([]);
    setRedemptionStatus({ loading: false, error: null });
    setUserReviews([]);
    setReviewStatus({ loading: false, error: null });
    setReviewModalOpen(false);
    setReviewTarget(null);
    setReviewRating(0);
    setReviewText("");
    setReviewError(null);
    setReviewBusy(false);
    setBusinessDetailOpen(false);
    setBusinessDetail(null);
    setBusinessDetailStatus({ loading: false, error: null });
    setBusinessDetailReviews([]);
  };

  const runRedeemGate = async (business) => {
    if (!business) return false;
    setRedeemGateBusy(true);
    setScannerStatus("checking");
    setRedeemGate({
      allowed: false,
      reason: "Checking your location...",
      distanceMeters: null,
    });
    try {
      let businessCoords = getBusinessCoordinate(business);
      if (!businessCoords && business.address) {
        const geocoded = await geocodeAddress(business.address);
        if (geocoded) businessCoords = geocoded;
      }
      if (!businessCoords) {
        setRedeemGate({
          allowed: false,
          reason: REDEEM_BLOCKED_MESSAGE,
          distanceMeters: null,
        });
        setScannerStatus("blocked");
        return false;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setRedeemGate({
          allowed: false,
          reason: REDEEM_BLOCKED_MESSAGE,
          distanceMeters: null,
        });
        setScannerStatus("blocked");
        return false;
      }
      let position = null;
      try {
        position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      } catch (error) {
        setRedeemGate({
          allowed: false,
          reason: REDEEM_BLOCKED_MESSAGE,
          distanceMeters: null,
        });
        setScannerStatus("blocked");
        return false;
      }
      const distance = distanceBetweenMeters(
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
        businessCoords,
      );
      if (!Number.isFinite(distance)) {
        setRedeemGate({
          allowed: false,
          reason: REDEEM_BLOCKED_MESSAGE,
          distanceMeters: null,
        });
        setScannerStatus("blocked");
        return false;
      }
      if (distance <= REDEEM_RADIUS_METERS) {
        setRedeemGate({
          allowed: true,
          reason: null,
          distanceMeters: distance,
        });
        return true;
      }
      setRedeemGate({
        allowed: false,
        reason: REDEEM_BLOCKED_MESSAGE,
        distanceMeters: distance,
      });
      setScannerStatus("blocked");
      return false;
    } finally {
      setRedeemGateBusy(false);
    }
  };

  const handleRedeemOffer = async (card) => {
    const business = resolveBusinessFromCard(card);
    if (!business) return;
    if (!isSignedIn) {
      if (businessDetailOpen) {
        setBusinessDetailOpen(false);
      }
      setSignInError("Sign in to redeem offers.");
      setAuthView("signin");
      openSheet("profile");
      return;
    }
    if (accountRole && accountRole !== "consumer") {
      Alert.alert(
        "User account required",
        "Switch to a user account to redeem offers.",
      );
      return;
    }
    if (businessDetailOpen) {
      setBusinessDetailOpen(false);
    }
    setScannerBusiness(business);
    setScannerOffer(card);
    setScannerStatus("checking");
    setScannerMessage(null);
    redemptionLoggedRef.current = false;
    setScannerVisible(true);
    const allowed = await runRedeemGate(business);
    if (allowed) {
      await redeemOfferInStore(business, card);
    }
  };

  const handleCloseScanner = () => {
    setScannerVisible(false);
    setScannerBusiness(null);
    setScannerStatus(null);
    setScannerOffer(null);
    setScannerMessage(null);
    setRedeemGate({
      allowed: true,
      reason: null,
      distanceMeters: null,
    });
    redemptionLoggedRef.current = false;
  };

  const openReviewForEntry = (entry, businessName) => {
    if (!entry) return;
    setReviewTarget({
      entry,
      businessName: businessName || "Wello business",
    });
    setReviewRating(0);
    setReviewText("");
    setReviewError(null);
    setReviewModalOpen(true);
  };

  const handleOpenReview = (group) => {
    if (!group) return;
    const targetEntry =
      group.pendingEntries?.[0] ||
      group.entries?.find((entry) => entry && entry.id) ||
      null;
    if (!targetEntry) return;
    openReviewForEntry(targetEntry, group.businessName);
  };

  const closeReviewModal = () => {
    setReviewModalOpen(false);
    setReviewTarget(null);
    setReviewRating(0);
    setReviewText("");
    setReviewError(null);
    setReviewBusy(false);
  };

  const openBusinessDetail = (business) => {
    if (!business) return;
    setBusinessDetail(business);
    setBusinessDetailOpen(true);
  };

  const closeBusinessDetail = () => {
    setBusinessDetailOpen(false);
    setBusinessDetail(null);
    setBusinessDetailStatus({ loading: false, error: null });
    setBusinessDetailReviews([]);
    setBusinessDetailOffers([]);
    setBusinessDetailOffersStatus({ loading: false, error: null });
  };

  const handleSubmitReview = async () => {
    if (!reviewTarget?.entry) return;
    if (!reviewRating) {
      setReviewError("Select a star rating to submit your review.");
      return;
    }
    if (!ensureSupabaseReady(setReviewError)) return;
    if (!authUserId) {
      setReviewError("Sign in to submit a review.");
      return;
    }
    if (reviewTarget.entry.businessId) {
      const alreadyReviewed = reviewedBusinessIds.has(
        String(reviewTarget.entry.businessId),
      );
      if (alreadyReviewed) {
        setReviewError("You already reviewed this business.");
        return;
      }
    }
    setReviewBusy(true);
    setReviewError(null);
    const entry = reviewTarget.entry;
    const payload = {
      business_id: entry.businessId || null,
      redemption_id: entry.id,
      offer_id: entry.offerId || null,
      user_id: authUserId,
      rating: reviewRating,
      review_text: reviewText.trim() ? reviewText.trim() : null,
    };
    const { error, data } = await supabase
      .from("reviews")
      .insert(payload)
      .select(
        "id, business_id, redemption_id, offer_id, rating, review_text, created_at",
      )
      .maybeSingle();
    if (error || !data) {
      if (error?.code === "23505") {
        setReviewError("You already reviewed this business.");
      } else {
        setReviewError(error?.message || "Unable to submit your review.");
      }
      setReviewBusy(false);
      return;
    }
    setUserReviews((prev) => [mapSupabaseReview(data), ...prev]);
    setReviewBusy(false);
    closeReviewModal();
    loadUserReviews({ silent: true });
    if (entry.businessId) {
      loadBusinessReviews(entry.businessId, { silent: true });
    }
  };

  const redeemOfferInStore = async (business, offerCard) => {
    if (!business?.id || !authUserId) return false;
    if (accountRole && accountRole !== "consumer") {
      setScannerStatus("error");
      setScannerMessage("Switch to a user account to redeem offers.");
      redemptionLoggedRef.current = false;
      return false;
    }
    if (redemptionLoggedRef.current) return true;
    redemptionLoggedRef.current = true;
    setScannerStatus("redeeming");
    setScannerMessage(null);
    try {
      const offerId = offerCard?.offerId || offerCard?.id || null;
      const limitCount = Number(offerCard?.redemptionLimitCount);
      const limitPeriod = String(offerCard?.redemptionLimitPeriod || "").trim();
      const limitWindowMs =
        limitPeriod === "day"
          ? 24 * 60 * 60 * 1000
          : limitPeriod === "week"
            ? 7 * 24 * 60 * 60 * 1000
            : 0;

      if (
        offerId &&
        Number.isFinite(limitCount) &&
        limitCount > 0 &&
        limitWindowMs > 0
      ) {
        const windowStartIso = new Date(
          Date.now() - limitWindowMs,
        ).toISOString();
        const { count, error: countError } = await supabase
          .from("redemptions")
          .select("id", { count: "exact", head: true })
          .eq("offer_id", offerId)
          .eq("scanned_by", authUserId)
          .gte("created_at", windowStartIso);
        if (countError) {
          console.warn(
            "Wello redemption limit precheck failed:",
            countError.message || countError,
          );
        } else if (Number(count || 0) >= limitCount) {
          const { data: oldestRows } = await supabase
            .from("redemptions")
            .select("created_at")
            .eq("offer_id", offerId)
            .eq("scanned_by", authUserId)
            .gte("created_at", windowStartIso)
            .order("created_at", { ascending: true })
            .limit(1);
          const oldestAt = oldestRows?.[0]?.created_at
            ? new Date(oldestRows[0].created_at).getTime()
            : null;
          const nextAllowedAt = oldestAt
            ? new Date(oldestAt + limitWindowMs)
            : null;
          setScannerStatus("error");
          setScannerMessage(
            nextAllowedAt
              ? `Redemption limit reached. Try again on ${nextAllowedAt.toLocaleString()}.`
              : "Redemption limit reached. Try again later.",
          );
          redemptionLoggedRef.current = false;
          return false;
        }
      }

      const { error } = await supabase.from("redemptions").insert({
        business_id: business.id,
        offer_id: offerId,
        qr_payload: null,
        scanned_by: authUserId,
      });
      if (error) {
        redemptionLoggedRef.current = false;
        setScannerStatus("error");
        const rawDetails = String(error?.details || "");
        const parsedDetails = (() => {
          try {
            return rawDetails ? JSON.parse(rawDetails) : null;
          } catch {
            return null;
          }
        })();
        if (
          String(error?.message || "")
            .toLowerCase()
            .includes("redemption limit") ||
          parsedDetails?.code === "REDEEM_LIMIT"
        ) {
          const nextAllowedAt = parsedDetails?.next_allowed_at
            ? new Date(parsedDetails.next_allowed_at)
            : null;
          setScannerMessage(
            nextAllowedAt
              ? `Redemption limit reached. Try again on ${nextAllowedAt.toLocaleString()}.`
              : "Redemption limit reached. Try again later.",
          );
        }
        console.warn("Wello redemption insert failed:", error.message || error);
        return false;
      }
      setScannerStatus("success");
      loadRedemptions({ silent: true });
      return true;
    } catch (error) {
      redemptionLoggedRef.current = false;
      setScannerStatus("error");
      console.warn("Wello redemption insert failed:", error?.message || error);
      return false;
    }
  };

  const handleLocateMe = async () => {
    try {
      setLocating(true);
      setLocationError(null);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError("Location permission denied.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const nextRegion = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        latitudeDelta: MAP_REGION.latitudeDelta,
        longitudeDelta: MAP_REGION.longitudeDelta,
      };
      setMapRegion(nextRegion);
      upsertUserLocation(position.coords);
      mapRef.current?.animateToRegion(nextRegion, 700);
    } catch (error) {
      setLocationError("Unable to find your location.");
    } finally {
      setLocating(false);
    }
  };

  const openSheet = (nextTab = "discover") => {
    setActiveTab(nextTab);
    bottomSheetRef.current?.snapToIndex(1);
  };

  const scrollToBusiness = (business) => {
    const index = filteredOfferCards.findIndex(
      (item) => item.businessId === business.id,
    );
    if (index >= 0 && cardListRef.current) {
      cardListRef.current.scrollToIndex({ index, animated: true });
    }
  };

  const openSheetForBusiness = (business) => {
    setSelectedId(business.id);
    openSheet("discover");
    scrollToBusiness(business);
  };

  const resolveBusinessFromCard = (card) =>
    businesses.find((business) => business.id === card?.businessId) ||
    card?.business ||
    card;

  const getBusinessCoordinate = (business) => {
    if (!business) return null;
    if (business.hasCoordinates === false) return null;
    const latitude = Number(
      business.coordinate?.latitude ?? business.latitude ?? business.lat,
    );
    const longitude = Number(
      business.coordinate?.longitude ?? business.longitude ?? business.lng,
    );
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    if (latitude === 0 && longitude === 0) return null;
    if (business.fallbackCoordinate) {
      const deltaLat = Math.abs(
        latitude - business.fallbackCoordinate.latitude,
      );
      const deltaLng = Math.abs(
        longitude - business.fallbackCoordinate.longitude,
      );
      if (deltaLat < 0.0001 && deltaLng < 0.0001) return null;
    }
    if (business.address) {
      const deltaLatDefault = Math.abs(latitude - MAP_REGION.latitude);
      const deltaLngDefault = Math.abs(longitude - MAP_REGION.longitude);
      if (deltaLatDefault < 0.001 && deltaLngDefault < 0.001) {
        return null;
      }
    }
    return { latitude, longitude };
  };

  const toRadians = (value) => (value * Math.PI) / 180;

  const distanceBetweenMeters = (from, to) => {
    if (!from || !to) return null;
    const lat1 = toRadians(from.latitude);
    const lat2 = toRadians(to.latitude);
    const deltaLat = toRadians(to.latitude - from.latitude);
    const deltaLng = toRadians(to.longitude - from.longitude);
    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(deltaLng / 2) *
        Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371000 * c;
  };

  const formatDistanceMeters = (meters) => {
    if (!Number.isFinite(meters)) return "--";
    const miles = meters / 1609.34;
    if (miles >= 0.1) return `${miles.toFixed(1)} mi`;
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
  };

  const geocodeAddress = useCallback(async (address) => {
    if (!GOOGLE_PLACES_KEY || !address) return null;
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          address,
        )}&key=${GOOGLE_PLACES_KEY}`,
      );
      const data = await response.json();
      const location = data.results?.[0]?.geometry?.location;
      if (!location) return null;
      return { latitude: location.lat, longitude: location.lng };
    } catch (error) {
      console.warn("Wello geocode failed:", error?.message || error);
      return null;
    }
  }, []);

  const hydrateBusinessCoordinates = useCallback(
    async (list) => {
      if (!GOOGLE_PLACES_KEY || !Array.isArray(list) || list.length === 0) {
        return;
      }
      const missing = list.filter(
        (business) =>
          business.source === "supabase" &&
          !business.hasCoordinates &&
          business.address,
      );
      if (missing.length === 0) return;
      const batch = missing.slice(0, 8);
      for (const business of batch) {
        if (!isMountedRef.current) return;
        if (geocodeCacheRef.current.has(business.id)) continue;
        const coords = await geocodeAddress(business.address);
        if (!coords) continue;
        geocodeCacheRef.current.set(business.id, coords);
        if (isMountedRef.current) {
          setBusinesses((prev) =>
            prev.map((item) =>
              item.id === business.id
                ? { ...item, coordinate: coords, hasCoordinates: true }
                : item,
            ),
          );
        }
        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
          const { error } = await supabase
            .from("businesses")
            .update({
              latitude: coords.latitude,
              longitude: coords.longitude,
            })
            .eq("id", business.id);
          if (error) {
            console.warn("Wello geocode save failed:", error.message);
          }
        }
      }
    },
    [geocodeAddress],
  );
  hydrateBusinessCoordinatesRef.current = hydrateBusinessCoordinates;

  const handleCardPress = async (card) => {
    const business = resolveBusinessFromCard(card);
    if (!business) return;
    trackOfferView(business.id, card?.offerId || card?.id);
    openSheetForBusiness(business);
    openBusinessDetail(business);
    let coordinate = getBusinessCoordinate(business);
    if (!coordinate && business.address) {
      const cached = geocodeCacheRef.current.get(business.id);
      coordinate = cached || (await geocodeAddress(business.address));
      if (coordinate) {
        geocodeCacheRef.current.set(business.id, coordinate);
        setBusinesses((prev) =>
          prev.map((item) =>
            item.id === business.id
              ? { ...item, coordinate, hasCoordinates: true }
              : item,
          ),
        );
      }
    }
    if (!coordinate) return;
    const nextRegion = {
      ...coordinate,
      latitudeDelta: MAP_REGION.latitudeDelta,
      longitudeDelta: MAP_REGION.longitudeDelta,
    };
    setMapRegion(nextRegion);
    mapRef.current?.animateToRegion(nextRegion, 500);
  };

  const handleMarkerPress = (business) => {
    const isSame = selectedId === business.id;
    const isSheetOpen = sheetIndexRef.current > 0;
    if (isSame || isSheetOpen) {
      openSheetForBusiness(business);
    } else {
      setSelectedId(business.id);
    }
  };

  const toggleFilter = (filterKey) => {
    setActiveFilters((prev) =>
      prev.includes(filterKey)
        ? prev.filter((key) => key !== filterKey)
        : [...prev, filterKey],
    );
  };

  const handleFormChange = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddressChange = (value) => {
    addressSelectionRef.current = false;
    setAddressError(null);
    setFormData((prev) => ({
      ...prev,
      address: value,
      addressPlaceId: null,
      addressCoords: null,
      city: "",
      state: "",
      postalCode: "",
    }));
  };

  const handleBusinessAddressChange = (value) => {
    businessAddressSelectionRef.current = false;
    setBusinessAddressError(null);
    setBusinessAddressCoords(null);
    setBusinessAddressCity("");
    setBusinessAddressState("");
    setBusinessAddressPostal("");
    setBusinessAddress(value);
  };

  const handleSelectBusinessSuggestion = async (suggestion) => {
    businessAddressSelectionRef.current = true;
    businessAddressRequestRef.current += 1;
    setBusinessAddressResults([]);
    setBusinessAddressLoading(false);
    setBusinessAddressError(null);
    setBusinessAddress(suggestion.description);

    if (!GOOGLE_PLACES_KEY) return;
    try {
      setBusinessAddressLoading(true);
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
          suggestion.place_id,
        )}&fields=formatted_address,address_components,geometry&key=${GOOGLE_PLACES_KEY}`,
      );
      const data = await response.json();
      if (data.status && data.status !== "OK") {
        throw new Error(data.error_message || "Unable to load place details.");
      }
      if (data.result?.formatted_address) {
        setBusinessAddress(data.result.formatted_address);
      }
      const parsed = parseAddressComponents(data.result?.address_components);
      setBusinessAddressCity(parsed.city || "");
      setBusinessAddressState(parsed.state || "");
      setBusinessAddressPostal(parsed.postalCode || "");
      const location = data.result?.geometry?.location;
      if (location) {
        setBusinessAddressCoords({
          latitude: location.lat,
          longitude: location.lng,
        });
      }
    } catch (error) {
      setBusinessAddressError(error.message || "Unable to load place details.");
    } finally {
      setBusinessAddressLoading(false);
    }
  };

  const handleSelectSuggestion = async (suggestion) => {
    addressSelectionRef.current = true;
    addressRequestRef.current += 1;
    setAddressResults([]);
    setAddressLoading(false);
    setAddressError(null);
    setFormData((prev) => ({
      ...prev,
      address: suggestion.description,
      addressPlaceId: suggestion.place_id,
    }));

    if (!GOOGLE_PLACES_KEY) return;
    try {
      setAddressLoading(true);
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
          suggestion.place_id,
        )}&fields=geometry,formatted_address,address_components&key=${GOOGLE_PLACES_KEY}`,
      );
      const data = await response.json();
      if (data.status && data.status !== "OK") {
        throw new Error(data.error_message || "Unable to load place details.");
      }
      const location = data.result?.geometry?.location;
      if (location) {
        const parsed = parseAddressComponents(data.result?.address_components);
        setFormData((prev) => ({
          ...prev,
          address: data.result.formatted_address || prev.address,
          addressCoords: { latitude: location.lat, longitude: location.lng },
          city: parsed.city || prev.city,
          state: parsed.state || prev.state,
          postalCode: parsed.postalCode || prev.postalCode,
        }));
        mapRef.current?.animateToRegion(
          {
            latitude: location.lat,
            longitude: location.lng,
            latitudeDelta: MAP_REGION.latitudeDelta,
            longitudeDelta: MAP_REGION.longitudeDelta,
          },
          600,
        );
      }
    } catch (error) {
      setAddressError(error.message || "Unable to load place details.");
    } finally {
      setAddressLoading(false);
    }
  };

  const handleSaveTags = async () => {
    if (!ownerBusiness || !tagsDirty) return;
    const tagList = normalizeTagsInput(formData.tags);
    const nextTags = tagList.length ? tagList : ["local"];
    setTagSaveStatus({ saving: true, error: null, success: null });
    const updatedBusiness = {
      ...ownerBusiness,
      tags: nextTags,
    };

    if (
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY ||
      ownerBusiness.source !== "supabase"
    ) {
      setBusinesses((prev) =>
        prev.map((business) =>
          business.id === ownerBusiness.id ? updatedBusiness : business,
        ),
      );
      setTagSaveStatus({
        saving: false,
        error: null,
        success: "Tags saved.",
      });
      return;
    }

    try {
      const { data, error } = await supabase
        .from("businesses")
        .update({ tags: nextTags })
        .eq("id", ownerBusiness.id)
        .select(
          [
            "id",
            "owner_id",
            "name",
            "address",
            "city",
            "state",
            "postal_code",
            "phone",
            "category_key",
            "category_label",
            "offer_highlight",
            "hours",
            "tags",
            "latitude",
            "longitude",
            "qr_code",
            "is_open",
            "approval_status",
            "status",
            "stripe_account_id",
            "stripe_customer_id",
            "stripe_payment_method_id",
            "stripe_payment_method_brand",
            "stripe_payment_method_last4",
            "stripe_charges_enabled",
            "stripe_payouts_enabled",
            "stripe_onboarded_at",
            "commission_rate_cents",
            "commission_enabled",
            "created_at",
          ].join(","),
        )
        .maybeSingle();
      if (error || !data) {
        setTagSaveStatus({
          saving: false,
          error: error?.message || "Unable to save tags.",
          success: null,
        });
        return;
      }
      const mapped = mapSupabaseBusiness(data, 0);
      setBusinesses((prev) =>
        prev.map((business) =>
          business.id === ownerBusiness.id
            ? { ...mapped, pendingEdits: ownerBusiness.pendingEdits }
            : business,
        ),
      );
      setTagSaveStatus({
        saving: false,
        error: null,
        success: "Tags saved.",
      });
    } catch (error) {
      setTagSaveStatus({
        saving: false,
        error: error?.message || "Unable to save tags.",
        success: null,
      });
    }
  };

  const handleSaveBusiness = async () => {
    if (!ownerBusiness) return;
    if (!formData.name.trim()) {
      setFormMessage({
        type: "error",
        text: "Business name is required.",
      });
      return;
    }
    setFormMessage(null);

    const tagList = normalizeTagsInput(formData.tags);
    const trimmedName = formData.name.trim();
    const trimmedAddress = formData.address.trim();
    const trimmedCity = formData.city.trim();
    const trimmedState = formData.state.trim();
    const trimmedPostal = formData.postalCode.trim();
    const pendingEdits = {};

    if (trimmedName && trimmedName !== ownerBusiness.name) {
      pendingEdits.name = trimmedName;
    }
    if (trimmedAddress && trimmedAddress !== (ownerBusiness.address || "")) {
      pendingEdits.address = trimmedAddress;
      if (formData.addressCoords) {
        pendingEdits.coordinate = formData.addressCoords;
      }
    }
    if (trimmedCity !== (ownerBusiness.city || "")) {
      pendingEdits.city = trimmedCity;
    }
    if (trimmedState !== (ownerBusiness.state || "")) {
      pendingEdits.state = trimmedState;
    }
    if (trimmedPostal !== (ownerBusiness.postalCode || "")) {
      pendingEdits.postalCode = trimmedPostal;
    }
    if (formData.categoryKey !== ownerBusiness.categoryKey) {
      pendingEdits.categoryKey = formData.categoryKey;
    }

    const hasPendingEdits = Object.keys(pendingEdits).length > 0;
    const nextCategoryKey = hasPendingEdits
      ? ownerBusiness.categoryKey
      : formData.categoryKey;
    const categoryDisplay = getCategoryConfig(nextCategoryKey).display;

    const updatedBusiness = {
      ...ownerBusiness,
      name: hasPendingEdits ? ownerBusiness.name : trimmedName,
      address: hasPendingEdits ? ownerBusiness.address : trimmedAddress,
      city: hasPendingEdits ? ownerBusiness.city : trimmedCity,
      state: hasPendingEdits ? ownerBusiness.state : trimmedState,
      postalCode: hasPendingEdits ? ownerBusiness.postalCode : trimmedPostal,
      category: categoryDisplay,
      categoryKey: nextCategoryKey,
      offer: ownerBusiness.offer,
      tags: tagList.length ? tagList : ["local"],
      isOpen: formData.isOpen,
      hours: formData.hours.trim() || ownerBusiness.hours,
      coordinate: hasPendingEdits
        ? ownerBusiness.coordinate
        : formData.addressCoords || ownerBusiness.coordinate,
      pendingEdits: hasPendingEdits ? pendingEdits : null,
      pendingEditsAt: hasPendingEdits ? Date.now() : null,
    };

    if (
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY ||
      ownerBusiness.source !== "supabase"
    ) {
      setBusinesses((prev) =>
        prev.map((business) =>
          business.id === ownerBusiness.id ? updatedBusiness : business,
        ),
      );
      setFormMessage({
        type: "success",
        text: hasPendingEdits
          ? "Changes sent for approval. You'll see updates once approved."
          : "Changes saved.",
      });
      setIsEditingBusiness(false);
      return;
    }

    setBusinessSaveBusy(true);
    try {
      let pendingRequestId = ownerBusiness.pendingRequestId || null;
      if (hasPendingEdits) {
        const { data: request, error: requestError } = await supabase
          .from("change_requests")
          .insert({
            entity_type: "business",
            entity_id: ownerBusiness.id,
            business_id: ownerBusiness.id,
            submitted_by: authUserId,
            payload: pendingEdits,
            status: "pending",
          })
          .select("id, entity_type, business_id, payload, status, created_at")
          .maybeSingle();
        if (requestError || !request) {
          setFormMessage({
            type: "error",
            text: requestError?.message || "Unable to submit changes.",
          });
          return;
        }
        pendingRequestId = request.id;
        const nextRequests = [
          request,
          ...changeRequests.filter((item) => item.id !== request.id),
        ];
        setChangeRequests(nextRequests);
        applyPendingEditsFromRequests(nextRequests);
      }

      const updatePayload = {
        tags: tagList.length ? tagList : [],
        hours: formData.hours.trim() || ownerBusiness.hours || null,
        is_open: formData.isOpen,
      };
      if (!hasPendingEdits) {
        updatePayload.name = trimmedName;
        updatePayload.address = trimmedAddress;
        updatePayload.city = trimmedCity || null;
        updatePayload.state = trimmedState || null;
        updatePayload.postal_code = trimmedPostal || null;
        updatePayload.category_key = formData.categoryKey;
        updatePayload.category_label = getCategoryConfig(
          formData.categoryKey,
        ).display;
        if (formData.addressCoords) {
          updatePayload.latitude = formData.addressCoords.latitude;
          updatePayload.longitude = formData.addressCoords.longitude;
        }
      }

      const { data, error } = await supabase
        .from("businesses")
        .update(updatePayload)
        .eq("id", ownerBusiness.id)
        .select(
          [
            "id",
            "owner_id",
            "name",
            "address",
            "city",
            "state",
            "postal_code",
            "phone",
            "category_key",
            "category_label",
            "offer_highlight",
            "hours",
            "tags",
            "latitude",
            "longitude",
            "qr_code",
            "is_open",
            "approval_status",
            "status",
            "created_at",
          ].join(","),
        )
        .maybeSingle();
      if (error || !data) {
        setFormMessage({
          type: "error",
          text: error?.message || "Unable to save business updates.",
        });
        return;
      }
      const mapped = mapSupabaseBusiness(data, 0);
      const finalBusiness = {
        ...mapped,
        pendingEdits: hasPendingEdits ? pendingEdits : null,
        pendingEditsAt: hasPendingEdits ? Date.now() : null,
        pendingRequestId: hasPendingEdits ? pendingRequestId : null,
      };
      setBusinesses((prev) =>
        prev.map((business) =>
          business.id === ownerBusiness.id ? finalBusiness : business,
        ),
      );
      setFormMessage({
        type: "success",
        text: hasPendingEdits
          ? "Changes sent for approval. You'll see updates once approved."
          : "Changes saved.",
      });
      setIsEditingBusiness(false);
    } finally {
      setBusinessSaveBusy(false);
    }
  };

  const handleApprove = async (id) => {
    const target = businesses.find((business) => business.id === id);
    if (!target) return;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || target.source !== "supabase") {
      setBusinesses((prev) =>
        prev.map((business) =>
          business.id === id ? { ...business, approved: true } : business,
        ),
      );
      return;
    }
    const { data, error } = await supabase
      .from("businesses")
      .update({ approval_status: "approved", status: "active" })
      .eq("id", id)
      .select(
        [
          "id",
          "owner_id",
          "name",
          "address",
          "city",
          "state",
          "postal_code",
          "phone",
          "category_key",
          "category_label",
          "offer_highlight",
          "hours",
          "tags",
          "latitude",
          "longitude",
          "qr_code",
          "is_open",
          "approval_status",
          "status",
          "stripe_account_id",
          "stripe_customer_id",
          "stripe_payment_method_id",
          "stripe_payment_method_brand",
          "stripe_payment_method_last4",
          "stripe_charges_enabled",
          "stripe_payouts_enabled",
          "stripe_onboarded_at",
          "commission_rate_cents",
          "commission_enabled",
          "created_at",
        ].join(","),
      )
      .maybeSingle();
    if (error || !data) {
      console.warn("Wello approve failed:", error?.message);
      return;
    }
    const mapped = mapSupabaseBusiness(data, 0);
    setBusinesses((prev) =>
      prev.map((business) =>
        business.id === id ? { ...mapped, pendingEdits: null } : business,
      ),
    );
  };

  const handleApproveEdits = async (id) => {
    const target = businesses.find((business) => business.id === id);
    if (!target?.pendingEdits) return;
    if (
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY ||
      target.source !== "supabase" ||
      !target.pendingRequestId
    ) {
      setBusinesses((prev) =>
        prev.map((business) => {
          if (business.id !== id || !business.pendingEdits) return business;
          const pending = business.pendingEdits;
          const nextCategoryKey = pending.categoryKey || business.categoryKey;
          const categoryDisplay = getCategoryConfig(nextCategoryKey).display;
          return {
            ...business,
            ...pending,
            categoryKey: nextCategoryKey,
            category: categoryDisplay,
            pendingEdits: null,
            pendingEditsAt: null,
          };
        }),
      );
      return;
    }

    const updates = {};
    const pending = target.pendingEdits;
    if (pending.name) updates.name = pending.name;
    if (pending.address) updates.address = pending.address;
    if (pending.city !== undefined) updates.city = pending.city || null;
    if (pending.state !== undefined) updates.state = pending.state || null;
    if (pending.postalCode !== undefined) {
      updates.postal_code = pending.postalCode || null;
    }
    if (pending.categoryKey) {
      updates.category_key = pending.categoryKey;
      updates.category_label = getCategoryConfig(pending.categoryKey).display;
    }
    if (pending.coordinate) {
      updates.latitude = pending.coordinate.latitude;
      updates.longitude = pending.coordinate.longitude;
    }

    const { data, error } = await supabase
      .from("businesses")
      .update(updates)
      .eq("id", id)
      .select(
        [
          "id",
          "owner_id",
          "name",
          "address",
          "city",
          "state",
          "postal_code",
          "phone",
          "category_key",
          "category_label",
          "offer_highlight",
          "hours",
          "tags",
          "latitude",
          "longitude",
          "qr_code",
          "is_open",
          "approval_status",
          "status",
          "stripe_account_id",
          "stripe_customer_id",
          "stripe_payment_method_id",
          "stripe_payment_method_brand",
          "stripe_payment_method_last4",
          "stripe_charges_enabled",
          "stripe_payouts_enabled",
          "stripe_onboarded_at",
          "commission_rate_cents",
          "commission_enabled",
          "created_at",
        ].join(","),
      )
      .maybeSingle();
    if (error || !data) {
      console.warn("Wello approve edits failed:", error?.message);
      return;
    }
    await supabase
      .from("change_requests")
      .update({
        status: "approved",
        reviewed_by: authUserId || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", target.pendingRequestId);

    const mapped = mapSupabaseBusiness(data, 0);
    setBusinesses((prev) =>
      prev.map((business) =>
        business.id === id
          ? {
              ...mapped,
              pendingEdits: null,
              pendingEditsAt: null,
              pendingRequestId: null,
            }
          : business,
      ),
    );
    setChangeRequests((prev) =>
      prev.map((request) =>
        request.id === target.pendingRequestId
          ? { ...request, status: "approved" }
          : request,
      ),
    );
  };

  const handleRejectEdits = async (id) => {
    const target = businesses.find((business) => business.id === id);
    if (!target?.pendingEdits) return;
    if (
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY ||
      target.source !== "supabase" ||
      !target.pendingRequestId
    ) {
      setBusinesses((prev) =>
        prev.map((business) =>
          business.id === id
            ? { ...business, pendingEdits: null, pendingEditsAt: null }
            : business,
        ),
      );
      return;
    }

    await supabase
      .from("change_requests")
      .update({
        status: "rejected",
        reviewed_by: authUserId || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", target.pendingRequestId);

    setBusinesses((prev) =>
      prev.map((business) =>
        business.id === id
          ? {
              ...business,
              pendingEdits: null,
              pendingEditsAt: null,
              pendingRequestId: null,
            }
          : business,
      ),
    );
    setChangeRequests((prev) =>
      prev.map((request) =>
        request.id === target.pendingRequestId
          ? { ...request, status: "rejected" }
          : request,
      ),
    );
  };

  const handleReject = async (id) => {
    const target = businesses.find((business) => business.id === id);
    if (!target) return;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || target.source !== "supabase") {
      setBusinesses((prev) =>
        prev.map((business) =>
          business.id === id ? { ...business, rejected: true } : business,
        ),
      );
      return;
    }
    const { data, error } = await supabase
      .from("businesses")
      .update({ approval_status: "rejected", status: "inactive" })
      .eq("id", id)
      .select(
        [
          "id",
          "owner_id",
          "name",
          "address",
          "city",
          "state",
          "postal_code",
          "phone",
          "category_key",
          "category_label",
          "offer_highlight",
          "hours",
          "tags",
          "latitude",
          "longitude",
          "qr_code",
          "is_open",
          "approval_status",
          "status",
          "stripe_account_id",
          "stripe_customer_id",
          "stripe_payment_method_id",
          "stripe_payment_method_brand",
          "stripe_payment_method_last4",
          "stripe_charges_enabled",
          "stripe_payouts_enabled",
          "stripe_onboarded_at",
          "commission_rate_cents",
          "commission_enabled",
          "created_at",
        ].join(","),
      )
      .maybeSingle();
    if (error || !data) {
      console.warn("Wello reject failed:", error?.message);
      return;
    }
    const mapped = mapSupabaseBusiness(data, 0);
    setBusinesses((prev) =>
      prev.map((business) =>
        business.id === id ? { ...mapped, pendingEdits: null } : business,
      ),
    );
  };

  const handleScrollToIndexFailed = (info) => {
    const target = Math.max(0, info.highestMeasuredFrameIndex);
    cardListRef.current?.scrollToIndex({ index: target, animated: true });
  };

  const applyPendingEditsFromRequests = useCallback((requests) => {
    if (!Array.isArray(requests)) return;
    const pendingByBusiness = new Map();
    requests
      .filter(
        (request) =>
          request.status === "pending" && request.entity_type === "business",
      )
      .forEach((request) => {
        if (!request.business_id) return;
        const existing = pendingByBusiness.get(request.business_id);
        const nextTime = request.created_at
          ? new Date(request.created_at).getTime()
          : 0;
        const prevTime = existing?.created_at
          ? new Date(existing.created_at).getTime()
          : 0;
        if (!existing || nextTime > prevTime) {
          pendingByBusiness.set(request.business_id, request);
        }
      });

    setBusinesses((prev) =>
      prev.map((business) => {
        if (business.source !== "supabase") return business;
        const pending = pendingByBusiness.get(business.id);
        if (!pending) {
          if (!business.pendingEdits && !business.pendingRequestId) {
            return business;
          }
          return {
            ...business,
            pendingEdits: null,
            pendingEditsAt: null,
            pendingRequestId: null,
          };
        }
        const pendingEdits = pending.payload || {};
        const pendingEditsAt = pending.created_at
          ? new Date(pending.created_at).getTime()
          : Date.now();
        return {
          ...business,
          pendingEdits,
          pendingEditsAt,
          pendingRequestId: pending.id,
        };
      }),
    );
  }, []);

  const loadChangeRequests = useCallback(
    async ({ businessId, status } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        setChangeRequestStatus({
          loading: false,
          error: "Supabase is not configured for change requests yet.",
        });
        return;
      }
      setChangeRequestStatus({ loading: true, error: null });
      let query = supabase
        .from("change_requests")
        .select("id, entity_type, business_id, payload, status, created_at");
      if (status) {
        query = query.eq("status", status);
      }
      if (businessId) {
        query = query.eq("business_id", businessId);
      }
      const { data, error } = await query.order("created_at", {
        ascending: false,
      });
      if (error) {
        setChangeRequestStatus({
          loading: false,
          error: error.message || "Unable to load change requests.",
        });
        return;
      }
      const list = Array.isArray(data) ? data : [];
      setChangeRequests(list);
      setChangeRequestStatus({ loading: false, error: null });
      applyPendingEditsFromRequests(list);
    },
    [applyPendingEditsFromRequests],
  );

  const mergeOffers = useCallback((nextOffers) => {
    setOffers((prev) => {
      const map = new Map(prev.map((offer) => [offer.id, offer]));
      nextOffers.forEach((offer) => {
        map.set(offer.id, offer);
      });
      return Array.from(map.values()).sort(
        (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      );
    });
  }, []);

  const loadRemoteOffers = useCallback(
    async ({ silent } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        setOfferStatus({
          loading: false,
          error: "Supabase is not configured for offers yet.",
        });
        return;
      }
      if (!silent) {
        setOfferStatus({ loading: true, error: null });
      }
      const { data, error } = await supabase
        .from("offers")
        .select(
          [
            "id",
            "business_id",
            "title",
            "description",
            "offer_type",
            "image_url",
            "active",
            "approval_status",
            "redemption_limit_period",
            "redemption_limit_count",
            "created_at",
            "business:businesses (id, name, category_key, category_label, tags, latitude, longitude, is_open, approval_status, status)",
          ].join(","),
        )
        .eq("active", true)
        .eq("approval_status", "approved")
        .order("created_at", { ascending: false });
      if (error) {
        if (!silent) {
          setOfferStatus({
            loading: false,
            error: error.message || "Unable to load offers.",
          });
        }
        return;
      }
      mergeOffers((data || []).map(mapSupabaseOffer));
      if (!silent) {
        setOfferStatus({ loading: false, error: null });
      }
    },
    [mergeOffers],
  );

  const loadBusinessRatings = useCallback(async ({ silent } = {}) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const { data, error } = await supabase
      .from("reviews")
      .select("business_id, rating");
    if (error) {
      if (!silent) {
        console.warn("Wello ratings load failed:", error.message || error);
      }
      return;
    }
    const totals = new Map();
    (data || []).forEach((row) => {
      if (!row?.business_id) return;
      const rating = Number(row.rating);
      if (!Number.isFinite(rating) || rating <= 0) return;
      const current = totals.get(row.business_id) || { sum: 0, count: 0 };
      current.sum += rating;
      current.count += 1;
      totals.set(row.business_id, current);
    });
    setBusinesses((prev) =>
      prev.map((business) => {
        const stat = totals.get(business.id);
        if (!stat) return business;
        const average = stat.sum / stat.count;
        return { ...business, rating: average };
      }),
    );
    setBusinessDetail((prev) => {
      if (!prev?.id) return prev;
      const stat = totals.get(prev.id);
      if (!stat) return prev;
      const average = stat.sum / stat.count;
      return { ...prev, rating: average };
    });
  }, []);

  const loadOwnerOffers = useCallback(
    async (businessId, { silent } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !businessId) return;
      if (!silent) {
        setOwnerOffersStatus({ loading: true, error: null });
      }
      const { data, error } = await supabase
        .from("offers")
        .select(
          [
            "id",
            "business_id",
            "title",
            "description",
            "offer_type",
            "image_url",
            "active",
            "approval_status",
            "redemption_limit_period",
            "redemption_limit_count",
            "created_at",
          ].join(","),
        )
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error) {
        if (!silent) {
          setOwnerOffersStatus({
            loading: false,
            error: error.message || "Unable to load offers.",
          });
        }
        return;
      }
      const mapped = (data || []).map(mapSupabaseOffer);
      setOwnerOffersList(mapped);
      mergeOffers(mapped);
      if (!silent) {
        setOwnerOffersStatus({ loading: false, error: null });
      }
    },
    [mergeOffers],
  );

  const refreshAll = useCallback(
    async ({ silent, force } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
      const now = Date.now();
      if (refreshInFlightRef.current) return;
      if (!force && now - lastRefreshRef.current < REFRESH_MIN_INTERVAL_MS) {
        return;
      }
      refreshInFlightRef.current = true;
      lastRefreshRef.current = now;
      if (!silent) {
        setRefreshing(true);
      }
      try {
        await Promise.all([
          loadRemoteBusinesses({ silent: true }),
          loadRemoteOffers({ silent: true }),
        ]);
        await loadBusinessRatings({ silent: true });
        if (ownerBusiness?.id) {
          await loadOwnerOffers(ownerBusiness.id);
        }
      } finally {
        refreshInFlightRef.current = false;
        if (!silent) {
          setRefreshing(false);
        }
      }
    },
    [
      loadRemoteBusinesses,
      loadRemoteOffers,
      loadBusinessRatings,
      loadOwnerOffers,
      ownerBusiness?.id,
    ],
  );

  const handleRefresh = useCallback(() => {
    refreshAll({ silent: false });
  }, [refreshAll]);

  const loadPendingOffers = useCallback(async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setPendingOfferStatus({
        loading: false,
        error: "Supabase is not configured for offers yet.",
      });
      return;
    }
    setPendingOfferStatus({ loading: true, error: null });
    const { data, error } = await supabase
      .from("offers")
      .select(
        [
          "id",
          "business_id",
          "title",
          "description",
          "offer_type",
          "image_url",
          "active",
          "approval_status",
          "redemption_limit_period",
          "redemption_limit_count",
          "created_at",
          "business:businesses (id, name, category_key, category_label)",
        ].join(","),
      )
      .eq("approval_status", "pending")
      .order("created_at", { ascending: false });
    if (error) {
      setPendingOfferStatus({
        loading: false,
        error: error.message || "Unable to load offer reviews.",
      });
      return;
    }
    setPendingOffers((data || []).map(mapSupabaseOffer));
    setPendingOfferStatus({ loading: false, error: null });
  }, []);

  const handleApproveOffer = async (offerId) => {
    if (!offerId) return;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const { data, error } = await supabase
      .from("offers")
      .update({ approval_status: "approved" })
      .eq("id", offerId)
      .select(
        [
          "id",
          "business_id",
          "title",
          "description",
          "offer_type",
          "image_url",
          "active",
          "approval_status",
          "redemption_limit_period",
          "redemption_limit_count",
          "created_at",
          "business:businesses (id, name, category_key, category_label)",
        ].join(","),
      )
      .maybeSingle();
    if (error || !data) {
      console.warn("Wello offer approve failed:", error?.message);
      return;
    }
    const mapped = mapSupabaseOffer(data);
    mergeOffers([mapped]);
    setPendingOffers((prev) => prev.filter((offer) => offer.id !== offerId));
    loadRemoteOffers();
  };

  const handleRejectOffer = async (offerId) => {
    if (!offerId) return;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const { data, error } = await supabase
      .from("offers")
      .update({ approval_status: "rejected", active: false })
      .eq("id", offerId)
      .select(
        [
          "id",
          "business_id",
          "title",
          "description",
          "offer_type",
          "image_url",
          "active",
          "approval_status",
          "redemption_limit_period",
          "redemption_limit_count",
          "created_at",
          "business:businesses (id, name, category_key, category_label)",
        ].join(","),
      )
      .maybeSingle();
    if (error || !data) {
      console.warn("Wello offer reject failed:", error?.message);
      return;
    }
    const mapped = mapSupabaseOffer(data);
    mergeOffers([mapped]);
    setPendingOffers((prev) => prev.filter((offer) => offer.id !== offerId));
  };

  const handleAdminDeleteOffer = async (offer) => {
    if (!offer?.id) return;
    if (
      !ensureSupabaseReady((message) =>
        setAdminActionStatus({ loading: false, error: message, success: null }),
      )
    ) {
      return;
    }
    setAdminActionStatus({ loading: true, error: null, success: null });
    const imageError = await removeOfferImageByUrl(offer.imageUrl);
    const { error } = await supabase.from("offers").delete().eq("id", offer.id);
    if (error) {
      setAdminActionStatus({
        loading: false,
        error: error.message || "Unable to delete offer.",
        success: null,
      });
      return;
    }
    setOffers((prev) => prev.filter((item) => item.id !== offer.id));
    setPendingOffers((prev) => prev.filter((item) => item.id !== offer.id));
    setAdminActionStatus({
      loading: false,
      error: null,
      success: imageError
        ? "Offer deleted. Image cleanup failed."
        : "Offer deleted.",
    });
  };

  const handleAdminDeleteBusiness = async (business) => {
    if (!business?.id) return;
    if (business.source !== "supabase") {
      setBusinesses((prev) => prev.filter((item) => item.id !== business.id));
      setOffers((prev) =>
        prev.filter((offer) => offer.businessId !== business.id),
      );
      setPendingOffers((prev) =>
        prev.filter((offer) => offer.businessId !== business.id),
      );
      setAdminActionStatus({
        loading: false,
        error: null,
        success: "Business removed locally.",
      });
      return;
    }
    if (
      !ensureSupabaseReady((message) =>
        setAdminActionStatus({ loading: false, error: message, success: null }),
      )
    ) {
      return;
    }
    setAdminActionStatus({ loading: true, error: null, success: null });
    let imageCleanupError = null;
    const { data: offerRows, error: offerError } = await supabase
      .from("offers")
      .select("id, image_url")
      .eq("business_id", business.id);
    if (offerError) {
      imageCleanupError = offerError.message || "Unable to load offer images.";
    }
    const imagePaths = Array.from(
      new Set(
        (offerRows || [])
          .map((row) => getOfferImagePath(row.image_url))
          .filter(Boolean),
      ),
    );
    if (imagePaths.length) {
      const { error: storageError } = await supabase.storage
        .from(OFFER_IMAGE_BUCKET)
        .remove(imagePaths);
      if (storageError) {
        imageCleanupError =
          storageError.message || "Unable to remove offer images.";
      }
    }
    const { error } = await supabase
      .from("businesses")
      .delete()
      .eq("id", business.id);
    if (error) {
      setAdminActionStatus({
        loading: false,
        error: error.message || "Unable to delete business.",
        success: null,
      });
      return;
    }
    setBusinesses((prev) => prev.filter((item) => item.id !== business.id));
    setOffers((prev) =>
      prev.filter((offer) => offer.businessId !== business.id),
    );
    setPendingOffers((prev) =>
      prev.filter((offer) => offer.businessId !== business.id),
    );
    if (ownerBusinessId === business.id) {
      setOwnerBusinessId(null);
    }
    if (businessDetail?.id === business.id) {
      setBusinessDetail(null);
      setBusinessDetailOpen(false);
    }
    setAdminActionStatus({
      loading: false,
      error: null,
      success: imageCleanupError
        ? "Business deleted. Image cleanup failed."
        : "Business deleted.",
    });
  };

  const handlePickOfferImage = async () => {
    if (!ownerBusiness) {
      setOfferError("Create your business profile first.");
      return;
    }
    setOfferError(null);
    setOfferImageStatus({ uploading: false, error: null });
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    const hasPermission = permission.granted || permission.status === "limited";
    if (!hasPermission) {
      setOfferImageStatus({
        uploading: false,
        error: "Photo access is required. Enable it in Settings.",
      });
      return;
    }
    try {
      const mediaTypes = getImagePickerMediaTypes();
      const result = await ImagePicker.launchImageLibraryAsync({
        ...(mediaTypes ? { mediaTypes } : {}),
        allowsEditing: false,
        aspect: [2, 1],
        quality: 0.85,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      if (!isImageAsset(asset)) {
        setOfferImageStatus({
          uploading: false,
          error: "Please select an image file.",
        });
        return;
      }
      const normalized = await normalizeOfferImage(asset);
      if (normalized.error || !normalized.image) {
        setOfferImageStatus({
          uploading: false,
          error: normalized.error || "Unable to process the image.",
        });
        return;
      }
      setOfferImage(normalized.image);
    } catch (error) {
      setOfferImageStatus({
        uploading: false,
        error: error?.message || "Unable to open photo library.",
      });
    }
  };

  const handlePickEditOfferImage = async () => {
    setEditOfferStatus((prev) => ({ ...prev, error: null }));
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    const hasPermission = permission.granted || permission.status === "limited";
    if (!hasPermission) {
      setEditOfferStatus({
        saving: false,
        error: "Photo access is required. Enable it in Settings.",
      });
      return;
    }
    try {
      const mediaTypes = getImagePickerMediaTypes();
      const result = await ImagePicker.launchImageLibraryAsync({
        ...(mediaTypes ? { mediaTypes } : {}),
        allowsEditing: false,
        aspect: [2, 1],
        quality: 0.85,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      if (!isImageAsset(asset)) {
        setEditOfferStatus({
          saving: false,
          error: "Please select an image file.",
        });
        return;
      }
      const normalized = await normalizeOfferImage(asset);
      if (normalized.error || !normalized.image) {
        setEditOfferStatus({
          saving: false,
          error: normalized.error || "Unable to process the image.",
        });
        return;
      }
      setEditOfferImage({
        ...normalized.image,
        isRemote: false,
      });
    } catch (error) {
      setEditOfferStatus({
        saving: false,
        error: error?.message || "Unable to open photo library.",
      });
    }
  };

  const loadPlaidLinkState = useCallback(
    async ({ silent } = {}) => {
      if (!isSignedIn || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
        setPlaidLinkState({
          loading: false,
          linked: false,
          linkedCount: 0,
          error: null,
        });
        return;
      }
      if (!silent) {
        setPlaidLinkState((prev) => ({ ...prev, loading: true, error: null }));
      }
      const { data, error } = await callPlaidFunction("plaid-get-link-status", {});
      if (error) {
        if (!silent) {
          setPlaidLinkState((prev) => ({
            ...prev,
            loading: false,
            error,
          }));
        }
        return;
      }
      setPlaidLinkState({
        loading: false,
        linked: Boolean(data?.linked),
        linkedCount: Number(data?.linkedCount) || 0,
        error: null,
      });
    },
    [isSignedIn],
  );

  const handleLinkPurchaseVerificationBank = useCallback(async () => {
    if (!isSignedIn) {
      setPurchaseVerifyStatus({
        loading: false,
        targetId: null,
        error: "Sign in to link a bank account.",
        success: null,
      });
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setPlaidLinkState((prev) => ({
        ...prev,
        loading: false,
        error: "Supabase is not configured for purchase verification.",
      }));
      return;
    }

    setPlaidLinkAction("linking");
    setPlaidLinkState((prev) => ({ ...prev, loading: true, error: null }));
    setPurchaseVerifyStatus({
      loading: false,
      targetId: null,
      error: null,
      success: null,
    });

    const requestPayload = {
      platform: Platform.OS,
      ...(Platform.OS === "android" && PLAID_ANDROID_PACKAGE_NAME
        ? { androidPackageName: PLAID_ANDROID_PACKAGE_NAME }
        : {}),
    };
    const { data, error } = await callPlaidFunction(
      "plaid-create-link-token",
      requestPayload,
    );
    if (error || !data?.linkToken) {
      setPlaidLinkAction("idle");
      setPlaidLinkState((prev) => ({
        ...prev,
        loading: false,
        error:
          error ||
          data?.error ||
          "Unable to start bank linking. Please try again.",
      }));
      return;
    }

    try {
      await destroyPlaidLink().catch(() => null);
      createPlaidLink({
        token: String(data.linkToken),
        noLoadingState: false,
      });

      let linkedSuccessfully = false;
      openPlaidLink({
        logLevel: LinkLogLevel.ERROR,
        iOSPresentationStyle: LinkIOSPresentationStyle.MODAL,
        onSuccess: async (success) => {
          linkedSuccessfully = true;
          const publicToken = String(success?.publicToken || "").trim();
          if (!publicToken) {
            setPlaidLinkAction("idle");
            setPlaidLinkState((prev) => ({
              ...prev,
              loading: false,
              error: "Missing public token from Plaid Link.",
            }));
            return;
          }
          const { data: exchangeData, error: exchangeError } =
            await callPlaidFunction("plaid-exchange-public-token", {
              publicToken,
            });
          if (exchangeError) {
            setPlaidLinkAction("idle");
            setPlaidLinkState((prev) => ({
              ...prev,
              loading: false,
              error: exchangeError,
            }));
            return;
          }

          setPurchaseVerifyStatus({
            loading: false,
            targetId: null,
            error: null,
            success:
              exchangeData?.copy?.primary ||
              "Bank linked for automatic purchase verification.",
          });
          await loadPlaidLinkState({ silent: true });
          setPlaidLinkAction("idle");
        },
        onExit: (linkExit) => {
          const exitMessage =
            linkExit?.error?.displayMessage ||
            linkExit?.error?.errorMessage ||
            null;
          if (linkedSuccessfully && !exitMessage) {
            return;
          }
          setPlaidLinkAction("idle");
          setPlaidLinkState((prev) => ({
            ...prev,
            loading: false,
            error: exitMessage,
          }));
          loadPlaidLinkState({ silent: true });
        },
      });
    } catch (error) {
      setPlaidLinkAction("idle");
      setPlaidLinkState((prev) => ({
        ...prev,
        loading: false,
        error: error?.message || "Unable to open bank linking.",
      }));
    }
  }, [isSignedIn, loadPlaidLinkState]);

  const handleUnlinkLinkedBanks = useCallback(async () => {
    if (!isSignedIn) return;
    setPlaidLinkAction("unlinking");
    setPlaidLinkState((prev) => ({ ...prev, loading: true, error: null }));
    const { data, error } = await callPlaidFunction("plaid-unlink-bank", {});
    if (error) {
      setPlaidLinkAction("idle");
      setPlaidLinkState((prev) => ({ ...prev, loading: false, error }));
      setPurchaseVerifyStatus({
        loading: false,
        targetId: null,
        error,
        success: null,
      });
      return;
    }
    setPurchaseVerifyStatus({
      loading: false,
      targetId: null,
      error: null,
      success:
        data?.copy?.primary ||
        "Linked bank removed. Receipt upload is available for verification.",
    });
    await loadPlaidLinkState({ silent: true });
    setPlaidLinkAction("idle");
  }, [isSignedIn, loadPlaidLinkState]);

  const handleAutoVerifyPurchase = useCallback(
    async (entry) => {
      if (!entry?.id || !entry?.businessId) return;
      if (
        !ensureSupabaseReady((message) =>
          setPurchaseVerifyStatus({
            loading: false,
            targetId: null,
            error: message,
            success: null,
          }),
        )
      ) {
        return;
      }
      if (!authUserId) {
        setPurchaseVerifyStatus({
          loading: false,
          targetId: null,
          error: "Sign in to verify purchases.",
          success: null,
        });
        return;
      }
      setPurchaseVerifyStatus({
        loading: true,
        targetId: entry.id,
        error: null,
        success: null,
      });
      const purchaseDate = entry.createdAt
        ? new Date(entry.createdAt).toISOString().slice(0, 10)
        : null;
      const merchantName =
        entry.business?.name || entry.businessName || entry.business?.title || "";
      const { data, error } = await callPlaidFunction("plaid-verify-purchase", {
        redemptionId: entry.id,
        purchaseDate,
        merchantName,
      });
      if (error) {
        setPurchaseVerifyStatus({
          loading: false,
          targetId: null,
          error,
          success: null,
        });
        return;
      }

      const status = String(data?.verificationStatus || "").toLowerCase();
      const reasonCode = String(data?.reasonCode || "").trim();
      const fallbackMessage =
        data?.fallbackMessage || data?.message || PLAID_FALLBACK_COPY;
      if (status === "confirmed") {
        setPurchaseVerifyStatus({
          loading: false,
          targetId: null,
          error: null,
          success: "Purchase verified. Cashback will follow normal payout rules.",
        });
        await Promise.all([
          loadRedemptions({ silent: true }),
          loadCashbackBalance({ silent: true }),
        ]);
        return;
      }

      if (status === "pending") {
        setPurchaseVerifyStatus({
          loading: false,
          targetId: null,
          error: null,
          success:
            data?.message ||
            "Verification is pending. You can wait or upload a receipt now.",
        });
        await loadRedemptions({ silent: true });
        if (data?.fallbackRequired) {
          setVerificationPrompt({
            visible: true,
            title: "Verification pending",
            message: mergeVerificationCopy(
              data?.message || PLAID_PENDING_COPY,
              PLAID_FALLBACK_COPY,
            ),
            primaryLabel: "Upload receipt",
            secondaryLabel: "Wait",
            entry,
          });
        }
        return;
      }

      setPurchaseVerifyStatus({
        loading: false,
        targetId: null,
        error: null,
        success:
          data?.message ||
          formatPurchaseVerificationReason(reasonCode, null) ||
          "Automatic verification needs a receipt fallback.",
      });
      await loadRedemptions({ silent: true });
      setVerificationPrompt({
        visible: true,
        title: "Receipt needed",
        message: mergeVerificationCopy(fallbackMessage, PLAID_FALLBACK_COPY),
        primaryLabel: "Upload receipt",
        secondaryLabel: "Later",
        entry,
      });
    },
    [authUserId, loadRedemptions, loadCashbackBalance],
  );

  const handleUploadReceipt = async (entry, source = "library") => {
    if (!entry?.id || !entry.businessId) return;
    const showReceiptOverlay = (phase, title, message, { autoHideMs } = {}) => {
      const timers = receiptUploadTimersRef.current;
      if (timers.hide) clearTimeout(timers.hide);
      setReceiptUploadOverlay({
        visible: true,
        phase,
        title,
        message,
      });
      if (autoHideMs) {
        timers.hide = setTimeout(() => {
          setReceiptUploadOverlay((prev) => ({ ...prev, visible: false }));
          timers.hide = null;
        }, autoHideMs);
      }
    };
    const triggerReceiptConfetti = () => {
      const timers = receiptUploadTimersRef.current;
      if (timers.confetti) clearTimeout(timers.confetti);
      setReceiptUploadConfetti(true);
      timers.confetti = setTimeout(() => {
        setReceiptUploadConfetti(false);
        timers.confetti = null;
      }, 2600);
    };

    setReceiptDebug(null);
    setReceiptUploadStatus((prev) => ({ ...prev, error: null }));
    if (
      !ensureSupabaseReady((message) =>
        setReceiptUploadStatus({
          uploading: false,
          error: message,
          targetId: null,
        }),
      )
    ) {
      return;
    }
    if (!authUserId) {
      setReceiptUploadStatus({
        uploading: false,
        error: "Sign in to upload receipts.",
        targetId: null,
      });
      return;
    }
    if (entry.receipt?.id) {
      setReceiptUploadStatus({
        uploading: false,
        error: "Receipt already uploaded.",
        targetId: null,
      });
      return;
    }
    const allowFallbackReceipt =
      entry?.purchaseVerification?.status === "pending" ||
      entry?.purchaseVerification?.status === "rejected";
    if (!isReceiptWindowOpen(entry) && !allowFallbackReceipt) {
      setReceiptUploadStatus({
        uploading: false,
        error: "Receipt window expired.",
        targetId: null,
      });
      return;
    }
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    const hasPermission = permission.granted || permission.status === "limited";
    if (!hasPermission) {
      setReceiptUploadStatus({
        uploading: false,
        error: "Photo access is required. Enable it in Settings.",
        targetId: null,
      });
      return;
    }
    try {
      const mediaTypes = getImagePickerMediaTypes();
      const launch =
        source === "camera"
          ? ImagePicker.launchCameraAsync
          : ImagePicker.launchImageLibraryAsync;
      const result = await launch({
        ...(mediaTypes ? { mediaTypes } : {}),
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      if (!isImageAsset(asset)) {
        setReceiptUploadStatus({
          uploading: false,
          error: "Please select an image file.",
          targetId: null,
        });
        return;
      }
      const normalized = await normalizeReceiptImage(asset);
      if (normalized.error || !normalized.image) {
        setReceiptUploadStatus({
          uploading: false,
          error: normalized.error || "Unable to process the receipt image.",
          targetId: null,
        });
        return;
      }
      setReceiptUploadStatus({
        uploading: true,
        error: null,
        targetId: entry.id,
      });
      showReceiptOverlay(
        "uploading",
        "Uploading receipt",
        "Uploading your photo and saving it securely...",
      );
      const { path, error, debug } = await uploadReceiptImage(
        normalized.image,
        entry.businessId,
        entry.id,
      );
      if (error || !path) {
        if (debug) {
          setReceiptDebug(debug);
        }
        setReceiptUploadStatus({
          uploading: false,
          error: error || "Unable to upload receipt.",
          targetId: null,
        });
        showReceiptOverlay(
          "error",
          "Upload failed",
          error || "Unable to upload receipt. Please try again.",
          { autoHideMs: 2200 },
        );
        return;
      }
      const {
        data,
        error: insertError,
        status: insertStatus,
      } = await insertReceiptUploadRecord({
        redemptionId: entry.id,
        businessId: entry.businessId,
        userId: authUserId,
        storagePath: path,
      });
      if (insertError || !data) {
        if (insertError) {
          setReceiptDebug(
            `receipt insert failed (${insertStatus ?? "no-status"}): ${insertError}`,
          );
        }
        setReceiptUploadStatus({
          uploading: false,
          error: insertError || "Unable to save receipt.",
          targetId: null,
        });
        showReceiptOverlay(
          "error",
          "Upload failed",
          insertError || "Unable to save receipt. Please try again.",
          { autoHideMs: 2200 },
        );
        return;
      }
      setRedemptionHistory((prev) =>
        prev.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                receipt: {
                  id: String(data.id),
                  storagePath: data.storage_path || "",
                  verificationSource: "receipt",
                  verificationReference: null,
                  reviewStatus: "pending",
                  uploadedAt: data.uploaded_at
                    ? new Date(data.uploaded_at).getTime()
                    : Date.now(),
                },
                purchaseVerification: {
                  id: item.purchaseVerification?.id || `local-${entry.id}`,
                  source: "receipt",
                  status: "pending",
                  reasonCode: "receipt_under_review",
                  reasonDetail: "Receipt uploaded and awaiting review.",
                  lastCheckedAt: Date.now(),
                  confirmedAt: null,
                  rejectedAt: null,
                },
              }
            : item,
        ),
      );
      setReceiptUploadStatus({
        uploading: false,
        error: null,
        targetId: null,
      });
      triggerReceiptConfetti();
      showReceiptOverlay(
        "success",
        "Receipt uploaded",
        "Thanks! We'll review it shortly.",
        { autoHideMs: 1600 },
      );
      loadRedemptions({ silent: true });
    } catch (error) {
      setReceiptUploadStatus({
        uploading: false,
        error: error?.message || "Unable to upload receipt.",
        targetId: null,
      });
      showReceiptOverlay(
        "error",
        "Upload failed",
        error?.message || "Unable to upload receipt. Please try again.",
        { autoHideMs: 2200 },
      );
    }
  };

  const promptReceiptUpload = (entry) => {
    Alert.alert("Upload receipt", "Choose an option", [
      {
        text: "Take photo",
        onPress: () => handleUploadReceipt(entry, "camera"),
      },
      {
        text: "Choose from library",
        onPress: () => handleUploadReceipt(entry, "library"),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleOpenOfferEdit = (offer) => {
    if (!offer) return;
    setEditOfferDraft({
      id: offer.id,
      title: offer.title || "",
      description: offer.description || "",
      type: offer.offerType || offer.offer_type || "",
      imageUrl: offer.imageUrl || "",
    });
    setEditOfferImage(
      offer.imageUrl ? { uri: offer.imageUrl, isRemote: true } : null,
    );
    setEditOfferStatus({ saving: false, error: null });
    setEditOfferOpen(true);
  };

  const handleSubmitOfferEdit = async () => {
    if (!ownerBusiness || !editOfferDraft.id) return;
    if (!editOfferDraft.title.trim()) {
      setEditOfferStatus({
        saving: false,
        error: "Offer title is required.",
      });
      return;
    }
    setEditOfferStatus({ saving: true, error: null });
    if (
      !ensureSupabaseReady((message) =>
        setEditOfferStatus({ saving: false, error: message }),
      )
    ) {
      return;
    }
    try {
      let imageUrl = editOfferDraft.imageUrl || "";
      if (editOfferImage && !editOfferImage.isRemote) {
        const upload = await uploadOfferImage(editOfferImage, ownerBusiness.id);
        if (upload.error) {
          setEditOfferStatus({ saving: false, error: upload.error });
          return;
        }
        imageUrl = upload.url || "";
      }
      const payload = {
        title: editOfferDraft.title.trim(),
        description: editOfferDraft.description.trim() || null,
        offer_type: editOfferDraft.type.trim(),
        image_url: imageUrl || null,
        approval_status: "pending",
      };
      const { data, error } = await supabase
        .from("offers")
        .update(payload)
        .eq("id", editOfferDraft.id)
        .select(
          [
            "id",
            "business_id",
            "title",
            "description",
            "offer_type",
            "image_url",
            "active",
            "approval_status",
            "created_at",
          ].join(","),
        )
        .maybeSingle();
      if (error || !data) {
        setEditOfferStatus({
          saving: false,
          error: error?.message || "Unable to submit offer edits.",
        });
        return;
      }
      mergeOffers([mapSupabaseOffer(data)]);
      setEditOfferOpen(false);
    } finally {
      setEditOfferStatus((prev) => ({ ...prev, saving: false }));
    }
  };

  const handleOpenReceiptPreview = async (receipt, offerTitle) => {
    if (!receipt) return;
    receiptBaseScale.setValue(1);
    receiptPinchScale.setValue(1);
    receiptBaseX.setValue(0);
    receiptBaseY.setValue(0);
    receiptPanX.setValue(0);
    receiptPanY.setValue(0);
    receiptViewportSizeRef.current = {
      width: RECEIPT_PREVIEW_WIDTH,
      height: RECEIPT_PREVIEW_HEIGHT,
    };
    receiptImageSizeRef.current = { width: 0, height: 0 };
    setReceiptViewportSize(receiptViewportSizeRef.current);
    setReceiptImageSize(receiptImageSizeRef.current);
    const title = offerTitle || receipt.offerTitle || "Receipt";
    setReceiptPreview({
      uri: "",
      title,
      timestamp: receipt.uploadedAt,
      loading: true,
      error: null,
    });
    let signedUrl = null;
    if (receipt.storagePath) {
      signedUrl = await createReceiptSignedUrl(receipt.storagePath);
    }
    const finalUrl = signedUrl || receipt.imageUrl || "";
    if (!finalUrl) {
      setReceiptDebug("receipt preview missing signed url");
    }
    if (finalUrl) {
      try {
        const ok = await Image.prefetch(finalUrl);
        if (!ok) {
          setReceiptPreview({
            uri: "",
            title,
            timestamp: receipt.uploadedAt,
            loading: false,
            error: "Unable to load receipt image.",
          });
          return;
        }
      } catch (_error) {
        setReceiptPreview({
          uri: "",
          title,
          timestamp: receipt.uploadedAt,
          loading: false,
          error: "Unable to load receipt image.",
        });
        return;
      }
    }
    setReceiptPreview({
      uri: finalUrl,
      title,
      timestamp: receipt.uploadedAt,
      loading: false,
      error: finalUrl ? null : "Unable to load receipt image.",
    });
  };

  const onReceiptPinchEvent = Animated.event(
    [{ nativeEvent: { scale: receiptPinchScale } }],
    { useNativeDriver: true },
  );

  const onReceiptPanEvent = Animated.event(
    [
      {
        nativeEvent: {
          translationX: receiptPanX,
          translationY: receiptPanY,
        },
      },
    ],
    { useNativeDriver: true },
  );

  const resetReceiptZoom = useCallback(() => {
    receiptBaseScale.setValue(1);
    receiptPinchScale.setValue(1);
    receiptBaseX.setValue(0);
    receiptBaseY.setValue(0);
    receiptPanX.setValue(0);
    receiptPanY.setValue(0);
  }, [
    receiptBaseScale,
    receiptPinchScale,
    receiptBaseX,
    receiptBaseY,
    receiptPanX,
    receiptPanY,
  ]);

  const getReceiptPanBounds = useCallback(
    (scale) => {
      const viewport = receiptViewportSizeRef.current;
      const image = receiptImageSizeRef.current;
      const viewportWidth = Number(viewport?.width) || RECEIPT_PREVIEW_WIDTH;
      const viewportHeight = Number(viewport?.height) || RECEIPT_PREVIEW_HEIGHT;
      const { width: contentWidth, height: contentHeight } =
        computeContainedSize(
          viewportWidth,
          viewportHeight,
          image?.width,
          image?.height,
        );
      const maxX = Math.max(
        0,
        (Number(contentWidth) * scale - viewportWidth) / 2,
      );
      const maxY = Math.max(
        0,
        (Number(contentHeight) * scale - viewportHeight) / 2,
      );
      return { maxX, maxY };
    },
    [receiptViewportSizeRef, receiptImageSizeRef],
  );

  const onReceiptPinchStateChange = useCallback(
    (event) => {
      if (event.nativeEvent.oldState === GestureState.ACTIVE) {
        const next = Math.max(
          1,
          Math.min(
            RECEIPT_PREVIEW_MAX_ZOOM,
            receiptBaseScaleValue.current * event.nativeEvent.scale,
          ),
        );
        receiptBaseScale.setValue(next);
        receiptPinchScale.setValue(1);
        if (next <= 1.001) {
          receiptBaseScale.setValue(1);
          receiptBaseX.setValue(0);
          receiptBaseY.setValue(0);
          return;
        }
        const { maxX, maxY } = getReceiptPanBounds(next);
        const clampedX = clampValue(receiptBaseXValue.current, -maxX, maxX);
        const clampedY = clampValue(receiptBaseYValue.current, -maxY, maxY);
        receiptBaseX.setValue(clampedX);
        receiptBaseY.setValue(clampedY);
      }
    },
    [
      receiptBaseScale,
      receiptPinchScale,
      receiptBaseX,
      receiptBaseY,
      getReceiptPanBounds,
    ],
  );

  const onReceiptPanStateChange = useCallback(
    (event) => {
      if (event.nativeEvent.oldState === GestureState.ACTIVE) {
        const scale = receiptBaseScaleValue.current;
        const { maxX, maxY } = getReceiptPanBounds(scale);
        const nextX = clampValue(
          receiptBaseXValue.current + event.nativeEvent.translationX,
          -maxX,
          maxX,
        );
        const nextY = clampValue(
          receiptBaseYValue.current + event.nativeEvent.translationY,
          -maxY,
          maxY,
        );
        receiptBaseX.setValue(nextX);
        receiptBaseY.setValue(nextY);
        receiptPanX.setValue(0);
        receiptPanY.setValue(0);
      }
    },
    [receiptBaseX, receiptBaseY, receiptPanX, receiptPanY, getReceiptPanBounds],
  );

  const handleCreateOffer = async () => {
    setOfferNotice(null);
    if (!ownerBusiness) {
      setOfferError("Create your business profile first.");
      return;
    }
    if (!offerForm.title.trim()) {
      setOfferError("Offer title is required.");
      return;
    }
    const normalizedType = normalizeOfferType(offerForm.type);
    if (!normalizedType) {
      setOfferError("Offer type is required.");
      return;
    }
    if (!offerForm.description.trim()) {
      setOfferError("Description is required.");
      return;
    }
    if (!offerImage?.uri) {
      setOfferError("Offer photo is required.");
      return;
    }
    const redemptionLimitMode = String(
      offerForm.redemptionLimitMode || "unlimited",
    );
    const redemptionLimitEnabled = redemptionLimitMode !== "unlimited";
    const redemptionLimitPeriod =
      redemptionLimitMode === "day"
        ? "day"
        : redemptionLimitMode === "week"
          ? "week"
          : String(offerForm.redemptionLimitPeriod || "day");
    const redemptionLimitCount =
      redemptionLimitMode === "custom"
        ? Math.floor(Number(offerForm.redemptionLimitCount))
        : redemptionLimitMode === "unlimited"
          ? null
          : 1;
    if (redemptionLimitEnabled) {
      if (!["day", "week"].includes(redemptionLimitPeriod)) {
        setOfferError("Choose a valid redemption limit period.");
        return;
      }
      if (
        !Number.isFinite(Number(redemptionLimitCount)) ||
        redemptionLimitCount <= 0
      ) {
        setOfferError("Enter a valid redemption limit.");
        return;
      }
    }
    if (!ensureSupabaseReady(setOfferError)) return;
    setOfferBusy(true);
    setOfferError(null);
    setOfferImageStatus((prev) => ({ ...prev, error: null }));

    let imageUrl = null;
    if (offerImage?.uri) {
      setOfferImageStatus({ uploading: true, error: null });
      const { url, error } = await uploadOfferImage(
        offerImage,
        ownerBusiness.id,
      );
      console.log("Wello offer image upload", {
        businessId: ownerBusiness.id,
        ok: !error,
        url,
        error,
      });
      setOfferImageStatus({ uploading: false, error });
      if (error) {
        setOfferError(error);
        setOfferBusy(false);
        return;
      }
      imageUrl = url;
    }
    const { data, error } = await supabase
      .from("offers")
      .insert({
        business_id: ownerBusiness.id,
        title: offerForm.title.trim(),
        description: offerForm.description.trim() || null,
        offer_type: normalizedType,
        image_url: imageUrl,
        active: true,
        approval_status: "pending",
        redemption_limit_period: redemptionLimitEnabled
          ? redemptionLimitPeriod
          : null,
        redemption_limit_count: redemptionLimitEnabled
          ? redemptionLimitCount
          : null,
      })
      .select(
        [
          "id",
          "business_id",
          "title",
          "description",
          "offer_type",
          "image_url",
          "active",
          "approval_status",
          "redemption_limit_period",
          "redemption_limit_count",
          "created_at",
        ].join(","),
      )
      .maybeSingle();
    console.log("Wello offer insert", {
      businessId: ownerBusiness.id,
      offerId: data?.id || null,
      error: error?.message || null,
    });
    if (error || !data) {
      setOfferError(error?.message || "Unable to create offer.");
      setOfferBusy(false);
      return;
    }
    mergeOffers([mapSupabaseOffer(data)]);
    setOfferForm({
      title: "",
      description: "",
      type: "",
      redemptionLimitMode: "unlimited",
      redemptionLimitCount: "1",
      redemptionLimitPeriod: "day",
    });
    setOfferImage(null);
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      loadOwnerOffers(ownerBusiness.id);
      loadRemoteOffers({ silent: true });
    }
    setOfferNotice({
      type: "success",
      text: "Offer submitted for review. It will appear as pending until approved. Reviews typically take 12-24 hours.",
    });
    setOfferBusy(false);
  };

  const renderCreateOfferCard = () => (
    <View style={styles.formCard}>
      <View style={styles.formHeaderRow}>
        <View style={styles.formHeaderCopy}>
          <Text style={styles.formHeaderTitle}>Create offer</Text>
          <Text style={styles.formHeaderMeta}>
            Customers will see this on Discover.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.sectionInfoButton}
          onPress={() =>
            openInfoTooltip(
              "Create offer",
              "Keep titles short and clear. Add a description with any conditions (limits, dates, eligible items). Offer type is used for filtering and reporting.",
            )
          }
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name="information-circle-outline"
            size={18}
            color={COLORS.muted}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.formRow}>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Offer title</Text>
          <AutoFocusInput
            style={styles.formInput}
            placeholder="Example: 20% off first visit"
            placeholderTextColor={COLORS.muted}
            value={offerForm.title}
            onChangeText={(value) => {
              setOfferForm((prev) => ({
                ...prev,
                title: value,
              }));
              if (offerError) setOfferError(null);
              if (offerNotice) setOfferNotice(null);
            }}
            maxLength={64}
            returnKeyType="next"
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Offer type</Text>
          <AutoFocusInput
            style={styles.formInput}
            placeholder="Discount, BOGO, Bundle..."
            placeholderTextColor={COLORS.muted}
            value={offerForm.type}
            onChangeText={(value) => {
              setOfferForm((prev) => ({
                ...prev,
                type: value,
              }));
              if (offerError) setOfferError(null);
              if (offerNotice) setOfferNotice(null);
            }}
            autoCorrect
            autoCapitalize="words"
            onBlur={() => {
              const corrected = normalizeOfferType(offerForm.type);
              if (corrected && corrected !== offerForm.type) {
                setOfferForm((prev) => ({
                  ...prev,
                  type: corrected,
                }));
              }
            }}
            maxLength={32}
          />
        </View>
      </View>

      <Text style={styles.formLabel}>Description</Text>
      <AutoFocusInput
        style={[styles.formInput, styles.formTextarea]}
        placeholder="Add the details customers should know (limits, dates, eligible items)."
        placeholderTextColor={COLORS.muted}
        value={offerForm.description}
        onChangeText={(value) => {
          setOfferForm((prev) => ({
            ...prev,
            description: value,
          }));
          if (offerError) setOfferError(null);
          if (offerNotice) setOfferNotice(null);
        }}
        multiline
        textAlignVertical="top"
        maxLength={360}
      />
      {showOfferTypeSuggestion && (
        <Text style={styles.formHint}>Suggested: {offerTypeSuggestion}</Text>
      )}

      <Text style={styles.formLabel}>Redemption limit</Text>
      <View style={styles.limitOptionRow}>
        {[
          { key: "unlimited", label: "Unlimited" },
          { key: "day", label: "1/day" },
          { key: "week", label: "1/week" },
          { key: "custom", label: "Custom" },
        ].map((option) => {
          const active = offerForm.redemptionLimitMode === option.key;
          const optionStyles =
            option.key === "unlimited"
              ? {
                  pill: styles.limitOptionUnlimited,
                  pillActive: styles.limitOptionUnlimitedActive,
                  text: styles.limitOptionTextUnlimited,
                }
              : option.key === "day"
                ? {
                    pill: styles.limitOptionDay,
                    pillActive: styles.limitOptionDayActive,
                    text: styles.limitOptionTextDay,
                  }
                : option.key === "week"
                  ? {
                      pill: styles.limitOptionWeek,
                      pillActive: styles.limitOptionWeekActive,
                      text: styles.limitOptionTextWeek,
                    }
                  : {
                      pill: styles.limitOptionCustom,
                      pillActive: styles.limitOptionCustomActive,
                      text: styles.limitOptionTextCustom,
                    };
          return (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.limitOption,
                optionStyles.pill,
                active && optionStyles.pillActive,
              ]}
              onPress={() => {
                setOfferForm((prev) => ({
                  ...prev,
                  redemptionLimitMode: option.key,
                  redemptionLimitPeriod:
                    option.key === "week"
                      ? "week"
                      : option.key === "day"
                        ? "day"
                        : prev.redemptionLimitPeriod,
                  redemptionLimitCount:
                    option.key === "custom"
                      ? prev.redemptionLimitCount || "1"
                      : "1",
                }));
                if (offerError) setOfferError(null);
                if (offerNotice) setOfferNotice(null);
              }}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.limitOptionText,
                  optionStyles.text,
                  active && styles.limitOptionTextActive,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {offerForm.redemptionLimitMode === "custom" && (
        <View style={styles.limitCustomRow}>
          <View style={styles.limitCountWrap}>
            <AutoFocusInput
              style={[styles.formInput, styles.limitCountInput]}
              placeholder="Times"
              placeholderTextColor={COLORS.muted}
              value={String(offerForm.redemptionLimitCount || "")}
              onChangeText={(value) => {
                setOfferForm((prev) => ({
                  ...prev,
                  redemptionLimitCount: value.replace(/[^\d]/g, ""),
                }));
                if (offerError) setOfferError(null);
                if (offerNotice) setOfferNotice(null);
              }}
              keyboardType="number-pad"
              maxLength={3}
            />
          </View>
          <View style={styles.limitPeriodRow}>
            {["day", "week"].map((period) => {
              const active = offerForm.redemptionLimitPeriod === period;
              return (
                <TouchableOpacity
                  key={period}
                  style={[
                    styles.limitPeriodOption,
                    active && styles.limitPeriodOptionActive,
                  ]}
                  onPress={() =>
                    setOfferForm((prev) => ({
                      ...prev,
                      redemptionLimitPeriod: period,
                    }))
                  }
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.limitPeriodText,
                      active && styles.limitPeriodTextActive,
                    ]}
                  >
                    per {period}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
      <Text style={styles.formHint}>
        Applies per customer (rolling 24h/7d).
      </Text>

      <View style={styles.offerPhotoHeader}>
        <Text style={styles.formLabel}>Offer photo</Text>
        {offerImage && (
          <TouchableOpacity
            style={styles.offerRemoveButton}
            onPress={() => {
              setOfferImage(null);
              if (offerNotice) setOfferNotice(null);
            }}
          >
            <Text style={styles.offerRemoveButtonText}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>
      {offerImageStatus.error && (
        <Text style={styles.formError}>{offerImageStatus.error}</Text>
      )}
      <TouchableOpacity
        style={[styles.offerUploadFrame, styles.offerUploadFrameInteractive]}
        onPress={() => {
          if (offerNotice) setOfferNotice(null);
          handlePickOfferImage();
        }}
        disabled={offerImageStatus.uploading}
        activeOpacity={0.85}
      >
        {offerImage ? (
          <>
            <Image
              source={{ uri: offerImage.uri }}
              style={styles.offerUploadPreview}
              resizeMode="cover"
              onError={(event) => {
                console.warn("Wello offer preview failed:", {
                  uri: offerImage.uri,
                  error: event.nativeEvent?.error,
                });
              }}
            />
            <View style={styles.offerUploadOverlay}>
              <Text style={styles.offerUploadOverlayText}>Tap to replace</Text>
            </View>
          </>
        ) : (
          <View style={styles.offerUploadPlaceholder}>
            <Ionicons name="image-outline" size={18} color={COLORS.muted} />
            <Text style={styles.offerUploadHint}>Tap to upload a photo.</Text>
          </View>
        )}
        {offerImageStatus.uploading && (
          <View style={styles.offerUploadBusy}>
            <ActivityIndicator color={COLORS.pine} />
          </View>
        )}
      </TouchableOpacity>

      {offerNotice && (
        <View style={[styles.alertBox, styles.alertSuccess]}>
          <Text style={styles.alertText}>{offerNotice.text}</Text>
        </View>
      )}
      {offerError && <Text style={styles.formError}>{offerError}</Text>}

      <View style={styles.formActions}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            offerBusy && styles.primaryButtonDisabled,
          ]}
          onPress={handleCreateOffer}
          disabled={offerBusy}
        >
          <Text style={styles.primaryButtonText}>
            {offerBusy ? "Saving..." : "Create offer"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const handleToggleOffer = async (offer) => {
    if (!offer?.id) return;
    if (!ensureSupabaseReady(setOfferError)) return;
    setOfferBusy(true);
    setOfferError(null);
    const { data, error } = await supabase
      .from("offers")
      .update({ active: !offer.active })
      .eq("id", offer.id)
      .select(
        [
          "id",
          "business_id",
          "title",
          "description",
          "offer_type",
          "image_url",
          "active",
          "approval_status",
          "created_at",
        ].join(","),
      )
      .maybeSingle();
    if (error || !data) {
      setOfferError(error?.message || "Unable to update offer.");
      setOfferBusy(false);
      return;
    }
    mergeOffers([mapSupabaseOffer(data)]);
    setOfferBusy(false);
  };

  const handleDeleteOffer = async (offer) => {
    if (!offer?.id) return;
    if (!ensureSupabaseReady(setOfferError)) return;
    setOfferBusy(true);
    setOfferError(null);
    const imageError = await removeOfferImageByUrl(offer.imageUrl);
    const { error } = await supabase.from("offers").delete().eq("id", offer.id);
    if (error) {
      setOfferError(error.message || "Unable to delete offer.");
      setOfferBusy(false);
      return;
    }
    setOffers((prev) => prev.filter((item) => item.id !== offer.id));
    setPendingOffers((prev) => prev.filter((item) => item.id !== offer.id));
    if (imageError) {
      console.warn("Wello offer image delete failed:", imageError);
    }
    setOfferBusy(false);
  };

  const loadProfiles = useCallback(async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setProfileStatus({
        loading: false,
        error: "Supabase is not configured for profiles yet.",
      });
      return;
    }
    setProfileStatus({ loading: true, error: null });
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, phone, company, created_at")
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) {
      setProfileStatus({
        loading: false,
        error: error.message || "Unable to load team members.",
      });
      return;
    }
    setProfileList(Array.isArray(data) ? data : []);
    setProfileStatus({ loading: false, error: null });
  }, []);

  const loadRedemptions = useCallback(
    async ({ silent } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        setRedemptionStatus({
          loading: false,
          error: "Supabase is not configured for history yet.",
        });
        return;
      }
      if (!authUserId) {
        setRedemptionHistory([]);
        setRedemptionStatus({ loading: false, error: null });
        return;
      }
      if (!silent) {
        setRedemptionStatus({ loading: true, error: null });
      }
      const selectWithCashback = [
        "id",
        "business_id",
        "offer_id",
        "created_at",
        "offer:offers (id, title, description, offer_type, image_url)",
        "business:businesses (id, name, category_key, category_label)",
        "receipt_uploads (id, uploaded_at, storage_path, review_status, verification_source, verification_reference, cashback_events (amount_cents, status))",
        "purchase_verifications (id, source, status, reason_code, reason_detail, last_checked_at, confirmed_at, rejected_at)",
      ].join(",");
      const selectBasic = [
        "id",
        "business_id",
        "offer_id",
        "created_at",
        "offer:offers (id, title, description, offer_type, image_url)",
        "business:businesses (id, name, category_key, category_label)",
        "receipt_uploads (id, uploaded_at, storage_path, review_status, verification_source, verification_reference)",
        "purchase_verifications (id, source, status, reason_code, reason_detail, last_checked_at, confirmed_at, rejected_at)",
      ].join(",");
      const selectLegacy = [
        "id",
        "business_id",
        "offer_id",
        "created_at",
        "offer:offers (id, title, description, offer_type, image_url)",
        "business:businesses (id, name, category_key, category_label)",
        "receipt_uploads (id, uploaded_at, storage_path, review_status, verification_source, verification_reference)",
      ].join(",");

      let { data, error } = await supabase
        .from("redemptions")
        .select(selectWithCashback)
        .eq("scanned_by", authUserId)
        .order("created_at", { ascending: false });

      if (error) {
        const message = String(error.message || "").toLowerCase();
        if (
          message.includes("relationship") ||
          message.includes("could not find") ||
          message.includes("embedded") ||
          message.includes("cashback_events") ||
          message.includes("purchase_verifications")
        ) {
          ({ data, error } = await supabase
            .from("redemptions")
            .select(selectBasic)
            .eq("scanned_by", authUserId)
            .order("created_at", { ascending: false }));
          if (error) {
            const nestedMessage = String(error.message || "").toLowerCase();
            if (
              nestedMessage.includes("purchase_verifications") ||
              nestedMessage.includes("relationship") ||
              nestedMessage.includes("could not find")
            ) {
              ({ data, error } = await supabase
                .from("redemptions")
                .select(selectLegacy)
                .eq("scanned_by", authUserId)
                .order("created_at", { ascending: false }));
            }
          }
        }
      }
      if (error) {
        if (!silent) {
          setRedemptionStatus({
            loading: false,
            error: error.message || "Unable to load history.",
          });
        }
        return;
      }
      setRedemptionHistory((data || []).map(mapSupabaseRedemption));
      if (!silent) {
        setRedemptionStatus({ loading: false, error: null });
      }
    },
    [authUserId],
  );

  const loadUserReviews = useCallback(
    async ({ silent } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        setReviewStatus({
          loading: false,
          error: "Supabase is not configured for reviews yet.",
        });
        return;
      }
      if (!authUserId) {
        setUserReviews([]);
        setReviewStatus({ loading: false, error: null });
        return;
      }
      if (!silent) {
        setReviewStatus({ loading: true, error: null });
      }
      const { data, error } = await supabase
        .from("reviews")
        .select(
          "id, business_id, redemption_id, offer_id, rating, review_text, created_at",
        )
        .eq("user_id", authUserId)
        .order("created_at", { ascending: false });
      if (error) {
        if (!silent) {
          setReviewStatus({
            loading: false,
            error: error.message || "Unable to load reviews.",
          });
        }
        return;
      }
      setUserReviews((data || []).map(mapSupabaseReview));
      if (!silent) {
        setReviewStatus({ loading: false, error: null });
      }
    },
    [authUserId],
  );

  const refreshLiveData = useCallback(
    async ({ silent, force } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
      if (liveSyncRef.current.inFlight) return;
      liveSyncRef.current.inFlight = true;
      try {
        await refreshAll({ silent: true, force: Boolean(force) });
        if (isSignedIn) {
          await Promise.all([
            loadRedemptions({ silent: true }),
            loadUserReviews({ silent: true }),
            loadCashbackBalance({ silent: true }),
          ]);
        }
        const targetBusinessId = resolvedOwnerBusiness?.id || ownerBusinessId;
        if (isOwner && targetBusinessId) {
          await Promise.all([
            loadOwnerAnalytics(targetBusinessId, { silent: true }),
            loadBillingMetrics(targetBusinessId, { silent: true }),
            loadBusinessReceipts(targetBusinessId, { silent: true }),
            loadBusinessRedemptions(targetBusinessId, { silent: true }),
            loadOwnerOffers(targetBusinessId, { silent: true }),
          ]);
        }
      } finally {
        liveSyncRef.current.inFlight = false;
      }
    },
    [
      refreshAll,
      isSignedIn,
      isOwner,
      resolvedOwnerBusiness?.id,
      ownerBusinessId,
      loadRedemptions,
      loadUserReviews,
      loadCashbackBalance,
      loadOwnerAnalytics,
      loadBillingMetrics,
      loadBusinessReceipts,
      loadBusinessRedemptions,
      loadOwnerOffers,
    ],
  );

  const scheduleLiveRefresh = useCallback(() => {
    if (liveSyncRef.current.debounce) return;
    liveSyncRef.current.debounce = setTimeout(() => {
      liveSyncRef.current.debounce = null;
      refreshLiveData({ silent: true });
    }, LIVE_DEBOUNCE_MS);
  }, [refreshLiveData]);

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !supabase) return;
    if (liveSyncRef.current.channel) {
      liveSyncRef.current.channel.unsubscribe();
      liveSyncRef.current.channel = null;
    }
    const channel = supabase.channel("wello-live");
    const handleChange = () => scheduleLiveRefresh();
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "businesses" },
      handleChange,
    );
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "offers" },
      handleChange,
    );
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "reviews" },
      handleChange,
    );
    if (authUserId) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "redemptions",
          filter: `scanned_by=eq.${authUserId}`,
        },
        handleChange,
      );
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "receipt_uploads",
          filter: `user_id=eq.${authUserId}`,
        },
        handleChange,
      );
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cashback_events",
          filter: `user_id=eq.${authUserId}`,
        },
        handleChange,
      );
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "purchase_verifications",
          filter: `user_id=eq.${authUserId}`,
        },
        handleChange,
      );
    }
    const targetBusinessId = resolvedOwnerBusiness?.id || ownerBusinessId;
    if (targetBusinessId) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "receipt_uploads",
          filter: `business_id=eq.${targetBusinessId}`,
        },
        handleChange,
      );
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "commission_events",
          filter: `business_id=eq.${targetBusinessId}`,
        },
        handleChange,
      );
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        scheduleLiveRefresh();
      }
    });
    liveSyncRef.current.channel = channel;
    return () => {
      channel.unsubscribe();
      if (liveSyncRef.current.channel === channel) {
        liveSyncRef.current.channel = null;
      }
    };
  }, [
    authUserId,
    resolvedOwnerBusiness?.id,
    ownerBusinessId,
    scheduleLiveRefresh,
  ]);

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    if (liveSyncRef.current.interval) {
      clearInterval(liveSyncRef.current.interval);
    }
    liveSyncRef.current.interval = setInterval(() => {
      if (AppState.currentState !== "active") return;
      refreshLiveData({ silent: true });
    }, LIVE_POLL_MS);
    return () => {
      if (liveSyncRef.current.interval) {
        clearInterval(liveSyncRef.current.interval);
        liveSyncRef.current.interval = null;
      }
    };
  }, [refreshLiveData]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshLiveData({ silent: true, force: true });
      }
    });
    return () => subscription.remove();
  }, [refreshLiveData]);

  const loadBusinessReviews = useCallback(
    async (businessId, { silent } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        setBusinessDetailStatus({
          loading: false,
          error: "Supabase is not configured for reviews yet.",
        });
        return;
      }
      if (!businessId) {
        setBusinessDetailReviews([]);
        setBusinessDetailStatus({ loading: false, error: null });
        return;
      }
      if (!silent) {
        setBusinessDetailStatus({ loading: true, error: null });
      }
      const { data, error } = await supabase
        .from("reviews")
        .select(
          "id, business_id, redemption_id, offer_id, rating, review_text, created_at",
        )
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error) {
        if (!silent) {
          setBusinessDetailStatus({
            loading: false,
            error: error.message || "Unable to load reviews.",
          });
        }
        return;
      }
      const mapped = (data || []).map(mapSupabaseReview);
      const averageRating = computeAverageRating(mapped);
      setBusinessDetailReviews(mapped);
      setBusinesses((prev) =>
        prev.map((business) =>
          business.id === businessId
            ? { ...business, rating: averageRating }
            : business,
        ),
      );
      setBusinessDetail((prev) =>
        prev && prev.id === businessId
          ? { ...prev, rating: averageRating }
          : prev,
      );
      if (!silent) {
        setBusinessDetailStatus({ loading: false, error: null });
      }
    },
    [],
  );

  const loadBusinessOffers = useCallback(
    async (businessId, { silent } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        setBusinessDetailOffers([]);
        setBusinessDetailOffersStatus({
          loading: false,
          error: "Supabase is not configured for offers yet.",
        });
        return;
      }
      if (!businessId) {
        setBusinessDetailOffers([]);
        setBusinessDetailOffersStatus({ loading: false, error: null });
        return;
      }
      if (!silent) {
        setBusinessDetailOffersStatus({ loading: true, error: null });
      }
      const { data, error } = await supabase
        .from("offers")
        .select(
          [
            "id",
            "business_id",
            "title",
            "description",
            "offer_type",
            "image_url",
            "active",
            "approval_status",
            "created_at",
          ].join(","),
        )
        .eq("business_id", businessId)
        .eq("active", true)
        .eq("approval_status", "approved")
        .order("created_at", { ascending: false });
      if (error) {
        if (!silent) {
          setBusinessDetailOffersStatus({
            loading: false,
            error: error.message || "Unable to load offers.",
          });
        }
        return;
      }
      setBusinessDetailOffers((data || []).map(mapSupabaseOffer));
      if (!silent) {
        setBusinessDetailOffersStatus({ loading: false, error: null });
      }
    },
    [],
  );

  const loadBusinessReceipts = useCallback(
    async (businessId, { silent } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        setBusinessReceiptStatus({
          loading: false,
          error: "Supabase is not configured for receipts yet.",
        });
        return;
      }
      if (!businessId) {
        setBusinessReceipts([]);
        setBusinessReceiptStatus({ loading: false, error: null });
        return;
      }
      if (!silent) {
        setBusinessReceiptStatus({ loading: true, error: null });
      }
      const { data, error } = await supabase
        .from("receipt_uploads")
        .select(
          [
            "id",
            "redemption_id",
            "business_id",
            "user_id",
            "storage_path",
            "uploaded_at",
            "redemption:redemptions (id, created_at, offer:offers (id, title))",
          ].join(","),
        )
        .eq("business_id", businessId)
        .order("uploaded_at", { ascending: false });
      if (error) {
        setReceiptDebug(`load receipts failed: ${error.message || "unknown"}`);
        if (!silent) {
          setBusinessReceiptStatus({
            loading: false,
            error: error.message || "Unable to load receipts.",
          });
        }
        return;
      }
      const mapped = await Promise.all(
        (data || []).map(async (row) => {
          const signedUrl = await createReceiptSignedUrl(row.storage_path);
          return {
            id: String(row.id),
            redemptionId: row.redemption_id || null,
            businessId: row.business_id || null,
            offerId: row.redemption?.offer?.id || null,
            uploadedAt: row.uploaded_at
              ? new Date(row.uploaded_at).getTime()
              : Date.now(),
            redeemedAt: row.redemption?.created_at
              ? new Date(row.redemption.created_at).getTime()
              : null,
            offerTitle: row.redemption?.offer?.title || "",
            storagePath: row.storage_path || "",
            imageUrl: signedUrl || "",
          };
        }),
      );
      setBusinessReceipts(mapped);
      if (!silent) {
        setBusinessReceiptStatus({ loading: false, error: null });
      }
    },
    [],
  );

  const loadBusinessRedemptions = useCallback(
    async (businessId, { silent } = {}) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        setBusinessRedemptionStatus({
          loading: false,
          error: "Supabase is not configured for redemptions yet.",
        });
        return;
      }
      if (!businessId) {
        setBusinessRedemptions([]);
        setBusinessRedemptionStatus({ loading: false, error: null });
        return;
      }
      if (!silent) {
        setBusinessRedemptionStatus({ loading: true, error: null });
      }
      const { data, error } = await supabase
        .from("redemptions")
        .select(
          [
            "id",
            "business_id",
            "offer_id",
            "created_at",
            "offer:offers (id, title, description, offer_type, image_url)",
            "receipt_uploads (id, uploaded_at, storage_path)",
          ].join(","),
        )
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error) {
        if (!silent) {
          setBusinessRedemptionStatus({
            loading: false,
            error: error.message || "Unable to load redemptions.",
          });
        }
        return;
      }
      setBusinessRedemptions((data || []).map(mapSupabaseRedemption));
      if (!silent) {
        setBusinessRedemptionStatus({ loading: false, error: null });
      }
    },
    [],
  );

  useEffect(() => {
    if (activeTab !== "history") return;
    if (!isSignedIn || !showHistoryTab) return;
    loadRedemptions();
    loadUserReviews();
    loadPlaidLinkState({});
  }, [
    activeTab,
    isSignedIn,
    showHistoryTab,
    loadRedemptions,
    loadUserReviews,
    loadPlaidLinkState,
  ]);

  useEffect(() => {
    if (!isSignedIn || !showHistoryTab) {
      setUserReviews([]);
      setReviewStatus({ loading: false, error: null });
      return;
    }
    loadUserReviews({ silent: true });
  }, [isSignedIn, showHistoryTab, loadUserReviews]);

  useEffect(() => {
    if (!isSignedIn || !showHistoryTab) {
      setRedemptionHistory([]);
      setRedemptionStatus({ loading: false, error: null });
      setPurchaseVerifyStatus({
        loading: false,
        targetId: null,
        error: null,
        success: null,
      });
      return;
    }
    loadRedemptions({ silent: true });
  }, [isSignedIn, showHistoryTab, loadRedemptions]);

  useEffect(() => {
    if (!isSignedIn || !showHistoryTab) {
      receiptNoticeShownRef.current = false;
      setReceiptNoticeOpen(false);
      return;
    }
    if (activeTab !== "history") return;
    if (pendingReceiptCount <= 0) return;
    if (receiptNoticeShownRef.current) return;
    receiptNoticeShownRef.current = true;
    setReceiptNoticeOpen(true);
  }, [activeTab, isSignedIn, showHistoryTab, pendingReceiptCount]);

  useEffect(() => {
    if (!businessDetailOpen || !businessDetail?.id) return;
    loadBusinessReviews(businessDetail.id);
    loadBusinessOffers(businessDetail.id);
  }, [
    businessDetailOpen,
    businessDetail?.id,
    loadBusinessReviews,
    loadBusinessOffers,
  ]);

  const handlePromoteSupervisor = async (profile) => {
    if (!profile?.id) return;
    if (
      !ensureSupabaseReady((message) =>
        setSupervisorStatus({ loading: false, error: message, success: null }),
      )
    ) {
      return;
    }
    setSupervisorStatus({ loading: true, error: null, success: null });
    const { data, error } = await supabase
      .from("profiles")
      .update({ role: "supervisor" })
      .eq("id", profile.id)
      .select("id, role")
      .maybeSingle();
    if (error || !data) {
      setSupervisorStatus({
        loading: false,
        error: error?.message || "Unable to update that profile.",
        success: null,
      });
      return;
    }
    setProfileList((prev) =>
      prev.map((item) =>
        item.id === profile.id ? { ...item, role: "supervisor" } : item,
      ),
    );
    setSupervisorStatus({
      loading: false,
      error: null,
      success: "Supervisor access granted.",
    });
  };

  const handleCreateAddressChange = (value) => {
    createAddressSelectionRef.current = false;
    setCreateAddressError(null);
    setCreateBusinessForm((prev) => ({
      ...prev,
      address: value,
      addressCoords: null,
      city: "",
      state: "",
      postalCode: "",
    }));
  };

  const handleSelectCreateSuggestion = async (suggestion) => {
    createAddressSelectionRef.current = true;
    createAddressRequestRef.current += 1;
    setCreateAddressResults([]);
    setCreateAddressLoading(false);
    setCreateAddressError(null);
    setCreateBusinessForm((prev) => ({
      ...prev,
      address: suggestion.description,
    }));

    if (!GOOGLE_PLACES_KEY) return;
    try {
      setCreateAddressLoading(true);
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
          suggestion.place_id,
        )}&fields=formatted_address,address_components,geometry&key=${GOOGLE_PLACES_KEY}`,
      );
      const data = await response.json();
      if (data.status && data.status !== "OK") {
        throw new Error(data.error_message || "Unable to load place details.");
      }
      const parsed = parseAddressComponents(data.result?.address_components);
      const location = data.result?.geometry?.location;
      setCreateBusinessForm((prev) => ({
        ...prev,
        address:
          parsed.street || data.result?.formatted_address || prev.address,
        city: parsed.city || prev.city,
        state: parsed.state || prev.state,
        postalCode: parsed.postalCode || prev.postalCode,
        addressCoords: location
          ? { latitude: location.lat, longitude: location.lng }
          : prev.addressCoords,
      }));
    } catch (error) {
      setCreateAddressError(error.message || "Unable to load place details.");
    } finally {
      setCreateAddressLoading(false);
    }
  };

  const handleCreateBusinessProfile = async () => {
    if (!authUserId) {
      setCreateBusinessError("Sign in to create your business profile.");
      return;
    }
    if (!createBusinessForm.name.trim() || !createBusinessForm.address.trim()) {
      setCreateBusinessError("Business name and address are required.");
      return;
    }
    if (!createBusinessForm.phone.trim()) {
      setCreateBusinessError("Phone number is required.");
      return;
    }
    if (!createHoursStart || !createHoursEnd) {
      setCreateBusinessError("Operating hours are required.");
      return;
    }
    if (!ensureSupabaseReady(setCreateBusinessError)) return;
    setCreateBusinessBusy(true);
    setCreateBusinessError(null);
    try {
      const categoryConfig = getCategoryConfig(createBusinessForm.categoryKey);
      const hoursValue = formatBusinessHours(
        createHoursStart,
        createHoursStartMeridiem,
        createHoursEnd,
        createHoursEndMeridiem,
      );
      let createCoords = createBusinessForm.addressCoords;
      if (!createCoords && createBusinessForm.address.trim()) {
        createCoords = await geocodeAddress(createBusinessForm.address.trim());
      }
      const { data, error } = await supabase
        .from("businesses")
        .insert({
          owner_id: authUserId,
          name: createBusinessForm.name.trim(),
          address: createBusinessForm.address.trim(),
          city: createBusinessForm.city.trim() || null,
          state: createBusinessForm.state.trim() || null,
          postal_code: createBusinessForm.postalCode.trim() || null,
          phone: createBusinessForm.phone.trim(),
          category_key: createBusinessForm.categoryKey,
          category_label: categoryConfig.display,
          offer_highlight: null,
          hours: hoursValue,
          tags: normalizeTagsInput(createBusinessForm.tags),
          approval_status: "pending",
          status: "active",
          is_open: true,
          latitude: createCoords?.latitude ?? null,
          longitude: createCoords?.longitude ?? null,
        })
        .select("*")
        .maybeSingle();
      if (error || !data) {
        setCreateBusinessError(
          error?.message || "Unable to create your business profile.",
        );
        return;
      }
      const profileEmailValue = profileEmail || authEmail || null;
      await supabase.from("profiles").upsert({
        id: authUserId,
        email: profileEmailValue,
        full_name: profileName || null,
        phone: createBusinessForm.phone.trim() || null,
        company: createBusinessForm.name.trim() || null,
      });
      const mapped = mapSupabaseBusiness(data, 0);
      setBusinesses((prev) => [mapped, ...prev]);
      setOwnerBusinessId(mapped.id);
      setCreateBusinessForm({
        name: "",
        address: "",
        addressCoords: null,
        city: "",
        state: "",
        postalCode: "",
        categoryKey: "restaurant",
        offer: "",
        phone: "",
        tags: "",
      });
      setCreateHoursStart("");
      setCreateHoursEnd("");
      setCreateHoursStartMeridiem("AM");
      setCreateHoursEndMeridiem("PM");
    } finally {
      setCreateBusinessBusy(false);
    }
  };

  const handlePromoteBusinessOwner = async (profile) => {
    if (!profile?.id) return;
    if (
      !ensureSupabaseReady((message) =>
        setSupervisorStatus({ loading: false, error: message, success: null }),
      )
    ) {
      return;
    }
    setSupervisorStatus({ loading: true, error: null, success: null });
    const { data, error } = await supabase
      .from("profiles")
      .update({ role: "business_owner" })
      .eq("id", profile.id)
      .select("id, role")
      .maybeSingle();
    if (error || !data) {
      setSupervisorStatus({
        loading: false,
        error: error?.message || "Unable to update that profile.",
        success: null,
      });
      return;
    }
    setProfileList((prev) =>
      prev.map((item) =>
        item.id === profile.id ? { ...item, role: "business_owner" } : item,
      ),
    );
    setSupervisorStatus({
      loading: false,
      error: null,
      success: "Business access granted.",
    });
  };

  const handleRemoveSupervisor = async (profile) => {
    if (!profile?.id) return;
    if (
      !ensureSupabaseReady((message) =>
        setSupervisorStatus({ loading: false, error: message, success: null }),
      )
    ) {
      return;
    }
    setSupervisorStatus({ loading: true, error: null, success: null });
    const { data, error } = await supabase
      .from("profiles")
      .update({ role: "consumer" })
      .eq("id", profile.id)
      .select("id, role")
      .maybeSingle();
    if (error || !data) {
      setSupervisorStatus({
        loading: false,
        error: error?.message || "Unable to update that profile.",
        success: null,
      });
      return;
    }
    setProfileList((prev) =>
      prev.map((item) =>
        item.id === profile.id ? { ...item, role: "consumer" } : item,
      ),
    );
    setSupervisorStatus({
      loading: false,
      error: null,
      success: "Supervisor access removed.",
    });
  };

  if ((!fontsLoaded && !fontError) || !sessionReady) {
    return <View style={styles.loadingScreen} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen}>
          <StatusBar
            barStyle="dark-content"
            translucent
            backgroundColor="transparent"
          />
          <View style={styles.container}>
            <MapView
              ref={mapRef}
              style={styles.map}
              region={mapRegion}
              onRegionChangeComplete={setMapRegion}
              customMapStyle={MAP_STYLE}
              showsUserLocation
              showsMyLocationButton={false}
              showsCompass={false}
              showsScale={false}
              showsPointsOfInterest={false}
            >
              {filteredBusinesses.map((business) => {
                const category = getCategoryConfig(business.categoryKey);
                const isSelected = selectedId === business.id;
                const markerKey = CATEGORY_CONFIG[business.categoryKey]
                  ? business.categoryKey
                  : "default";
                const androidIcon = androidMarkerIcons?.normal?.[markerKey];
                const androidHalo = androidMarkerIcons?.halo?.[markerKey];
                const useAndroidImages =
                  Platform.OS === "android" && androidIcon;
                const markerAnchor =
                  Platform.OS === "android" && useAndroidImages
                    ? { x: 0.5, y: 0.5 }
                    : { x: 0.5, y: 1 };
                const markerCoordinate =
                  business.coordinate ||
                  (business.source === "supabase"
                    ? null
                    : business.fallbackCoordinate);
                if (!markerCoordinate) return null;
                return (
                  <React.Fragment key={business.id}>
                    {Platform.OS === "android" &&
                      useAndroidImages &&
                      isSelected &&
                      androidHalo && (
                        <Marker
                          coordinate={markerCoordinate}
                          anchor={{ x: 0.5, y: 0.5 }}
                          image={androidHalo}
                          zIndex={1}
                          onPress={() => handleMarkerPress(business)}
                        />
                      )}
                    <Marker
                      coordinate={markerCoordinate}
                      anchor={markerAnchor}
                      onPress={() => handleMarkerPress(business)}
                      image={useAndroidImages ? androidIcon : undefined}
                      pinColor={
                        Platform.OS === "android" && !useAndroidImages
                          ? category.color
                          : undefined
                      }
                      zIndex={Platform.OS === "android" && isSelected ? 2 : 0}
                    >
                      {Platform.OS !== "android" && (
                        <View
                          style={styles.markerWrap}
                          pointerEvents="none"
                          collapsable={false}
                        >
                          <View
                            style={[
                              styles.markerIcon,
                              { backgroundColor: category.color },
                              isSelected && styles.markerIconSelected,
                            ]}
                          >
                            <Ionicons
                              name={category.icon}
                              size={20}
                              color={COLORS.white}
                            />
                          </View>
                          <View style={styles.markerPointerWrap}>
                            <View
                              style={[
                                styles.markerPointer,
                                { backgroundColor: category.color },
                              ]}
                            />
                          </View>
                        </View>
                      )}
                    </Marker>
                  </React.Fragment>
                );
              })}
            </MapView>

            <LinearGradient
              pointerEvents="none"
              colors={["rgba(244, 246, 249, 0.0)", "rgba(244, 246, 249, 0.45)"]}
              style={styles.mapShade}
            />

            <View style={styles.topMeta} pointerEvents="box-none">
              <View style={[styles.navContainer, { width: navContainerWidth }]}>
                <View style={styles.navRow}>
                  {visibleTabs.map((tab, index) => {
                    const isActive = activeTab === tab.key;
                    return (
                      <TouchableOpacity
                        key={tab.key}
                        style={[
                          styles.navPill,
                          index > 0 && styles.navPillSpaced,
                          isActive && styles.navPillActive,
                        ]}
                        onPress={() => openSheet(tab.key)}
                      >
                        <Text
                          style={[
                            styles.navPillText,
                            isActive && styles.navPillTextActive,
                          ]}
                          numberOfLines={1}
                          allowFontScaling={false}
                        >
                          {tab.label}
                        </Text>
                        {tab.key === "history" && pendingHistoryCount > 0 && (
                          <View style={styles.navPillBadge}>
                            <Text style={styles.navPillBadgeText}>
                              {pendingHistoryCount > 9
                                ? "9+"
                                : pendingHistoryCount}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <View style={styles.locateRow} pointerEvents="box-none">
                <TouchableOpacity
                  style={styles.locateButton}
                  onPress={handleLocateMe}
                  disabled={locating}
                >
                  <Ionicons
                    name={locating ? "locate" : "locate-outline"}
                    size={18}
                    color={COLORS.pine}
                  />
                </TouchableOpacity>
                {locationError && (
                  <View style={styles.locateError}>
                    <Text style={styles.locateErrorText}>{locationError}</Text>
                  </View>
                )}
              </View>
            </View>

            <Modal
              transparent
              visible={Boolean(infoTooltip)}
              animationType="fade"
              onRequestClose={closeInfoTooltip}
            >
              <Pressable
                style={styles.infoTooltipOverlay}
                onPress={closeInfoTooltip}
              >
                <Pressable style={styles.infoTooltipCard} onPress={() => {}}>
                  <View style={styles.infoTooltipHeader}>
                    <Text style={styles.infoTooltipTitle}>
                      {infoTooltip?.title || "Info"}
                    </Text>
                    <TouchableOpacity
                      style={styles.infoTooltipClose}
                      onPress={closeInfoTooltip}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="close" size={18} color={COLORS.muted} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.infoTooltipBody}>
                    {infoTooltip?.body || ""}
                  </Text>
                </Pressable>
              </Pressable>
            </Modal>

            <Modal transparent visible={scannerVisible} animationType="slide">
              <View style={styles.scannerOverlay}>
                <View style={styles.scannerCard}>
                  <View style={styles.scannerHeader}>
                    <View>
                      <Text style={styles.scannerTitle}>Redeem offer</Text>
                      <Text style={styles.scannerSubtitle}>
                        {scannerBusiness?.name || "Wello business"}
                      </Text>
                      {scannerOffer?.offerTitle && (
                        <Text style={styles.scannerOfferTitle}>
                          {scannerOffer.offerTitle}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.scannerClose}
                      onPress={handleCloseScanner}
                    >
                      <Ionicons name="close" size={18} color={COLORS.ink} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.scannerFrame}>
                    <View style={styles.scannerBlocked}>
                      <Ionicons
                        name={
                          scannerStatus === "success"
                            ? "checkmark-circle"
                            : scannerStatus === "blocked"
                              ? "alert-circle"
                              : scannerStatus === "error"
                                ? "warning"
                                : scannerStatus === "redeeming"
                                  ? "card"
                                  : "locate"
                        }
                        size={42}
                        color={
                          scannerStatus === "success"
                            ? "#047857"
                            : scannerStatus === "blocked" ||
                                scannerStatus === "error"
                              ? "#B42318"
                              : COLORS.pine
                        }
                      />
                      <Text style={styles.scannerBlockedText}>
                        {scannerStatus === "success"
                          ? "Offer redeemed."
                          : scannerMessage
                            ? scannerMessage
                            : scannerStatus === "redeeming"
                              ? "Redeeming offer..."
                              : scannerStatus === "checking"
                                ? "Checking your location..."
                                : scannerStatus === "blocked"
                                  ? REDEEM_BLOCKED_MESSAGE
                                  : scannerStatus === "error"
                                    ? "Unable to redeem right now. Try again."
                                    : "Checking your location..."}
                      </Text>
                      {Number.isFinite(redeemGate?.distanceMeters) &&
                        redeemGate.distanceMeters !== null && (
                          <Text style={styles.scannerDistanceText}>
                            Distance:{" "}
                            {redeemGate.distanceMeters < 1000
                              ? `${Math.round(redeemGate.distanceMeters)} m`
                              : `${(redeemGate.distanceMeters / 1000).toFixed(
                                  1,
                                )} km`}
                          </Text>
                        )}
                    </View>
                    <View
                      style={styles.scannerFrameOutline}
                      pointerEvents="none"
                    />
                  </View>

                  <View style={styles.scannerStatus}>
                    <Text style={styles.scannerStatusText}>
                      {scannerStatus === "success"
                        ? "Offer redeemed. Show this confirmation to the staff."
                        : scannerMessage
                          ? scannerMessage
                          : scannerStatus === "redeeming"
                            ? "Hang tight. This will only take a moment."
                            : scannerStatus === "checking"
                              ? "Checking your location..."
                              : scannerStatus === "blocked"
                                ? REDEEM_BLOCKED_MESSAGE
                                : scannerStatus === "error"
                                  ? "We couldn't complete that redemption."
                                  : "Checking your location..."}
                    </Text>
                  </View>

                  <View style={styles.scannerActions}>
                    {scannerStatus === "success" ? (
                      <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={handleCloseScanner}
                      >
                        <Text style={styles.primaryButtonText}>Done</Text>
                      </TouchableOpacity>
                    ) : scannerStatus === "blocked" ? (
                      <TouchableOpacity
                        style={[
                          styles.secondaryButton,
                          redeemGateBusy && styles.secondaryButtonDisabled,
                        ]}
                        onPress={() => {
                          if (!redeemGateBusy) {
                            void (async () => {
                              const allowed =
                                await runRedeemGate(scannerBusiness);
                              if (allowed) {
                                await redeemOfferInStore(
                                  scannerBusiness,
                                  scannerOffer,
                                );
                              }
                            })();
                          }
                        }}
                        disabled={redeemGateBusy}
                      >
                        <Text style={styles.secondaryButtonText}>
                          {redeemGateBusy ? "Checking..." : "Check again"}
                        </Text>
                      </TouchableOpacity>
                    ) : scannerStatus === "checking" ||
                      scannerStatus === "redeeming" ? (
                      <View
                        style={[
                          styles.secondaryButton,
                          styles.secondaryButtonDisabled,
                        ]}
                      >
                        <Text style={styles.secondaryButtonText}>
                          {scannerStatus === "redeeming"
                            ? "Redeeming..."
                            : "Checking..."}
                        </Text>
                      </View>
                    ) : scannerStatus === "error" ? (
                      <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={() => {
                          void (async () => {
                            setScannerStatus("checking");
                            const allowed =
                              await runRedeemGate(scannerBusiness);
                            if (allowed) {
                              await redeemOfferInStore(
                                scannerBusiness,
                                scannerOffer,
                              );
                            }
                          })();
                        }}
                      >
                        <Text style={styles.secondaryButtonText}>
                          Try again
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {scannerStatus === "success" && (
                    <ConfettiDrizzle
                      active
                      width={SCANNER_CARD_WIDTH}
                      height={SCANNER_CARD_HEIGHT}
                    />
                  )}
                </View>
              </View>
            </Modal>

            <Modal transparent visible={reviewModalOpen} animationType="fade">
              <View style={styles.reviewOverlay}>
                <View style={styles.reviewCard}>
                  <View style={styles.reviewHeader}>
                    <View>
                      <Text style={styles.reviewTitle}>Leave a review</Text>
                      <Text style={styles.reviewSubtitle}>
                        {reviewTarget?.businessName || "Wello business"}
                      </Text>
                      {reviewTarget?.entry?.offer?.title && (
                        <Text style={styles.reviewOffer}>
                          {reviewTarget.entry.offer.title}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.reviewClose}
                      onPress={closeReviewModal}
                    >
                      <Ionicons name="close" size={18} color={COLORS.ink} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.formLabel}>Star rating</Text>
                  <View style={styles.reviewStars}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <TouchableOpacity
                        key={star}
                        style={styles.reviewStarButton}
                        onPress={() => setReviewRating(star)}
                      >
                        <Ionicons
                          name={reviewRating >= star ? "star" : "star-outline"}
                          size={24}
                          color={
                            reviewRating >= star ? COLORS.sun : COLORS.muted
                          }
                        />
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.formLabel}>Review (optional)</Text>
                  <AutoFocusInput
                    style={[styles.formInput, styles.reviewInput]}
                    placeholder="Share details for other Wello members."
                    placeholderTextColor={COLORS.muted}
                    value={reviewText}
                    onChangeText={setReviewText}
                    multiline
                    textAlignVertical="top"
                  />

                  {reviewError && (
                    <Text style={styles.formError}>{reviewError}</Text>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      reviewBusy && styles.primaryButtonDisabled,
                    ]}
                    onPress={handleSubmitReview}
                    disabled={reviewBusy}
                  >
                    <Text style={styles.primaryButtonText}>
                      {reviewBusy ? "Submitting..." : "Submit review"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={closeReviewModal}
                  >
                    <Text style={styles.secondaryButtonText}>Not now</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>

            <Modal
              transparent
              visible={businessDetailOpen}
              animationType="slide"
            >
              <View style={styles.detailOverlay}>
                <View style={styles.detailCard}>
                  <View style={styles.detailHeader}>
                    <View>
                      <Text style={styles.detailTitle}>
                        {businessDetail?.name || "Business"}
                      </Text>
                      <Text style={styles.detailSubtitle}>
                        {businessDetail?.category || "Local business"}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.detailClose}
                      onPress={closeBusinessDetail}
                    >
                      <Ionicons name="close" size={18} color={COLORS.ink} />
                    </TouchableOpacity>
                  </View>

                  {businessDetail?.address ? (
                    <Text style={styles.detailAddress}>
                      {businessDetail.address}
                    </Text>
                  ) : null}
                  {businessDetail?.hours ? (
                    <Text style={styles.detailHours}>
                      {businessDetail.hours}
                    </Text>
                  ) : null}

                  <ScrollView
                    style={styles.detailBody}
                    contentContainerStyle={styles.detailBodyContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={styles.detailRatingRow}>
                      {(() => {
                        const total = businessDetailReviews.length;
                        const avg =
                          total === 0
                            ? null
                            : businessDetailReviews.reduce(
                                (sum, review) => sum + (review.rating || 0),
                                0,
                              ) / total;
                        return (
                          <>
                            <Ionicons
                              name="star"
                              size={16}
                              color={COLORS.sun}
                            />
                            <Text style={styles.detailRatingText}>
                              {avg ? avg.toFixed(1) : "New"}
                            </Text>
                            <Text style={styles.detailRatingCount}>
                              {total ? `${total} reviews` : "No reviews yet"}
                            </Text>
                          </>
                        );
                      })()}
                    </View>

                    {isSignedIn &&
                      businessDetail?.id &&
                      latestRedemptionByBusiness.has(businessDetail.id) &&
                      !reviewedBusinessIds.has(String(businessDetail.id)) && (
                        <TouchableOpacity
                          style={styles.detailReviewButton}
                          onPress={() => {
                            const entry = latestRedemptionByBusiness.get(
                              businessDetail.id,
                            );
                            openReviewForEntry(entry, businessDetail.name);
                          }}
                        >
                          <Text style={styles.detailReviewButtonText}>
                            Write a review
                          </Text>
                          <Ionicons
                            name="star"
                            size={16}
                            color={COLORS.white}
                          />
                        </TouchableOpacity>
                      )}

                    <View style={styles.detailOffersSection}>
                      <Text style={styles.detailSectionTitle}>Offers</Text>
                      {businessDetailOffersStatus.error && (
                        <Text style={styles.formError}>
                          {businessDetailOffersStatus.error}
                        </Text>
                      )}
                      {businessDetailOffersStatus.loading ? (
                        <View style={styles.remoteNotice}>
                          <Text style={styles.remoteNoticeText}>
                            Loading offers...
                          </Text>
                        </View>
                      ) : businessDetailOffers.length === 0 ? (
                        <View style={styles.emptyState}>
                          <Text style={styles.emptyTitle}>No offers yet.</Text>
                          <Text style={styles.emptyCopy}>
                            Offers will appear after you approve the business.
                          </Text>
                        </View>
                      ) : (
                        businessDetailOffers.map((offer) => {
                          const detailHours =
                            businessDetail?.hours ||
                            businessDetail?.business?.hours ||
                            "";
                          const openFromHours = isBusinessOpenNow(detailHours);
                          const isBusinessOpen =
                            openFromHours === null
                              ? (businessDetail?.isOpen ?? true)
                              : openFromHours;
                          return (
                            <View key={offer.id} style={styles.detailOfferCard}>
                              {offer.imageUrl ? (
                                <Image
                                  source={{ uri: offer.imageUrl }}
                                  style={styles.detailOfferImage}
                                />
                              ) : null}
                              <Text style={styles.detailOfferTitle}>
                                {offer.title || "Local offer"}
                              </Text>
                              <View style={styles.detailOfferTagRow}>
                                {(businessDetail.tags || []).map((tag) => (
                                  <View key={tag} style={styles.detailOfferTag}>
                                    <Text style={styles.detailOfferTagText}>
                                      {tag}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                              {offer.description ? (
                                <Text style={styles.detailOfferText}>
                                  {offer.description}
                                </Text>
                              ) : null}
                              <View style={styles.detailOfferMetaRow}>
                                <Text style={styles.detailOfferMeta}>
                                  {offer.offerType
                                    ? normalizeOfferType(offer.offerType)
                                    : "Offer"}
                                </Text>
                                <Text style={styles.detailOfferMeta}>
                                  {formatOfferDate(offer.createdAt)}
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={[
                                  styles.detailOfferRedemption,
                                  !isBusinessOpen &&
                                    styles.detailOfferRedemptionDisabled,
                                ]}
                                onPress={() =>
                                  handleRedeemOffer({
                                    id: offer.id,
                                    businessId: businessDetail.id,
                                    business: businessDetail,
                                    offerTitle:
                                      offer.title ||
                                      offer.offer ||
                                      businessDetail.offer,
                                    offerType:
                                      offer.offerType || offer.offer_type,
                                    tags: businessDetail.tags,
                                  })
                                }
                                disabled={redeemGateBusy || !isBusinessOpen}
                              >
                                <Text style={styles.detailOfferRedemptionText}>
                                  {isBusinessOpen
                                    ? "Redeem this offer"
                                    : "Closed now"}
                                </Text>
                              </TouchableOpacity>
                              <Pressable
                                style={({ pressed }) => [
                                  styles.detailOfferDirections,
                                  pressed &&
                                    styles.detailOfferDirectionsPressed,
                                ]}
                                onPress={() =>
                                  openMapsForBusiness(businessDetail)
                                }
                              >
                                <Ionicons
                                  name="navigate"
                                  size={14}
                                  color={COLORS.pine}
                                />
                                <Text style={styles.detailOfferDirectionsText}>
                                  Get directions
                                </Text>
                              </Pressable>
                            </View>
                          );
                        })
                      )}
                    </View>

                    <View style={styles.detailReviewList}>
                      {businessDetailStatus.error && (
                        <Text style={styles.formError}>
                          {businessDetailStatus.error}
                        </Text>
                      )}
                      {businessDetailStatus.loading ? (
                        <View style={styles.remoteNotice}>
                          <Text style={styles.remoteNoticeText}>
                            Loading reviews...
                          </Text>
                        </View>
                      ) : businessDetailReviews.length === 0 ? (
                        <View style={styles.emptyState}>
                          <Text style={styles.emptyTitle}>No reviews yet.</Text>
                          <Text style={styles.emptyCopy}>
                            Redeem an offer to leave the first review.
                          </Text>
                        </View>
                      ) : (
                        businessDetailReviews.map((review) => (
                          <View key={review.id} style={styles.detailReviewCard}>
                            <View style={styles.detailReviewHeader}>
                              <Text style={styles.detailReviewUser}>
                                Wello member
                              </Text>
                              <Text style={styles.detailReviewTime}>
                                {formatHistoryTimestamp(review.createdAt)}
                              </Text>
                            </View>
                            <View style={styles.detailReviewStars}>
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Ionicons
                                  key={star}
                                  name={
                                    review.rating >= star
                                      ? "star"
                                      : "star-outline"
                                  }
                                  size={14}
                                  color={
                                    review.rating >= star
                                      ? COLORS.sun
                                      : COLORS.muted
                                  }
                                />
                              ))}
                            </View>
                            {review.reviewText ? (
                              <Text style={styles.detailReviewText}>
                                {review.reviewText}
                              </Text>
                            ) : null}
                          </View>
                        ))
                      )}
                    </View>
                  </ScrollView>
                </View>
              </View>
            </Modal>

            <Modal visible={receiptsModalOpen} animationType="slide">
              {/* React Native Modal renders in a separate root on Android; wrap it so RNGH works reliably. */}
              <GestureHandlerRootView style={{ flex: 1 }}>
                <SafeAreaView
                  style={styles.receiptsScreen}
                  edges={["top", "bottom"]}
                >
                  <View style={styles.receiptsHeader}>
                    <View>
                      <Text style={styles.receiptsTitle}>Receipts</Text>
                      <Text style={styles.receiptsSubtitle}>
                        View uploaded receipts by offer.
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.receiptsClose}
                      onPress={() => {
                        setReceiptsModalOpen(false);
                        setReceiptPreview(null);
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="close" size={18} color={COLORS.ink} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    style={styles.receiptsBody}
                    contentContainerStyle={styles.receiptsBodyContent}
                    showsVerticalScrollIndicator={false}
                  >
                    {businessReceiptStatus.error && (
                      <Text style={styles.formError}>
                        {businessReceiptStatus.error}
                      </Text>
                    )}
                    {businessRedemptionStatus.error && (
                      <Text style={styles.formError}>
                        {businessRedemptionStatus.error}
                      </Text>
                    )}
                    {receiptDebug && (
                      <Text style={styles.cashoutErrorText}>
                        {receiptDebug}
                      </Text>
                    )}

                    {businessReceiptStatus.loading ||
                    businessRedemptionStatus.loading ? (
                      <View style={styles.remoteNotice}>
                        <Text style={styles.remoteNoticeText}>
                          Loading redemptions...
                        </Text>
                      </View>
                    ) : businessReceipts.length === 0 &&
                      pendingRedemptionGroups.length === 0 ? (
                      <View style={styles.emptyState}>
                        <Text style={styles.emptyTitle}>No receipts yet.</Text>
                        <Text style={styles.emptyCopy}>
                          Redemptions will appear here as customers redeem
                          offers.
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.receiptList}>
                        {receiptOfferGroups.length > 0 && (
                          <>
                            <Text style={styles.receiptSectionTitle}>
                              Verified redemptions
                            </Text>
                            {receiptOfferGroups.map((group) => {
                              const expandKey = `verified:${group.key}`;
                              const isExpanded = Boolean(
                                expandedReceiptOffers[expandKey],
                              );
                              return (
                                <View
                                  key={`verified-${group.key}`}
                                  style={styles.receiptOfferCard}
                                >
                                  <TouchableOpacity
                                    style={styles.receiptOfferHeader}
                                    onPress={() =>
                                      setExpandedReceiptOffers((prev) => ({
                                        ...prev,
                                        [expandKey]: !prev[expandKey],
                                      }))
                                    }
                                  >
                                    <View style={styles.receiptOfferMeta}>
                                      <Text
                                        style={styles.receiptOfferTitle}
                                        numberOfLines={1}
                                      >
                                        {group.offerTitle}
                                      </Text>
                                      <Text style={styles.receiptOfferSub}>
                                        {group.receipts.length} receipts{" "}
                                        {"\u00b7"} Last{" "}
                                        {formatHistoryTimestamp(
                                          group.lastUploadedAt,
                                        )}
                                      </Text>
                                    </View>
                                    <Ionicons
                                      name={
                                        isExpanded
                                          ? "chevron-up"
                                          : "chevron-down"
                                      }
                                      size={18}
                                      color={COLORS.muted}
                                    />
                                  </TouchableOpacity>
                                  {isExpanded && (
                                    <View style={styles.receiptTileGrid}>
                                      {group.receipts.map((receipt) => (
                                        <TouchableOpacity
                                          key={receipt.id}
                                          style={styles.receiptTile}
                                          onPress={() =>
                                            handleOpenReceiptPreview(
                                              receipt,
                                              group.offerTitle,
                                            )
                                          }
                                        >
                                          <View style={styles.receiptThumbWrap}>
                                            {receipt.imageUrl ? (
                                              <Image
                                                source={{
                                                  uri: receipt.imageUrl,
                                                }}
                                                style={styles.receiptThumb}
                                                resizeMode="cover"
                                              />
                                            ) : (
                                              <View
                                                style={
                                                  styles.receiptThumbPlaceholder
                                                }
                                              >
                                                <Ionicons
                                                  name="image"
                                                  size={16}
                                                  color={COLORS.muted}
                                                />
                                              </View>
                                            )}
                                          </View>
                                          <Text style={styles.receiptTileDate}>
                                            {formatOfferDate(
                                              receipt.uploadedAt,
                                            )}
                                          </Text>
                                          <Text style={styles.receiptTileTime}>
                                            {formatReceiptTime(
                                              receipt.uploadedAt,
                                            )}
                                          </Text>
                                        </TouchableOpacity>
                                      ))}
                                    </View>
                                  )}
                                </View>
                              );
                            })}
                          </>
                        )}
                        {pendingRedemptionGroups.length > 0 && (
                          <>
                            <Text style={styles.receiptSectionTitle}>
                              Pending receipts
                            </Text>
                            {pendingRedemptionGroups.map((group) => {
                              const expandKey = `pending:${group.key}`;
                              const isExpanded = Boolean(
                                expandedReceiptOffers[expandKey],
                              );
                              return (
                                <View
                                  key={`pending-${group.key}`}
                                  style={styles.receiptOfferCard}
                                >
                                  <TouchableOpacity
                                    style={styles.receiptOfferHeader}
                                    onPress={() =>
                                      setExpandedReceiptOffers((prev) => ({
                                        ...prev,
                                        [expandKey]: !prev[expandKey],
                                      }))
                                    }
                                  >
                                    <View style={styles.receiptOfferMeta}>
                                      <Text
                                        style={styles.receiptOfferTitle}
                                        numberOfLines={1}
                                      >
                                        {group.offerTitle}
                                      </Text>
                                      <Text style={styles.receiptOfferSub}>
                                        {group.entries.length} redeems{" "}
                                        {"\u00b7"} Last{" "}
                                        {formatHistoryTimestamp(
                                          group.lastRedeemed,
                                        )}
                                      </Text>
                                    </View>
                                    <Ionicons
                                      name={
                                        isExpanded
                                          ? "chevron-up"
                                          : "chevron-down"
                                      }
                                      size={18}
                                      color={COLORS.muted}
                                    />
                                  </TouchableOpacity>
                                  {isExpanded && (
                                    <View style={styles.receiptTileGrid}>
                                      {group.entries.map((entry) => (
                                        <View
                                          key={entry.id}
                                          style={[
                                            styles.receiptTile,
                                            styles.redeemTile,
                                          ]}
                                        >
                                          <View style={styles.redeemTileBadge}>
                                            <Text
                                              style={styles.redeemTileBadgeText}
                                            >
                                              No receipt
                                            </Text>
                                          </View>
                                          <Text style={styles.receiptTileDate}>
                                            {formatOfferDate(entry.createdAt)}
                                          </Text>
                                          <Text style={styles.receiptTileTime}>
                                            {formatReceiptTime(entry.createdAt)}
                                          </Text>
                                        </View>
                                      ))}
                                    </View>
                                  )}
                                </View>
                              );
                            })}
                          </>
                        )}
                      </View>
                    )}
                  </ScrollView>
                  {receiptPreview && (
                    <View style={styles.receiptPreviewOverlay}>
                      <View style={styles.receiptPreviewCard}>
                        <View style={styles.receiptPreviewHeader}>
                          <View>
                            <Text style={styles.receiptPreviewTitle}>
                              {receiptPreview?.title || "Receipt"}
                            </Text>
                            {receiptPreview?.timestamp ? (
                              <Text style={styles.receiptPreviewMeta}>
                                Uploaded{" "}
                                {formatHistoryTimestamp(
                                  receiptPreview.timestamp,
                                )}
                              </Text>
                            ) : null}
                          </View>
                          <View style={styles.receiptPreviewHeaderActions}>
                            <TouchableOpacity
                              style={styles.receiptPreviewReset}
                              onPress={resetReceiptZoom}
                              hitSlop={{
                                top: 10,
                                bottom: 10,
                                left: 10,
                                right: 10,
                              }}
                            >
                              <Ionicons
                                name="refresh"
                                size={18}
                                color={COLORS.ink}
                              />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.receiptsClose}
                              onPress={() => {
                                setReceiptPreview(null);
                                resetReceiptZoom();
                              }}
                              hitSlop={{
                                top: 10,
                                bottom: 10,
                                left: 10,
                                right: 10,
                              }}
                            >
                              <Ionicons
                                name="close"
                                size={18}
                                color={COLORS.ink}
                              />
                            </TouchableOpacity>
                          </View>
                        </View>
                        {receiptPreview?.loading ? (
                          <View style={styles.receiptPreviewPlaceholder}>
                            <Ionicons
                              name="time-outline"
                              size={18}
                              color={COLORS.muted}
                            />
                            <Text style={styles.receiptPreviewPlaceholderText}>
                              Loading receipt...
                            </Text>
                          </View>
                        ) : receiptPreview?.uri ? (
                          <View
                            style={styles.receiptPreviewViewport}
                            onLayout={(event) => {
                              const { width, height } =
                                event.nativeEvent.layout || {};
                              if (!width || !height) return;
                              const next = { width, height };
                              receiptViewportSizeRef.current = next;
                              setReceiptViewportSize(next);
                            }}
                          >
                            <PinchGestureHandler
                              ref={receiptPinchRef}
                              simultaneousHandlers={receiptPanRef}
                              onGestureEvent={onReceiptPinchEvent}
                              onHandlerStateChange={onReceiptPinchStateChange}
                            >
                              <Animated.View style={styles.receiptZoomWrap}>
                                <PanGestureHandler
                                  ref={receiptPanRef}
                                  simultaneousHandlers={receiptPinchRef}
                                  onGestureEvent={onReceiptPanEvent}
                                  onHandlerStateChange={onReceiptPanStateChange}
                                  minPointers={1}
                                  maxPointers={2}
                                >
                                  <Animated.View
                                    style={[
                                      styles.receiptPreviewContent,
                                      (() => {
                                        const { width: vw, height: vh } =
                                          receiptViewportSize || {};
                                        const { width: iw, height: ih } =
                                          receiptImageSize || {};
                                        const base = computeContainedSize(
                                          vw || RECEIPT_PREVIEW_WIDTH,
                                          vh || RECEIPT_PREVIEW_HEIGHT,
                                          iw,
                                          ih,
                                        );
                                        return {
                                          width:
                                            base.width ||
                                            vw ||
                                            RECEIPT_PREVIEW_WIDTH,
                                          height:
                                            base.height ||
                                            vh ||
                                            RECEIPT_PREVIEW_HEIGHT,
                                          transform: [
                                            { translateX: receiptTranslateX },
                                            { translateY: receiptTranslateY },
                                            { scale: receiptScale },
                                          ],
                                        };
                                      })(),
                                    ]}
                                  >
                                    <Image
                                      source={{ uri: receiptPreview.uri }}
                                      style={styles.receiptPreviewImage}
                                      resizeMode="contain"
                                      onLoad={(event) => {
                                        const source =
                                          event?.nativeEvent?.source;
                                        const width =
                                          Number(source?.width) || 0;
                                        const height =
                                          Number(source?.height) || 0;
                                        if (!width || !height) return;
                                        const next = { width, height };
                                        receiptImageSizeRef.current = next;
                                        setReceiptImageSize(next);
                                      }}
                                      onError={() =>
                                        setReceiptPreview((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                uri: "",
                                                error:
                                                  "Unable to load receipt image.",
                                              }
                                            : prev,
                                        )
                                      }
                                    />
                                  </Animated.View>
                                </PanGestureHandler>
                              </Animated.View>
                            </PinchGestureHandler>
                          </View>
                        ) : (
                          <View style={styles.receiptPreviewPlaceholder}>
                            <Ionicons
                              name="image-outline"
                              size={18}
                              color={COLORS.muted}
                            />
                            <Text style={styles.receiptPreviewPlaceholderText}>
                              {receiptPreview?.error ||
                                "Receipt image unavailable."}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  )}
                </SafeAreaView>
              </GestureHandlerRootView>
            </Modal>

            <Modal visible={editOfferOpen} animationType="slide">
              <SafeAreaView
                style={styles.editOfferScreen}
                edges={["top", "bottom"]}
              >
                <View style={styles.editOfferHeader}>
                  <Text style={styles.editOfferTitle}>Request offer edit</Text>
                  <TouchableOpacity
                    style={styles.receiptsClose}
                    onPress={() => setEditOfferOpen(false)}
                  >
                    <Ionicons name="close" size={18} color={COLORS.ink} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.editOfferSubtitle}>
                  Updates are reviewed before they go live.
                </Text>
                <ScrollView
                  style={styles.editOfferBody}
                  contentContainerStyle={styles.editOfferBodyContent}
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={styles.formLabel}>Offer title</Text>
                  <AutoFocusInput
                    style={styles.formInput}
                    placeholder="Offer title"
                    placeholderTextColor={COLORS.muted}
                    value={editOfferDraft.title}
                    onChangeText={(value) =>
                      setEditOfferDraft((prev) => ({ ...prev, title: value }))
                    }
                  />

                  <Text style={styles.formLabel}>Description</Text>
                  <AutoFocusInput
                    style={[styles.formInput, styles.formTextarea]}
                    placeholder="Describe the offer details"
                    placeholderTextColor={COLORS.muted}
                    value={editOfferDraft.description}
                    onChangeText={(value) =>
                      setEditOfferDraft((prev) => ({
                        ...prev,
                        description: value,
                      }))
                    }
                    multiline
                    textAlignVertical="top"
                  />

                  <Text style={styles.formLabel}>Offer type</Text>
                  <AutoFocusInput
                    style={styles.formInput}
                    placeholder="Discount, BOGO, Bundle..."
                    placeholderTextColor={COLORS.muted}
                    value={editOfferDraft.type}
                    onChangeText={(value) =>
                      setEditOfferDraft((prev) => ({ ...prev, type: value }))
                    }
                    autoCorrect
                    autoCapitalize="words"
                  />

                  <Text style={styles.formLabel}>Offer photo</Text>
                  <View style={styles.offerUploadRow}>
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={handlePickEditOfferImage}
                      disabled={editOfferStatus.saving}
                    >
                      <Text style={styles.secondaryButtonText}>
                        {editOfferImage ? "Replace photo" : "Upload photo"}
                      </Text>
                    </TouchableOpacity>
                    {editOfferImage && (
                      <TouchableOpacity
                        style={styles.offerRemoveButton}
                        onPress={() => setEditOfferImage(null)}
                      >
                        <Text style={styles.offerRemoveButtonText}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={styles.offerUploadFrame}>
                    {editOfferImage?.uri ? (
                      <Image
                        source={{ uri: editOfferImage.uri }}
                        style={styles.offerUploadPreview}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.offerUploadPlaceholder}>
                        <Ionicons
                          name="image-outline"
                          size={18}
                          color={COLORS.muted}
                        />
                        <Text style={styles.offerUploadHint}>
                          Upload a new photo for this offer.
                        </Text>
                      </View>
                    )}
                  </View>

                  {editOfferStatus.error && (
                    <Text style={styles.formError}>
                      {editOfferStatus.error}
                    </Text>
                  )}

                  <View style={styles.formActions}>
                    <TouchableOpacity
                      style={[
                        styles.primaryButton,
                        editOfferStatus.saving && styles.primaryButtonDisabled,
                      ]}
                      onPress={handleSubmitOfferEdit}
                      disabled={editOfferStatus.saving}
                    >
                      <Text style={styles.primaryButtonText}>
                        {editOfferStatus.saving
                          ? "Submitting..."
                          : "Submit for approval"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </SafeAreaView>
            </Modal>

            <Modal visible={ownerOffersModalOpen} animationType="slide">
              <SafeAreaView
                style={styles.editOfferScreen}
                edges={["top", "bottom"]}
              >
                <View style={styles.editOfferHeader}>
                  <Text style={styles.editOfferTitle}>Your offers</Text>
                  <TouchableOpacity
                    style={styles.receiptsClose}
                    onPress={() => setOwnerOffersModalOpen(false)}
                  >
                    <Ionicons name="close" size={18} color={COLORS.ink} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.editOfferSubtitle}>
                  Tap an offer to view full details or request edits.
                </Text>
                <ScrollView
                  style={styles.editOfferBody}
                  contentContainerStyle={styles.editOfferBodyContent}
                  showsVerticalScrollIndicator={false}
                >
                  {ownerOffersStatus.error && (
                    <Text style={styles.formError}>
                      {ownerOffersStatus.error}
                    </Text>
                  )}
                  {ownerOffersStatus.loading ? (
                    <View style={styles.remoteNotice}>
                      <Text style={styles.remoteNoticeText}>
                        Loading offers...
                      </Text>
                    </View>
                  ) : ownerOffersList.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyTitle}>No offers yet.</Text>
                      <Text style={styles.emptyCopy}>
                        Create your first offer to show on Discover.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.offerList}>
                      {ownerOffersList.map((offer) => {
                        const isExpanded = Boolean(
                          expandedOwnerOffers[offer.id],
                        );
                        const statusLabel =
                          offer.approvalStatus === "pending"
                            ? "Pending review"
                            : offer.approvalStatus === "rejected"
                              ? "Rejected"
                              : "Approved";
                        const offerTypeLabel = offer.offerType
                          ? normalizeOfferType(offer.offerType)
                          : "Offer";
                        const canEdit = offer.approvalStatus !== "pending";
                        return (
                          <View key={offer.id} style={styles.ownerOfferCard}>
                            <TouchableOpacity
                              style={styles.ownerOfferHeader}
                              onPress={() =>
                                setExpandedOwnerOffers((prev) => ({
                                  ...prev,
                                  [offer.id]: !prev[offer.id],
                                }))
                              }
                            >
                              <View style={styles.offerMeta}>
                                <Text style={styles.offerTitle}>
                                  {offer.title || "Untitled offer"}
                                </Text>
                                <Text style={styles.offerStatus}>
                                  {offer.active ? "Active" : "Paused"}{" "}
                                  {"\u00b7"}{" "}
                                  {statusLabel}
                                </Text>
                              </View>
                              <Ionicons
                                name={
                                  isExpanded ? "chevron-up" : "chevron-down"
                                }
                                size={18}
                                color={COLORS.muted}
                              />
                            </TouchableOpacity>
                            {isExpanded && (
                              <View style={styles.ownerOfferBody}>
                                {offer.imageUrl ? (
                                  <Image
                                    source={{ uri: offer.imageUrl }}
                                    style={styles.detailOfferImage}
                                    resizeMode="cover"
                                  />
                                ) : (
                                  <View
                                    style={styles.ownerOfferImagePlaceholder}
                                  >
                                    <Ionicons
                                      name="image-outline"
                                      size={18}
                                      color={COLORS.muted}
                                    />
                                    <Text style={styles.cardMediaLabel}>
                                      Offer image
                                    </Text>
                                  </View>
                                )}
                                <View style={styles.detailOfferTagRow}>
                                  {(ownerBusiness?.tags || []).map((tag) => (
                                    <View
                                      key={tag}
                                      style={styles.detailOfferTag}
                                    >
                                      <Text style={styles.detailOfferTagText}>
                                        {tag}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                                {offer.description ? (
                                  <Text style={styles.detailOfferText}>
                                    {offer.description}
                                  </Text>
                                ) : null}
                                <View style={styles.detailOfferMetaRow}>
                                  <Text style={styles.detailOfferMeta}>
                                    {offerTypeLabel}
                                  </Text>
                                </View>
                                <View style={styles.offerActionsRow}>
                                  <TouchableOpacity
                                    style={[
                                      styles.offerAction,
                                      !canEdit && styles.offerActionDisabled,
                                    ]}
                                    onPress={() => handleOpenOfferEdit(offer)}
                                    disabled={!canEdit}
                                  >
                                    <Text style={styles.offerActionText}>
                                      {canEdit
                                        ? "Request edit"
                                        : "Pending review"}
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.offerActionGhost}
                                    onPress={() => handleToggleOffer(offer)}
                                  >
                                    <Text style={styles.offerActionTextGhost}>
                                      {offer.active ? "Pause" : "Activate"}
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.offerActionGhost}
                                    onPress={() => handleDeleteOffer(offer)}
                                  >
                                    <Text style={styles.offerActionTextGhost}>
                                      Delete
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </ScrollView>
              </SafeAreaView>
            </Modal>

            <Modal
              transparent
              visible={receiptNoticeOpen}
              animationType="fade"
              presentationStyle="overFullScreen"
              statusBarTranslucent
            >
              <View style={styles.noticeOverlay}>
                <View style={styles.noticeCard}>
                  <Text style={styles.noticeTitle}>Receipts needed</Text>
                  <Text style={styles.noticeBody}>
                    Upload receipts within 24 hours of redeeming offers to
                    verify them.
                  </Text>
                  <View style={styles.noticeActions}>
                    <TouchableOpacity
                      style={styles.primaryButton}
                      onPress={() => setReceiptNoticeOpen(false)}
                    >
                      <Text style={styles.primaryButtonText}>Got it</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>

            <Modal
              transparent
              visible={verificationPrompt.visible}
              animationType="fade"
              presentationStyle="overFullScreen"
              statusBarTranslucent
              onRequestClose={() =>
                setVerificationPrompt((prev) => ({
                  ...prev,
                  visible: false,
                  entry: null,
                }))
              }
            >
              <View style={styles.noticeOverlay}>
                <View style={styles.noticeCard}>
                  <Text style={styles.noticeTitle}>
                    {verificationPrompt.title || "Receipt needed"}
                  </Text>
                  <Text style={styles.noticeBody}>
                    {verificationPrompt.message || PLAID_FALLBACK_COPY}
                  </Text>
                  <View style={styles.verificationPromptActions}>
                    <TouchableOpacity
                      style={styles.primaryButton}
                      onPress={() => {
                        const target = verificationPrompt.entry;
                        setVerificationPrompt((prev) => ({
                          ...prev,
                          visible: false,
                          entry: null,
                        }));
                        if (target) {
                          promptReceiptUpload(target);
                        }
                      }}
                    >
                      <Text style={styles.primaryButtonText}>
                        {verificationPrompt.primaryLabel || "Upload receipt"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() =>
                        setVerificationPrompt((prev) => ({
                          ...prev,
                          visible: false,
                          entry: null,
                        }))
                      }
                    >
                      <Text style={styles.secondaryButtonText}>
                        {verificationPrompt.secondaryLabel || "Later"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>

            <Modal
              transparent
              visible={receiptUploadOverlay.visible}
              animationType="fade"
              presentationStyle="overFullScreen"
              statusBarTranslucent
            >
              <View style={styles.uploadOverlay}>
                <View style={styles.uploadCard}>
                  <View style={styles.uploadIconWrap}>
                    {receiptUploadOverlay.phase === "uploading" ? (
                      <ActivityIndicator size="small" color={COLORS.pine} />
                    ) : (
                      <Ionicons
                        name={
                          receiptUploadOverlay.phase === "success"
                            ? "checkmark"
                            : "alert"
                        }
                        size={18}
                        color={
                          receiptUploadOverlay.phase === "success"
                            ? "#14532D"
                            : "#B42318"
                        }
                      />
                    )}
                  </View>
                  <View style={styles.uploadCopy}>
                    <Text style={styles.uploadTitle}>
                      {receiptUploadOverlay.title ||
                        (receiptUploadOverlay.phase === "success"
                          ? "Receipt uploaded"
                          : receiptUploadOverlay.phase === "error"
                            ? "Upload failed"
                            : "Uploading receipt")}
                    </Text>
                    <Text style={styles.uploadMessage}>
                      {receiptUploadOverlay.message || " "}
                    </Text>
                  </View>
                </View>
              </View>
            </Modal>

            <Modal
              transparent
              visible={receiptUploadConfetti}
              animationType="fade"
              presentationStyle="overFullScreen"
              statusBarTranslucent
            >
              <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                <ConfettiDrizzle
                  active={receiptUploadConfetti}
                  width={SCREEN_WIDTH}
                  height={SCREEN_HEIGHT}
                  style={{ borderRadius: 0, overflow: "visible" }}
                />
              </View>
            </Modal>

            <Modal transparent visible={timePickerVisible} animationType="fade">
              <View style={styles.timePickerOverlay}>
                <View style={styles.timePickerCard}>
                  <View style={styles.timePickerHeader}>
                    <Text style={styles.timePickerTitle}>Select time</Text>
                    <TouchableOpacity
                      style={styles.timePickerClose}
                      onPress={() => setTimePickerVisible(false)}
                    >
                      <Ionicons name="close" size={16} color={COLORS.ink} />
                    </TouchableOpacity>
                  </View>
                  <ScrollView
                    contentContainerStyle={styles.timePickerList}
                    showsVerticalScrollIndicator={false}
                  >
                    {TIME_OPTIONS.map((time) => (
                      <TouchableOpacity
                        key={time}
                        style={styles.timePickerItem}
                        onPress={() => handleSelectTime(time)}
                      >
                        <Text style={styles.timePickerText}>{time}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>
            </Modal>

            <BottomSheet
              ref={bottomSheetRef}
              snapPoints={sheetSnapPoints}
              onChange={handleSheetChange}
              handleComponent={renderSheetHandle}
              enablePanDownToClose={false}
              enableOverDrag={false}
              enableDynamicSizing={false}
              enableHandlePanningGesture
              enableContentPanningGesture={false}
              backgroundStyle={styles.sheetBackground}
              keyboardBehavior="extend"
              keyboardBlurBehavior="restore"
            >
              <View style={styles.sheetBody}>
              {activeTab === "discover" ? (
                <BottomSheetScrollView
                  style={styles.sheetScroll}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.sheetScrollContent}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={handleRefresh}
                      tintColor={COLORS.pine}
                    />
                  }
                >
                  <View
                    style={[
                      styles.searchRow,
                      IS_COMPACT && styles.searchRowCompact,
                    ]}
                  >
                    <AutoFocusInput
                      placeholder="Search businesses, offers, or categories"
                      placeholderTextColor={COLORS.muted}
                      style={styles.searchInput}
                      value={query}
                      onChangeText={setQuery}
                    />
                    <TouchableOpacity
                      style={styles.filterButton}
                      onPress={() => setShowFilters((prev) => !prev)}
                    >
                      <Text style={styles.filterButtonText}>
                        {showFilters ? "Hide" : "Filters"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {showFilters && (
                    <View style={styles.filterRow}>
                      {FILTERS.map((filter) => {
                        const isActive = activeFilters.includes(filter.key);
                        return (
                          <TouchableOpacity
                            key={filter.key}
                            style={[
                              styles.filterPill,
                              isActive && styles.filterPillActive,
                            ]}
                            onPress={() => toggleFilter(filter.key)}
                          >
                            <Text
                              style={[
                                styles.filterText,
                                isActive && styles.filterTextActive,
                              ]}
                            >
                              {filter.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  {(remoteStatus.loading ||
                    remoteStatus.error ||
                    offerStatus.loading ||
                    offerStatus.error) && (
                    <View style={styles.remoteNotice}>
                      <Text style={styles.remoteNoticeText}>
                        {remoteStatus.loading
                          ? "Loading businesses from Wello..."
                          : offerStatus.loading
                            ? "Loading offers from Wello..."
                            : remoteStatus.error || offerStatus.error}
                      </Text>
                    </View>
                  )}

                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.sectionTitle}>Offer cards</Text>
                    <Text style={styles.sectionMeta}>
                      {filteredOfferCards.length} nearby
                    </Text>
                  </View>

                  {filteredOfferCards.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyTitle}>No listings match.</Text>
                      <Text style={styles.emptyCopy}>
                        Try a different search or reset filters.
                      </Text>
                    </View>
                  ) : (
                    <FlatList
                      ref={cardListRef}
                      data={filteredOfferCards}
                      keyExtractor={(item) => item.id}
                      renderItem={({ item }) => (
                        <OfferCard
                          item={item}
                          onPress={() => handleCardPress(item)}
                          onRedeem={() => handleRedeemOffer(item)}
                          selected={selectedId === item.businessId}
                          cashbackRatePercent={
                            accountRole === "consumer" ? cashbackRatePercent : null
                          }
                        />
                      )}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.cardList}
                      getItemLayout={(_, index) => ({
                        length: CARD_WIDTH + CARD_GAP,
                        offset: (CARD_WIDTH + CARD_GAP) * index,
                        index,
                      })}
                      onScrollToIndexFailed={handleScrollToIndexFailed}
                    />
                  )}
                </BottomSheetScrollView>
              ) : (
                <KeyboardAvoidingView
                  behavior={Platform.OS === "ios" ? "padding" : "height"}
                  keyboardVerticalOffset={SAFE_TOP + 20}
                  style={styles.sheetScroll}
                >
                  <BottomSheetScrollView
                    ref={sheetScrollRef}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={[
                      styles.sheetScrollContent,
                      { paddingBottom: 24 + keyboardInset },
                    ]}
                    keyboardShouldPersistTaps="handled"
                  >
                    {activeTab === "business" && isOwner ? (
                      <>
                        <View style={styles.sectionBlock}>
                          <View style={styles.sectionTitleRow}>
                            <Text
                              style={[
                                styles.sectionTitleAlt,
                                styles.sectionTitleTight,
                              ]}
                            >
                              Dashboard
                            </Text>
                            <TouchableOpacity
                              style={styles.sectionInfoButton}
                              onPress={() =>
                                openInfoTooltip(
                                  "Dashboard",
                                  "Track performance, review receipts, and manage your listing details. Changes to key business info are reviewed before they go live.",
                                )
                              }
                              hitSlop={{
                                top: 10,
                                bottom: 10,
                                left: 10,
                                right: 10,
                              }}
                            >
                              <Ionicons
                                name="information-circle-outline"
                                size={18}
                                color={COLORS.muted}
                              />
                            </TouchableOpacity>
                          </View>
                        </View>

                        <View style={styles.analyticsGrid}>
                          <TouchableOpacity
                            style={[
                              styles.analyticsCard,
                              styles.analyticsCardInteractive,
                            ]}
                            onPress={() => {
                              setViewsModalOpen(true);
                              loadOfferViewsBreakdown(
                                ownerBusiness?.id || ownerBusinessId,
                              );
                            }}
                            activeOpacity={0.85}
                          >
                            <Text style={styles.analyticsValue}>
                              {formatMetricValue(ownerMetrics.views)}
                            </Text>
                            <View style={styles.analyticsLabelRow}>
                              <Text style={styles.analyticsLabel}>Views</Text>
                              <Ionicons
                                name="chevron-forward"
                                size={14}
                                color={COLORS.muted}
                              />
                            </View>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.analyticsCard,
                              styles.analyticsCardInteractive,
                            ]}
                            onPress={() => setReceiptsModalOpen(true)}
                            activeOpacity={0.85}
                          >
                            <Text style={styles.analyticsValue}>
                              {formatMetricValue(ownerMetrics.redemptions)}
                            </Text>
                            <View style={styles.analyticsLabelRow}>
                              <Text style={styles.analyticsLabel}>
                                Redemptions
                              </Text>
                              <Ionicons
                                name="chevron-forward"
                                size={14}
                                color={COLORS.muted}
                              />
                            </View>
                          </TouchableOpacity>
                          <View style={styles.analyticsCard}>
                            <Text style={styles.analyticsValue}>
                              {formatMetricValue(ownerMetrics.reach)}
                            </Text>
                            <View style={styles.analyticsLabelRow}>
                              <Text style={styles.analyticsLabel}>Reach</Text>
                              <TouchableOpacity
                                style={styles.analyticsInfoButton}
                                onPress={triggerReachTooltip}
                              >
                                <Ionicons
                                  name="information-circle-outline"
                                  size={14}
                                  color={COLORS.muted}
                                />
                              </TouchableOpacity>
                            </View>
                            {showReachTooltip && (
                              <View style={styles.analyticsTooltip}>
                                <Text style={styles.analyticsTooltipText}>
                                  Reach is the estimated number of unique people
                                  who saw your listing.
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                        {ownerAnalyticsStatus.error && (
                          <Text style={styles.formError}>
                            {ownerAnalyticsStatus.error}
                          </Text>
                        )}

                        <View style={styles.sectionBlock}>
                          <View style={styles.sectionTitleRow}>
                            <Text
                              style={[
                                styles.sectionTitleAlt,
                                styles.sectionTitleTight,
                              ]}
                            >
                              Payments
                            </Text>
                            <TouchableOpacity
                              style={styles.sectionInfoButton}
                              onPress={() =>
                                openInfoTooltip(
                                  "Payments",
                                  `Commission is ${COMMISSION_RATE_PERCENT}% of each verified receipt total. Customer cashback is a percentage of that commission (promo codes can increase it). Your commission is billed monthly. The billing portal is for payment methods and invoices.`,
                                )
                              }
                              hitSlop={{
                                top: 10,
                                bottom: 10,
                                left: 10,
                                right: 10,
                              }}
                            >
                              <Ionicons
                                name="information-circle-outline"
                                size={18}
                                color={COLORS.muted}
                              />
                            </TouchableOpacity>
                          </View>
                        </View>
                        <View style={styles.paymentCard}>
                          <View style={styles.paymentHeaderRow}>
                            <View style={styles.paymentHeaderBadges}>
                              <View style={styles.paymentRow}>
                                <Text style={styles.paymentLabel}>
                                  Stripe account
                                </Text>
                                <View
                                  style={[
                                    styles.paymentBadge,
                                    resolvedOwnerBusiness?.stripeAccountId
                                      ? styles.paymentBadgeActive
                                      : styles.paymentBadgeInactive,
                                  ]}
                                >
                                  <Text style={styles.paymentBadgeText}>
                                    {resolvedOwnerBusiness?.stripeAccountId
                                      ? "Connected"
                                      : "Not connected"}
                                  </Text>
                                </View>
                              </View>
                              <View style={styles.paymentRow}>
                                <Text style={styles.paymentLabel}>
                                  Payment method
                                </Text>
                                <View
                                  style={[
                                    styles.paymentBadge,
                                    resolvedOwnerBusiness?.stripePaymentMethodId
                                      ? styles.paymentBadgeActive
                                      : styles.paymentBadgeInactive,
                                  ]}
                                >
                                  <Text style={styles.paymentBadgeText}>
                                    {resolvedOwnerBusiness?.stripePaymentMethodId
                                      ? "On file"
                                      : "Needed"}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          </View>
                          <View style={styles.paymentRow}>
                            <Text style={styles.paymentLabel}>
                              Gross income
                            </Text>
                            <Text style={styles.paymentAmount}>
                              {formatCurrencyFromCents(
                                billingMetrics.periodVerifiedGrossCents,
                              )}
                            </Text>
                          </View>
                          <View style={styles.paymentRow}>
                            <Text style={styles.paymentLabel}>Charges due</Text>
                            <Text style={styles.paymentAmount}>
                              {formatCurrencyFromCents(
                                Math.max(
                                  0,
                                  (Number(billingMetrics.periodTotalCents) ||
                                    0) -
                                    (Number(billingMetrics.periodPaidCents) ||
                                      0),
                                ),
                              )}
                            </Text>
                          </View>
                          <View style={styles.paymentRow}>
                            <Text style={styles.paymentLabel}>
                              Net after fees
                            </Text>
                            <Text style={styles.paymentAmount}>
                              {formatCurrencyFromCents(
                                Math.max(
                                  0,
                                  (Number(
                                    billingMetrics.periodVerifiedGrossCents,
                                  ) || 0) -
                                    (Number(billingMetrics.periodTotalCents) ||
                                      0),
                                ),
                              )}
                            </Text>
                          </View>
                          {billingStatus.loading && (
                            <Text style={styles.formHint}>
                              Updating charges...
                            </Text>
                          )}
                          {billingStatus.error && (
                            <Text style={styles.formError}>
                              {billingStatus.error}
                            </Text>
                          )}
                          <View style={styles.paymentActionsRow}>
                            {!resolvedOwnerBusiness?.stripeAccountId ? (
                              <TouchableOpacity
                                style={[
                                  styles.primaryButton,
                                  stripeActionStatus.loading &&
                                    styles.primaryButtonDisabled,
                                ]}
                                onPress={handleStripeConnect}
                                disabled={stripeActionStatus.loading}
                              >
                                <Text style={styles.primaryButtonText}>
                                  Connect Stripe
                                </Text>
                              </TouchableOpacity>
                            ) : !resolvedOwnerBusiness?.stripePaymentMethodId ? (
                              <TouchableOpacity
                                style={[
                                  styles.primaryButton,
                                  stripeActionStatus.loading &&
                                    styles.primaryButtonDisabled,
                                ]}
                                onPress={handleStripePaymentSetup}
                                disabled={stripeActionStatus.loading}
                              >
                                <Text style={styles.primaryButtonText}>
                                  Add payment method
                                </Text>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                style={[
                                  styles.primaryButton,
                                  stripeActionStatus.loading &&
                                    styles.primaryButtonDisabled,
                                ]}
                                onPress={handleStripeManage}
                                disabled={stripeActionStatus.loading}
                              >
                                <Text style={styles.primaryButtonText}>
                                  Billing portal
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                          {stripeActionStatus.error && (
                            <Text style={styles.formError}>
                              {formatStripeError(stripeActionStatus.error)}
                            </Text>
                          )}
                          {stripeActionStatus.success && (
                            <Text style={styles.formSuccess}>
                              {stripeActionStatus.success}
                            </Text>
                          )}
                        </View>

                        <View style={styles.sectionBlock}>
                          <View style={styles.sectionTitleRow}>
                            <Text
                              style={[
                                styles.sectionTitleAlt,
                                styles.sectionTitleTight,
                              ]}
                            >
                              Offers
                            </Text>
                            <TouchableOpacity
                              style={styles.sectionInfoButton}
                              onPress={() =>
                                openInfoTooltip(
                                  "Offers",
                                  "Create and manage offers customers see on Discover. Redemption limits apply per customer.",
                                )
                              }
                              hitSlop={{
                                top: 10,
                                bottom: 10,
                                left: 10,
                                right: 10,
                              }}
                            >
                              <Ionicons
                                name="information-circle-outline"
                                size={18}
                                color={COLORS.muted}
                              />
                            </TouchableOpacity>
                          </View>
                          <TouchableOpacity
                            style={styles.secondaryButton}
                            onPress={() => setOwnerOffersModalOpen(true)}
                          >
                            <Text style={styles.secondaryButtonText}>
                              View current offers
                            </Text>
                          </TouchableOpacity>
                        </View>

                        {ownerBusiness && renderCreateOfferCard()}

                        <View style={styles.sectionBlock}>
                          <View style={styles.sectionTitleRow}>
                            <Text
                              style={[
                                styles.sectionTitleAlt,
                                styles.sectionTitleTight,
                              ]}
                            >
                              Business info
                            </Text>
                            <TouchableOpacity
                              style={styles.sectionInfoButton}
                              onPress={() =>
                                openInfoTooltip(
                                  "Business info",
                                  "Update what customers see on your listing. Changes to name, address, category, and offers are reviewed before they go live.",
                                )
                              }
                              hitSlop={{
                                top: 10,
                                bottom: 10,
                                left: 10,
                                right: 10,
                              }}
                            >
                              <Ionicons
                                name="information-circle-outline"
                                size={18}
                                color={COLORS.muted}
                              />
                            </TouchableOpacity>
                          </View>
                        </View>

                        {ownerBusiness ? (
                          <View style={styles.formCard}>
                            <View style={styles.formHeaderRow}>
                              <View>
                                <Text style={styles.formHeaderTitle}>
                                  {ownerBusiness.name}
                                </Text>
                                <Text style={styles.formHeaderMeta}>
                                  {
                                    getCategoryConfig(ownerBusiness.categoryKey)
                                      .display
                                  }{" "}
                                </Text>
                              </View>
                              <View
                                style={[
                                  styles.statusPill,
                                  ownerBusiness.isOpen
                                    ? styles.statusApproved
                                    : styles.statusRejected,
                                ]}
                              >
                                <Text style={styles.statusText}>
                                  {ownerBusiness.isOpen ? "Open" : "Closed"}
                                </Text>
                              </View>
                            </View>

                            {ownerBusiness.pendingEdits && (
                              <View style={styles.pendingNotice}>
                                <Text style={styles.pendingNoticeTitle}>
                                  Changes pending approval
                                </Text>
                                <Text style={styles.pendingNoticeBody}>
                                  Updates to your name, address, category, or
                                  offer are reviewed before they go live.
                                </Text>
                                <View style={styles.pendingList}>
                                  {Object.keys(ownerBusiness.pendingEdits)
                                    .filter((field) => field !== "coordinate")
                                    .map((field) => (
                                      <View
                                        key={field}
                                        style={styles.pendingPill}
                                      >
                                        <Text style={styles.pendingPillText}>
                                          {getPendingEditLabel(field)}
                                        </Text>
                                      </View>
                                    ))}
                                </View>
                              </View>
                            )}

                            {!isEditingBusiness && (
                              <View style={styles.editGate}>
                                <Text style={styles.editGateText}>
                                  Request an edit to unlock your business info.
                                  Name, address, category, and offer changes are
                                  reviewed before they go live.
                                </Text>
                                <TouchableOpacity
                                  style={[
                                    styles.primaryButton,
                                    !canRequestEdits &&
                                      styles.primaryButtonDisabled,
                                  ]}
                                  onPress={() => {
                                    if (!canRequestEdits) return;
                                    setIsEditingBusiness(true);
                                    setFormMessage(null);
                                  }}
                                  disabled={!canRequestEdits}
                                >
                                  <Text style={styles.primaryButtonText}>
                                    Request edit
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )}
                            {isEditingBusiness && (
                              <View style={styles.editGateActive}>
                                <Text style={styles.editGateActiveText}>
                                  You're in edit mode. Submit changes for
                                  review.
                                </Text>
                              </View>
                            )}

                            <Text style={styles.formLabel}>Business name</Text>
                            <AutoFocusInput
                              style={[
                                styles.formInput,
                                !canEditBusiness && styles.formInputDisabled,
                              ]}
                              placeholder="Business name"
                              placeholderTextColor={COLORS.muted}
                              value={formData.name}
                              editable={canEditBusiness}
                              onChangeText={(value) =>
                                handleFormChange("name", value)
                              }
                            />

                            <Text style={styles.formLabel}>
                              Business address
                            </Text>
                            <AutoFocusInput
                              style={[
                                styles.formInput,
                                !canEditBusiness && styles.formInputDisabled,
                              ]}
                              placeholder="Start typing an address"
                              placeholderTextColor={COLORS.muted}
                              value={formData.address}
                              editable={canEditBusiness}
                              onChangeText={handleAddressChange}
                            />
                            {!GOOGLE_PLACES_KEY && canEditBusiness && (
                              <Text style={styles.formHint}>
                                Add your Google Places key in `.env` to enable
                                address autocomplete.
                              </Text>
                            )}
                            {addressLoading && canEditBusiness && (
                              <Text style={styles.formHint}>
                                Searching addresses...
                              </Text>
                            )}
                            {addressError && canEditBusiness && (
                              <Text style={styles.formError}>
                                {addressError}
                              </Text>
                            )}
                            {canEditBusiness && addressResults.length > 0 && (
                              <View style={styles.suggestionList}>
                                {addressResults.map((result) => (
                                  <TouchableOpacity
                                    key={result.place_id}
                                    style={styles.suggestionItem}
                                    onPress={() =>
                                      handleSelectSuggestion(result)
                                    }
                                  >
                                    <Text style={styles.suggestionTitle}>
                                      {result.structured_formatting
                                        ?.main_text || result.description}
                                    </Text>
                                    {result.structured_formatting
                                      ?.secondary_text && (
                                      <Text style={styles.suggestionSubtitle}>
                                        {
                                          result.structured_formatting
                                            .secondary_text
                                        }
                                      </Text>
                                    )}
                                  </TouchableOpacity>
                                ))}
                              </View>
                            )}

                            <View style={styles.formRow}>
                              <View style={styles.formField}>
                                <Text style={styles.formLabel}>City</Text>
                                <AutoFocusInput
                                  style={[
                                    styles.formInput,
                                    !canEditBusiness &&
                                      styles.formInputDisabled,
                                  ]}
                                  placeholder="City"
                                  placeholderTextColor={COLORS.muted}
                                  value={formData.city}
                                  editable={canEditBusiness}
                                  onChangeText={(value) =>
                                    handleFormChange("city", value)
                                  }
                                />
                              </View>
                              <View style={styles.formField}>
                                <Text style={styles.formLabel}>State</Text>
                                <AutoFocusInput
                                  style={[
                                    styles.formInput,
                                    !canEditBusiness &&
                                      styles.formInputDisabled,
                                  ]}
                                  placeholder="State"
                                  placeholderTextColor={COLORS.muted}
                                  value={formData.state}
                                  editable={canEditBusiness}
                                  onChangeText={(value) =>
                                    handleFormChange("state", value)
                                  }
                                />
                              </View>
                              <View style={styles.formField}>
                                <Text style={styles.formLabel}>Zip code</Text>
                                <AutoFocusInput
                                  style={[
                                    styles.formInput,
                                    !canEditBusiness &&
                                      styles.formInputDisabled,
                                  ]}
                                  placeholder="Zip"
                                  placeholderTextColor={COLORS.muted}
                                  value={formData.postalCode}
                                  editable={canEditBusiness}
                                  onChangeText={(value) =>
                                    handleFormChange("postalCode", value)
                                  }
                                  keyboardType="number-pad"
                                />
                              </View>
                            </View>

                            <Text style={styles.formLabel}>Category</Text>
                            <View style={styles.categoryRow}>
                              {CATEGORY_OPTIONS.map((option) => {
                                const isActive =
                                  formData.categoryKey === option.key;
                                return (
                                  <TouchableOpacity
                                    key={option.key}
                                    style={[
                                      styles.categoryChip,
                                      isActive && styles.categoryChipActive,
                                      !canEditBusiness &&
                                        styles.categoryChipDisabled,
                                    ]}
                                    disabled={!canEditBusiness}
                                    onPress={() =>
                                      handleFormChange(
                                        "categoryKey",
                                        option.key,
                                      )
                                    }
                                  >
                                    <Text
                                      style={[
                                        styles.categoryChipText,
                                        isActive &&
                                          styles.categoryChipTextActive,
                                        !canEditBusiness &&
                                          styles.categoryChipTextDisabled,
                                      ]}
                                    >
                                      {option.label}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>

                            <Text style={styles.formLabel}>
                              Operating hours
                            </Text>
                            <View style={styles.timeRow}>
                              <View style={styles.timeBlock}>
                                <Text style={styles.timeLabel}>Start</Text>
                                <View style={styles.timeInputRow}>
                                  <TouchableOpacity
                                    style={[
                                      styles.timeSelect,
                                      !canEditBusiness &&
                                        styles.timeSelectDisabled,
                                    ]}
                                    onPress={() => openTimePicker("editStart")}
                                    disabled={!canEditBusiness}
                                  >
                                    <Text style={styles.timeSelectText}>
                                      {editHoursStart ||
                                        (IS_COMPACT ? "Select" : "Select time")}
                                    </Text>
                                    <Ionicons
                                      name="chevron-down"
                                      size={16}
                                      color={COLORS.muted}
                                    />
                                  </TouchableOpacity>
                                  <View style={styles.timeMeridiem}>
                                    {["AM", "PM"].map((label) => {
                                      const isActive =
                                        editHoursStartMeridiem === label;
                                      return (
                                        <TouchableOpacity
                                          key={label}
                                          style={[
                                            styles.timeMeridiemPill,
                                            isActive &&
                                              styles.timeMeridiemPillActive,
                                            !canEditBusiness &&
                                              styles.timeMeridiemPillDisabled,
                                          ]}
                                          onPress={() =>
                                            setEditHoursStartMeridiem(label)
                                          }
                                          disabled={!canEditBusiness}
                                        >
                                          <Text
                                            style={[
                                              styles.timeMeridiemText,
                                              isActive &&
                                                styles.timeMeridiemTextActive,
                                              !canEditBusiness &&
                                                styles.timeMeridiemTextDisabled,
                                            ]}
                                          >
                                            {label}
                                          </Text>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </View>
                                </View>
                              </View>
                              <View style={styles.timeBlock}>
                                <Text style={styles.timeLabel}>End</Text>
                                <View style={styles.timeInputRow}>
                                  <TouchableOpacity
                                    style={[
                                      styles.timeSelect,
                                      !canEditBusiness &&
                                        styles.timeSelectDisabled,
                                    ]}
                                    onPress={() => openTimePicker("editEnd")}
                                    disabled={!canEditBusiness}
                                  >
                                    <Text style={styles.timeSelectText}>
                                      {editHoursEnd ||
                                        (IS_COMPACT ? "Select" : "Select time")}
                                    </Text>
                                    <Ionicons
                                      name="chevron-down"
                                      size={16}
                                      color={COLORS.muted}
                                    />
                                  </TouchableOpacity>
                                  <View style={styles.timeMeridiem}>
                                    {["AM", "PM"].map((label) => {
                                      const isActive =
                                        editHoursEndMeridiem === label;
                                      return (
                                        <TouchableOpacity
                                          key={label}
                                          style={[
                                            styles.timeMeridiemPill,
                                            isActive &&
                                              styles.timeMeridiemPillActive,
                                            !canEditBusiness &&
                                              styles.timeMeridiemPillDisabled,
                                          ]}
                                          onPress={() =>
                                            setEditHoursEndMeridiem(label)
                                          }
                                          disabled={!canEditBusiness}
                                        >
                                          <Text
                                            style={[
                                              styles.timeMeridiemText,
                                              isActive &&
                                                styles.timeMeridiemTextActive,
                                              !canEditBusiness &&
                                                styles.timeMeridiemTextDisabled,
                                            ]}
                                          >
                                            {label}
                                          </Text>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </View>
                                </View>
                              </View>
                            </View>

                            <Text style={styles.formLabel}>Tags</Text>
                            <View
                              style={[
                                styles.tagOptionRow,
                                !canEditTags && styles.tagOptionRowDisabled,
                              ]}
                            >
                              {TAG_OPTIONS.map((option) => {
                                const isActive = selectedBusinessTags.has(
                                  option.value,
                                );
                                return (
                                  <TouchableOpacity
                                    key={option.value}
                                    style={[
                                      styles.tagOptionPill,
                                      isActive && styles.tagOptionPillActive,
                                      !canEditTags &&
                                        styles.tagOptionPillDisabled,
                                    ]}
                                    disabled={!canEditTags}
                                    onPress={() => {
                                      if (!canEditTags) return;
                                      const next = new Set(
                                        selectedBusinessTags,
                                      );
                                      if (next.has(option.value)) {
                                        next.delete(option.value);
                                      } else {
                                        next.add(option.value);
                                      }
                                      handleFormChange(
                                        "tags",
                                        Array.from(next).join(", "),
                                      );
                                    }}
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
                            <View style={styles.tagActionsRow}>
                              <Text style={styles.formHint}>
                                Tags save instantly.
                              </Text>
                              <TouchableOpacity
                                style={[
                                  styles.tagSaveButton,
                                  (!tagsDirty || tagSaveStatus.saving) &&
                                    styles.tagSaveButtonDisabled,
                                ]}
                                onPress={handleSaveTags}
                                disabled={!tagsDirty || tagSaveStatus.saving}
                              >
                                <Text style={styles.tagSaveButtonText}>
                                  {tagSaveStatus.saving
                                    ? "Saving..."
                                    : "Save tags"}
                                </Text>
                              </TouchableOpacity>
                            </View>
                            {tagSaveStatus.error && (
                              <Text style={styles.formError}>
                                {tagSaveStatus.error}
                              </Text>
                            )}
                            {tagSaveStatus.success && (
                              <Text style={styles.formHint}>
                                {tagSaveStatus.success}
                              </Text>
                            )}

                            {isEditingBusiness && (
                              <View style={styles.formActions}>
                                <TouchableOpacity
                                  style={[
                                    styles.primaryButton,
                                    businessSaveBusy &&
                                      styles.primaryButtonDisabled,
                                  ]}
                                  onPress={handleSaveBusiness}
                                  disabled={businessSaveBusy}
                                >
                                  <Text style={styles.primaryButtonText}>
                                    {businessSaveBusy
                                      ? "Submitting..."
                                      : "Submit for review"}
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.secondaryButton}
                                  onPress={() => {
                                    if (ownerBusiness) {
                                      setFormData(
                                        buildFormFromBusiness(ownerBusiness),
                                      );
                                    }
                                    setFormMessage(null);
                                    setIsEditingBusiness(false);
                                  }}
                                >
                                  <Text style={styles.secondaryButtonText}>
                                    Cancel
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        ) : (
                          <View style={styles.formCard}>
                            <Text style={styles.formHeaderTitle}>
                              Create your business profile
                            </Text>
                            <Text style={styles.formHeaderMeta}>
                              Add your listing details. You can edit them later
                              if needed.
                            </Text>

                            <Text style={styles.formLabel}>Business name</Text>
                            <AutoFocusInput
                              style={styles.formInput}
                              placeholder="Business name"
                              placeholderTextColor={COLORS.muted}
                              value={createBusinessForm.name}
                              onChangeText={(value) =>
                                setCreateBusinessForm((prev) => ({
                                  ...prev,
                                  name: value,
                                }))
                              }
                            />

                            <Text style={styles.formLabel}>
                              Business address
                            </Text>
                            <AutoFocusInput
                              style={styles.formInput}
                              placeholder="Street address"
                              placeholderTextColor={COLORS.muted}
                              value={createBusinessForm.address}
                              onChangeText={handleCreateAddressChange}
                            />
                            {!GOOGLE_PLACES_KEY && (
                              <Text style={styles.formHint}>
                                Add your Google Places key in `.env` to enable
                                address autocomplete.
                              </Text>
                            )}
                            {createAddressLoading && (
                              <Text style={styles.formHint}>
                                Searching addresses...
                              </Text>
                            )}
                            {createAddressError && (
                              <Text style={styles.formError}>
                                {createAddressError}
                              </Text>
                            )}
                            {createAddressResults.length > 0 && (
                              <View style={styles.suggestionList}>
                                {createAddressResults.map((result) => (
                                  <TouchableOpacity
                                    key={result.place_id}
                                    style={styles.suggestionItem}
                                    onPress={() =>
                                      handleSelectCreateSuggestion(result)
                                    }
                                  >
                                    <Text style={styles.suggestionTitle}>
                                      {result.structured_formatting
                                        ?.main_text || result.description}
                                    </Text>
                                    {result.structured_formatting
                                      ?.secondary_text && (
                                      <Text style={styles.suggestionSubtitle}>
                                        {
                                          result.structured_formatting
                                            .secondary_text
                                        }
                                      </Text>
                                    )}
                                  </TouchableOpacity>
                                ))}
                              </View>
                            )}

                            <View style={styles.formRow}>
                              <View style={styles.formField}>
                                <Text style={styles.formLabel}>City</Text>
                                <AutoFocusInput
                                  style={styles.formInput}
                                  placeholder="City"
                                  placeholderTextColor={COLORS.muted}
                                  value={createBusinessForm.city}
                                  onChangeText={(value) =>
                                    setCreateBusinessForm((prev) => ({
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
                                  placeholderTextColor={COLORS.muted}
                                  value={createBusinessForm.state}
                                  onChangeText={(value) =>
                                    setCreateBusinessForm((prev) => ({
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
                                  placeholder="Zip"
                                  placeholderTextColor={COLORS.muted}
                                  value={createBusinessForm.postalCode}
                                  onChangeText={(value) =>
                                    setCreateBusinessForm((prev) => ({
                                      ...prev,
                                      postalCode: value,
                                    }))
                                  }
                                  keyboardType="number-pad"
                                />
                              </View>
                            </View>

                            <Text style={styles.formLabel}>Category</Text>
                            <View style={styles.categoryRow}>
                              {CATEGORY_OPTIONS.map((option) => {
                                const isActive =
                                  createBusinessForm.categoryKey === option.key;
                                return (
                                  <TouchableOpacity
                                    key={option.key}
                                    style={[
                                      styles.categoryChip,
                                      isActive && styles.categoryChipActive,
                                    ]}
                                    onPress={() =>
                                      setCreateBusinessForm((prev) => ({
                                        ...prev,
                                        categoryKey: option.key,
                                      }))
                                    }
                                  >
                                    <Text
                                      style={[
                                        styles.categoryChipText,
                                        isActive &&
                                          styles.categoryChipTextActive,
                                      ]}
                                    >
                                      {option.label}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>

                            <Text style={styles.formLabel}>Phone</Text>
                            <AutoFocusInput
                              style={styles.formInput}
                              placeholder="(555) 123-4567"
                              placeholderTextColor={COLORS.muted}
                              value={createBusinessForm.phone}
                              onChangeText={(value) =>
                                setCreateBusinessForm((prev) => ({
                                  ...prev,
                                  phone: value,
                                }))
                              }
                              keyboardType="phone-pad"
                            />

                            <Text style={styles.formLabel}>
                              Operating hours
                            </Text>
                            <View style={styles.timeRow}>
                              <View style={styles.timeBlock}>
                                <Text style={styles.timeLabel}>Start</Text>
                                <View style={styles.timeInputRow}>
                                  <TouchableOpacity
                                    style={styles.timeSelect}
                                    onPress={() =>
                                      openTimePicker("createStart")
                                    }
                                  >
                                    <Text style={styles.timeSelectText}>
                                      {createHoursStart ||
                                        (IS_COMPACT ? "Select" : "Select time")}
                                    </Text>
                                    <Ionicons
                                      name="chevron-down"
                                      size={16}
                                      color={COLORS.muted}
                                    />
                                  </TouchableOpacity>
                                  <View style={styles.timeMeridiem}>
                                    {["AM", "PM"].map((label) => {
                                      const isActive =
                                        createHoursStartMeridiem === label;
                                      return (
                                        <TouchableOpacity
                                          key={label}
                                          style={[
                                            styles.timeMeridiemPill,
                                            isActive &&
                                              styles.timeMeridiemPillActive,
                                          ]}
                                          onPress={() =>
                                            setCreateHoursStartMeridiem(label)
                                          }
                                        >
                                          <Text
                                            style={[
                                              styles.timeMeridiemText,
                                              isActive &&
                                                styles.timeMeridiemTextActive,
                                            ]}
                                          >
                                            {label}
                                          </Text>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </View>
                                </View>
                              </View>
                              <View style={styles.timeBlock}>
                                <Text style={styles.timeLabel}>End</Text>
                                <View style={styles.timeInputRow}>
                                  <TouchableOpacity
                                    style={styles.timeSelect}
                                    onPress={() => openTimePicker("createEnd")}
                                  >
                                    <Text style={styles.timeSelectText}>
                                      {createHoursEnd ||
                                        (IS_COMPACT ? "Select" : "Select time")}
                                    </Text>
                                    <Ionicons
                                      name="chevron-down"
                                      size={16}
                                      color={COLORS.muted}
                                    />
                                  </TouchableOpacity>
                                  <View style={styles.timeMeridiem}>
                                    {["AM", "PM"].map((label) => {
                                      const isActive =
                                        createHoursEndMeridiem === label;
                                      return (
                                        <TouchableOpacity
                                          key={label}
                                          style={[
                                            styles.timeMeridiemPill,
                                            isActive &&
                                              styles.timeMeridiemPillActive,
                                          ]}
                                          onPress={() =>
                                            setCreateHoursEndMeridiem(label)
                                          }
                                        >
                                          <Text
                                            style={[
                                              styles.timeMeridiemText,
                                              isActive &&
                                                styles.timeMeridiemTextActive,
                                            ]}
                                          >
                                            {label}
                                          </Text>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </View>
                                </View>
                              </View>
                            </View>

                            <Text style={styles.formLabel}>Tags</Text>
                            <View style={styles.tagOptionRow}>
                              {TAG_OPTIONS.map((option) => {
                                const isActive = selectedCreateTags.has(
                                  option.value,
                                );
                                return (
                                  <TouchableOpacity
                                    key={option.value}
                                    style={[
                                      styles.tagOptionPill,
                                      isActive && styles.tagOptionPillActive,
                                    ]}
                                    onPress={() => {
                                      const next = new Set(selectedCreateTags);
                                      if (next.has(option.value)) {
                                        next.delete(option.value);
                                      } else {
                                        next.add(option.value);
                                      }
                                      setCreateBusinessForm((prev) => ({
                                        ...prev,
                                        tags: Array.from(next).join(", "),
                                      }));
                                    }}
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

                            {createBusinessError && (
                              <Text style={styles.formError}>
                                {createBusinessError}
                              </Text>
                            )}

                            <View style={styles.formActions}>
                              <TouchableOpacity
                                style={[
                                  styles.primaryButton,
                                  createBusinessBusy &&
                                    styles.primaryButtonDisabled,
                                ]}
                                onPress={handleCreateBusinessProfile}
                                disabled={createBusinessBusy}
                              >
                                <Text style={styles.primaryButtonText}>
                                  {createBusinessBusy
                                    ? "Creating..."
                                    : "Create profile"}
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}

                        {formMessage && (
                          <View
                            style={[
                              styles.alertBox,
                              formMessage.type === "error"
                                ? styles.alertError
                                : styles.alertSuccess,
                            ]}
                          >
                            <Text style={styles.alertText}>
                              {formMessage.text}
                            </Text>
                          </View>
                        )}

                        {/* Offer management lives in the Business Dashboard tab. */}
                      </>
                    ) : activeTab === "history" ? (
                      <>
                        {!isSignedIn ? (
                          <View style={styles.authCard}>
                            <Text style={styles.authTitle}>History</Text>
                            <Text style={styles.authSubtitle}>
                              Sign in to see the offers you have redeemed.
                            </Text>
                            <TouchableOpacity
                              style={styles.authPrimaryButton}
                              onPress={() => {
                                setAuthView("signin");
                                setActiveTab("profile");
                              }}
                            >
                              <Text style={styles.authButtonText}>Sign in</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <>
                            <View style={styles.sectionBlock}>
                             <Text style={styles.sectionTitleAlt}>
                                History
                              </Text>
                              <Text style={styles.sectionBody}>
                                Your redemptions, grouped by business.
                              </Text>
                            </View>
                            {redemptionStatus.error && (
                              <Text style={styles.formError}>
                                {redemptionStatus.error}
                              </Text>
                            )}
                            {receiptUploadStatus.error && (
                              <Text style={styles.formError}>
                                {receiptUploadStatus.error}
                              </Text>
                            )}
                            {purchaseVerifyStatus.error && (
                              <Text style={styles.formError}>
                                {purchaseVerifyStatus.error}
                              </Text>
                            )}
                            {purchaseVerifyStatus.success && (
                              <Text style={styles.formHint}>
                                {purchaseVerifyStatus.success}
                              </Text>
                            )}
                            {receiptDebug && (
                              <Text style={styles.cashoutErrorText}>
                                {receiptDebug}
                              </Text>
                            )}
                            <View style={styles.receiptNoticeCard}>
                              <Text style={styles.receiptNoticeTitle}>
                                Purchase verification
                              </Text>
                              <Text style={styles.receiptNoticeBody}>
                                {PLAID_AUTO_VERIFY_COPY}
                              </Text>
                              <Text style={styles.receiptNoticeBody}>
                                {PLAID_FALLBACK_COPY}
                              </Text>
                              <Text style={styles.receiptNoticeBody}>
                                {PLAID_PENDING_COPY}
                              </Text>
                              <Text style={styles.receiptNoticeMeta}>
                                {plaidLinkState.loading
                                  ? "Checking linked bank status..."
                                  : plaidLinkState.linked
                                    ? `Linked banks: ${plaidLinkState.linkedCount}`
                                    : "No linked bank yet. Receipt upload is always available."}
                              </Text>
                              {plaidLinkState.error && (
                                <Text style={styles.receiptNoticeMetaError}>
                                  {plaidLinkState.error}
                                </Text>
                              )}
                              <View style={styles.receiptNoticeActionRow}>
                                <TouchableOpacity
                                  style={styles.receiptNoticeLinkButton}
                                  onPress={handleLinkPurchaseVerificationBank}
                                  disabled={
                                    plaidLinkState.loading ||
                                    plaidLinkAction !== "idle"
                                  }
                                >
                                  <Text style={styles.receiptNoticeLinkButtonText}>
                                    {plaidLinkAction === "linking"
                                      ? "Opening Plaid Link..."
                                      : plaidLinkState.linked
                                        ? "Link another bank"
                                        : "Link bank for auto verification"}
                                  </Text>
                                </TouchableOpacity>
                                {plaidLinkState.linked && (
                                  <TouchableOpacity
                                    style={[
                                      styles.receiptNoticeLinkButton,
                                      styles.receiptNoticeLinkButtonSecondary,
                                    ]}
                                    onPress={handleUnlinkLinkedBanks}
                                    disabled={
                                      plaidLinkState.loading ||
                                      plaidLinkAction !== "idle"
                                    }
                                  >
                                    <Text style={styles.receiptNoticeLinkButtonText}>
                                      {plaidLinkAction === "unlinking"
                                        ? "Updating..."
                                        : "Unlink linked banks"}
                                    </Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            </View>
                            {pendingReceiptCount > 0 && (
                              <View style={styles.receiptNoticeCard}>
                                <Text style={styles.receiptNoticeTitle}>
                                  Receipts needed
                                </Text>
                                <Text style={styles.receiptNoticeBody}>
                                  Upload within 24 hours to verify recent
                                  redemptions.
                                </Text>
                              </View>
                            )}

                            {redemptionStatus.loading ? (
                              <View style={styles.remoteNotice}>
                                <Text style={styles.remoteNoticeText}>
                                  Loading your history...
                                </Text>
                              </View>
                            ) : redemptionHistory.length === 0 ? (
                              <View style={styles.emptyState}>
                                <Text style={styles.emptyTitle}>
                                  No redemptions yet.
                                </Text>
                                <Text style={styles.emptyCopy}>
                                  Redeem an offer to see it here.
                                </Text>
                              </View>
                            ) : (
                              <View style={styles.historyList}>
                                {historyGroups.map((group) => {
                                  const isExpanded = Boolean(
                                    expandedHistoryGroups[group.key],
                                  );
                                  const accentKey =
                                    group.businessId ||
                                    group.key ||
                                    group.businessName ||
                                    "wello";
                                  const accentColor = pickHistoryAccent(
                                    accentKey,
                                  );
                                  const initials = getInitials(
                                    group.businessName,
                                  );
                                  const hasReview = reviewedBusinessIds.has(
                                    String(group.businessId || group.key),
                                  );
                                  const entriesWithReceipt =
                                    group.entries.filter((entry) =>
                                      Boolean(entry.receipt?.id),
                                    );
                                  const entriesWithoutReceipt =
                                    group.entries.filter(
                                      (entry) => !entry.receipt?.id,
                                    );
                                  const renderHistoryEntry = (entry) => {
                                    const offerTitle =
                                      entry.offer?.title || "Redeemed offer";
                                    const hasReceipt = Boolean(
                                      entry.receipt?.id,
                                    );
                                    const receiptWindowOpen =
                                      isReceiptWindowOpen(entry);
                                    const isUploadingReceipt =
                                      receiptUploadStatus.uploading &&
                                      receiptUploadStatus.targetId === entry.id;
                                    const isAutoVerifying =
                                      purchaseVerifyStatus.loading &&
                                      purchaseVerifyStatus.targetId === entry.id;
                                    const needsReceipt = !hasReceipt;
                                    const purchaseVerification =
                                      entry.purchaseVerification || null;
                                    const verificationStatus =
                                      purchaseVerification?.status || null;
                                    const verificationReason =
                                      formatPurchaseVerificationReason(
                                        purchaseVerification?.reasonCode,
                                        purchaseVerification?.reasonDetail,
                                      );
                                    const canUploadReceipt =
                                      needsReceipt &&
                                      (receiptWindowOpen ||
                                        verificationStatus === "pending" ||
                                        verificationStatus === "rejected");
                                    const cashbackStatus =
                                      entry.receipt?.cashbackStatus || null;
                                    const cashbackCents = Number(
                                      entry.receipt?.cashbackCents,
                                    );
                                    const toneColor = (() => {
                                      if (needsReceipt) {
                                        if (verificationStatus === "pending") {
                                          return "#A16207";
                                        }
                                        return canUploadReceipt
                                          ? "#2563EB"
                                          : "#DC2626";
                                      }
                                      if (cashbackStatus === "reversed") {
                                        return "#B42318";
                                      }
                                      if (
                                        Number.isFinite(cashbackCents) &&
                                        cashbackCents > 0
                                      ) {
                                        return "#16A34A";
                                      }
                                      return accentColor;
                                    })();
                                    const cashbackLine = (() => {
                                      if (!hasReceipt) {
                                        if (verificationStatus === "pending") {
                                          return {
                                            icon: "time",
                                            text: "Verification pending",
                                            variant: "pending",
                                          };
                                        }
                                        if (verificationStatus === "rejected") {
                                          return {
                                            icon: "alert-circle",
                                            text: "Receipt required",
                                            variant: "reversed",
                                          };
                                        }
                                        return null;
                                      }
                                      if (cashbackStatus === "reversed") {
                                        return {
                                          icon: "alert-circle",
                                          text: "Cashback reversed",
                                          variant: "reversed",
                                        };
                                      }
                                      if (
                                        Number.isFinite(cashbackCents) &&
                                        cashbackCents > 0
                                      ) {
                                        return {
                                          icon: "cash",
                                          text: `Cashback +${formatCurrencyFromCents(
                                            cashbackCents,
                                          )}`,
                                          variant: "earned",
                                        };
                                      }
                                      return {
                                        icon: "time",
                                        text: "Cashback pending",
                                        variant: "pending",
                                      };
                                    })();
                                    return (
                                      <View
                                        key={entry.id}
                                        style={[
                                          styles.historyEntry,
                                          {
                                            borderColor: hexToRgba(
                                              toneColor,
                                              0.18,
                                            ),
                                            backgroundColor: hexToRgba(
                                              toneColor,
                                              0.06,
                                            ),
                                          },
                                        ]}
                                      >
                                        <View style={styles.historyEntryRow}>
                                          <View style={styles.historyEntryMain}>
                                            <Text
                                              style={styles.historyEntryTitle}
                                              numberOfLines={1}
                                            >
                                              {offerTitle}
                                            </Text>
                                            {Boolean(entry.offer?.description) && (
                                              <Text
                                                style={styles.historyEntrySubtitle}
                                                numberOfLines={2}
                                              >
                                                {entry.offer?.description}
                                              </Text>
                                            )}
                                          </View>
                                          <View style={styles.historyEntryMeta}>
                                            <View
                                              style={styles.historyEntryTimeRow}
                                            >
                                              <Ionicons
                                                name="time-outline"
                                                size={13}
                                                color={COLORS.muted}
                                              />
                                              <Text
                                                style={styles.historyEntryTime}
                                                numberOfLines={1}
                                              >
                                                {formatHistoryTimestamp(
                                                  entry.createdAt,
                                                )}
                                              </Text>
                                            </View>
                                            {cashbackLine && (
                                              <View
                                                style={[
                                                  styles.historyCashbackPill,
                                                  cashbackLine.variant ===
                                                    "earned" &&
                                                    styles.historyCashbackPillEarned,
                                                  cashbackLine.variant ===
                                                    "pending" &&
                                                    styles.historyCashbackPillPending,
                                                  cashbackLine.variant ===
                                                    "reversed" &&
                                                    styles.historyCashbackPillReversed,
                                                ]}
                                              >
                                                <Ionicons
                                                  name={cashbackLine.icon}
                                                  size={18}
                                                  color={
                                                    cashbackLine.variant ===
                                                    "earned"
                                                      ? "#047857"
                                                      : cashbackLine.variant ===
                                                          "reversed"
                                                        ? "#B42318"
                                                        : COLORS.muted
                                                  }
                                                />
                                                <Text
                                                  style={[
                                                    styles.historyCashbackPillText,
                                                    cashbackLine.variant ===
                                                      "earned" &&
                                                      styles.historyCashbackPillTextEarned,
                                                    cashbackLine.variant ===
                                                      "reversed" &&
                                                      styles.historyCashbackPillTextReversed,
                                                  ]}
                                                  numberOfLines={1}
                                                >
                                                  {cashbackLine.text}
                                                </Text>
                                              </View>
                                            )}
                                          </View>
                                        </View>
                                        <View style={styles.historyFlagsRow}>
                                          {!hasReview &&
                                            entry.id === group.entries[0]?.id && (
                                              <View
                                                style={[
                                                  styles.historyFlagChip,
                                                  {
                                                    backgroundColor: hexToRgba(
                                                      accentColor,
                                                      0.1,
                                                    ),
                                                    borderColor: hexToRgba(
                                                      accentColor,
                                                      0.25,
                                                    ),
                                                  },
                                                ]}
                                              >
                                                <Ionicons
                                                  name="star"
                                                  size={14}
                                                  color={accentColor}
                                                />
                                                <Text
                                                  style={[
                                                    styles.historyFlagChipText,
                                                    { color: accentColor },
                                                  ]}
                                                  numberOfLines={1}
                                                >
                                                  Review
                                                </Text>
                                              </View>
                                            )}
                                          {needsReceipt && (
                                            <View
                                              style={[
                                                styles.historyFlagChip,
                                                verificationStatus === "pending"
                                                  ? styles.historyFlagChipWarn
                                                  : canUploadReceipt
                                                    ? styles.historyFlagChipInfo
                                                    : styles.historyFlagChipDanger,
                                              ]}
                                            >
                                              <Ionicons
                                                name={
                                                  verificationStatus === "pending"
                                                    ? "time-outline"
                                                    : canUploadReceipt
                                                      ? "document-text-outline"
                                                      : "close-circle"
                                                }
                                                size={12}
                                                color={
                                                  verificationStatus === "pending"
                                                    ? "#92400E"
                                                    : canUploadReceipt
                                                      ? "#1D4ED8"
                                                      : "#B42318"
                                                }
                                              />
                                              <Text
                                                style={[
                                                  styles.historyFlagChipText,
                                                  verificationStatus === "pending"
                                                    ? styles.historyFlagChipTextWarn
                                                    : canUploadReceipt
                                                      ? styles.historyFlagChipTextInfo
                                                      : styles.historyFlagChipTextDanger,
                                                ]}
                                                numberOfLines={1}
                                              >
                                                {verificationStatus === "pending"
                                                  ? "Bank check pending"
                                                  : canUploadReceipt
                                                    ? "Receipt needed"
                                                    : "Receipt expired"}
                                              </Text>
                                            </View>
                                          )}
                                          {needsReceipt &&
                                            verificationStatus === "rejected" && (
                                              <View
                                                style={[
                                                  styles.historyFlagChip,
                                                  styles.historyFlagChipInfo,
                                                ]}
                                              >
                                                <Ionicons
                                                  name="document-outline"
                                                  size={12}
                                                  color="#1D4ED8"
                                                />
                                                <Text
                                                  style={[
                                                    styles.historyFlagChipText,
                                                    styles.historyFlagChipTextInfo,
                                                  ]}
                                                  numberOfLines={1}
                                                >
                                                  Receipt fallback ready
                                                </Text>
                                              </View>
                                            )}
                                        </View>
                                        {needsReceipt && Boolean(verificationReason) && (
                                          <Text style={styles.historyVerificationText}>
                                            {verificationReason}
                                          </Text>
                                        )}
                                        {needsReceipt &&
                                          canUploadReceipt &&
                                          isAutoVerifying && (
                                            <View style={styles.historyUploadHint}>
                                              <Ionicons
                                                name="sync-outline"
                                                size={14}
                                                color={COLORS.muted}
                                              />
                                              <Text style={styles.historyUploadHintText}>
                                                Checking linked bank transactions...
                                              </Text>
                                            </View>
                                          )}
                                        {needsReceipt &&
                                          canUploadReceipt &&
                                          isUploadingReceipt && (
                                          <View style={styles.historyUploadHint}>
                                            <Ionicons
                                              name="cloud-upload-outline"
                                              size={14}
                                              color={COLORS.muted}
                                            />
                                            <Text style={styles.historyUploadHintText}>
                                              Uploading receipt...
                                            </Text>
                                          </View>
                                          )}
                                        {needsReceipt && canUploadReceipt && (
                                          <View style={styles.historyActionRow}>
                                            <TouchableOpacity
                                              style={[
                                                styles.receiptUploadButton,
                                                styles.historyVerifyButton,
                                                (isAutoVerifying ||
                                                  isUploadingReceipt) &&
                                                  styles.receiptUploadButtonDisabled,
                                              ]}
                                              onPress={() =>
                                                handleAutoVerifyPurchase(entry)
                                              }
                                              disabled={
                                                isAutoVerifying || isUploadingReceipt
                                              }
                                            >
                                              <Ionicons
                                                name="search-outline"
                                                size={16}
                                                color={COLORS.ink}
                                              />
                                              <Text
                                                style={styles.historyVerifyButtonText}
                                              >
                                                {isAutoVerifying
                                                  ? "Checking..."
                                                  : "Auto verify"}
                                              </Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                              style={[
                                                styles.receiptUploadButton,
                                                isUploadingReceipt &&
                                                  styles.receiptUploadButtonDisabled,
                                                styles.historyReceiptUploadButton,
                                                {
                                                  borderColor: hexToRgba(
                                                    toneColor,
                                                    0.22,
                                                  ),
                                                },
                                              ]}
                                              onPress={() =>
                                                promptReceiptUpload(entry)
                                              }
                                              disabled={
                                                isUploadingReceipt || isAutoVerifying
                                              }
                                            >
                                              <Ionicons
                                                name="document-text-outline"
                                                size={16}
                                                color={COLORS.ink}
                                              />
                                              <Text
                                                style={
                                                  styles.historyReceiptUploadButtonText
                                                }
                                              >
                                                {isUploadingReceipt
                                                  ? "Uploading..."
                                                  : "Upload receipt"}
                                              </Text>
                                            </TouchableOpacity>
                                          </View>
                                        )}
                                      </View>
                                    );
                                  };
                                  return (
                                    <View
                                      key={group.key}
                                      style={styles.historyGroupCard}
                                    >
                                      <Pressable
                                        style={({ pressed }) => [
                                          styles.historyGroupHeader,
                                          pressed && styles.historyGroupHeaderPressed,
                                        ]}
                                        android_ripple={{
                                          color: hexToRgba(accentColor, 0.12),
                                          borderless: false,
                                        }}
                                        onPress={() =>
                                          setExpandedHistoryGroups((prev) => ({
                                            ...prev,
                                            [group.key]: !prev[group.key],
                                          }))
                                        }
                                      >
                                        <View style={styles.historyGroupHeaderLeft}>
                                          <View
                                            style={[
                                              styles.historyGroupAvatar,
                                              {
                                                borderColor: hexToRgba(
                                                  accentColor,
                                                  0.35,
                                                ),
                                                backgroundColor: hexToRgba(
                                                  accentColor,
                                                  0.12,
                                                ),
                                              },
                                            ]}
                                          >
                                            <Text
                                              style={[
                                                styles.historyGroupAvatarText,
                                                { color: accentColor },
                                              ]}
                                            >
                                              {initials}
                                            </Text>
                                          </View>
                                          <View style={styles.historyGroupMeta}>
                                            <Text
                                              style={styles.historyGroupTitle}
                                              numberOfLines={1}
                                            >
                                              {group.businessName}
                                            </Text>
                                            <View style={styles.historyGroupSubRow}>
                                              <Ionicons
                                                name="time-outline"
                                                size={12}
                                                color={COLORS.muted}
                                              />
                                              <Text
                                                style={styles.historyGroupSub}
                                                numberOfLines={1}
                                              >
                                                {group.entries.length} redeemed{" "}
                                                {"\u00b7"} Last{" "}
                                                {formatHistoryTimestamp(
                                                  group.lastRedeemed,
                                                )}
                                              </Text>
                                            </View>
                                          </View>
                                        </View>

                                        <View style={styles.historyGroupActions}>
                                          {group.pendingCount > 0 && (
                                            <View style={styles.historyReviewBadge}>
                                              <Text
                                                style={styles.historyReviewBadgeText}
                                              >
                                                {group.pendingCount}
                                              </Text>
                                            </View>
                                          )}
                                          {group.receiptPendingCount > 0 && (
                                            <View style={styles.historyReceiptBadge}>
                                              <Text
                                                style={styles.historyReceiptBadgeText}
                                              >
                                                {group.receiptPendingCount}
                                              </Text>
                                            </View>
                                          )}
                                          <View style={styles.historyGroupChevron}>
                                            <Ionicons
                                              name={
                                                isExpanded
                                                  ? "chevron-up"
                                                  : "chevron-down"
                                              }
                                              size={18}
                                              color={COLORS.muted}
                                            />
                                          </View>
                                        </View>
                                      </Pressable>
                                      {isExpanded && (
                                        <View style={styles.historyEntries}>
                                          {group.pendingCount > 0 && (
                                            <Pressable
                                              style={({ pressed }) => [
                                                styles.historyReviewButton,
                                                {
                                                  borderColor: hexToRgba(
                                                    accentColor,
                                                    0.25,
                                                  ),
                                                  backgroundColor: hexToRgba(
                                                    accentColor,
                                                    0.10,
                                                  ),
                                                },
                                                pressed &&
                                                  styles.historyReviewButtonPressed,
                                              ]}
                                              onPress={() =>
                                                handleOpenReview(group)
                                              }
                                            >
                                              <View
                                                style={
                                                  styles.historyReviewButtonLeft
                                                }
                                              >
                                                <View
                                                  style={[
                                                    styles.historyReviewIcon,
                                                    {
                                                      backgroundColor:
                                                        hexToRgba(
                                                          accentColor,
                                                          0.16,
                                                        ),
                                                      borderColor: hexToRgba(
                                                        accentColor,
                                                        0.28,
                                                      ),
                                                    },
                                                  ]}
                                                >
                                                  <Ionicons
                                                    name="star"
                                                    size={16}
                                                    color={accentColor}
                                                  />
                                                </View>
                                                <View>
                                                  <Text
                                                    style={styles.historyReviewText}
                                                  >
                                                    Leave a review
                                                  </Text>
                                                  <Text
                                                    style={
                                                      styles.historyReviewSubtext
                                                    }
                                                  >
                                                    Takes about 10 seconds.
                                                  </Text>
                                                </View>
                                              </View>
                                              <Ionicons
                                                name="chevron-forward"
                                                size={18}
                                                color={COLORS.muted}
                                              />
                                            </Pressable>
                                          )}
                                          {entriesWithoutReceipt.length > 0 && (
                                            <View style={styles.historySection}>
                                              <View
                                                style={[
                                                  styles.historySectionHeader,
                                                  {
                                                    borderColor: hexToRgba(
                                                      "#2563EB",
                                                      0.18,
                                                    ),
                                                    backgroundColor: hexToRgba(
                                                      "#2563EB",
                                                      0.08,
                                                    ),
                                                  },
                                                ]}
                                              >
                                                <View
                                                  style={
                                                    styles.historySectionTitleRow
                                                  }
                                                >
                                                  <Ionicons
                                                    name="document-text-outline"
                                                    size={14}
                                                    color={"#1D4ED8"}
                                                  />
                                                  <Text
                                                    style={
                                                      styles.historySectionTitle
                                                    }
                                                  >
                                                    Needs receipt
                                                  </Text>
                                                </View>
                                                <View
                                                  style={
                                                    styles.historySectionCount
                                                  }
                                                >
                                                  <Text
                                                    style={
                                                      styles.historySectionCountText
                                                    }
                                                  >
                                                    {entriesWithoutReceipt.length}
                                                  </Text>
                                                </View>
                                              </View>
                                              {entriesWithoutReceipt.map(
                                                renderHistoryEntry,
                                              )}
                                            </View>
                                          )}
                                          {entriesWithReceipt.length > 0 && (
                                            <View style={styles.historySection}>
                                              <View
                                                style={[
                                                  styles.historySectionHeader,
                                                  {
                                                    borderColor: hexToRgba(
                                                      "#16A34A",
                                                      0.18,
                                                    ),
                                                    backgroundColor: hexToRgba(
                                                      "#16A34A",
                                                      0.08,
                                                    ),
                                                  },
                                                ]}
                                              >
                                                <View
                                                  style={
                                                    styles.historySectionTitleRow
                                                  }
                                                >
                                                  <Ionicons
                                                    name="checkmark-circle-outline"
                                                    size={14}
                                                    color={"#16A34A"}
                                                  />
                                                  <Text
                                                    style={
                                                      styles.historySectionTitle
                                                    }
                                                  >
                                                    Receipt uploaded
                                                  </Text>
                                                </View>
                                                <View
                                                  style={
                                                    styles.historySectionCount
                                                  }
                                                >
                                                  <Text
                                                    style={
                                                      styles.historySectionCountText
                                                    }
                                                  >
                                                    {entriesWithReceipt.length}
                                                  </Text>
                                                </View>
                                              </View>
                                              {entriesWithReceipt.map(
                                                renderHistoryEntry,
                                              )}
                                            </View>
                                          )}
                                        </View>
                                      )}
                                    </View>
                                  );
                                })}
                              </View>
                            )}
                          </>
                        )}
                      </>
                    ) : activeTab === "cashout" ? (
                      <>
                        {!isSignedIn ? (
                          <View style={styles.authCard}>
                            <Text style={styles.authTitle}>Cash out</Text>
                            <Text style={styles.authSubtitle}>
                              Sign in to link a bank account and withdraw
                              cashback.
                            </Text>
                            <TouchableOpacity
                              style={styles.authPrimaryButton}
                              onPress={() => {
                                setAuthView("signin");
                                setActiveTab("profile");
                              }}
                            >
                              <Text style={styles.authButtonText}>Sign in</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <>
                            <View style={styles.sectionBlock}>
                              <View style={styles.cashoutTitleRow}>
                                <View style={styles.sectionTitleIcon}>
                                  <Ionicons
                                    name="cash-outline"
                                    size={16}
                                    color={COLORS.ink}
                                  />
                                </View>
                                <Text style={styles.sectionTitleAlt}>
                                  Cash out
                                </Text>
                              </View>
                            </View>
                            <View style={styles.pointsCard}>
                              <View style={styles.pointsHeader}>
                                <View style={styles.pointsLabelRow}>
                                  <Ionicons
                                    name="sparkles-outline"
                                    size={14}
                                    color={COLORS.muted}
                                  />
                                  <Text style={styles.pointsLabel}>
                                    Cashback balance
                                  </Text>
                                </View>
                                <Text style={styles.pointsValue}>
                                  {formatCurrencyFromCents(
                                    cashbackBalance.availableCents,
                                  )}
                                </Text>
                              </View>
                              <View style={styles.cashoutAmountGroup}>
                                <View style={styles.cashoutAmountHeader}>
                                  <Text style={styles.cashoutAmountTitle}>
                                    Amount
                                  </Text>
                                  <Text style={styles.cashoutAmountMeta}>
                                    Available:{" "}
                                    {formatCurrencyFromCents(
                                      cashbackBalance.availableCents,
                                    )}
                                  </Text>
                                </View>
                                <View style={styles.cashoutAmountRow}>
                                  <View style={styles.cashoutAmountField}>
                                    <Text style={styles.cashoutAmountPrefix}>
                                      $
                                    </Text>
                                    <TextInput
                                      style={styles.cashoutAmountInput}
                                      value={cashoutAmountText}
                                      onChangeText={setCashoutAmountText}
                                      placeholder="Enter amount (optional)"
                                      placeholderTextColor={COLORS.muted}
                                      keyboardType="decimal-pad"
                                      returnKeyType="done"
                                      onBlur={() => {
                                        const cleaned = String(
                                          cashoutAmountText || "",
                                        ).trim();
                                        if (!cleaned) return;
                                        const parsed = Number(cleaned);
                                        if (
                                          !Number.isFinite(parsed) ||
                                          parsed <= 0
                                        )
                                          return;
                                        setCashoutAmountText(parsed.toFixed(2));
                                      }}
                                    />
                                  </View>
                                  <TouchableOpacity
                                    style={styles.cashoutAmountMaxButton}
                                    onPress={() =>
                                      setCashoutAmountText(
                                        (
                                          (Number(
                                            cashbackBalance.availableCents,
                                          ) || 0) / 100
                                        ).toFixed(2),
                                      )
                                    }
                                    disabled={cashoutActionStatus.loading}
                                  >
                                    <Text style={styles.cashoutAmountMaxText}>
                                      Max
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                                {String(cashoutAmountText || "").trim() &&
                                  cashoutPreview.mode === "invalid" && (
                                    <Text style={styles.formError}>
                                      Enter an amount up to{" "}
                                      {formatCurrencyFromCents(
                                        cashbackBalance.availableCents,
                                      )}
                                      .
                                    </Text>
                                  )}
                              </View>
                              <TouchableOpacity
                                style={[
                                  styles.primaryButton,
                                  { marginTop: 12 },
                                  (!cashoutStatus.connected ||
                                    !cashoutStatus.payoutsEnabled ||
                                    cashoutPreview.mode === "invalid" ||
                                    (Number(cashbackBalance.availableCents) ||
                                      0) <= 0 ||
                                    cashoutActionStatus.loading) &&
                                    styles.primaryButtonDisabled,
                                ]}
                                onPress={handleCashoutPayout}
                                disabled={
                                  !cashoutStatus.connected ||
                                  !cashoutStatus.payoutsEnabled ||
                                  cashoutPreview.mode === "invalid" ||
                                  (Number(cashbackBalance.availableCents) ||
                                    0) <= 0 ||
                                  cashoutActionStatus.loading
                                }
                              >
                                <Text style={styles.primaryButtonText}>
                                  {cashoutPreview.label}
                                </Text>
                              </TouchableOpacity>
                              {cashbackBalanceState.loading && (
                                <Text style={styles.formHint}>
                                  Updating cashback...
                                </Text>
                              )}
                              {cashbackBalanceState.error && (
                                <Text style={styles.formError}>
                                  {cashbackBalanceState.error}
                                </Text>
                              )}
                            </View>
                            <View style={styles.sectionBlock}>
                              <View style={styles.cashoutTitleRow}>
                                <View style={styles.sectionTitleIcon}>
                                  <Ionicons
                                    name="card-outline"
                                    size={16}
                                    color={COLORS.ink}
                                  />
                                </View>
                                <Text style={styles.sectionTitleAlt}>
                                  Bank account
                                </Text>
                              </View>
                              <Text style={styles.sectionBody}>
                                Link a bank account to receive payouts. Cashouts
                                are available once per week.
                              </Text>
                              <View style={styles.cashoutStatusRow}>
                                <View
                                  style={[
                                    styles.cashoutPill,
                                    cashoutStatus.connected
                                      ? styles.cashoutPillActive
                                      : styles.cashoutPillMuted,
                                  ]}
                                  accessibilityLabel={
                                    cashoutStatus.connected
                                      ? "Bank account linked"
                                      : "Bank account not linked"
                                  }
                                >
                                  <Ionicons
                                    name={
                                      cashoutStatus.connected
                                        ? "link-outline"
                                        : "alert-circle-outline"
                                    }
                                    size={16}
                                    color={
                                      cashoutStatus.connected
                                        ? COLORS.ink
                                        : COLORS.muted
                                    }
                                  />
                                </View>
                                <View
                                  style={[
                                    styles.cashoutPill,
                                    cashoutStatus.payoutsEnabled
                                      ? styles.cashoutPillActive
                                      : styles.cashoutPillMuted,
                                  ]}
                                  accessibilityLabel={
                                    cashoutStatus.payoutsEnabled
                                      ? "Payouts ready"
                                      : cashoutStatus.connected
                                        ? "Payouts pending verification"
                                        : "Payouts locked"
                                  }
                                >
                                  <Ionicons
                                    name={
                                      cashoutStatus.payoutsEnabled
                                        ? "checkmark-circle-outline"
                                        : cashoutStatus.connected
                                          ? "time-outline"
                                          : "lock-closed-outline"
                                    }
                                    size={16}
                                    color={
                                      cashoutStatus.payoutsEnabled
                                        ? COLORS.ink
                                        : COLORS.muted
                                    }
                                  />
                                </View>
                              </View>
                              {cashoutStatusState.loading && (
                                <View style={styles.cashoutStatusHint}>
                                  <ActivityIndicator
                                    size="small"
                                    color={COLORS.muted}
                                  />
                                  <Text style={styles.cashoutStatusText}>
                                    Checking status...
                                  </Text>
                                </View>
                              )}
                              {cashoutStatusState.error && (
                                <Text style={styles.cashoutErrorText}>
                                  {cashoutStatusState.error}
                                </Text>
                              )}
                              {cashoutActionStatus.error && (
                                <Text style={styles.cashoutErrorText}>
                                  {cashoutActionStatus.error}
                                </Text>
                              )}
                              {cashoutActionStatus.success && (
                                <Text style={styles.cashoutSuccessText}>
                                  {cashoutActionStatus.success}
                                </Text>
                              )}
                              <View style={styles.cashoutButtonStack}>
                                <TouchableOpacity
                                  style={styles.primaryButton}
                                  onPress={handleCashoutConnect}
                                  disabled={cashoutActionStatus.loading}
                                >
                                  <Text style={styles.primaryButtonText}>
                                    {cashoutStatus.connected
                                      ? "Update bank account"
                                      : "Link bank account"}
                                  </Text>
                                </TouchableOpacity>
                                {cashoutStatus.connected && (
                                  <TouchableOpacity
                                    style={styles.secondaryButton}
                                    onPress={handleCashoutManage}
                                    disabled={cashoutActionStatus.loading}
                                  >
                                    <Text style={styles.secondaryButtonText}>
                                      Update payout details
                                    </Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            </View>
                          </>
                        )}
                      </>
                    ) : activeTab === "profile" ? (
                      <>
                        {!isSignedIn ? (
                          <View style={styles.authStack}>
                            {authView === "menu" && (
                              <View style={styles.authCard}>
                                <Text style={styles.authBrand}>Wello</Text>
                                <Text style={styles.authTitle}>
                                  You're not signed in
                                </Text>
                                <Text style={styles.authSubtitle}>
                                  Sign in to manage your account or create a new
                                  one to get started.
                                </Text>

                                <TouchableOpacity
                                  style={styles.authPrimaryButton}
                                  onPress={() => setAuthView("signin")}
                                >
                                  <Text style={styles.authButtonText}>
                                    Sign in
                                  </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  style={styles.authSecondaryButton}
                                  onPress={() => setAuthView("signup")}
                                >
                                  <Text style={styles.secondaryButtonText}>
                                    Create new account
                                  </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                  style={styles.authSecondaryButton}
                                  onPress={() => setAuthView("business")}
                                >
                                  <Text style={styles.secondaryButtonText}>
                                    Create business account
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )}

                            {authView === "signin" && (
                              <View style={styles.authCard}>
                                <TouchableOpacity
                                  style={styles.authBack}
                                  onPress={() => setAuthView("menu")}
                                >
                                  <Ionicons
                                    name="arrow-back"
                                    size={16}
                                    color={COLORS.muted}
                                  />
                                  <Text style={styles.authBackText}>Back</Text>
                                </TouchableOpacity>

                                <Text style={styles.authTitle}>Sign in</Text>
                                <Text style={styles.authSubtitle}>
                                  Access your account to manage listings and
                                  offers.
                                </Text>

                                <Text style={styles.formLabel}>Email</Text>
                                <AutoFocusInput
                                  style={styles.authInput}
                                  placeholder="name@business.com"
                                  placeholderTextColor={COLORS.muted}
                                  value={signInEmail}
                                  onChangeText={setSignInEmail}
                                  keyboardType="email-address"
                                  autoCapitalize="none"
                                />

                                <Text style={styles.formLabel}>Password</Text>
                                <AutoFocusInput
                                  style={styles.authInput}
                                  placeholder="--------"
                                  placeholderTextColor={COLORS.muted}
                                  value={signInPassword}
                                  onChangeText={setSignInPassword}
                                  secureTextEntry
                                />

                                {signInError && (
                                  <Text style={styles.formError}>
                                    {signInError}
                                  </Text>
                                )}

                                <TouchableOpacity
                                  style={[
                                    styles.authButton,
                                    authBusy && styles.authButtonDisabled,
                                  ]}
                                  onPress={handleSignIn}
                                  disabled={authBusy}
                                >
                                  <Text style={styles.authButtonText}>
                                    {authBusy ? "Please wait..." : "Sign in"}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )}

                            {authView === "signup" && (
                              <View style={styles.authCard}>
                                <TouchableOpacity
                                  style={styles.authBack}
                                  onPress={() => setAuthView("menu")}
                                >
                                  <Ionicons
                                    name="arrow-back"
                                    size={16}
                                    color={COLORS.muted}
                                  />
                                  <Text style={styles.authBackText}>Back</Text>
                                </TouchableOpacity>

                                <Text style={styles.authTitle}>
                                  Create account
                                </Text>
                                <Text style={styles.authSubtitle}>
                                  Create a member account to save your favorites
                                  and redeem offers.
                                </Text>

                                <Text style={styles.formLabel}>Full name</Text>
                                <AutoFocusInput
                                  style={styles.authInput}
                                  placeholder="Your name"
                                  placeholderTextColor={COLORS.muted}
                                  value={signUpName}
                                  onChangeText={setSignUpName}
                                />

                                <Text style={styles.formLabel}>Email</Text>
                                <AutoFocusInput
                                  style={styles.authInput}
                                  placeholder="name@business.com"
                                  placeholderTextColor={COLORS.muted}
                                  value={signUpEmail}
                                  onChangeText={setSignUpEmail}
                                  keyboardType="email-address"
                                  autoCapitalize="none"
                                />

                                <Text style={styles.formLabel}>Password</Text>
                                <AutoFocusInput
                                  style={styles.authInput}
                                  placeholder="--------"
                                  placeholderTextColor={COLORS.muted}
                                  value={signUpPassword}
                                  onChangeText={setSignUpPassword}
                                  secureTextEntry
                                />

                                {signUpError && (
                                  <Text style={styles.formError}>
                                    {signUpError}
                                  </Text>
                                )}

                                <TouchableOpacity
                                  style={[
                                    styles.authButton,
                                    authBusy && styles.authButtonDisabled,
                                  ]}
                                  onPress={handleCreateAccount}
                                  disabled={authBusy}
                                >
                                  <Text style={styles.authButtonText}>
                                    {authBusy
                                      ? "Please wait..."
                                      : "Create account"}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )}

                            {authView === "business" && (
                              <View style={styles.authCard}>
                                <TouchableOpacity
                                  style={styles.authBack}
                                  onPress={() => setAuthView("menu")}
                                >
                                  <Ionicons
                                    name="arrow-back"
                                    size={16}
                                    color={COLORS.muted}
                                  />
                                  <Text style={styles.authBackText}>Back</Text>
                                </TouchableOpacity>

                                <Text style={styles.authTitle}>
                                  Create business account
                                </Text>
                                <Text style={styles.authSubtitle}>
                                  Business accounts are reviewed before they
                                  appear in Wello.
                                </Text>

                                <Text style={styles.formLabel}>Full name</Text>
                                <AutoFocusInput
                                  style={styles.authInput}
                                  placeholder="Your name"
                                  placeholderTextColor={COLORS.muted}
                                  value={businessOwnerName}
                                  onChangeText={setBusinessOwnerName}
                                />

                                <Text style={styles.formLabel}>
                                  Business name
                                </Text>
                                <AutoFocusInput
                                  style={styles.authInput}
                                  placeholder="Business name"
                                  placeholderTextColor={COLORS.muted}
                                  value={businessName}
                                  onChangeText={setBusinessName}
                                />

                                <Text style={styles.formLabel}>Category</Text>
                                <View style={styles.categoryRow}>
                                  {CATEGORY_OPTIONS.map((option) => {
                                    const isActive =
                                      businessCategoryKey === option.key;
                                    return (
                                      <TouchableOpacity
                                        key={option.key}
                                        style={[
                                          styles.categoryChip,
                                          isActive && styles.categoryChipActive,
                                        ]}
                                        onPress={() =>
                                          setBusinessCategoryKey(option.key)
                                        }
                                      >
                                        <Text
                                          style={[
                                            styles.categoryChipText,
                                            isActive &&
                                              styles.categoryChipTextActive,
                                          ]}
                                        >
                                          {option.label}
                                        </Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>

                                <Text style={styles.formLabel}>
                                  Business address
                                </Text>
                                <AutoFocusInput
                                  style={styles.authInput}
                                  placeholder="Street address"
                                  placeholderTextColor={COLORS.muted}
                                  value={businessAddress}
                                  onChangeText={handleBusinessAddressChange}
                                />
                                {!GOOGLE_PLACES_KEY && (
                                  <Text style={styles.formHint}>
                                    Add your Google Places key in `.env` to
                                    enable address autocomplete.
                                  </Text>
                                )}
                                {businessAddressLoading && (
                                  <Text style={styles.formHint}>
                                    Searching addresses...
                                  </Text>
                                )}
                                {businessAddressError && (
                                  <Text style={styles.formError}>
                                    {businessAddressError}
                                  </Text>
                                )}
                                {businessAddressResults.length > 0 && (
                                  <View style={styles.suggestionList}>
                                    {businessAddressResults.map((result) => (
                                      <TouchableOpacity
                                        key={result.place_id}
                                        style={styles.suggestionItem}
                                        onPress={() =>
                                          handleSelectBusinessSuggestion(result)
                                        }
                                      >
                                        <Text style={styles.suggestionTitle}>
                                          {result.structured_formatting
                                            ?.main_text || result.description}
                                        </Text>
                                        {result.structured_formatting
                                          ?.secondary_text && (
                                          <Text
                                            style={styles.suggestionSubtitle}
                                          >
                                            {
                                              result.structured_formatting
                                                .secondary_text
                                            }
                                          </Text>
                                        )}
                                      </TouchableOpacity>
                                    ))}
                                  </View>
                                )}

                                <View style={styles.formRow}>
                                  <View style={styles.formField}>
                                    <Text style={styles.formLabel}>City</Text>
                                    <AutoFocusInput
                                      style={styles.authInput}
                                      placeholder="City"
                                      placeholderTextColor={COLORS.muted}
                                      value={businessAddressCity}
                                      onChangeText={setBusinessAddressCity}
                                    />
                                  </View>
                                  <View style={styles.formField}>
                                    <Text style={styles.formLabel}>State</Text>
                                    <AutoFocusInput
                                      style={styles.authInput}
                                      placeholder="State"
                                      placeholderTextColor={COLORS.muted}
                                      value={businessAddressState}
                                      onChangeText={setBusinessAddressState}
                                    />
                                  </View>
                                  <View style={styles.formField}>
                                    <Text style={styles.formLabel}>
                                      Zip code
                                    </Text>
                                    <AutoFocusInput
                                      style={styles.authInput}
                                      placeholder="Zip"
                                      placeholderTextColor={COLORS.muted}
                                      value={businessAddressPostal}
                                      onChangeText={setBusinessAddressPostal}
                                      keyboardType="number-pad"
                                    />
                                  </View>
                                </View>

                                <Text style={styles.formLabel}>Phone</Text>
                                <AutoFocusInput
                                  style={styles.authInput}
                                  placeholder="(555) 123-4567"
                                  placeholderTextColor={COLORS.muted}
                                  value={businessPhone}
                                  onChangeText={setBusinessPhone}
                                  keyboardType="phone-pad"
                                />

                                <Text style={styles.formLabel}>
                                  Operating hours
                                </Text>
                                <View style={styles.timeRow}>
                                  <View style={styles.timeBlock}>
                                    <Text style={styles.timeLabel}>Start</Text>
                                    <View style={styles.timeInputRow}>
                                      <TouchableOpacity
                                        style={styles.timeSelect}
                                        onPress={() => openTimePicker("start")}
                                      >
                                        <Text style={styles.timeSelectText}>
                                          {businessHoursStart ||
                                            (IS_COMPACT
                                              ? "Select"
                                              : "Select time")}
                                        </Text>
                                        <Ionicons
                                          name="chevron-down"
                                          size={16}
                                          color={COLORS.muted}
                                        />
                                      </TouchableOpacity>
                                      <View style={styles.timeMeridiem}>
                                        {["AM", "PM"].map((label) => {
                                          const isActive =
                                            businessHoursStartMeridiem ===
                                            label;
                                          return (
                                            <TouchableOpacity
                                              key={label}
                                              style={[
                                                styles.timeMeridiemPill,
                                                isActive &&
                                                  styles.timeMeridiemPillActive,
                                              ]}
                                              onPress={() =>
                                                setBusinessHoursStartMeridiem(
                                                  label,
                                                )
                                              }
                                            >
                                              <Text
                                                style={[
                                                  styles.timeMeridiemText,
                                                  isActive &&
                                                    styles.timeMeridiemTextActive,
                                                ]}
                                              >
                                                {label}
                                              </Text>
                                            </TouchableOpacity>
                                          );
                                        })}
                                      </View>
                                    </View>
                                  </View>
                                  <View style={styles.timeBlock}>
                                    <Text style={styles.timeLabel}>End</Text>
                                    <View style={styles.timeInputRow}>
                                      <TouchableOpacity
                                        style={styles.timeSelect}
                                        onPress={() => openTimePicker("end")}
                                      >
                                        <Text style={styles.timeSelectText}>
                                          {businessHoursEnd ||
                                            (IS_COMPACT
                                              ? "Select"
                                              : "Select time")}
                                        </Text>
                                        <Ionicons
                                          name="chevron-down"
                                          size={16}
                                          color={COLORS.muted}
                                        />
                                      </TouchableOpacity>
                                      <View style={styles.timeMeridiem}>
                                        {["AM", "PM"].map((label) => {
                                          const isActive =
                                            businessHoursEndMeridiem === label;
                                          return (
                                            <TouchableOpacity
                                              key={label}
                                              style={[
                                                styles.timeMeridiemPill,
                                                isActive &&
                                                  styles.timeMeridiemPillActive,
                                              ]}
                                              onPress={() =>
                                                setBusinessHoursEndMeridiem(
                                                  label,
                                                )
                                              }
                                            >
                                              <Text
                                                style={[
                                                  styles.timeMeridiemText,
                                                  isActive &&
                                                    styles.timeMeridiemTextActive,
                                                ]}
                                              >
                                                {label}
                                              </Text>
                                            </TouchableOpacity>
                                          );
                                        })}
                                      </View>
                                    </View>
                                  </View>
                                </View>

                                <Text style={styles.formLabel}>Email</Text>
                                <AutoFocusInput
                                  style={styles.authInput}
                                  placeholder="owner@business.com"
                                  placeholderTextColor={COLORS.muted}
                                  value={businessEmail}
                                  onChangeText={setBusinessEmail}
                                  keyboardType="email-address"
                                  autoCapitalize="none"
                                />

                                <Text style={styles.formLabel}>Password</Text>
                                <AutoFocusInput
                                  style={styles.authInput}
                                  placeholder="--------"
                                  placeholderTextColor={COLORS.muted}
                                  value={businessPassword}
                                  onChangeText={setBusinessPassword}
                                  secureTextEntry
                                />

                                {businessSignUpError && (
                                  <Text style={styles.formError}>
                                    {businessSignUpError}
                                  </Text>
                                )}

                                <TouchableOpacity
                                  style={[
                                    styles.authButton,
                                    authBusy && styles.authButtonDisabled,
                                  ]}
                                  onPress={handleBusinessSignUp}
                                  disabled={authBusy}
                                >
                                  <Text style={styles.authButtonText}>
                                    {authBusy
                                      ? "Please wait..."
                                      : "Create business account"}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        ) : (
                          <>
                            <View style={styles.sectionBlock}>
                              <Text style={styles.sectionTitleAlt}>
                                Profile
                              </Text>
                              <Text style={styles.sectionBody}>
                                Manage your account details and business access.
                              </Text>
                            </View>

                            <View style={styles.profileCard}>
                              <View style={styles.profileHeader}>
                                <View style={styles.profileAvatar}>
                                  <Text style={styles.profileInitials}>
                                    {profileInitials}
                                  </Text>
                                </View>
                                <View style={styles.profileHeaderText}>
                                  <Text style={styles.profileName}>
                                    {profileName || "Wello Owner"}
                                  </Text>
                                  <Text style={styles.profileEmail}>
                                    {profileEmail || authEmail}
                                  </Text>
                                </View>
                                <View style={styles.profileRolePill}>
                                  <Text style={styles.profileRoleText}>
                                    {roleLabel}
                                  </Text>
                                </View>
                              </View>
                            </View>

                            <View style={styles.notificationPanel}>
                              <Text style={styles.sectionTitleAlt}>
                                Notifications
                              </Text>
                              <Text style={styles.sectionBody}>
                                Stay informed about new or nearby offers. Toggle
                                the categories you care about.
                              </Text>
                              {preferencesStatus.loading && (
                                <Text style={styles.formHint}>
                                  Saving preferences...
                                </Text>
                              )}
                              {preferencesStatus.error && (
                                <Text style={styles.formError}>
                                  {preferencesStatus.error}
                                </Text>
                              )}
                              <View style={styles.notificationRow}>
                                <Text style={styles.notificationLabel}>
                                  New offers
                                </Text>
                                <Switch
                                  value={notificationPreferences.new_offer}
                                  onValueChange={(value) =>
                                    handlePreferenceToggle("new_offer", value)
                                  }
                                />
                              </View>
                              <View style={styles.notificationRow}>
                                <Text style={styles.notificationLabel}>
                                  Offers expiring soon
                                </Text>
                                <Switch
                                  value={notificationPreferences.expiring_offer}
                                  onValueChange={(value) =>
                                    handlePreferenceToggle(
                                      "expiring_offer",
                                      value,
                                    )
                                  }
                                />
                              </View>
                              <View style={styles.notificationRow}>
                                <Text style={styles.notificationLabel}>
                                  Offers nearby
                                </Text>
                                <Switch
                                  value={notificationPreferences.nearby_offer}
                                  onValueChange={(value) =>
                                    handlePreferenceToggle(
                                      "nearby_offer",
                                      value,
                                    )
                                  }
                                />
                              </View>
                              <Text style={styles.notificationHelp}>
                                Push permission:{" "}
                                {notificationPermissionStatus === "granted"
                                  ? "Enabled"
                                  : notificationPermissionStatus === "denied"
                                    ? "Denied"
                                    : notificationPermissionStatus ===
                                        "unsupported"
                                      ? "Device unsupported"
                                      : "Pending"}
                              </Text>
                              {notificationPermissionStatus === "denied" ? (
                                <TouchableOpacity
                                  style={styles.pushTokenRefreshButton}
                                  onPress={() => {
                                    Linking.openSettings().catch(() => {});
                                  }}
                                >
                                  <Ionicons
                                    name="settings-outline"
                                    size={14}
                                    color={COLORS.ink}
                                  />
                                  <Text style={styles.pushTokenRefreshText}>
                                    Open settings
                                  </Text>
                                </TouchableOpacity>
                              ) : null}
                              {tokenError && (
                                <Text style={styles.formError}>
                                  {tokenError}
                                </Text>
                              )}
                            </View>

                            {accountRole === "consumer" ? (
                              <View style={styles.notificationPanel}>
                                <View style={styles.promoHeader}>
                                  <View style={styles.promoHeaderLeft}>
                                    <Text style={styles.sectionTitleAlt}>
                                      Cashback
                                    </Text>
                                    {promoState.code ? (
                                      <View style={styles.promoActivePill}>
                                        <Ionicons
                                          name="sparkles-outline"
                                          size={12}
                                          color={COLORS.pine}
                                        />
                                        <Text style={styles.promoActivePillText}>
                                          {promoState.code}
                                        </Text>
                                      </View>
                                    ) : null}
                                  </View>
                                  <View style={styles.promoRatePill}>
                                    <Text style={styles.promoRateText}>
                                      {formatCashbackRateLabel(cashbackRatePercent) ||
                                        "Cashback"}
                                    </Text>
                                  </View>
                                </View>
                              <Text style={styles.promoHint}>
                                Apply a promo code to increase your cashback rate.
                              </Text>

                              <View style={styles.promoRow}>
                                <AutoFocusInput
                                  style={styles.promoInput}
                                  placeholder="Enter promo code"
                                  placeholderTextColor={COLORS.muted}
                                  value={promoCodeInput}
                                  onChangeText={setPromoCodeInput}
                                  autoCapitalize="characters"
                                  autoCorrect={false}
                                />
                                <TouchableOpacity
                                  style={[
                                    styles.promoApplyButton,
                                    promoState.loading &&
                                      styles.authButtonDisabled,
                                  ]}
                                  onPress={handleApplyPromoCode}
                                  disabled={promoState.loading}
                                >
                                  <Text style={styles.promoApplyText}>
                                    {promoState.loading ? "..." : "Apply"}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                              <View style={styles.promoActions}>
                                {promoState.code ? (
                                  <TouchableOpacity
                                    style={styles.promoClearButton}
                                    onPress={handleClearPromoCode}
                                    disabled={promoState.loading}
                                  >
                                    <Text style={styles.promoClearText}>
                                      Remove
                                    </Text>
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                              {promoState.error ? (
                                <Text style={styles.formError}>
                                  {promoState.error}
                                </Text>
                              ) : null}
                              {promoState.success ? (
                                <Text style={styles.promoSuccess}>
                                  {promoState.success}
                                </Text>
                              ) : null}
                            </View>
                            ) : null}

                            <View style={styles.formCard}>
                              <Text style={styles.formLabel}>Full name</Text>
                              <AutoFocusInput
                                style={styles.formInput}
                                placeholder="Your name"
                                placeholderTextColor={COLORS.muted}
                                value={profileName}
                                onChangeText={setProfileName}
                              />

                              <Text style={styles.formLabel}>Email</Text>
                              <AutoFocusInput
                                style={styles.formInput}
                                placeholder="name@business.com"
                                placeholderTextColor={COLORS.muted}
                                value={profileEmail}
                                onChangeText={setProfileEmail}
                                keyboardType="email-address"
                                autoCapitalize="none"
                              />

                              <Text style={styles.formLabel}>Phone</Text>
                              <AutoFocusInput
                                style={styles.formInput}
                                placeholder="(555) 123-4567"
                                placeholderTextColor={COLORS.muted}
                                value={profilePhone}
                                onChangeText={setProfilePhone}
                                keyboardType="phone-pad"
                              />

                              {accountRole !== "consumer" && (
                                <>
                                  <Text style={styles.formLabel}>Company</Text>
                                  <AutoFocusInput
                                    style={styles.formInput}
                                    placeholder="Business name"
                                    placeholderTextColor={COLORS.muted}
                                    value={profileCompany}
                                    onChangeText={setProfileCompany}
                                  />
                                </>
                              )}

                              <View style={styles.profileMetaRow} />

                              <View style={styles.formActions}>
                                <TouchableOpacity
                                  style={styles.primaryButton}
                                  onPress={handleProfileSave}
                                >
                                  <Text style={styles.primaryButtonText}>
                                    Save profile
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.secondaryButton}
                                  onPress={handleSignOut}
                                >
                                  <Text style={styles.secondaryButtonText}>
                                    Sign out
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>

                            {profileMessage && (
                              <View
                                style={[styles.alertBox, styles.alertSuccess]}
                              >
                                <Text style={styles.alertText}>
                                  {profileMessage}
                                </Text>
                              </View>
                            )}
                          </>
                        )}
                      </>
                    ) : activeTab === "admin" && isStaff ? (
                      <>
                        <View style={styles.sectionBlock}>
                          <Text style={styles.sectionTitleAlt}>
                            Admin review
                          </Text>
                          <Text style={styles.sectionBody}>
                            Approve new listings before they go live.
                          </Text>
                        </View>
                        {adminActionStatus.loading && (
                          <Text style={styles.formHint}>
                            Processing admin action...
                          </Text>
                        )}
                        {adminActionStatus.error && (
                          <Text style={styles.formError}>
                            {adminActionStatus.error}
                          </Text>
                        )}
                        {adminActionStatus.success && (
                          <Text style={styles.formSuccess}>
                            {adminActionStatus.success}
                          </Text>
                        )}

                        <View style={styles.adminSummary}>
                          <View style={styles.statCard}>
                            <Text style={styles.statValue}>
                              {pendingBusinesses.length}
                            </Text>
                            <Text style={styles.statLabel}>
                              Pending listings
                            </Text>
                          </View>
                          <View style={styles.statCard}>
                            <Text style={styles.statValue}>
                              {pendingEditBusinesses.length}
                            </Text>
                            <Text style={styles.statLabel}>Edit requests</Text>
                          </View>
                          <View style={styles.statCard}>
                            <Text style={styles.statValue}>
                              {pendingOffers.length}
                            </Text>
                            <Text style={styles.statLabel}>Offer reviews</Text>
                          </View>
                          <View style={styles.statCard}>
                            <Text style={styles.statValue}>
                              {approvedBusinesses.length}
                            </Text>
                            <Text style={styles.statLabel}>Approved</Text>
                          </View>
                        </View>

                        <View style={styles.sectionBlock}>
                          <Text style={styles.sectionTitleAlt}>
                            Pending edits
                          </Text>
                          <Text style={styles.sectionBody}>
                            Approve or reject changes to business details.
                          </Text>
                        </View>

                        {pendingEditBusinesses.length === 0 ? (
                          <View style={styles.emptyState}>
                            <Text style={styles.emptyTitle}>
                              No edit requests.
                            </Text>
                            <Text style={styles.emptyCopy}>
                              Updates will appear here for review.
                            </Text>
                          </View>
                        ) : (
                          pendingEditBusinesses.map((business) => {
                            const isExpanded = Boolean(
                              expandedAdminEdits[business.id],
                            );
                            const pendingEdits = business.pendingEdits || {};
                            const fields = Object.keys(pendingEdits).filter(
                              (field) => field !== "coordinate",
                            );
                            const resolveValue = (field, value) => {
                              if (field === "categoryKey") {
                                return getCategoryConfig(value).display;
                              }
                              return value || "--";
                            };
                            return (
                              <View key={business.id} style={styles.adminCard}>
                                <TouchableOpacity
                                  style={styles.adminHeaderRow}
                                  onPress={() =>
                                    setExpandedAdminEdits((prev) => ({
                                      ...prev,
                                      [business.id]: !prev[business.id],
                                    }))
                                  }
                                >
                                  <View style={styles.adminHeaderText}>
                                    <Text style={styles.adminTitle}>
                                      {business.name}
                                    </Text>
                                    <Text style={styles.adminMeta}>
                                      {
                                        getCategoryConfig(business.categoryKey)
                                          .display
                                      }
                                    </Text>
                                  </View>
                                  <Ionicons
                                    name={
                                      isExpanded ? "chevron-up" : "chevron-down"
                                    }
                                    size={18}
                                    color={COLORS.muted}
                                  />
                                </TouchableOpacity>
                                <Text style={styles.adminOffer}>
                                  Requested updates
                                </Text>
                                <View style={styles.pendingList}>
                                  {fields.map((field) => (
                                    <View
                                      key={field}
                                      style={styles.pendingPill}
                                    >
                                      <Text style={styles.pendingPillText}>
                                        {getPendingEditLabel(field)}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                                {isExpanded && fields.length > 0 && (
                                  <View style={styles.adminDetails}>
                                    {fields.map((field) => (
                                      <View
                                        key={field}
                                        style={styles.adminDetailRow}
                                      >
                                        <Text style={styles.adminDetailLabel}>
                                          {getPendingEditLabel(field)}
                                        </Text>
                                        <Text style={styles.adminDetailValue}>
                                          {resolveValue(field, business[field])}
                                        </Text>
                                        <Text
                                          style={styles.adminDetailValueNew}
                                        >
                                          {resolveValue(
                                            field,
                                            pendingEdits[field],
                                          )}
                                        </Text>
                                      </View>
                                    ))}
                                  </View>
                                )}
                                <View style={styles.adminActions}>
                                  <TouchableOpacity
                                    style={styles.adminApprove}
                                    onPress={() =>
                                      handleApproveEdits(business.id)
                                    }
                                  >
                                    <Text style={styles.adminActionText}>
                                      Approve edits
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.adminReject}
                                    onPress={() =>
                                      handleRejectEdits(business.id)
                                    }
                                  >
                                    <Text
                                      style={[
                                        styles.adminActionText,
                                        styles.adminActionTextDark,
                                      ]}
                                    >
                                      Reject edits
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            );
                          })
                        )}

                        <View style={styles.sectionBlock}>
                          <Text style={styles.sectionTitleAlt}>
                            Pending offers
                          </Text>
                          <Text style={styles.sectionBody}>
                            Review new offers before they appear on Discover.
                          </Text>
                        </View>

                        {pendingOfferStatus.loading && (
                          <Text style={styles.formHint}>
                            Loading pending offers...
                          </Text>
                        )}
                        {pendingOfferStatus.error && (
                          <Text style={styles.formError}>
                            {pendingOfferStatus.error}
                          </Text>
                        )}

                        {pendingOffers.length === 0 ? (
                          <View style={styles.emptyState}>
                            <Text style={styles.emptyTitle}>
                              No pending offers.
                            </Text>
                            <Text style={styles.emptyCopy}>
                              New offers will appear here for approval.
                            </Text>
                          </View>
                        ) : (
                          pendingOffers.map((offer) => {
                            const isExpanded = Boolean(
                              expandedAdminOffers[offer.id],
                            );
                            return (
                              <View key={offer.id} style={styles.adminCard}>
                                <TouchableOpacity
                                  style={styles.adminHeaderRow}
                                  onPress={() =>
                                    setExpandedAdminOffers((prev) => ({
                                      ...prev,
                                      [offer.id]: !prev[offer.id],
                                    }))
                                  }
                                >
                                  <View style={styles.adminHeaderText}>
                                    <Text style={styles.adminTitle}>
                                      {offer.title || "New offer"}
                                    </Text>
                                    <Text style={styles.adminMeta}>
                                      {offer.business?.name || "Business"}
                                    </Text>
                                  </View>
                                  <Ionicons
                                    name={
                                      isExpanded ? "chevron-up" : "chevron-down"
                                    }
                                    size={18}
                                    color={COLORS.muted}
                                  />
                                </TouchableOpacity>
                                {isExpanded && (
                                  <View style={styles.adminDetails}>
                                    {offer.description ? (
                                      <View style={styles.adminDetailRow}>
                                        <Text style={styles.adminDetailLabel}>
                                          Description
                                        </Text>
                                        <Text
                                          style={styles.adminDetailValueFull}
                                        >
                                          {offer.description}
                                        </Text>
                                      </View>
                                    ) : null}
                                    <View style={styles.adminDetailRow}>
                                      <Text style={styles.adminDetailLabel}>
                                        Offer type
                                      </Text>
                                      <Text style={styles.adminDetailValueFull}>
                                        {offer.offerType
                                          ? normalizeOfferType(offer.offerType)
                                          : "Offer"}
                                      </Text>
                                    </View>
                                    <View style={styles.adminDetailRow}>
                                      <Text style={styles.adminDetailLabel}>
                                        Created
                                      </Text>
                                      <Text style={styles.adminDetailValueFull}>
                                        {formatOfferDate(offer.createdAt)}
                                      </Text>
                                    </View>
                                  </View>
                                )}
                                <View style={styles.adminActions}>
                                  <TouchableOpacity
                                    style={styles.adminApprove}
                                    onPress={() => handleApproveOffer(offer.id)}
                                  >
                                    <Text style={styles.adminActionText}>
                                      Approve
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.adminReject}
                                    onPress={() => handleRejectOffer(offer.id)}
                                  >
                                    <Text
                                      style={[
                                        styles.adminActionText,
                                        styles.adminActionTextDark,
                                      ]}
                                    >
                                      Reject
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.adminDelete}
                                    onPress={() =>
                                      handleAdminDeleteOffer(offer)
                                    }
                                  >
                                    <Text
                                      style={[
                                        styles.adminActionText,
                                        styles.adminActionTextDark,
                                      ]}
                                    >
                                      Delete
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            );
                          })
                        )}

                        <View style={styles.sectionBlock}>
                          <Text style={styles.sectionTitleAlt}>
                            Pending businesses
                          </Text>
                          <Text style={styles.sectionBody}>
                            Review new businesses before they go live.
                          </Text>
                        </View>

                        {pendingBusinesses.length === 0 ? (
                          <View style={styles.emptyState}>
                            <Text style={styles.emptyTitle}>
                              No pending reviews.
                            </Text>
                            <Text style={styles.emptyCopy}>
                              New submissions will appear here.
                            </Text>
                          </View>
                        ) : (
                          pendingBusinesses.map((business) => {
                            const isExpanded = Boolean(
                              expandedAdminBusinesses[business.id],
                            );
                            const addressLine = [
                              business.address,
                              [
                                business.city,
                                business.state,
                                business.postalCode,
                              ]
                                .filter(Boolean)
                                .join(", "),
                            ]
                              .filter(Boolean)
                              .join(", ");
                            const tagLine = Array.isArray(business.tags)
                              ? business.tags.filter(Boolean).join(", ")
                              : "";
                            return (
                              <View key={business.id} style={styles.adminCard}>
                                <TouchableOpacity
                                  style={styles.adminHeaderRow}
                                  onPress={() =>
                                    setExpandedAdminBusinesses((prev) => ({
                                      ...prev,
                                      [business.id]: !prev[business.id],
                                    }))
                                  }
                                >
                                  <View style={styles.adminHeaderText}>
                                    <Text style={styles.adminTitle}>
                                      {business.name}
                                    </Text>
                                    <Text style={styles.adminMeta}>
                                      {
                                        getCategoryConfig(business.categoryKey)
                                          .display
                                      }
                                    </Text>
                                  </View>
                                  <Ionicons
                                    name={
                                      isExpanded ? "chevron-up" : "chevron-down"
                                    }
                                    size={18}
                                    color={COLORS.muted}
                                  />
                                </TouchableOpacity>
                                <Text style={styles.adminOffer}>
                                  {business.offer}
                                </Text>
                                {isExpanded && (
                                  <View style={styles.adminDetails}>
                                    <View style={styles.adminDetailRow}>
                                      <Text style={styles.adminDetailLabel}>
                                        Address
                                      </Text>
                                      <Text style={styles.adminDetailValueFull}>
                                        {addressLine || "--"}
                                      </Text>
                                    </View>
                                    <View style={styles.adminDetailRow}>
                                      <Text style={styles.adminDetailLabel}>
                                        Phone
                                      </Text>
                                      <Text style={styles.adminDetailValueFull}>
                                        {business.phone || "--"}
                                      </Text>
                                    </View>
                                    <View style={styles.adminDetailRow}>
                                      <Text style={styles.adminDetailLabel}>
                                        Hours
                                      </Text>
                                      <Text style={styles.adminDetailValueFull}>
                                        {business.hours || "--"}
                                      </Text>
                                    </View>
                                    <View style={styles.adminDetailRow}>
                                      <Text style={styles.adminDetailLabel}>
                                        Tags
                                      </Text>
                                      <Text style={styles.adminDetailValueFull}>
                                        {tagLine || "--"}
                                      </Text>
                                    </View>
                                    <View style={styles.adminDetailRow}>
                                      <Text style={styles.adminDetailLabel}>
                                        Submitted
                                      </Text>
                                      <Text style={styles.adminDetailValueFull}>
                                        {formatOfferDate(business.createdAt)}
                                      </Text>
                                    </View>
                                  </View>
                                )}
                                <View style={styles.adminActions}>
                                  <TouchableOpacity
                                    style={styles.adminApprove}
                                    onPress={() => handleApprove(business.id)}
                                  >
                                    <Text style={styles.adminActionText}>
                                      Approve
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.adminReject}
                                    onPress={() => handleReject(business.id)}
                                  >
                                    <Text
                                      style={[
                                        styles.adminActionText,
                                        styles.adminActionTextDark,
                                      ]}
                                    >
                                      Reject
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.adminDelete}
                                    onPress={() =>
                                      handleAdminDeleteBusiness(business)
                                    }
                                  >
                                    <Text
                                      style={[
                                        styles.adminActionText,
                                        styles.adminActionTextDark,
                                      ]}
                                    >
                                      Delete
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            );
                          })
                        )}

                        <View style={styles.sectionBlock}>
                          <Text style={styles.sectionTitleAlt}>
                            Offer management
                          </Text>
                          <Text style={styles.sectionBody}>
                            Remove offers and clean up their images.
                          </Text>
                        </View>

                        {adminOffers.length === 0 ? (
                          <View style={styles.emptyState}>
                            <Text style={styles.emptyTitle}>
                              No offers yet.
                            </Text>
                            <Text style={styles.emptyCopy}>
                              Offers will appear once businesses are active.
                            </Text>
                          </View>
                        ) : (
                          adminOffers.map((offer) => (
                            <View key={offer.id} style={styles.adminCard}>
                              <View style={styles.adminHeader}>
                                <Text style={styles.adminTitle}>
                                  {offer.title || "Offer"}
                                </Text>
                                <Text style={styles.adminMeta}>
                                  {offer.business?.name || "Business"}
                                </Text>
                              </View>
                              {offer.description ? (
                                <Text style={styles.adminOffer}>
                                  {offer.description}
                                </Text>
                              ) : null}
                              <View style={styles.adminActions}>
                                <TouchableOpacity
                                  style={styles.adminDelete}
                                  onPress={() => handleAdminDeleteOffer(offer)}
                                >
                                  <Text
                                    style={[
                                      styles.adminActionText,
                                      styles.adminActionTextDark,
                                    ]}
                                  >
                                    Delete
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          ))
                        )}

                        <View style={styles.sectionBlock}>
                          <Text style={styles.sectionTitleAlt}>
                            Business management
                          </Text>
                          <Text style={styles.sectionBody}>
                            Delete businesses and their offers when needed.
                          </Text>
                        </View>

                        {adminBusinesses.length === 0 ? (
                          <View style={styles.emptyState}>
                            <Text style={styles.emptyTitle}>
                              No businesses yet.
                            </Text>
                            <Text style={styles.emptyCopy}>
                              Approved listings will appear here.
                            </Text>
                          </View>
                        ) : (
                          adminBusinesses.map((business) => (
                            <View key={business.id} style={styles.adminCard}>
                              <View style={styles.adminHeader}>
                                <Text style={styles.adminTitle}>
                                  {business.name}
                                </Text>
                                <Text style={styles.adminMeta}>
                                  {
                                    getCategoryConfig(business.categoryKey)
                                      .display
                                  }
                                </Text>
                              </View>
                              <Text style={styles.adminOffer}>
                                {business.offer}
                              </Text>
                              <View style={styles.adminActions}>
                                <TouchableOpacity
                                  style={styles.adminDelete}
                                  onPress={() =>
                                    handleAdminDeleteBusiness(business)
                                  }
                                >
                                  <Text
                                    style={[
                                      styles.adminActionText,
                                      styles.adminActionTextDark,
                                    ]}
                                  >
                                    Delete
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          ))
                        )}

                        {isAdmin && (
                          <>
                            <View style={styles.sectionBlock}>
                              <Text style={styles.sectionTitleAlt}>
                                Supervisor access
                              </Text>
                              <Text style={styles.sectionBody}>
                                Promote teammates to review listings without
                                full admin access.
                              </Text>
                            </View>

                            <View style={styles.invitePanel}>
                              <AutoFocusInput
                                style={styles.authInput}
                                placeholder="Search by name, email, phone, or company"
                                placeholderTextColor={COLORS.muted}
                                value={supervisorSearch}
                                onChangeText={setSupervisorSearch}
                                autoCapitalize="none"
                              />
                              {profileStatus.loading && (
                                <Text style={styles.formHint}>
                                  Loading team members...
                                </Text>
                              )}
                              {profileStatus.error && (
                                <Text style={styles.formError}>
                                  {profileStatus.error}
                                </Text>
                              )}
                              {supervisorStatus.error && (
                                <Text style={styles.formError}>
                                  {supervisorStatus.error}
                                </Text>
                              )}
                              {supervisorStatus.success && (
                                <Text style={styles.formSuccess}>
                                  {supervisorStatus.success}
                                </Text>
                              )}
                              {filteredProfiles.length === 0 ? (
                                <View style={styles.emptyState}>
                                  <Text style={styles.emptyTitle}>
                                    No team members yet.
                                  </Text>
                                  <Text style={styles.emptyCopy}>
                                    New signups will appear here.
                                  </Text>
                                </View>
                              ) : (
                                <View style={styles.supervisorList}>
                                  {filteredProfiles.map((profile) => {
                                    const role = profile.role || "consumer";
                                    const displayName =
                                      profile.full_name ||
                                      profile.email ||
                                      "Member";
                                    const metaLine = [
                                      profile.email,
                                      profile.phone,
                                      profile.company,
                                    ]
                                      .filter(Boolean)
                                      .join(" - ");
                                    const isProfileAdmin = role === "admin";
                                    const isProfileSupervisor =
                                      role === "supervisor";
                                    const isProfileBusiness =
                                      role === "business_owner";
                                    return (
                                      <View
                                        key={profile.id}
                                        style={styles.supervisorRow}
                                      >
                                        <View style={styles.supervisorMeta}>
                                          <Text style={styles.supervisorName}>
                                            {displayName}
                                          </Text>
                                          {metaLine ? (
                                            <Text
                                              style={styles.supervisorDetails}
                                            >
                                              {metaLine}
                                            </Text>
                                          ) : null}
                                          <Text style={styles.supervisorRole}>
                                            {isProfileAdmin
                                              ? "Admin"
                                              : isProfileSupervisor
                                                ? "Supervisor"
                                                : "Member"}
                                          </Text>
                                        </View>
                                        {isProfileAdmin ? (
                                          <View style={styles.supervisorBadge}>
                                            <Text
                                              style={styles.supervisorBadgeText}
                                            >
                                              Admin
                                            </Text>
                                          </View>
                                        ) : (
                                          <View
                                            style={styles.supervisorActionsRow}
                                          >
                                            {isProfileBusiness ? (
                                              <View
                                                style={
                                                  styles.supervisorBadgeAlt
                                                }
                                              >
                                                <Text
                                                  style={
                                                    styles.supervisorBadgeText
                                                  }
                                                >
                                                  Business
                                                </Text>
                                              </View>
                                            ) : (
                                              <TouchableOpacity
                                                style={
                                                  styles.supervisorActionAlt
                                                }
                                                onPress={() =>
                                                  handlePromoteBusinessOwner(
                                                    profile,
                                                  )
                                                }
                                              >
                                                <Text
                                                  style={
                                                    styles.supervisorActionTextAlt
                                                  }
                                                >
                                                  Make business
                                                </Text>
                                              </TouchableOpacity>
                                            )}
                                            <TouchableOpacity
                                              style={styles.supervisorAction}
                                              onPress={() =>
                                                isProfileSupervisor
                                                  ? handleRemoveSupervisor(
                                                      profile,
                                                    )
                                                  : handlePromoteSupervisor(
                                                      profile,
                                                    )
                                              }
                                            >
                                              <Text
                                                style={
                                                  styles.supervisorActionText
                                                }
                                              >
                                                {isProfileSupervisor
                                                  ? "Remove"
                                                  : "Make supervisor"}
                                              </Text>
                                            </TouchableOpacity>
                                          </View>
                                        )}
                                      </View>
                                    );
                                  })}
                                </View>
                              )}
                            </View>
                          </>
                        )}
                      </>
                    ) : (
                      <View style={styles.emptyState}>
                        <Text style={styles.emptyTitle}>
                          Access restricted.
                        </Text>
                        <Text style={styles.emptyCopy}>
                          Switch to an authorized account to view this section.
                        </Text>
                      </View>
                    )}
                    <Modal
                      visible={viewsModalOpen}
                      transparent
                      animationType="slide"
                      onRequestClose={() => setViewsModalOpen(false)}
                    >
                      <View style={styles.modalOverlay}>
                        <View style={styles.modalCard}>
                          <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Offer views</Text>
                            <TouchableOpacity
                              style={styles.modalCloseButton}
                              onPress={() => setViewsModalOpen(false)}
                            >
                              <Ionicons
                                name="close"
                                size={18}
                                color={COLORS.ink}
                              />
                            </TouchableOpacity>
                          </View>
                          <Text style={styles.modalSubtitle}>
                            Total views: {formatMetricValue(ownerMetrics.views)}
                          </Text>
                          {viewsBreakdownStatus.loading &&
                          viewsBreakdown.length === 0 ? (
                            <Text style={styles.formHint}>
                              Loading views...
                            </Text>
                          ) : viewsBreakdownStatus.error ? (
                            <Text style={styles.formError}>
                              {viewsBreakdownStatus.error}
                            </Text>
                          ) : viewsBreakdown.length === 0 ? (
                            <View style={styles.emptyState}>
                              <Text style={styles.emptyTitle}>
                                No offers yet.
                              </Text>
                              <Text style={styles.emptyCopy}>
                                Create an offer to start tracking views.
                              </Text>
                            </View>
                          ) : (
                            <ScrollView
                              showsVerticalScrollIndicator={false}
                              contentContainerStyle={styles.modalList}
                            >
                              {viewsBreakdownStatus.loading && (
                                <Text style={styles.formHint}>
                                  Refreshing views...
                                </Text>
                              )}
                              {viewsBreakdown.map((item) => (
                                <View key={item.id} style={styles.modalRow}>
                                  <Text
                                    style={styles.modalRowTitle}
                                    numberOfLines={1}
                                  >
                                    {item.title}
                                  </Text>
                                  <Text style={styles.modalRowValue}>
                                    {item.count}
                                  </Text>
                                </View>
                              ))}
                            </ScrollView>
                          )}
                        </View>
                      </View>
                    </Modal>
                  </BottomSheetScrollView>
                </KeyboardAvoidingView>
              )}
              </View>
            </BottomSheet>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  authScreen: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  authContainer: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  authStack: {
    marginTop: 4,
    marginBottom: 12,
    gap: 16,
  },
  authCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.sand,
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  authBrand: {
    fontSize: 22,
    color: COLORS.pine,
    fontFamily: FONT_DISPLAY,
    marginBottom: 6,
  },
  authTitle: {
    fontSize: 18,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
    marginBottom: 6,
  },
  authSubtitle: {
    fontSize: 13,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 18,
    marginBottom: 14,
  },
  authInput: {
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: FONT_TEXT,
    fontSize: 14,
    color: COLORS.ink,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12,
  },
  authButton: {
    backgroundColor: COLORS.pine,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
  },
  authPrimaryButton: {
    backgroundColor: COLORS.pine,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  authButtonDisabled: {
    backgroundColor: "#9AA7B8",
  },
  authButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontFamily: FONT_MEDIUM,
  },
  authBack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  authBackText: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  timeRow: {
    flexDirection: "column",
    gap: 12,
    marginBottom: 12,
  },
  timeBlock: {
    flex: 1,
    alignItems: "flex-start",
    gap: 6,
  },
  timeLabel: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  timeInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "stretch",
    flexWrap: "wrap",
  },
  timeSelect: {
    flex: 1,
    minWidth: 140,
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.sand,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 42,
  },
  timeSelectDisabled: {
    opacity: 0.6,
  },
  timeSelectText: {
    fontSize: IS_COMPACT ? 12 : 13,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    flexShrink: 1,
  },
  timeMeridiem: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: COLORS.sand,
    borderRadius: 12,
    overflow: "hidden",
    minHeight: 42,
    width: 84,
  },
  timeMeridiemPill: {
    flex: 1,
    minWidth: 42,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
  },
  timeMeridiemPillDisabled: {
    backgroundColor: COLORS.mint,
  },
  timeMeridiemPillActive: {
    backgroundColor: COLORS.pine,
  },
  timeMeridiemText: {
    fontSize: IS_COMPACT ? 10 : 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  timeMeridiemTextDisabled: {
    color: COLORS.muted,
    opacity: 0.7,
  },
  timeMeridiemTextActive: {
    color: COLORS.white,
  },
  timePickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    padding: 20,
  },
  timePickerCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 14,
    maxHeight: SCREEN_HEIGHT * 0.6,
  },
  timePickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  timePickerTitle: {
    fontSize: 14,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  timePickerClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.mint,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  timePickerList: {
    gap: 6,
  },
  timePickerItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
  },
  timePickerText: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  authSecondaryButton: {
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  authToggleText: {
    textAlign: "center",
    marginTop: 12,
    color: COLORS.coral,
    fontSize: 12,
    fontFamily: FONT_MEDIUM,
  },
  redeemButton: {
    marginTop: 12,
    alignSelf: "stretch",
    backgroundColor: COLORS.pine,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "rgba(15, 23, 42, 0.2)",
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  redeemButtonDisabled: {
    backgroundColor: "#E1E8F1",
    borderWidth: 1,
    borderColor: COLORS.sand,
    shadowOpacity: 0,
    elevation: 0,
  },
  redeemButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: FONT_SEMIBOLD,
    letterSpacing: 0.3,
  },
  redeemButtonTextDisabled: {
    color: COLORS.muted,
  },
  directionsButton: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
    alignSelf: "stretch",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
  },
  directionsButtonPressed: {
    backgroundColor: "#E9EEF6",
    borderColor: "#C9D4E4",
    opacity: 0.92,
  },
  directionsButtonText: {
    fontSize: 12,
    color: COLORS.pine,
    fontFamily: FONT_MEDIUM,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapShade: {
    ...StyleSheet.absoluteFillObject,
  },
  topMeta: {
    position: "absolute",
    top: SAFE_TOP,
    left: IS_COMPACT ? 8 : 12,
    right: IS_COMPACT ? 8 : 12,
  },
  navContainer: {
    alignSelf: "center",
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: IS_COMPACT ? 16 : 18,
    paddingHorizontal: NAV_PADDING,
    paddingBottom: NAV_PADDING,
    paddingTop: NAV_PADDING + 6,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  navRow: {
    flexDirection: "row",
    paddingHorizontal: 2,
    paddingTop: 6,
    paddingBottom: 2,
  },
  locateRow: {
    alignItems: "flex-end",
    marginTop: IS_COMPACT ? 8 : 10,
  },
  locateButton: {
    width: IS_COMPACT ? 38 : 42,
    height: IS_COMPACT ? 38 : 42,
    borderRadius: IS_COMPACT ? 19 : 21,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  locateError: {
    marginTop: 8,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#F1D4A8",
    alignItems: "center",
    maxWidth: 180,
  },
  locateErrorText: {
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    textAlign: "center",
  },
  scannerOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    padding: 20,
  },
  scannerCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  scannerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  scannerTitle: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  scannerSubtitle: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  scannerOfferTitle: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginTop: 4,
  },
  scannerClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.mint,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  scannerFrame: {
    height: SCANNER_FRAME,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: COLORS.ink,
    justifyContent: "center",
    alignItems: "center",
  },
  scanner: {
    ...StyleSheet.absoluteFillObject,
  },
  scannerFrameOutline: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.8)",
  },
  scannerBlocked: {
    padding: 20,
    alignItems: "center",
  },
  scannerBlockedText: {
    fontSize: 12,
    color: COLORS.white,
    fontFamily: FONT_TEXT,
    textAlign: "center",
  },
  scannerDistanceText: {
    marginTop: 8,
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.9)",
    fontFamily: FONT_MEDIUM,
    textAlign: "center",
  },
  scannerStatus: {
    marginTop: 12,
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  scannerStatusText: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    textAlign: "center",
  },
  scannerActions: {
    marginTop: 12,
  },
  reviewOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    padding: 20,
  },
  reviewCard: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    gap: 12,
  },
  reviewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  reviewTitle: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  reviewSubtitle: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  reviewOffer: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginTop: 4,
  },
  reviewClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.mint,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  reviewStars: {
    flexDirection: "row",
    gap: 8,
  },
  reviewStarButton: {
    padding: 4,
  },
  reviewInput: {
    minHeight: 90,
  },
  detailOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    padding: 20,
  },
  detailCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    maxHeight: SCREEN_HEIGHT * 0.82,
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 6,
  },
  detailTitle: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  detailSubtitle: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  detailClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.mint,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  detailAddress: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    marginTop: 4,
  },
  detailHours: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  detailRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  detailRatingText: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  detailRatingCount: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  detailReviewButton: {
    marginTop: 12,
    backgroundColor: COLORS.pine,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  detailReviewButtonText: {
    color: COLORS.white,
    fontFamily: FONT_MEDIUM,
    fontSize: 12,
  },
  detailOffersSection: {
    marginTop: 16,
    gap: 12,
  },
  detailSectionTitle: {
    fontSize: 14,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  detailOfferCard: {
    borderWidth: 1,
    borderColor: COLORS.sand,
    borderRadius: 12,
    padding: 12,
    backgroundColor: COLORS.cream,
  },
  detailOfferTitle: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  detailOfferText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 4,
    lineHeight: 16,
  },
  detailOfferMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  detailOfferMeta: {
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  detailOfferImage: {
    width: "100%",
    height: 140,
    borderRadius: 10,
    marginBottom: 8,
    resizeMode: "cover",
  },
  receiptsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingTop: Platform.OS === "ios" ? 8 : 0,
  },
  receiptsTitle: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  receiptsSubtitle: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  receiptsClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.mint,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  receiptsBody: {
    marginTop: 12,
  },
  receiptsBodyContent: {
    paddingBottom: 6,
  },
  detailOfferTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  detailOfferTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: "#F4F6F9",
  },
  detailOfferTagText: {
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  detailOfferRedemption: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.pine,
    alignItems: "center",
  },
  detailOfferRedemptionDisabled: {
    backgroundColor: "#D5DDE8",
  },
  detailOfferRedemptionText: {
    fontSize: 12,
    fontFamily: FONT_MEDIUM,
    color: COLORS.white,
  },
  detailOfferDirections: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
    alignSelf: "stretch",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
  },
  detailOfferDirectionsPressed: {
    backgroundColor: "#E9EEF6",
    borderColor: "#C9D4E4",
    opacity: 0.92,
  },
  detailOfferDirectionsText: {
    fontSize: 12,
    color: COLORS.pine,
    fontFamily: FONT_MEDIUM,
  },
  detailBody: {
    marginTop: 12,
  },
  detailBodyContent: {
    paddingBottom: 20,
    gap: 16,
  },
  detailReviewList: {
    marginTop: 12,
    gap: 10,
  },
  detailReviewCard: {
    borderWidth: 1,
    borderColor: COLORS.sand,
    borderRadius: 12,
    padding: 12,
    backgroundColor: COLORS.mint,
  },
  detailReviewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  detailReviewUser: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  detailReviewTime: {
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  detailReviewStars: {
    flexDirection: "row",
    gap: 4,
    marginTop: 6,
  },
  detailReviewText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 6,
    lineHeight: 16,
  },
  confettiOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    overflow: "hidden",
  },
  confettiPiece: {
    position: "absolute",
    top: -24,
    borderRadius: 3,
    opacity: 0.85,
  },
  navPill: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 999,
    paddingVertical: IS_COMPACT ? 6 : 8,
    paddingHorizontal: Platform.select({
      ios: IS_COMPACT ? 10 : 14,
      android: IS_COMPACT ? 10 : 12,
      default: IS_COMPACT ? 12 : 16,
    }),
    borderWidth: 1,
    borderColor: COLORS.sand,
    position: "relative",
  },
  navPillSpaced: {
    marginLeft: NAV_GAP,
  },
  navPillActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine,
  },
  navPillText: {
    fontSize: Platform.select({
      ios: IS_COMPACT ? 12 : 13,
      android: IS_COMPACT ? 11 : 12,
      default: IS_COMPACT ? 12 : 13,
    }),
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
    lineHeight: Platform.select({
      ios: IS_COMPACT ? 16 : 18,
      android: IS_COMPACT ? 15 : 17,
      default: IS_COMPACT ? 16 : 18,
    }),
    textAlign: "center",
    ...Platform.select({
      android: { includeFontPadding: false },
    }),
  },
  navPillTextActive: {
    color: COLORS.white,
  },
  navPillBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#D62246",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: COLORS.white,
  },
  navPillBadgeText: {
    fontSize: 10,
    color: COLORS.white,
    fontFamily: FONT_MEDIUM,
  },
  primaryButton: {
    backgroundColor: COLORS.pine,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryButtonDisabled: {
    backgroundColor: "#AEB9C7",
  },
  primaryButtonText: {
    color: COLORS.white,
    fontFamily: FONT_DISPLAY,
    fontSize: 13,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  secondaryButtonDisabled: {
    opacity: 0.6,
  },
  secondaryButtonText: {
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    fontSize: 13,
  },
  offerUploadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
    marginBottom: 8,
  },
  offerRemoveButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: "#F4F6FA",
  },
  offerRemoveButtonText: {
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
    fontSize: 12,
  },
  offerPhotoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
    marginBottom: 8,
  },
  limitOptionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 6,
  },
  limitOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: "#F4F6FA",
  },
  limitOptionUnlimited: {
    borderColor: "rgba(92, 107, 122, 0.22)",
    backgroundColor: "rgba(92, 107, 122, 0.08)",
  },
  limitOptionUnlimitedActive: {
    borderColor: "rgba(92, 107, 122, 0.92)",
    backgroundColor: "rgba(92, 107, 122, 0.92)",
  },
  limitOptionDay: {
    borderColor: "rgba(16, 185, 129, 0.26)",
    backgroundColor: "rgba(16, 185, 129, 0.10)",
  },
  limitOptionDayActive: {
    borderColor: "#047857",
    backgroundColor: "#047857",
  },
  limitOptionWeek: {
    borderColor: "rgba(245, 158, 11, 0.28)",
    backgroundColor: "rgba(245, 158, 11, 0.12)",
  },
  limitOptionWeekActive: {
    borderColor: "#B45309",
    backgroundColor: "#B45309",
  },
  limitOptionCustom: {
    borderColor: "rgba(31, 78, 140, 0.22)",
    backgroundColor: "rgba(31, 78, 140, 0.10)",
  },
  limitOptionCustomActive: {
    borderColor: COLORS.coral,
    backgroundColor: COLORS.coral,
  },
  limitOptionActive: {
    borderColor: COLORS.pine,
    backgroundColor: COLORS.pine,
  },
  limitOptionText: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  limitOptionTextUnlimited: {
    color: COLORS.muted,
  },
  limitOptionTextDay: {
    color: "#047857",
  },
  limitOptionTextWeek: {
    color: "#B45309",
  },
  limitOptionTextCustom: {
    color: COLORS.coral,
  },
  limitOptionTextActive: {
    color: COLORS.white,
  },
  limitCustomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
    marginBottom: 4,
  },
  limitCountWrap: {
    width: 96,
  },
  limitCountInput: {
    textAlign: "center",
  },
  limitPeriodRow: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
  },
  limitPeriodOption: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
  },
  limitPeriodOptionActive: {
    borderColor: "#A7E0C6",
    backgroundColor: "#E6F5EE",
  },
  limitPeriodText: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  limitPeriodTextActive: {
    color: COLORS.ink,
  },
  offerUploadFrame: {
    width: "100%",
    aspectRatio: OFFER_IMAGE_ASPECT,
    borderRadius: 16,
    backgroundColor: "#EFF3F8",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  offerUploadFrameInteractive: {
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.12)",
  },
  offerUploadPreview: {
    width: "100%",
    height: "100%",
    borderRadius: 16,
  },
  offerUploadOverlay: {
    position: "absolute",
    right: 10,
    bottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.22)",
  },
  offerUploadOverlayText: {
    fontSize: 11,
    color: COLORS.white,
    fontFamily: FONT_MEDIUM,
  },
  offerUploadBusy: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.55)",
  },
  offerUploadPlaceholder: {
    alignItems: "center",
    paddingHorizontal: 16,
  },
  offerUploadHint: {
    marginTop: 6,
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    textAlign: "center",
    lineHeight: 16,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: SHEET_MAX,
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: IS_COMPACT ? 12 : 16,
    paddingTop: 10,
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.9,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -8 },
    elevation: 10,
    renderToHardwareTextureAndroid: true,
    shouldRasterizeIOS: true,
  },
  sheetBackground: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.9,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -8 },
    elevation: 10,
  },
  sheetBody: {
    flex: 1,
    paddingHorizontal: IS_COMPACT ? 12 : 16,
    paddingTop: 10,
  },
  sheetScroll: {
    flex: 1,
  },
  sheetScrollContent: {
    paddingBottom: 24,
  },
  sheetHandle: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 12,
  },
  handleBar: {
    width: 48,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.sand,
    marginBottom: 8,
  },
  sheetHint: {
    fontSize: IS_COMPACT ? 11 : 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_COMPACT ? 8 : 10,
    marginBottom: 12,
  },
  searchRowCompact: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  searchInput: {
    flex: 1,
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: IS_COMPACT ? 8 : 10,
    fontFamily: FONT_TEXT,
    fontSize: IS_COMPACT ? 13 : 14,
    color: COLORS.ink,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  filterButton: {
    backgroundColor: COLORS.white,
    paddingVertical: IS_COMPACT ? 8 : 10,
    paddingHorizontal: IS_COMPACT ? 12 : 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  filterButtonText: {
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    fontSize: IS_COMPACT ? 12 : 13,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  statValue: {
    fontSize: 17,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  filterPill: {
    backgroundColor: COLORS.white,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  filterPillActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine,
  },
  filterText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  filterTextActive: {
    color: COLORS.white,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  sectionMeta: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  analyticsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },
  analyticsCard: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  analyticsCardInteractive: {
    borderColor: "#D4DCE8",
  },
  analyticsValue: {
    fontSize: 18,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  analyticsLabel: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  analyticsHint: {
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 6,
  },
  paymentCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(13, 34, 56, 0.1)",
    marginBottom: 20,
  },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  paymentLabel: {
    fontSize: 14,
    fontFamily: "Rubik-Medium",
    color: COLORS.text,
  },
  paymentAmount: {
    fontSize: 14,
    fontFamily: "Rubik-SemiBold",
    color: COLORS.text,
  },
  paymentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(13, 34, 56, 0.08)",
  },
  paymentBadgeActive: {
    backgroundColor: "rgba(46, 176, 126, 0.15)",
  },
  paymentBadgeInactive: {
    backgroundColor: "rgba(255, 155, 0, 0.12)",
  },
  paymentBadgeText: {
    fontSize: 12,
    fontFamily: "Rubik-Medium",
    color: COLORS.text,
  },
  analyticsLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  analyticsInfoButton: {
    padding: 2,
  },
  analyticsTooltip: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: COLORS.mint,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  analyticsTooltipText: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    lineHeight: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.mint,
  },
  modalSubtitle: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginBottom: 12,
  },
  modalList: {
    paddingBottom: 20,
    gap: 10,
  },
  modalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.cream,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  modalRowTitle: {
    flex: 1,
    marginRight: 12,
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
  },
  modalRowValue: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  cardList: {
    paddingBottom: 16,
    paddingRight: 8,
  },
  cardShell: {
    width: CARD_WIDTH,
    marginRight: CARD_GAP,
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    minHeight: IS_SHORT ? 220 : 250,
    borderWidth: 1,
    borderColor: COLORS.sand,
    overflow: "hidden",
  },
  cardContent: {
    padding: IS_COMPACT ? 14 : 16,
    paddingBottom: IS_COMPACT ? 12 : 14,
  },
  cardSelected: {
    borderColor: COLORS.coral,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardHeaderBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardName: {
    flex: 1,
    paddingRight: 12,
    fontSize: IS_COMPACT ? 14 : 15,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  cardBadge: {
    backgroundColor: COLORS.mint,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  cardBadgeOpen: {
    backgroundColor: "#E4F3E9",
    borderColor: "#BFE1C9",
  },
  cardBadgeClosed: {
    backgroundColor: "#F7ECEC",
    borderColor: "#E5C0C0",
  },
  cardBadgeText: {
    fontSize: 10,
    color: COLORS.pine,
    fontFamily: FONT_MEDIUM,
  },
  cardCashbackBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#86EFAC",
    backgroundColor: "#DCFCE7",
  },
  cardCashbackIcon: {
    marginTop: 1,
  },
  cardCashbackText: {
    fontSize: 11,
    color: "#065F46",
    fontFamily: FONT_MEDIUM,
  },
  cardCategory: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 8,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  cardOfferTitle: {
    fontSize: IS_COMPACT ? 14 : 15,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginTop: 8,
  },
  cardOffer: {
    fontSize: IS_COMPACT ? 12 : 13,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    marginTop: 6,
    lineHeight: 20,
  },
  cardLimitBadgeTop: {
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(31, 78, 140, 0.18)",
    backgroundColor: "rgba(31, 78, 140, 0.09)",
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  cardLimitBadgeUnlimited: {
    borderColor: "rgba(92, 107, 122, 0.22)",
    backgroundColor: "rgba(92, 107, 122, 0.10)",
  },
  cardLimitBadgeOnceDay: {
    borderColor: "rgba(16, 185, 129, 0.28)",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  cardLimitBadgeMaxDay: {
    borderColor: "rgba(31, 78, 140, 0.22)",
    backgroundColor: "rgba(31, 78, 140, 0.10)",
  },
  cardLimitBadgeOnceWeek: {
    borderColor: "rgba(245, 158, 11, 0.30)",
    backgroundColor: "rgba(245, 158, 11, 0.14)",
  },
  cardLimitBadgeMaxWeek: {
    borderColor: "rgba(244, 63, 94, 0.30)",
    backgroundColor: "rgba(244, 63, 94, 0.13)",
  },
  cardLimitIcon: {
    marginRight: 6,
    marginTop: 1,
  },
  cardLimitBadgeText: {
    fontSize: 11,
    color: COLORS.coral,
    fontFamily: FONT_MEDIUM,
  },
  cardLimitTextUnlimited: {
    color: COLORS.muted,
  },
  cardLimitTextOnceDay: {
    color: "#047857",
  },
  cardLimitTextMaxDay: {
    color: COLORS.coral,
  },
  cardLimitTextOnceWeek: {
    color: "#B45309",
  },
  cardLimitTextMaxWeek: {
    color: "#BE123C",
  },
  cardMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
  },
  cardMeta: {
    fontSize: IS_COMPACT ? 10 : 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  cardMedia: {
    position: "relative",
    // Keep cards visually consistent across platforms (Android font scaling can
    // make the content section taller). Using the "content width" media height
    // prevents the card from feeling oversized and getting clipped in the sheet.
    height: CARD_MEDIA_HEIGHT,
    alignSelf: "stretch",
    backgroundColor: "#EFF3F8",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  cardMediaBadges: {
    position: "absolute",
    top: 8,
    left: 8,
    alignItems: "flex-start",
    gap: 6,
    zIndex: 2,
  },
  cardMediaOverlay: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    gap: 6,
    zIndex: 2,
  },
  cardOverlayPill: {
    shadowColor: "rgba(15, 23, 42, 0.35)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 2,
  },
  cardMediaImage: {
    width: "100%",
    height: "100%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  cardMediaLabel: {
    marginTop: 6,
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  tagPill: {
    backgroundColor: COLORS.mint,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  tagPillOverlay: {
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  tagText: {
    fontSize: 10,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
  },
  tagTextOverlay: {
    color: COLORS.ink,
  },
  tagActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
    marginBottom: 4,
  },
  tagSaveButton: {
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  tagSaveButtonDisabled: {
    opacity: 0.6,
  },
  tagSaveButtonText: {
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    fontSize: 12,
  },
  tagOptionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  tagOptionRowDisabled: {
    opacity: 0.6,
  },
  tagOptionPill: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  tagOptionPillActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine,
  },
  tagOptionPillDisabled: {
    opacity: 0.6,
  },
  tagOptionText: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  tagOptionTextActive: {
    color: COLORS.white,
  },
  emptyState: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 14,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
    marginBottom: 4,
  },
  emptyCopy: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16,
  },
  sectionBlock: {
    marginBottom: 12,
  },
  sectionTitleAlt: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
    marginBottom: 4,
  },
  cashoutTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionTitleIcon: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: "rgba(15, 23, 42, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitleTight: {
    marginBottom: 0,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sectionInfoButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
  },
  sectionBody: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16,
  },
  formCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12,
  },
  paymentCard: {
    marginTop: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.mint,
  },
  paymentHeaderRow: {
    marginBottom: 10,
  },
  paymentHeaderBadges: {
    gap: 8,
  },
  paymentActionsRow: {
    marginTop: 8,
  },
  paymentTitle: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginBottom: 4,
  },
  paymentBody: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16,
    marginBottom: 10,
  },
  infoTooltipOverlay: {
    flex: 1,
    backgroundColor: "rgba(10, 15, 25, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  infoTooltipCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.12)",
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  infoTooltipHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  infoTooltipTitle: {
    fontSize: 15,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  infoTooltipClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
  },
  infoTooltipBody: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 18,
  },
  formHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  formHeaderCopy: {
    flex: 1,
    paddingRight: 10,
  },
  formHeaderTitle: {
    fontSize: 15,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  formHeaderMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  formRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  formField: {
    flex: 1,
    minWidth: 120,
  },
  pendingNotice: {
    backgroundColor: "#FFF7E6",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#F1D4A8",
    marginBottom: 12,
  },
  pendingNoticeTitle: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginBottom: 4,
  },
  pendingNoticeBody: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16,
    marginBottom: 8,
  },
  pendingList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
    marginBottom: 6,
  },
  pendingPill: {
    backgroundColor: COLORS.white,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#E5D1B2",
  },
  pendingPillText: {
    fontSize: 10,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  profileCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  profileAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.mint,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  profileInitials: {
    fontSize: 16,
    color: COLORS.pine,
    fontFamily: FONT_DISPLAY,
  },
  profileHeaderText: {
    flex: 1,
  },
  profileName: {
    fontSize: 15,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  profileEmail: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  profileRolePill: {
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  profileRoleText: {
    fontSize: 11,
    color: COLORS.pine,
    fontFamily: FONT_MEDIUM,
  },
  roleRow: {
    marginTop: 8,
    marginBottom: 12,
  },
  rolePillRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  rolePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
  },
  rolePillActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine,
  },
  rolePillText: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  rolePillTextActive: {
    color: COLORS.white,
  },
  invitePanel: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 14,
    gap: 10,
    marginBottom: 12,
  },
  formSuccess: {
    fontSize: 12,
    color: COLORS.pine,
    fontFamily: FONT_MEDIUM,
  },
  supervisorList: {
    gap: 12,
  },
  supervisorRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  supervisorMeta: {
    flex: 1,
    paddingRight: 12,
  },
  supervisorName: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  supervisorDetails: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 4,
  },
  supervisorRole: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  supervisorAction: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.pine,
    backgroundColor: COLORS.pine,
  },
  supervisorActionText: {
    fontSize: 11,
    color: COLORS.white,
    fontFamily: FONT_MEDIUM,
  },
  supervisorActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  supervisorActionAlt: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
  },
  supervisorActionTextAlt: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  supervisorBadgeAlt: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.mint,
  },
  supervisorBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.mint,
  },
  supervisorBadgeText: {
    fontSize: 11,
    color: COLORS.pine,
    fontFamily: FONT_MEDIUM,
  },
  profileMetaRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
    marginBottom: 6,
  },
  profileMetaCard: {
    flex: 1,
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  profileMetaLabel: {
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  profileMetaValue: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginTop: 4,
  },
  formLabel: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginBottom: 6,
  },
  formInput: {
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: FONT_TEXT,
    fontSize: 13,
    color: COLORS.ink,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12,
  },
  formTextarea: {
    minHeight: 88,
  },
  formInputDisabled: {
    backgroundColor: "#EEF2F7",
    color: "#94A3B8",
  },
  editGate: {
    backgroundColor: COLORS.mint,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  editGateText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16,
  },
  editGateActive: {
    backgroundColor: "#E8F3EC",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#9AC9AE",
    padding: 12,
    marginBottom: 14,
  },
  editGateActiveText: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    lineHeight: 16,
  },
  formHint: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginBottom: 12,
  },
  notificationPanel: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 14,
    gap: 8,
    marginBottom: 16,
  },
  promoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 2,
  },
  promoHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  promoActivePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(15, 118, 110, 0.22)",
    backgroundColor: "rgba(15, 118, 110, 0.10)",
    maxWidth: 160,
  },
  promoActivePillText: {
    fontSize: 11,
    color: COLORS.pine,
    fontFamily: FONT_MEDIUM,
  },
  promoRatePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(31, 78, 140, 0.18)",
    backgroundColor: "rgba(31, 78, 140, 0.08)",
  },
  promoRateText: {
    fontSize: 12,
    color: COLORS.pine,
    fontFamily: FONT_MEDIUM,
  },
  promoHint: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16,
    marginBottom: 6,
  },
  promoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  promoInput: {
    flex: 1,
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: FONT_TEXT,
    fontSize: 13,
    color: COLORS.ink,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  promoApplyButton: {
    backgroundColor: COLORS.pine,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 84,
  },
  promoApplyText: {
    fontSize: 12,
    color: COLORS.white,
    fontFamily: FONT_MEDIUM,
  },
  promoActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
  },
  promoClearButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
  },
  promoClearText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  promoSuccess: {
    fontSize: 11,
    color: "#047857",
    fontFamily: FONT_MEDIUM,
    marginTop: 8,
  },
  notificationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  notificationLabel: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  notificationHelp: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 8,
  },
  pushTokenRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  pushTokenTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  pushTokenLabel: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  pushTokenValue: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 15,
  },
  pushTokenCopyButton: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 72,
  },
  pushTokenCopyButtonDisabled: {
    opacity: 0.55,
  },
  pushTokenCopyText: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  pushTokenRefreshButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pushTokenRefreshText: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  remoteNotice: {
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  remoteNoticeText: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    textAlign: "center",
  },
  offerList: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 12,
    gap: 12,
    marginBottom: 16,
  },
  receiptList: {
    gap: 12,
    marginBottom: 16,
  },
  receiptOfferCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 12,
    gap: 10,
  },
  receiptOfferHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  receiptOfferMeta: {
    flex: 1,
  },
  receiptOfferTitle: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  receiptOfferSub: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 4,
  },
  receiptSectionTitle: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginBottom: 8,
    marginTop: 4,
  },
  receiptTileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  receiptTile: {
    width: "48%",
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.mint,
    padding: 8,
    justifyContent: "flex-start",
  },
  receiptThumbWrap: {
    width: "100%",
    height: 64,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: COLORS.cream,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 6,
  },
  receiptThumb: {
    width: "100%",
    height: "100%",
  },
  receiptThumbPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  redeemTile: {
    justifyContent: "space-between",
  },
  redeemTileBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#FFF1F2",
    borderWidth: 1,
    borderColor: "#F3C2C7",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  redeemTileBadgeText: {
    fontSize: 10,
    color: "#B42318",
    fontFamily: FONT_MEDIUM,
  },
  receiptTileDisabled: {
    opacity: 0.6,
  },
  receiptTileDate: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    textAlign: "left",
  },
  receiptTileTime: {
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 4,
    textAlign: "left",
  },
  receiptsScreen: {
    flex: 1,
    backgroundColor: COLORS.cream,
    padding: 16,
  },
  editOfferScreen: {
    flex: 1,
    backgroundColor: COLORS.cream,
    padding: 16,
  },
  editOfferHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  editOfferTitle: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  editOfferSubtitle: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 6,
    marginBottom: 12,
  },
  editOfferBody: {
    flex: 1,
  },
  editOfferBodyContent: {
    paddingBottom: 24,
  },
  receiptPreviewOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    backgroundColor: "rgba(15, 23, 42, 0.7)",
    justifyContent: "center",
    padding: 12,
  },
  receiptPreviewCard: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    width: "100%",
    maxWidth: RECEIPT_PREVIEW_WIDTH,
    maxHeight: RECEIPT_PREVIEW_HEIGHT + 92,
    alignSelf: "center",
  },
  receiptPreviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  receiptPreviewHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  receiptPreviewReset: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  receiptPreviewTitle: {
    fontSize: 15,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  receiptPreviewMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  receiptPreviewImage: {
    width: "100%",
    height: "100%",
    backgroundColor: "#EFF3F8",
  },
  receiptZoomWrap: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  receiptPreviewViewport: {
    width: "100%",
    height: RECEIPT_PREVIEW_HEIGHT,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#0B1220",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.12)",
  },
  receiptPreviewContent: {
    alignSelf: "center",
    justifyContent: "center",
    backgroundColor: "#EFF3F8",
    borderRadius: 12,
    overflow: "hidden",
  },
  receiptPreviewPlaceholder: {
    width: "100%",
    height: RECEIPT_PREVIEW_HEIGHT,
    borderRadius: 14,
    backgroundColor: "#EFF3F8",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  receiptPreviewPlaceholderText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  receiptNoticeCard: {
    backgroundColor: "#FFF7E6",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#F1D4A8",
    padding: 12,
    marginBottom: 12,
  },
  receiptNoticeTitle: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginBottom: 4,
  },
  receiptNoticeBody: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16,
  },
  receiptNoticeMeta: {
    marginTop: 8,
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  receiptNoticeMetaError: {
    marginTop: 6,
    fontSize: 11,
    color: "#B42318",
    fontFamily: FONT_MEDIUM,
  },
  receiptNoticeActionRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  receiptNoticeLinkButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(29, 78, 216, 0.25)",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#EFF6FF",
  },
  receiptNoticeLinkButtonSecondary: {
    backgroundColor: "#F8FAFC",
    borderColor: "rgba(100, 116, 139, 0.3)",
  },
  receiptNoticeLinkButtonText: {
    fontSize: 11,
    color: "#1D4ED8",
    fontFamily: FONT_MEDIUM,
  },
  noticeOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    padding: 20,
  },
  noticeCard: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  noticeTitle: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
    marginBottom: 6,
  },
  noticeBody: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 18,
  },
  noticeActions: {
    marginTop: 12,
  },
  verificationPromptActions: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  uploadOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.52)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  uploadCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  uploadIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#EEF2F7",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  uploadCopy: {
    flex: 1,
    marginLeft: 12,
  },
  uploadTitle: {
    fontSize: 14,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  uploadMessage: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 18,
  },
  historyList: {
    gap: 12,
    marginBottom: 12,
  },
  historyGroupCard: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.sand,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  historyGroupAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  historyGroupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  historyGroupHeaderPressed: {
    backgroundColor: "rgba(2, 6, 23, 0.03)",
  },
  historyGroupHeaderLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 0,
  },
  historyGroupAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  historyGroupAvatarText: {
    fontSize: 13,
    fontFamily: FONT_BOLD,
    letterSpacing: 0.4,
  },
  historyGroupMeta: {
    flex: 1,
  },
  historyGroupTitle: {
    flex: 1,
    fontSize: 15,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  historyGroupSubRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  historyGroupSub: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  historyGroupActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  historyGroupChevron: {
    width: 28,
    height: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
  },
  historyReviewBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#D62246",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  historyReviewBadgeText: {
    fontSize: 10,
    color: COLORS.white,
    fontFamily: FONT_MEDIUM,
  },
  historyEntries: {
    borderTopWidth: 1,
    borderTopColor: COLORS.sand,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 12,
    gap: 10,
  },
  historySection: {
    gap: 8,
  },
  historySectionTitle: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    letterSpacing: 0.2,
  },
  historySectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  historySectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  historySectionCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.7)",
  },
  historySectionCountText: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  historyReviewButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: "#FFF7E6",
  },
  historyReviewButtonPressed: {
    transform: [{ scale: 0.99 }],
    opacity: 0.96,
  },
  historyReviewButtonLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  historyReviewIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  historyReviewText: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  historyReviewSubtext: {
    marginTop: 2,
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  pointsCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 14,
    backgroundColor: COLORS.mint,
    marginBottom: 12,
  },
  pointsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  pointsLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pointsLabel: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  pointsValue: {
    fontSize: 18,
    color: COLORS.ink,
    fontFamily: FONT_BOLD,
  },
  pointsMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  cashoutAmountGroup: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(15, 23, 42, 0.08)",
  },
  cashoutAmountHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  cashoutAmountTitle: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  cashoutAmountMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  cashoutAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
  },
  cashoutAmountField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  cashoutAmountPrefix: {
    fontSize: 13,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
    marginRight: 8,
  },
  cashoutAmountInput: {
    flex: 1,
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    padding: 0,
  },
  cashoutAmountMaxButton: {
    marginLeft: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
  },
  cashoutAmountMaxText: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  cashoutAmountHint: {
    marginTop: 8,
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  cashoutStatusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  cashoutPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#EEF2F7",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  cashoutPillActive: {
    backgroundColor: "#DFF4E9",
    borderColor: "rgba(20, 83, 45, 0.15)",
  },
  cashoutPillMuted: {
    backgroundColor: "#EEF2F7",
    borderColor: "rgba(15, 23, 42, 0.08)",
  },
  cashoutPillText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  cashoutPillTextActive: {
    color: COLORS.ink,
  },
  cashoutStatusHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  cashoutStatusText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  cashoutErrorText: {
    marginTop: 8,
    fontSize: 11,
    color: "#B42318",
    fontFamily: FONT_MEDIUM,
  },
  cashoutSuccessText: {
    marginTop: 8,
    fontSize: 11,
    color: COLORS.pine,
    fontFamily: FONT_MEDIUM,
  },
  cashoutButtonStack: {
    marginTop: 14,
    gap: 10,
  },
  historyEntry: {
    position: "relative",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.mint,
  },
  historyEntryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  historyEntryMain: {
    flex: 1,
  },
  historyEntryTitle: {
    flex: 1,
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  historyEntrySubtitle: {
    marginTop: 4,
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16,
  },
  historyEntryTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  historyEntryTime: {
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  historyEntryMeta: {
    alignItems: "flex-end",
    gap: 4,
  },
  historyCashbackPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
    maxWidth: 240,
  },
  historyCashbackPillEarned: {
    borderColor: "#A7F3D0",
    backgroundColor: "#ECFDF5",
  },
  historyCashbackPillPending: {
    borderColor: COLORS.sand,
    backgroundColor: "#F8FAFC",
  },
  historyCashbackPillReversed: {
    borderColor: "#FECDCA",
    backgroundColor: "#FFFBFA",
  },
  historyCashbackPillText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  historyCashbackPillTextEarned: {
    color: "#047857",
  },
  historyCashbackPillTextReversed: {
    color: "#B42318",
  },
  historyFlagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  historyUploadHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  historyUploadHintText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  historyVerificationText: {
    marginTop: 8,
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16,
  },
  historyFlagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: COLORS.white,
    borderColor: COLORS.sand,
  },
  historyFlagChipWarn: {
    backgroundColor: "#FFF7E6",
    borderColor: "rgba(146, 64, 14, 0.2)",
  },
  historyFlagChipInfo: {
    backgroundColor: "#EFF6FF",
    borderColor: "rgba(29, 78, 216, 0.18)",
  },
  historyFlagChipDanger: {
    backgroundColor: "#FFFBFA",
    borderColor: "rgba(180, 35, 24, 0.2)",
  },
  historyFlagChipText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  historyFlagChipTextWarn: {
    color: "#92400E",
  },
  historyFlagChipTextInfo: {
    color: "#1D4ED8",
  },
  historyFlagChipTextDanger: {
    color: "#B42318",
  },
  historyEntryPending: {
    fontSize: 10,
    color: "#B42318",
    fontFamily: FONT_MEDIUM,
    marginTop: 4,
  },
  historyEntryDescription: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 6,
    lineHeight: 16,
  },
  historyReceiptBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#F97316",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  historyReceiptBadgeText: {
    fontSize: 10,
    color: COLORS.white,
    fontFamily: FONT_MEDIUM,
  },
  receiptUploadButton: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
    alignSelf: "flex-start",
  },
  receiptUploadButtonDisabled: {
    opacity: 0.6,
  },
  receiptUploadButtonText: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  historyReceiptUploadButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  historyActionRow: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  historyVerifyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  historyVerifyButtonText: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  historyReceiptUploadButtonText: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  offerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 12,
  },
  ownerOfferCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
    overflow: "hidden",
  },
  ownerOfferHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  ownerOfferBody: {
    borderTopWidth: 1,
    borderColor: COLORS.sand,
    padding: 12,
    gap: 8,
  },
  ownerOfferImagePlaceholder: {
    width: "100%",
    height: 140,
    borderRadius: 10,
    backgroundColor: "#EFF3F8",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 8,
  },
  offerMeta: {
    flex: 1,
  },
  offerTitle: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  offerDescription: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 6,
    lineHeight: 16,
  },
  offerStatus: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 8,
  },
  offerActions: {
    alignItems: "flex-end",
    gap: 8,
  },
  offerActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  offerAction: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.pine,
    backgroundColor: COLORS.pine,
  },
  offerActionDisabled: {
    backgroundColor: "#B7C3D3",
    borderColor: "#B7C3D3",
  },
  offerActionText: {
    fontSize: 11,
    color: COLORS.white,
    fontFamily: FONT_MEDIUM,
  },
  offerActionGhost: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
  },
  offerActionTextGhost: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  formError: {
    fontSize: 11,
    color: "#B42318",
    fontFamily: FONT_TEXT,
    marginBottom: 12,
  },
  suggestionList: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12,
    overflow: "hidden",
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.sand,
  },
  suggestionTitle: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  suggestionSubtitle: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  formActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
  },
  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  categoryChip: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.sand,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  categoryChipDisabled: {
    backgroundColor: "#EEF2F7",
    borderColor: "#D6DEE8",
  },
  categoryChipActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine,
  },
  categoryChipText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  categoryChipTextDisabled: {
    color: "#9AA7B8",
  },
  categoryChipTextActive: {
    color: COLORS.white,
  },
  planRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  },
  planOption: {
    width: "48%",
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  planOptionActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine,
  },
  planOptionDisabled: {
    backgroundColor: "#EEF2F7",
    borderColor: "#D6DEE8",
  },
  planOptionName: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginBottom: 4,
  },
  planOptionNameActive: {
    color: COLORS.white,
  },
  planOptionPrice: {
    fontSize: 14,
    color: COLORS.ink,
    fontFamily: FONT_BOLD,
    marginBottom: 6,
  },
  planOptionPriceActive: {
    color: COLORS.white,
  },
  planOptionDesc: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 15,
  },
  planOptionDescActive: {
    color: "rgba(255, 255, 255, 0.8)",
  },
  planOptionTextDisabled: {
    color: "#9AA7B8",
  },
  planOptionBadge: {
    marginTop: 8,
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  alertBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  alertSuccess: {
    backgroundColor: "#E8F3EC",
    borderColor: "#9AC9AE",
  },
  alertError: {
    backgroundColor: "#F8E7E7",
    borderColor: "#E3A2A2",
  },
  alertText: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
  },
  submissionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  submissionTitle: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  submissionMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  statusPill: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPending: {
    backgroundColor: "#F2E8D5",
  },
  statusApproved: {
    backgroundColor: "#DDEBE2",
  },
  statusRejected: {
    backgroundColor: "#F5DDDD",
  },
  statusText: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  adminSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  adminCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12,
  },
  adminHeader: {
    marginBottom: 6,
  },
  adminHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    gap: 12,
  },
  adminHeaderText: {
    flex: 1,
  },
  adminTitle: {
    fontSize: 14,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  adminMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  adminOffer: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    marginBottom: 10,
  },
  adminDetails: {
    borderTopWidth: 1,
    borderColor: COLORS.sand,
    paddingTop: 10,
    marginTop: 6,
    marginBottom: 10,
  },
  adminDetailRow: {
    marginBottom: 10,
  },
  adminDetailLabel: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  adminDetailValue: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    marginBottom: 2,
  },
  adminDetailValueNew: {
    fontSize: 13,
    color: COLORS.pine,
    fontFamily: FONT_MEDIUM,
  },
  adminDetailValueFull: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    lineHeight: 18,
  },
  adminActions: {
    flexDirection: "row",
    gap: 8,
  },
  qrCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12,
  },
  qrHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  qrHeaderText: {
    flex: 1,
    paddingRight: 12,
  },
  qrTitle: {
    fontSize: 14,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
  },
  qrMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2,
  },
  qrBody: {
    marginTop: 12,
    alignItems: "center",
  },
  qrCodeWrap: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
  },
  qrImage: {
    width: QR_SIZE,
    height: QR_SIZE,
  },
  qrFallback: {
    width: QR_SIZE,
    height: QR_SIZE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.mint,
  },
  qrFallbackText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  qrCodeLabel: {
    marginTop: 10,
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
  },
  qrCodeNote: {
    marginTop: 6,
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    textAlign: "center",
  },
  qrModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    padding: 20,
  },
  qrModalCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  qrModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  qrModalActions: {
    marginTop: 16,
    gap: 8,
  },
  adminApprove: {
    flex: 1,
    backgroundColor: COLORS.pine,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  adminReject: {
    flex: 1,
    backgroundColor: COLORS.white,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    alignItems: "center",
  },
  adminDelete: {
    flex: 1,
    backgroundColor: "#FFECEC",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#F5B3B3",
    alignItems: "center",
  },
  adminActionText: {
    fontSize: 12,
    color: COLORS.white,
    fontFamily: FONT_MEDIUM,
  },
  adminActionTextDark: {
    color: COLORS.ink,
  },
  planStrip: {
    marginTop: 4,
    backgroundColor: COLORS.mint,
    borderRadius: 18,
    padding: IS_COMPACT ? 12 : 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: COLORS.sand,
  },
  planStripCompact: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 10,
  },
  planTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  planTitle: {
    color: COLORS.ink,
    fontSize: IS_COMPACT ? 12 : 13,
    fontFamily: FONT_MEDIUM,
    marginBottom: 4,
  },
  planCopy: {
    color: COLORS.muted,
    fontSize: IS_COMPACT ? 11 : 12,
    fontFamily: FONT_TEXT,
    lineHeight: 16,
  },
  planButton: {
    backgroundColor: COLORS.pine,
    paddingHorizontal: IS_COMPACT ? 12 : 14,
    paddingVertical: IS_COMPACT ? 8 : 10,
    borderRadius: 12,
  },
  planButtonCompact: {
    alignSelf: "stretch",
    alignItems: "center",
  },
  planButtonText: {
    color: COLORS.white,
    fontSize: IS_COMPACT ? 11 : 12,
    fontFamily: FONT_MEDIUM,
  },
  markerWrap: {
    width: 52,
    height: 62,
    alignItems: "center",
    justifyContent: "flex-start",
    overflow: "visible",
  },
  markerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  markerIconSelected: {
    borderColor: COLORS.white,
  },
  markerPointerWrap: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -4,
  },
  markerPointer: {
    width: 10,
    height: 10,
    borderRadius: 2,
    transform: [{ rotate: "45deg" }],
  },
});
