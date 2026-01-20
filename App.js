import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { LinearGradient } from "expo-linear-gradient";
import * as Font from "expo-font";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { toByteArray } from "base64-js";
import * as Location from "expo-location";
import QRCode from "qrcode";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { supabase } from "./lib/supabase";

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
const COLLAPSED_Y = SHEET_MAX - SHEET_MIN;
const SAFE_TOP =
  Platform.OS === "android"
    ? (StatusBar.currentHeight || 0) + (IS_COMPACT ? 8 : 12)
    : IS_COMPACT
      ? 8
      : 12;
const CARD_WIDTH = Math.min(280, Math.max(210, Math.round(SCREEN_WIDTH * 0.7)));
const CARD_GAP = Math.round(Math.max(10, SCREEN_WIDTH * 0.03));
const OFFER_IMAGE_ASPECT = 2 / 1;
const CARD_MEDIA_HEIGHT = Math.round(
  (CARD_WIDTH - (IS_COMPACT ? 28 : 32)) / OFFER_IMAGE_ASPECT,
);
const QR_SIZE = Math.min(200, Math.max(130, Math.round(SCREEN_WIDTH * 0.42)));
const SCANNER_FRAME = Math.min(
  300,
  Math.max(210, Math.round(SCREEN_HEIGHT * 0.32)),
);
const SCANNER_CARD_WIDTH = Math.max(280, SCREEN_WIDTH - 40);
const SCANNER_CARD_HEIGHT = SCANNER_FRAME + (IS_COMPACT ? 160 : 180);
const REDEEM_RADIUS_METERS = 150;
const REDEEM_BLOCKED_MESSAGE = "You need to be in store to redeem.";
const NEW_WINDOW_MS = 1000 * 60 * 60 * 24 * 10;
const ADDRESS_DEBOUNCE_MS = 300;
const GOOGLE_PLACES_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
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

function ConfettiDrizzle({ active, width, height }) {
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
    <View style={styles.confettiOverlay} pointerEvents="none">
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
    subscription: "Starter $50/mo",
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
    subscription: "Starter $50/mo",
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
    subscription: "Starter $50/mo",
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
    subscription: "Starter $50/mo",
    rating: 4.7,
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
    subscription: "Starter $50/mo",
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
    subscription: "Starter $50/mo",
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
    subscription: "Starter $50/mo",
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
    subscription: "Starter $50/mo",
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
const BUSINESS_QR_IMAGES = {
  1: require("./assets/qr/wello-1.png"),
  2: require("./assets/qr/wello-2.png"),
  3: require("./assets/qr/wello-3.png"),
  4: require("./assets/qr/wello-4.png"),
  5: require("./assets/qr/wello-5.png"),
  6: require("./assets/qr/wello-6.png"),
  7: require("./assets/qr/wello-7.png"),
  8: require("./assets/qr/wello-8.png"),
};

const MAP_REGION = {
  latitude: 40.7128,
  longitude: -74.006,
  latitudeDelta: 0.055,
  longitudeDelta: 0.045,
};

const formatSubscription = (plan, priceCents) => {
  if (!plan && (priceCents === null || priceCents === undefined)) {
    return "Starter $50/mo";
  }
  if (plan && Number.isFinite(Number(priceCents))) {
    const dollars = Math.round(Number(priceCents) / 100);
    return `${plan} $${dollars}/mo`;
  }
  if (plan) return plan;
  if (Number.isFinite(Number(priceCents))) {
    const dollars = Math.round(Number(priceCents) / 100);
    return `$${dollars}/mo`;
  }
  return "Starter $50/mo";
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
    subscription: formatSubscription(
      row.subscription_plan,
      row.subscription_price_cents,
    ),
    rating: 4.7,
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
  return `${dateLabel} · ${timeLabel}`;
};

const formatOfferDate = (value) => {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return date.toLocaleDateString();
};

const formatBusinessHours = (startTime, startMeridiem, endTime, endMeridiem) =>
  `${startTime} ${startMeridiem} - ${endTime} ${endMeridiem}`;

const parseBusinessHours = (value) => {
  if (!value) return null;
  const parts = String(value).split(" - ");
  if (parts.length !== 2) return null;
  const parsePart = (part) => {
    const [time, meridiem] = part.trim().split(" ");
    if (!time) return null;
    return {
      time,
      meridiem: meridiem || "AM",
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

const FILTERS = [
  { key: "open", label: "Open now" },
  { key: "top", label: "Top rated" },
  { key: "new", label: "New offers" },
  { key: "family", label: "Family friendly" },
];

const CATEGORY_OPTIONS = [
  { key: "cafe", label: "Cafes" },
  { key: "drink", label: "Drinks" },
  { key: "restaurant", label: "Restaurants/Food" },
  { key: "barbersalon", label: "Barbershops/Salons" },
  { key: "activity", label: "Activities/Entertainment" },
  { key: "auto", label: "Carwash/Auto Cosmetic" },
];

const PLAN_OPTIONS = [
  {
    key: "starter",
    label: "Starter",
    price: "$50/mo",
    desc: "Map listing and offers",
    enabled: true,
  },
  {
    key: "growth",
    label: "Growth",
    price: "$75/mo",
    desc: "Priority placement + insights",
    enabled: false,
  },
  {
    key: "premium",
    label: "Premium",
    price: "$99/mo",
    desc: "Featured badge + campaigns",
    enabled: false,
  },
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
    display: "Refreshment Studio",
    icon: "cup",
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
    icon: "scissors",
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
    icon: "car-wash",
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

function getPlanKeyFromSubscription(subscription = "") {
  const lower = subscription.toLowerCase();
  if (lower.includes("premium")) return "premium";
  if (lower.includes("growth")) return "growth";
  return "starter";
}

function buildQrHash(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36).toUpperCase();
}

function getBusinessQrCode(business) {
  if (!business) return "";
  const base = `${business.id}|${business.name || ""}|${business.categoryKey || ""}`;
  const hash = buildQrHash(base).slice(0, 8);
  return business.qrCode || `WELLO-${business.id}-${hash}`;
}

const OFFER_IMAGE_BUCKET = "offer-images";

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

function OfferCard({ item, onPress, onRedeem, selected }) {
  const category = getCategoryConfig(item.categoryKey);
  const ratingLabel =
    item.rating && Number.isFinite(item.rating)
      ? item.rating.toFixed(1)
      : "New";
  const offerTitle = item.offerTitle || item.offer;
  const offerDescription = item.offerDescription || "";
  const hoursValue = item.hours || item.business?.hours || "";
  const openFromHours = isBusinessOpenNow(hoursValue);
  const isOpen =
    openFromHours === null
      ? (item.isOpen ?? item.business?.isOpen ?? true)
      : openFromHours;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const visibleTags = tags.slice(0, 2);
  const extraTagCount = tags.length - visibleTags.length;
  return (
    <View style={styles.cardShell}>
      <TouchableOpacity
        style={[styles.card, selected && styles.cardSelected]}
        onPress={onPress}
        activeOpacity={0.85}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardName} numberOfLines={1}>
            {item.name}
          </Text>
          {isOpen && (
            <View style={[styles.cardBadge, styles.cardBadgeOpen]}>
              <Text style={styles.cardBadgeText}>Open</Text>
            </View>
          )}
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
          style={[styles.redeemButton, !isOpen && styles.redeemButtonDisabled]}
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
        <View style={styles.cardMetaRow}>
          <Text style={styles.cardMeta}>{item.distance || "--"}</Text>
          <Text style={styles.cardMeta}>Rating {ratingLabel}</Text>
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
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpError, setSignUpError] = useState(null);
  const [businessEmail, setBusinessEmail] = useState("");
  const [businessPassword, setBusinessPassword] = useState("");
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
  const [accountRole, setAccountRole] = useState("consumer");
  const [authUserId, setAuthUserId] = useState(null);
  const [authBusinessDraft, setAuthBusinessDraft] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerBusiness, setScannerBusiness] = useState(null);
  const [scannerOffer, setScannerOffer] = useState(null);
  const [scannerStatus, setScannerStatus] = useState(null);
  const [scannerEnabled, setScannerEnabled] = useState(true);
  const [redeemGate, setRedeemGate] = useState({
    allowed: true,
    reason: null,
    distanceMeters: null,
  });
  const [redeemGateBusy, setRedeemGateBusy] = useState(false);
  const redemptionLoggedRef = useRef(false);
  const [qrExpandedId, setQrExpandedId] = useState(null);
  const [qrImageMap, setQrImageMap] = useState({});
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
  const lastLocationHashRef = useRef("");
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
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
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
    planKey: "starter",
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
  const [paymentMessage, setPaymentMessage] = useState(null);
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
  });
  const [offerImage, setOfferImage] = useState(null);
  const [offerImageStatus, setOfferImageStatus] = useState({
    uploading: false,
    error: null,
  });
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerError, setOfferError] = useState(null);
  const [formMessage, setFormMessage] = useState(null);
  const [addressResults, setAddressResults] = useState([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState(null);
  const addressRequestRef = useRef(0);
  const addressSelectionRef = useRef(false);
  const translateY = useRef(new Animated.Value(COLLAPSED_Y)).current;
  const translateYRef = useRef(COLLAPSED_Y);
  const dragStart = useRef(COLLAPSED_Y);

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
      const { error: upsertError } = await supabase.from("profiles").upsert({
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
    console.log("Wello role hydrate:", {
      email: profileEmailValue,
      role: nextRole,
      profileFound: Boolean(data),
    });
    return nextRole;
  }, []);

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

  useEffect(() => {
    let isMounted = true;
    const loadSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        if (!isMounted) return;
        if (session?.user) {
          await hydrateProfile(session.user);
          setIsSignedIn(true);
        } else {
          setIsSignedIn(false);
          setAccountRole("consumer");
        }
      } catch (error) {
        if (isMounted) {
          setIsSignedIn(false);
          setAccountRole("consumer");
        }
      } finally {
        if (isMounted) setSessionReady(true);
      }
    };
    loadSession();
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!isMounted) return;
        if (session?.user) {
          await hydrateProfile(session.user);
          setIsSignedIn(true);
        } else {
          setIsSignedIn(false);
          setAccountRole("consumer");
        }
      },
    );
    return () => {
      isMounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [hydrateProfile]);

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

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    let isMounted = true;
    const loadRemoteBusinesses = async () => {
      setRemoteStatus({ loading: true, error: null });
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
            "subscription_plan",
            "subscription_price_cents",
            "qr_code",
            "is_open",
            "approval_status",
            "status",
            "created_at",
          ].join(","),
        )
        .order("created_at", { ascending: false });

      if (!isMounted) return;
      if (error) {
        setRemoteStatus({
          loading: false,
          error: error.message || "Unable to load businesses.",
        });
        return;
      }

      if (Array.isArray(data) && data.length) {
        const mapped = data.map(mapSupabaseBusiness);
        setBusinesses(mapped);
        hydrateBusinessCoordinates(mapped);
      }
      setRemoteStatus({ loading: false, error: null });
    };

    loadRemoteBusinesses();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    loadRemoteOffers();
  }, [loadRemoteOffers]);

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const intervalId = setInterval(() => {
      loadRemoteOffers({ silent: true });
      if (ownerBusiness?.id) {
        loadOwnerOffers(ownerBusiness.id);
      }
    }, OFFERS_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [loadRemoteOffers, loadOwnerOffers, ownerBusiness?.id]);

  useEffect(() => {
    if (!ownerBusiness?.id) return;
    loadOwnerOffers(ownerBusiness.id);
  }, [ownerBusiness?.id, loadOwnerOffers]);

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

  useEffect(() => {
    const id = translateY.addListener(({ value }) => {
      translateYRef.current = value;
    });
    return () => translateY.removeListener(id);
  }, [translateY]);

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

  const filterPredicates = useMemo(
    () => ({
      open: (business) => business.isOpen,
      top: (business) => business.rating && business.rating >= 4.7,
      new: (business) =>
        business.createdAt && Date.now() - business.createdAt <= NEW_WINDOW_MS,
      family: (business) => business.tags.includes("family"),
    }),
    [],
  );

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
  const offersByBusiness = useMemo(() => {
    const map = new Map();
    publicOffers.forEach((offer) => {
      if (!map.has(offer.businessId)) {
        map.set(offer.businessId, []);
      }
      map.get(offer.businessId).push(offer);
    });
    return map;
  }, [publicOffers]);

  const filteredBusinesses = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const baseList = approvedBusinesses.filter((business) =>
      activeFilters.every((filterKey) =>
        filterPredicates[filterKey]
          ? filterPredicates[filterKey](business)
          : true,
      ),
    );
    if (!trimmed) return baseList;
    return baseList.filter((business) => {
      const offerText = (offersByBusiness.get(business.id) || [])
        .map((offer) => `${offer.title} ${offer.description}`)
        .join(" ")
        .toLowerCase();
      const haystack = [
        business.name,
        business.category,
        business.offer,
        business.subscription,
        business.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmed) || offerText.includes(trimmed);
    });
  }, [
    query,
    approvedBusinesses,
    activeFilters,
    filterPredicates,
    offersByBusiness,
  ]);

  const offerCards = useMemo(() => {
    const businessMap = new Map(
      businesses.map((business) => [business.id, business]),
    );
    return publicOffers
      .map((offer) => {
        const business = offer.business || businessMap.get(offer.businessId);
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
          subscription:
            business.subscription ||
            formatSubscription(
              business.subscription_plan,
              business.subscription_price_cents,
            ) ||
            "Starter $50/mo",
          rating: business.rating || 4.7,
          tags: business.tags || [],
          imageUrl: offer.imageUrl,
          searchText,
        };
      })
      .filter(Boolean);
  }, [publicOffers, businesses]);

  const filteredOfferCards = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const visibleBusinessIds = new Set(
      filteredBusinesses.map((business) => business.id),
    );
    return offerCards.filter((card) => {
      if (!visibleBusinessIds.has(card.businessId)) return false;
      if (!trimmed) return true;
      return card.searchText.includes(trimmed);
    });
  }, [offerCards, filteredBusinesses, query]);

  const ownerOffers = useMemo(() => {
    if (!ownerBusiness?.id) return [];
    return offers.filter((offer) => offer.businessId === ownerBusiness.id);
  }, [offers, ownerBusiness?.id]);
  const offerTypeSuggestion = normalizeOfferType(offerForm.type);
  const showOfferTypeSuggestion =
    offerForm.type &&
    offerTypeSuggestion &&
    offerTypeSuggestion.toLowerCase() !== offerForm.type.trim().toLowerCase();

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
  const canRequestEdits =
    Boolean(ownerBusiness) && !ownerBusiness?.pendingEdits;
  const canEditBusiness = isEditingBusiness && !ownerBusiness?.pendingEdits;

  const ownerMetrics = useMemo(() => {
    if (!ownerBusiness) return DEFAULT_ANALYTICS;
    return BUSINESS_ANALYTICS[ownerBusiness.id] || DEFAULT_ANALYTICS;
  }, [ownerBusiness]);

  const pendingEditBusinesses = useMemo(
    () => businesses.filter((business) => business.pendingEdits),
    [businesses],
  );
  const isAdmin = accountRole === "admin";
  const isSupervisor = accountRole === "supervisor";
  const isOwner = accountRole === "business_owner";
  const isStaff = isAdmin || isSupervisor;
  const showHistoryTab = !isOwner && !isStaff;
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
        { key: "business", label: "Dashboard", show: isOwner },
        { key: "admin", label: "Admin", show: isStaff },
        { key: "profile", label: "Profile", show: true },
      ].filter((tab) => tab.show),
    [isOwner, isStaff, showHistoryTab],
  );
  const navContainerWidth = useMemo(() => {
    const count = visibleTabs.length || 1;
    const baseWidth =
      count * NAV_PILL_MIN + (count - 1) * NAV_GAP + NAV_PADDING * 2 + 4;
    const maxWidth = SCREEN_WIDTH - (IS_COMPACT ? 24 : 32);
    return Math.min(baseWidth, maxWidth);
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
    });
    return list.sort((a, b) => (b.lastRedeemed || 0) - (a.lastRedeemed || 0));
  }, [redemptionHistory, reviewedBusinessIds]);

  const pendingReviewCount = useMemo(
    () =>
      historyGroups.reduce(
        (total, group) => total + (group.pendingCount ? 1 : 0),
        0,
      ),
    [historyGroups],
  );

  useEffect(() => {
    if (!businesses.length) return;
    const exists = ownerBusinessId
      ? businesses.some((business) => business.id === ownerBusinessId)
      : false;
    if (!exists) {
      setOwnerBusinessId(businesses[0].id);
    }
  }, [businesses, ownerBusinessId]);

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
    if (!qrExpandedId) return;
    const business = approvedBusinesses.find(
      (item) => String(item.id) === String(qrExpandedId),
    );
    if (!business) return;
    if (BUSINESS_QR_IMAGES[business.id] || qrImageMap[business.id]) return;
    let isMounted = true;
    const payload = getBusinessQrCode(business);
    QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 240,
    })
      .then((dataUrl) => {
        if (!isMounted) return;
        setQrImageMap((prev) => ({ ...prev, [business.id]: dataUrl }));
      })
      .catch(() => {
        if (!isMounted) return;
        const fallbackUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
          payload,
        )}`;
        setQrImageMap((prev) => ({ ...prev, [business.id]: fallbackUrl }));
      });
    return () => {
      isMounted = false;
    };
  }, [approvedBusinesses, qrExpandedId, qrImageMap]);

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
    planKey: getPlanKeyFromSubscription(business?.subscription || ""),
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
    registerForPushNotificationsAsync();
  }, [registerForPushNotificationsAsync]);

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
    return true;
  };

  const upsertNotificationToken = useCallback(
    async (token) => {
      if (!authUserId || !token) return;
      if (!ensureSupabaseReady(() => null)) return;
      await supabase.from("notification_tokens").upsert({
        user_id: authUserId,
        expo_push_token: token,
        platform: Platform.OS,
        device_info:
          Device.modelName || Device.deviceName || Device.osName || Platform.OS,
        last_seen_at: new Date().toISOString(),
      });
    },
    [authUserId],
  );

  const registerForPushNotificationsAsync = useCallback(async () => {
    if (!authUserId) return;
    if (!Device.isDevice) {
      setNotificationPermissionStatus("unsupported");
      return;
    }
    try {
      const { status: existingStatus } =
        await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== "granted") {
        setNotificationPermissionStatus("denied");
        return;
      }
      setNotificationPermissionStatus("granted");
      const tokenData = await Notifications.getExpoPushTokenAsync();
      const token = tokenData.data;
      setExpoPushToken(token);
      await upsertNotificationToken(token);
    } catch (error) {
      setNotificationPermissionStatus("denied");
      setTokenError(error?.message || "Unable to register for notifications.");
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

  const stripeEnabled = Boolean(STRIPE_PUBLISHABLE_KEY);

  const handleStartSubscription = () => {
    if (!stripeEnabled) {
      setPaymentMessage(
        "Stripe is not connected yet. Add your publishable key to enable payments.",
      );
      return;
    }
    setPaymentMessage("Stripe checkout will be wired here before launch.");
  };

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
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: signInPassword,
      });
      if (error) {
        setSignInError(error.message || "Unable to sign in.");
        return;
      }
      if (!data.user) {
        setSignInError("Unable to sign in.");
        return;
      }
      await hydrateProfile(data.user, null);
      setIsSignedIn(true);
      setSignInPassword("");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCreateAccount = async () => {
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
    } finally {
      setAuthBusy(false);
    }
  };

  const handleBusinessSignUp = async () => {
    if (!businessEmail.trim() || !businessPassword.trim()) {
      setBusinessSignUpError("Email and password are required.");
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
            full_name: businessName.trim(),
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
        const { error: profileUpsertError } = await supabase
          .from("profiles")
          .upsert({
            id: data.user.id,
            email,
            full_name: businessName.trim(),
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
          subscription_plan: "Starter",
          subscription_price_cents: 5000,
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
            "subscription_plan",
            "subscription_price_cents",
            "qr_code",
            "is_open",
            "approval_status",
            "status",
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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setIsSignedIn(false);
    setSignInPassword("");
    setSignUpPassword("");
    setBusinessPassword("");
    setAccountRole("consumer");
    setAuthUserId(null);
    setAuthEmail("");
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
    setPaymentMessage(null);
    setCreateHoursStart("");
    setCreateHoursEnd("");
    setCreateHoursStartMeridiem("AM");
    setCreateHoursEndMeridiem("PM");
    setTimePickerVisible(false);
    setTimePickerTarget("start");
    setAuthView("menu");
    setActiveTab("discover");
    setOfferForm({ title: "", description: "", type: "" });
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
    setScannerEnabled(false);
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
        setScannerStatus(null);
        setScannerEnabled(true);
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
    setScannerBusiness(business);
    setScannerOffer(card);
    setScannerStatus("checking");
    setScannerEnabled(false);
    redemptionLoggedRef.current = false;
    setScannerVisible(true);
    await runRedeemGate(business);
  };

  const handleCloseScanner = () => {
    setScannerVisible(false);
    setScannerStatus(null);
    setScannerEnabled(true);
    setScannerOffer(null);
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
      setReviewError(error?.message || "Unable to submit your review.");
      setReviewBusy(false);
      return;
    }
    setUserReviews((prev) => [mapSupabaseReview(data), ...prev]);
    setReviewBusy(false);
    closeReviewModal();
    loadUserReviews({ silent: true });
    if (businessDetail?.id) {
      loadBusinessReviews(businessDetail.id, { silent: true });
    }
  };

  const handleScanCode = async ({ data }) => {
    if (!scannerEnabled || !scannerBusiness) return;
    setScannerEnabled(false);
    const expected = getBusinessQrCode(scannerBusiness);
    if (data && expected && data.includes(expected)) {
      setScannerStatus("success");
      if (!redemptionLoggedRef.current) {
        redemptionLoggedRef.current = true;
        if (SUPABASE_URL && SUPABASE_ANON_KEY && authUserId) {
          const { error } = await supabase.from("redemptions").insert({
            business_id: scannerBusiness.id,
            offer_id: scannerOffer?.offerId || scannerOffer?.id || null,
            qr_payload: data,
            scanned_by: authUserId,
          });
          if (error) {
            console.warn(
              "Wello redemption insert failed:",
              error.message || error,
            );
          } else {
            loadRedemptions({ silent: true });
          }
        }
      }
    } else {
      setScannerStatus("invalid");
    }
  };

  useEffect(() => {
    if (!scannerVisible) return;
    if (!cameraPermission || cameraPermission.status !== "granted") {
      requestCameraPermission();
    }
  }, [scannerVisible, cameraPermission, requestCameraPermission]);

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
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: false,
      tension: 90,
      friction: 12,
    }).start();
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

  const handleCardPress = async (card) => {
    const business = resolveBusinessFromCard(card);
    if (!business) return;
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
    const isSheetOpen = translateYRef.current < COLLAPSED_Y - 10;
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

    const tagList = formData.tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    const trimmedName = formData.name.trim();
    const trimmedAddress = formData.address.trim();
    const trimmedCity = formData.city.trim();
    const trimmedState = formData.state.trim();
    const trimmedPostal = formData.postalCode.trim();
    const selectedPlan =
      PLAN_OPTIONS.find((plan) => plan.key === formData.planKey) ||
      PLAN_OPTIONS[0];
    const approvedPlan = selectedPlan.enabled ? selectedPlan : PLAN_OPTIONS[0];
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
      subscription: `${approvedPlan.label} ${approvedPlan.price}`,
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

      const priceValue = Number(
        String(approvedPlan.price || "")
          .replace(/[^0-9]/g, "")
          .trim(),
      );
      const priceCents = Number.isFinite(priceValue) ? priceValue * 100 : 5000;
      const updatePayload = {
        tags: tagList.length ? tagList : [],
        hours: formData.hours.trim() || ownerBusiness.hours || null,
        is_open: formData.isOpen,
        subscription_plan: approvedPlan.label,
        subscription_price_cents: priceCents,
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
            "subscription_plan",
            "subscription_price_cents",
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
          "subscription_plan",
          "subscription_price_cents",
          "qr_code",
          "is_open",
          "approval_status",
          "status",
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
          "subscription_plan",
          "subscription_price_cents",
          "qr_code",
          "is_open",
          "approval_status",
          "status",
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
          "subscription_plan",
          "subscription_price_cents",
          "qr_code",
          "is_open",
          "approval_status",
          "status",
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
            "created_at",
            "business:businesses (id, name, category_key, category_label, tags, latitude, longitude, subscription_plan, subscription_price_cents, is_open, approval_status, status)",
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

  const loadOwnerOffers = useCallback(
    async (businessId) => {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !businessId) return;
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
        .order("created_at", { ascending: false });
      if (error) {
        return;
      }
      mergeOffers((data || []).map(mapSupabaseOffer));
    },
    [mergeOffers],
  );

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
    if (qrExpandedId === business.id) {
      setQrExpandedId(null);
    }
    setQrImageMap((prev) => {
      if (!prev[business.id]) return prev;
      const next = { ...prev };
      delete next[business.id];
      return next;
    });
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
      const mediaTypes = ImagePicker.MediaType?.Images
        ? [ImagePicker.MediaType.Images]
        : ImagePicker.MediaTypeOptions?.Images;
      if (!mediaTypes) {
        setOfferImageStatus({
          uploading: false,
          error: "Image picker is not available in this Expo Go version.",
        });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes,
        allowsEditing: true,
        aspect: [2, 1],
        quality: 0.85,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      setOfferImage({
        uri: asset.uri,
        mimeType: asset.mimeType || "image/jpeg",
        fileName: asset.fileName || null,
        base64: asset.base64 || null,
      });
    } catch (error) {
      setOfferImageStatus({
        uploading: false,
        error: error?.message || "Unable to open photo library.",
      });
    }
  };

  const handleCreateOffer = async () => {
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
    setOfferForm({ title: "", description: "", type: "" });
    setOfferImage(null);
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      loadOwnerOffers(ownerBusiness.id);
      loadRemoteOffers({ silent: true });
    }
    setOfferBusy(false);
  };

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
      const { data, error } = await supabase
        .from("redemptions")
        .select(
          [
            "id",
            "business_id",
            "offer_id",
            "created_at",
            "offer:offers (id, title, description, offer_type, image_url)",
            "business:businesses (id, name, category_key, category_label)",
          ].join(","),
        )
        .eq("scanned_by", authUserId)
        .order("created_at", { ascending: false });
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
      setBusinessDetailReviews((data || []).map(mapSupabaseReview));
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

  useEffect(() => {
    if (activeTab !== "history") return;
    if (!isSignedIn || !showHistoryTab) return;
    loadRedemptions();
    loadUserReviews();
  }, [activeTab, isSignedIn, showHistoryTab, loadRedemptions, loadUserReviews]);

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
      return;
    }
    loadRedemptions({ silent: true });
  }, [isSignedIn, showHistoryTab, loadRedemptions]);

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
    setPaymentMessage(null);
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
          tags: createBusinessForm.tags
            ? createBusinessForm.tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean)
            : [],
          subscription_plan: "Starter",
          subscription_price_cents: 5000,
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

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        dragStart.current = translateYRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        const nextValue = Math.min(
          Math.max(0, dragStart.current + gesture.dy),
          COLLAPSED_Y,
        );
        translateY.setValue(nextValue);
      },
      onPanResponderRelease: (_, gesture) => {
        const shouldExpand =
          gesture.vy < -0.4 || translateYRef.current < COLLAPSED_Y * 0.5;
        Animated.spring(translateY, {
          toValue: shouldExpand ? 0 : COLLAPSED_Y,
          useNativeDriver: false,
          tension: 90,
          friction: 12,
        }).start();
      },
    }),
  ).current;

  if ((!fontsLoaded && !fontError) || !sessionReady) {
    return <View style={styles.loadingScreen} />;
  }

  return (
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
              const useAndroidImages = Platform.OS === "android" && androidIcon;
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
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.navScroll}
              >
                {visibleTabs.map((tab) => {
                  const isActive = activeTab === tab.key;
                  return (
                    <TouchableOpacity
                      key={tab.key}
                      style={[styles.navPill, isActive && styles.navPillActive]}
                      onPress={() => openSheet(tab.key)}
                    >
                      <Text
                        style={[
                          styles.navPillText,
                          isActive && styles.navPillTextActive,
                        ]}
                      >
                        {tab.label}
                      </Text>
                      {tab.key === "history" && pendingReviewCount > 0 && (
                        <View style={styles.navPillBadge}>
                          <Text style={styles.navPillBadgeText}>
                            {pendingReviewCount > 9 ? "9+" : pendingReviewCount}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
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
                  {cameraPermission?.status === "denied" ? (
                    <View style={styles.scannerBlocked}>
                      <Text style={styles.scannerBlockedText}>
                        Camera permission is required.
                      </Text>
                    </View>
                  ) : scannerStatus === "blocked" ||
                    scannerStatus === "checking" ? (
                    <View style={styles.scannerBlocked}>
                      <Text style={styles.scannerBlockedText}>
                        {scannerStatus === "checking"
                          ? "Checking your location..."
                          : REDEEM_BLOCKED_MESSAGE}
                      </Text>
                    </View>
                  ) : (
                    <CameraView
                      onBarcodeScanned={
                        scannerEnabled ? handleScanCode : undefined
                      }
                      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                      style={styles.scanner}
                    />
                  )}
                  <View
                    style={styles.scannerFrameOutline}
                    pointerEvents="none"
                  />
                </View>

                <View style={styles.scannerStatus}>
                  <Text style={styles.scannerStatusText}>
                    {scannerStatus === "success"
                      ? "Offer redeemed. Show this confirmation to the staff."
                      : scannerStatus === "invalid"
                        ? "That code does not match this offer. Try again."
                        : scannerStatus === "checking"
                          ? "Checking your location..."
                          : scannerStatus === "blocked"
                            ? REDEEM_BLOCKED_MESSAGE
                            : "Scan the business QR code to redeem this offer."}
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
                  ) : scannerStatus === "blocked" ||
                    scannerStatus === "checking" ? (
                    <TouchableOpacity
                      style={[
                        styles.secondaryButton,
                        redeemGateBusy && styles.secondaryButtonDisabled,
                      ]}
                      onPress={() => {
                        if (!redeemGateBusy) {
                          runRedeemGate(scannerBusiness);
                        }
                      }}
                      disabled={redeemGateBusy}
                    >
                      <Text style={styles.secondaryButtonText}>
                        {redeemGateBusy ? "Checking..." : "Check again"}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => {
                        setScannerStatus(null);
                        setScannerEnabled(true);
                      }}
                    >
                      <Text style={styles.secondaryButtonText}>Scan again</Text>
                    </TouchableOpacity>
                  )}
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
                        color={reviewRating >= star ? COLORS.sun : COLORS.muted}
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

          <Modal transparent visible={businessDetailOpen} animationType="slide">
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
                  <Text style={styles.detailHours}>{businessDetail.hours}</Text>
                ) : null}

                <ScrollView
                  style={styles.detailBody}
                  contentContainerStyle={styles.detailBodyContent}
                  showsVerticalScrollIndicator={false}
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
                        <Ionicons name="star" size={16} color={COLORS.sun} />
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
                      <Ionicons name="star" size={16} color={COLORS.white} />
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
                  businessDetailOffers.map((offer) => (
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
                            <Text style={styles.detailOfferTagText}>{tag}</Text>
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
                        style={styles.detailOfferRedemption}
                        onPress={() =>
                          handleRedeemOffer({
                            id: offer.id,
                            businessId: businessDetail.id,
                            business: businessDetail,
                            offerTitle: offer.title || offer.offer || businessDetail.offer,
                            offerType: offer.offerType || offer.offer_type,
                            tags: businessDetail.tags,
                          })
                        }
                        disabled={redeemGateBusy}
                      >
                        <Text style={styles.detailOfferRedemptionText}>
                          Redeem this offer
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))
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
                                review.rating >= star ? "star" : "star-outline"
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

          <Animated.View
            style={[styles.sheet, { transform: [{ translateY }] }]}
          >
            <View style={styles.sheetHandle} {...panResponder.panHandlers}>
              <View style={styles.handleBar} />
              <Text style={styles.sheetHint}>Swipe up to explore offers</Text>
            </View>
            {activeTab === "discover" ? (
              <>
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
              </>
            ) : (
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                keyboardVerticalOffset={SAFE_TOP + 20}
                style={styles.sheetScroll}
              >
                <ScrollView
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
                        <Text style={styles.sectionTitleAlt}>Dashboard</Text>
                        <Text style={styles.sectionBody}>
                          Manage your single business profile here. More tools
                          are coming soon.
                        </Text>
                        <Text style={styles.sectionBody}>
                          Track performance and keep your listing up to date.
                        </Text>
                      </View>

                      <View style={styles.analyticsGrid}>
                        <View style={styles.analyticsCard}>
                          <Text style={styles.analyticsValue}>
                            {ownerMetrics.views.toLocaleString()}
                          </Text>
                          <Text style={styles.analyticsLabel}>Views</Text>
                        </View>
                        <View style={styles.analyticsCard}>
                          <Text style={styles.analyticsValue}>
                            {ownerMetrics.saves.toLocaleString()}
                          </Text>
                          <Text style={styles.analyticsLabel}>Saves</Text>
                        </View>
                        <View style={styles.analyticsCard}>
                          <Text style={styles.analyticsValue}>
                            {ownerMetrics.redemptions.toLocaleString()}
                          </Text>
                          <Text style={styles.analyticsLabel}>Redemptions</Text>
                        </View>
                        <View style={styles.analyticsCard}>
                          <Text style={styles.analyticsValue}>
                            {ownerMetrics.reach}
                          </Text>
                          <Text style={styles.analyticsLabel}>Reach</Text>
                        </View>
                      </View>

                      <View style={styles.sectionBlock}>
                        <Text style={styles.sectionTitleAlt}>
                          Business info
                        </Text>
                        <Text style={styles.sectionBody}>
                          Update what customers see on your listing. Changes to
                          name, address, category, and offers require approval.
                        </Text>
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
                                - {ownerBusiness.subscription}
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
                                You're in edit mode. Submit changes for review.
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

                          <Text style={styles.formLabel}>Business address</Text>
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
                            <Text style={styles.formError}>{addressError}</Text>
                          )}
                          {canEditBusiness && addressResults.length > 0 && (
                            <View style={styles.suggestionList}>
                              {addressResults.map((result) => (
                                <TouchableOpacity
                                  key={result.place_id}
                                  style={styles.suggestionItem}
                                  onPress={() => handleSelectSuggestion(result)}
                                >
                                  <Text style={styles.suggestionTitle}>
                                    {result.structured_formatting?.main_text ||
                                      result.description}
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
                                  !canEditBusiness && styles.formInputDisabled,
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
                                  !canEditBusiness && styles.formInputDisabled,
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
                                  !canEditBusiness && styles.formInputDisabled,
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
                                    handleFormChange("categoryKey", option.key)
                                  }
                                >
                                  <Text
                                    style={[
                                      styles.categoryChipText,
                                      isActive && styles.categoryChipTextActive,
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

                          <Text style={styles.formLabel}>Operating hours</Text>
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
                          <AutoFocusInput
                            style={[
                              styles.formInput,
                              !canEditBusiness && styles.formInputDisabled,
                            ]}
                            placeholder="wifi, family, happy-hour"
                            placeholderTextColor={COLORS.muted}
                            value={formData.tags}
                            editable={canEditBusiness}
                            onChangeText={(value) =>
                              handleFormChange("tags", value)
                            }
                          />

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
                            Add your listing details. You can edit them later if
                            needed.
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

                          <Text style={styles.formLabel}>Business address</Text>
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
                                    {result.structured_formatting?.main_text ||
                                      result.description}
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
                                      isActive && styles.categoryChipTextActive,
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

                          <Text style={styles.formLabel}>Operating hours</Text>
                          <View style={styles.timeRow}>
                            <View style={styles.timeBlock}>
                              <Text style={styles.timeLabel}>Start</Text>
                              <View style={styles.timeInputRow}>
                                <TouchableOpacity
                                  style={styles.timeSelect}
                                  onPress={() => openTimePicker("createStart")}
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
                          <AutoFocusInput
                            style={styles.formInput}
                            placeholder="wifi, family, happy-hour"
                            placeholderTextColor={COLORS.muted}
                            value={createBusinessForm.tags}
                            onChangeText={(value) =>
                              setCreateBusinessForm((prev) => ({
                                ...prev,
                                tags: value,
                              }))
                            }
                          />

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

                          <View style={styles.paymentCard}>
                            <Text style={styles.paymentTitle}>Membership</Text>
                            <Text style={styles.paymentBody}>
                              A subscription is required to publish your listing
                              once your profile is created.
                            </Text>
                            <TouchableOpacity
                              style={[
                                styles.primaryButton,
                                !stripeEnabled && styles.primaryButtonDisabled,
                              ]}
                              onPress={handleStartSubscription}
                              disabled={!stripeEnabled}
                            >
                              <Text style={styles.primaryButtonText}>
                                {stripeEnabled
                                  ? "Continue to payment"
                                  : "Stripe setup pending"}
                              </Text>
                            </TouchableOpacity>
                            {paymentMessage && (
                              <Text style={styles.formHint}>
                                {paymentMessage}
                              </Text>
                            )}
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

                      {ownerBusiness && (
                        <>
                          <View style={styles.sectionBlock}>
                            <Text style={styles.sectionTitleAlt}>Offers</Text>
                            <Text style={styles.sectionBody}>
                              Create and manage multiple offers for your
                              business. New offers may require approval.
                            </Text>
                          </View>

                          <View style={styles.formCard}>
                            <Text style={styles.formHeaderTitle}>
                              Create offer
                            </Text>
                            <Text style={styles.formHeaderMeta}>
                              Add a title and description for customers.
                            </Text>

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
                              }}
                            />

                            <Text style={styles.formLabel}>Description</Text>
                            <AutoFocusInput
                              style={[styles.formInput, styles.formTextarea]}
                              placeholder="Add the details customers should know."
                              placeholderTextColor={COLORS.muted}
                              value={offerForm.description}
                              onChangeText={(value) => {
                                setOfferForm((prev) => ({
                                  ...prev,
                                  description: value,
                                }));
                                if (offerError) setOfferError(null);
                              }}
                              multiline
                              textAlignVertical="top"
                            />

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
                              }}
                              autoCorrect
                              autoCapitalize="words"
                              onBlur={() => {
                                const corrected = normalizeOfferType(
                                  offerForm.type,
                                );
                                if (corrected && corrected !== offerForm.type) {
                                  setOfferForm((prev) => ({
                                    ...prev,
                                    type: corrected,
                                  }));
                                }
                              }}
                            />
                            {showOfferTypeSuggestion && (
                              <Text style={styles.formHint}>
                                Suggested: {offerTypeSuggestion}
                              </Text>
                            )}

                            <Text style={styles.formLabel}>Offer photo</Text>
                            <View style={styles.offerUploadRow}>
                              <TouchableOpacity
                                style={styles.secondaryButton}
                                onPress={handlePickOfferImage}
                                disabled={offerImageStatus.uploading}
                              >
                                <Text style={styles.secondaryButtonText}>
                                  {offerImage
                                    ? "Replace photo"
                                    : "Upload photo"}
                                </Text>
                              </TouchableOpacity>
                              {offerImage && (
                                <TouchableOpacity
                                  style={styles.offerRemoveButton}
                                  onPress={() => setOfferImage(null)}
                                >
                                  <Text style={styles.offerRemoveButtonText}>
                                    Remove
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>
                            {offerImageStatus.error && (
                              <Text style={styles.formError}>
                                {offerImageStatus.error}
                              </Text>
                            )}
                            <View style={styles.offerUploadFrame}>
                              {offerImage ? (
                                <Image
                                  source={{ uri: offerImage.uri }}
                                  style={styles.offerUploadPreview}
                                  resizeMode="cover"
                                  onError={(event) => {
                                    console.warn(
                                      "Wello offer preview failed:",
                                      {
                                        uri: offerImage.uri,
                                        error: event.nativeEvent?.error,
                                      },
                                    );
                                  }}
                                />
                              ) : (
                                <View style={styles.offerUploadPlaceholder}>
                                  <Ionicons
                                    name="image-outline"
                                    size={18}
                                    color={COLORS.muted}
                                  />
                                  <Text style={styles.offerUploadHint}>
                                    Upload a photo to help customers spot the
                                    offer.
                                  </Text>
                                </View>
                              )}
                            </View>

                            {offerError && (
                              <Text style={styles.formError}>{offerError}</Text>
                            )}

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

                          {ownerOffers.length === 0 ? (
                            <View style={styles.emptyState}>
                              <Text style={styles.emptyTitle}>
                                No offers yet.
                              </Text>
                              <Text style={styles.emptyCopy}>
                                Create your first offer to show on Discover.
                              </Text>
                            </View>
                          ) : (
                            <View style={styles.offerList}>
                              {ownerOffers.map((offer) => (
                                <View key={offer.id} style={styles.offerRow}>
                                  <View style={styles.offerMeta}>
                                    <Text style={styles.offerTitle}>
                                      {offer.title || "Untitled offer"}
                                    </Text>
                                    {offer.description ? (
                                      <Text style={styles.offerDescription}>
                                        {offer.description}
                                      </Text>
                                    ) : null}
                                    <Text style={styles.offerStatus}>
                                      {offer.active ? "Active" : "Paused"} -{" "}
                                      {offer.approvalStatus === "pending"
                                        ? "Pending review"
                                        : offer.approvalStatus === "rejected"
                                          ? "Rejected"
                                          : "Approved"}
                                    </Text>
                                  </View>
                                  <View style={styles.offerActions}>
                                    <TouchableOpacity
                                      style={styles.offerAction}
                                      onPress={() => handleToggleOffer(offer)}
                                    >
                                      <Text style={styles.offerActionText}>
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
                              ))}
                            </View>
                          )}
                        </>
                      )}
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
                            <Text style={styles.sectionTitleAlt}>History</Text>
                            <Text style={styles.sectionBody}>
                              Your redeemed offers are grouped by business so
                              you can leave a review.
                            </Text>
                          </View>

                          {redemptionStatus.error && (
                            <Text style={styles.formError}>
                              {redemptionStatus.error}
                            </Text>
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
                                const hasReview = reviewedBusinessIds.has(
                                  String(group.businessId || group.key),
                                );
                                return (
                                  <View
                                    key={group.key}
                                    style={styles.historyGroupCard}
                                  >
                                    <TouchableOpacity
                                      style={styles.historyGroupHeader}
                                      onPress={() =>
                                        setExpandedHistoryGroups((prev) => ({
                                          ...prev,
                                          [group.key]: !prev[group.key],
                                        }))
                                      }
                                    >
                                      <View style={styles.historyGroupMeta}>
                                        <Text
                                          style={styles.historyGroupTitle}
                                          numberOfLines={1}
                                        >
                                          {group.businessName}
                                        </Text>
                                        <Text style={styles.historyGroupSub}>
                                          {group.entries.length} redeemed · Last{" "}
                                          {formatHistoryTimestamp(
                                            group.lastRedeemed,
                                          )}
                                        </Text>
                                      </View>
                                      <View style={styles.historyGroupActions}>
                                        {group.pendingCount > 0 && (
                                          <View
                                            style={styles.historyReviewBadge}
                                          >
                                            <Text
                                              style={
                                                styles.historyReviewBadgeText
                                              }
                                            >
                                              {group.pendingCount}
                                            </Text>
                                          </View>
                                        )}
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
                                    </TouchableOpacity>
                                    {isExpanded && (
                                      <View style={styles.historyEntries}>
                                        {group.pendingCount > 0 && (
                                          <TouchableOpacity
                                            style={styles.historyReviewButton}
                                            onPress={() =>
                                              handleOpenReview(group)
                                            }
                                          >
                                            <Text
                                              style={styles.historyReviewText}
                                            >
                                              Leave a review
                                            </Text>
                                            <Ionicons
                                              name="star"
                                              size={16}
                                              color={COLORS.sun}
                                            />
                                          </TouchableOpacity>
                                        )}
                                        {group.entries.map((entry) => {
                                          const offerTitle =
                                            entry.offer?.title ||
                                            "Redeemed offer";
                                          const offerDescription =
                                            entry.offer?.description || "";
                                          return (
                                            <View
                                              key={entry.id}
                                              style={styles.historyEntry}
                                            >
                                              <View
                                                style={styles.historyEntryRow}
                                              >
                                                <Text
                                                  style={
                                                    styles.historyEntryTitle
                                                  }
                                                  numberOfLines={1}
                                                >
                                                  {offerTitle}
                                                </Text>
                                                <Text
                                                  style={
                                                    styles.historyEntryTime
                                                  }
                                                >
                                                  {formatHistoryTimestamp(
                                                    entry.createdAt,
                                                  )}
                                                </Text>
                                              </View>
                                              {!hasReview &&
                                                entry.id ===
                                                  group.entries[0]?.id && (
                                                  <Text
                                                    style={
                                                      styles.historyEntryPending
                                                    }
                                                  >
                                                    Review needed
                                                  </Text>
                                                )}
                                              {offerDescription ? (
                                                <Text
                                                  style={
                                                    styles.historyEntryDescription
                                                  }
                                                  numberOfLines={2}
                                                >
                                                  {offerDescription}
                                                </Text>
                                              ) : null}
                                            </View>
                                          );
                                        })}
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
                                  Add your Google Places key in `.env` to enable
                                  address autocomplete.
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
                                  <Text style={styles.formLabel}>Zip code</Text>
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
                                          businessHoursStartMeridiem === label;
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
                                              setBusinessHoursEndMeridiem(label)
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
                            <Text style={styles.sectionTitleAlt}>Profile</Text>
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
                                  handlePreferenceToggle("nearby_offer", value)
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
                            {tokenError && (
                              <Text style={styles.formError}>{tokenError}</Text>
                            )}
                          </View>

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

                            <Text style={styles.formLabel}>Company</Text>
                            <AutoFocusInput
                              style={styles.formInput}
                              placeholder="Business name"
                              placeholderTextColor={COLORS.muted}
                              value={profileCompany}
                              onChangeText={setProfileCompany}
                            />

                            <View style={styles.profileMetaRow}>
                              <View style={styles.profileMetaCard}>
                                <Text style={styles.profileMetaLabel}>
                                  Plan
                                </Text>
                                <Text style={styles.profileMetaValue}>
                                  {ownerBusiness?.subscription ||
                                    "Starter $50/mo"}
                                </Text>
                              </View>
                              <View style={styles.profileMetaCard}>
                                <Text style={styles.profileMetaLabel}>
                                  Listings
                                </Text>
                                <Text style={styles.profileMetaValue}>
                                  {approvedBusinesses.length}
                                </Text>
                              </View>
                            </View>

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
                        <Text style={styles.sectionTitleAlt}>Admin review</Text>
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
                        pendingEditBusinesses.map((business) => (
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
                              Requested updates
                            </Text>
                            <View style={styles.pendingList}>
                              {Object.keys(business.pendingEdits || {})
                                .filter((field) => field !== "coordinate")
                                .map((field) => (
                                  <View key={field} style={styles.pendingPill}>
                                    <Text style={styles.pendingPillText}>
                                      {getPendingEditLabel(field)}
                                    </Text>
                                  </View>
                                ))}
                            </View>
                            <View style={styles.adminActions}>
                              <TouchableOpacity
                                style={styles.adminApprove}
                                onPress={() => handleApproveEdits(business.id)}
                              >
                                <Text style={styles.adminActionText}>
                                  Approve edits
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.adminReject}
                                onPress={() => handleRejectEdits(business.id)}
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
                        ))
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
                        pendingOffers.map((offer) => (
                          <View key={offer.id} style={styles.adminCard}>
                            <View style={styles.adminHeader}>
                              <Text style={styles.adminTitle}>
                                {offer.title || "New offer"}
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
                          Offer management
                        </Text>
                        <Text style={styles.sectionBody}>
                          Remove offers and clean up their images.
                        </Text>
                      </View>

                      {adminOffers.length === 0 ? (
                        <View style={styles.emptyState}>
                          <Text style={styles.emptyTitle}>No offers yet.</Text>
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

                      {isAdmin && (
                        <>
                          <View style={styles.sectionBlock}>
                            <Text style={styles.sectionTitleAlt}>
                              Supervisor access
                            </Text>
                            <Text style={styles.sectionBody}>
                              Promote teammates to review listings without full
                              admin access.
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
                                              style={styles.supervisorBadgeAlt}
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
                                              style={styles.supervisorActionAlt}
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

                      <View style={styles.sectionBlock}>
                        <Text style={styles.sectionTitleAlt}>
                          Business QR codes
                        </Text>
                        <Text style={styles.sectionBody}>
                          Expand a business to show its unique QR code for
                          in-store redemption.
                        </Text>
                      </View>

                      {approvedBusinesses.length === 0 ? (
                        <View style={styles.emptyState}>
                          <Text style={styles.emptyTitle}>
                            No approved businesses yet.
                          </Text>
                          <Text style={styles.emptyCopy}>
                            Approve listings to generate QR codes.
                          </Text>
                        </View>
                      ) : (
                        approvedBusinesses.map((business) => {
                          const isExpanded = qrExpandedId === business.id;
                          const payload = getBusinessQrCode(business);
                          return (
                            <View key={business.id} style={styles.qrCard}>
                              <TouchableOpacity
                                style={styles.qrHeaderRow}
                                onPress={() =>
                                  setQrExpandedId(
                                    isExpanded ? null : business.id,
                                  )
                                }
                              >
                                <View style={styles.qrHeaderText}>
                                  <Text style={styles.qrTitle}>
                                    {business.name}
                                  </Text>
                                  <Text style={styles.qrMeta}>
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
                              {isExpanded && (
                                <View style={styles.qrBody}>
                                  <View style={styles.qrCodeWrap}>
                                    {BUSINESS_QR_IMAGES[business.id] ||
                                    qrImageMap[business.id] ? (
                                      <Image
                                        source={
                                          BUSINESS_QR_IMAGES[business.id] || {
                                            uri: qrImageMap[business.id],
                                          }
                                        }
                                        style={styles.qrImage}
                                        resizeMode="contain"
                                      />
                                    ) : (
                                      <View style={styles.qrFallback}>
                                        <Text style={styles.qrFallbackText}>
                                          Generating QR
                                        </Text>
                                      </View>
                                    )}
                                  </View>
                                  <Text style={styles.qrCodeLabel}>
                                    {payload}
                                  </Text>
                                  <Text style={styles.qrCodeNote}>
                                    Keep this code private. Scan at checkout to
                                    redeem offers.
                                  </Text>
                                </View>
                              )}
                            </View>
                          );
                        })
                      )}

                      <View style={styles.adminSummary}>
                        <View style={styles.statCard}>
                          <Text style={styles.statValue}>
                            {pendingBusinesses.length}
                          </Text>
                          <Text style={styles.statLabel}>Pending</Text>
                        </View>
                        <View style={styles.statCard}>
                          <Text style={styles.statValue}>
                            {approvedBusinesses.length}
                          </Text>
                          <Text style={styles.statLabel}>Approved</Text>
                        </View>
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
                        pendingBusinesses.map((business) => (
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
                        ))
                      )}
                    </>
                  ) : (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyTitle}>Access restricted.</Text>
                      <Text style={styles.emptyCopy}>
                        Switch to an authorized account to view this section.
                      </Text>
                    </View>
                  )}
                </ScrollView>
              </KeyboardAvoidingView>
            )}
          </Animated.View>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
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
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapShade: {
    ...StyleSheet.absoluteFillObject,
  },
  topMeta: {
    position: "absolute",
    top: SAFE_TOP,
    left: IS_COMPACT ? 12 : 16,
    right: IS_COMPACT ? 12 : 16,
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
  navScroll: {
    flexDirection: "row",
    gap: NAV_GAP,
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
  },
  scannerBlockedText: {
    fontSize: 12,
    color: COLORS.white,
    fontFamily: FONT_TEXT,
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
  detailOfferRedemptionText: {
    fontSize: 12,
    fontFamily: FONT_MEDIUM,
    color: COLORS.white,
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
    flexGrow: 0,
    minWidth: NAV_PILL_MIN,
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 999,
    paddingVertical: IS_COMPACT ? 6 : 8,
    paddingHorizontal: IS_COMPACT ? 12 : 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    position: "relative",
  },
  navPillActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine,
  },
  navPillText: {
    fontSize: IS_COMPACT ? 12 : 13,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
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
  offerUploadFrame: {
    width: "100%",
    aspectRatio: OFFER_IMAGE_ASPECT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: "#EFF3F8",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  offerUploadPreview: {
    width: "100%",
    height: "100%",
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
  sheetScroll: {
    flex: 1,
  },
  sheetScrollContent: {
    paddingBottom: 24,
  },
  sheetHandle: {
    alignItems: "center",
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
    marginHorizontal: 4,
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
    padding: IS_COMPACT ? 14 : 16,
    minHeight: IS_SHORT ? 220 : 250,
    borderWidth: 1,
    borderColor: COLORS.sand,
    overflow: "hidden",
  },
  cardSelected: {
    borderColor: COLORS.coral,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardName: {
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
    height: CARD_MEDIA_HEIGHT,
    marginTop: 12,
    alignSelf: "stretch",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    borderStyle: "dashed",
    backgroundColor: "#EFF3F8",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cardMediaOverlay: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    gap: 6,
    zIndex: 2,
  },
  cardMediaImage: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
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
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.mint,
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
  formHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
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
  historyList: {
    gap: 12,
    marginBottom: 12,
  },
  historyGroupCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 12,
    gap: 6,
  },
  historyGroupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  historyGroupMeta: {
    flex: 1,
  },
  historyGroupTitle: {
    flex: 1,
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  historyGroupSub: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 4,
  },
  historyGroupActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
    marginTop: 10,
    gap: 10,
  },
  historyReviewButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: "#FFF7E6",
  },
  historyReviewText: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  historyEntry: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.mint,
  },
  historyEntryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  historyEntryTitle: {
    flex: 1,
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
  },
  historyEntryTime: {
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
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
  offerAction: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.pine,
    backgroundColor: COLORS.pine,
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
    gap: 8,
    marginBottom: 12,
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
