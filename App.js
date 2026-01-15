import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { LinearGradient } from "expo-linear-gradient";
import * as Font from "expo-font";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { CameraView, useCameraPermissions } from "expo-camera";
import { supabase } from "./lib/supabase";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const IS_COMPACT = SCREEN_WIDTH < 360;
const IS_NARROW = SCREEN_WIDTH < 420;
const IS_SHORT = SCREEN_HEIGHT < 700;
const SHEET_MIN = IS_SHORT ? 140 : 160;
const SHEET_MAX = Math.min(SCREEN_HEIGHT * 0.72, IS_SHORT ? 560 : 620);
const COLLAPSED_Y = SHEET_MAX - SHEET_MIN;
const SAFE_TOP = Platform.OS === "android"
  ? (StatusBar.currentHeight || 0) + (IS_COMPACT ? 8 : 12)
  : IS_COMPACT ? 8 : 12;
const CARD_WIDTH = Math.min(280, Math.max(210, Math.round(SCREEN_WIDTH * 0.7)));
const CARD_GAP = Math.round(Math.max(10, SCREEN_WIDTH * 0.03));
const QR_SIZE = Math.min(200, Math.max(130, Math.round(SCREEN_WIDTH * 0.42)));
const SCANNER_FRAME = Math.min(300, Math.max(210, Math.round(SCREEN_HEIGHT * 0.32)));
const SCANNER_CARD_WIDTH = Math.max(280, SCREEN_WIDTH - 40);
const SCANNER_CARD_HEIGHT = SCANNER_FRAME + (IS_COMPACT ? 160 : 180);
const NEW_WINDOW_MS = 1000 * 60 * 60 * 24 * 10;
const ADDRESS_DEBOUNCE_MS = 300;
const GOOGLE_PLACES_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const ANDROID_MARKER_SIZE = 34;
const ANDROID_MARKER_SELECTED_SIZE = 44;
const CONFETTI_PIECES = 20;
const NAV_PILL_MIN = IS_COMPACT ? 78 : 90;
const NAV_GAP = IS_COMPACT ? 6 : 8;
const NAV_PADDING = IS_COMPACT ? 8 : 10;
const TIME_SELECT_MAX = Math.min(160, Math.round(SCREEN_WIDTH * 0.42));
const TIME_SELECT_MIN = IS_COMPACT ? 80 : 96;
const TIME_MERIDIEM_WIDTH = IS_COMPACT ? 68 : 80;
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
  "11:30"
];
const CONFETTI_COLORS = [
  "#F8C27A",
  "#F59E8B",
  "#8EC5F8",
  "#9DE3C1",
  "#F6A6C9",
  "#F2D36B",
  "#7FB7E8",
  "#C0E8B4"
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
  muted: "#5C6B7A"
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
          duration: 2400 + (index % 5) * 420
        };
      }),
    [width]
  );
  const fallValues = useRef(
    pieces.map((_, index) => new Animated.Value(-20 - (index % 4) * 12))
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
            useNativeDriver: true
          }),
          { resetBeforeIteration: true }
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
              transform: [{ translateY: fallValues[index] }]
            }
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
    source: "seed"
  },
  {
    id: "2",
    name: "Harbor Fitness",
    category: "Fitness Studio",
    categoryKey: "fitness",
    offer: "First month 30% off",
    qrCode: "WELLO-2-L4M8Z0T7",
    distance: "1.1 mi",
    subscription: "Starter $50/mo",
    rating: 4.9,
    tags: ["classes", "trainers", "family"],
    isOpen: true,
    hours: "5:30 AM - 9:00 PM",
    createdAt: daysAgo(8),
    coordinate: { latitude: 40.7119, longitude: -74.0018 },
    approved: true,
    rejected: false,
    source: "seed"
  },
  {
    id: "3",
    name: "Cedar Market",
    category: "Grocery",
    categoryKey: "grocery",
    offer: "Weekly produce box $24",
    qrCode: "WELLO-3-7P2X5N9C",
    distance: "0.9 mi",
    subscription: "Starter $50/mo",
    rating: 4.6,
    tags: ["organic", "family"],
    isOpen: true,
    hours: "8:00 AM - 8:00 PM",
    createdAt: daysAgo(14),
    coordinate: { latitude: 40.7152, longitude: -74.0083 },
    approved: true,
    rejected: false,
    source: "seed"
  },
  {
    id: "4",
    name: "Luna Nail Studio",
    category: "Nail Salon",
    categoryKey: "nail",
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
    source: "seed"
  },
  {
    id: "5",
    name: "Rivertown Books",
    category: "Bookshop",
    categoryKey: "books",
    offer: "2nd book 50% off",
    qrCode: "WELLO-5-M9R2V7D4",
    distance: "0.5 mi",
    subscription: "Starter $50/mo",
    rating: 4.9,
    tags: ["events", "cozy", "open"],
    isOpen: true,
    hours: "9:00 AM - 7:00 PM",
    createdAt: daysAgo(6),
    coordinate: { latitude: 40.7145, longitude: -74.0034 },
    approved: true,
    rejected: false,
    source: "seed"
  },
  {
    id: "6",
    name: "Steel & Stone",
    category: "Retail Home Goods",
    categoryKey: "retail",
    offer: "Bundle any 2 candles",
    qrCode: "WELLO-6-J5C1Y8W3",
    distance: "1.8 mi",
    subscription: "Starter $50/mo",
    rating: 4.5,
    tags: ["decor", "gifts"],
    isOpen: true,
    hours: "10:00 AM - 8:00 PM",
    createdAt: daysAgo(20),
    coordinate: { latitude: 40.7121, longitude: -74.0121 },
    approved: true,
    rejected: false,
    source: "seed"
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
    source: "seed"
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
    source: "seed"
  }
];

const BUSINESS_ANALYTICS = {
  "1": { views: 1840, saves: 312, redemptions: 86, reach: "6.2k" },
  "2": { views: 1620, saves: 276, redemptions: 63, reach: "5.4k" },
  "3": { views: 1180, saves: 198, redemptions: 41, reach: "4.1k" },
  "4": { views: 980, saves: 146, redemptions: 38, reach: "3.2k" },
  "5": { views: 1540, saves: 284, redemptions: 59, reach: "5.8k" },
  "6": { views: 1320, saves: 224, redemptions: 47, reach: "4.6k" },
  "7": { views: 1410, saves: 246, redemptions: 52, reach: "5.1k" },
  "8": { views: 1760, saves: 298, redemptions: 74, reach: "6.0k" }
};
const DEFAULT_ANALYTICS = { views: 0, saves: 0, redemptions: 0, reach: "0" };
const BUSINESS_QR_IMAGES = {
  "1": require("./assets/qr/wello-1.png"),
  "2": require("./assets/qr/wello-2.png"),
  "3": require("./assets/qr/wello-3.png"),
  "4": require("./assets/qr/wello-4.png"),
  "5": require("./assets/qr/wello-5.png"),
  "6": require("./assets/qr/wello-6.png"),
  "7": require("./assets/qr/wello-7.png"),
  "8": require("./assets/qr/wello-8.png")
};

const MAP_REGION = {
  latitude: 40.7128,
  longitude: -74.006,
  latitudeDelta: 0.055,
  longitudeDelta: 0.045
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
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  return {
    id: String(row.id || index + 1),
    ownerId: row.owner_id || null,
    name: row.name || "Wello business",
    category: row.category_label || categoryConfig.display,
    categoryKey,
    offer: row.offer_highlight || "New offer available",
    distance: "—",
    subscription: formatSubscription(row.subscription_plan, row.subscription_price_cents),
    rating: 4.7,
    tags: Array.isArray(row.tags) && row.tags.length ? row.tags : ["local"],
    isOpen: row.is_open ?? true,
    hours: row.hours || "Hours available upon request",
    phone: row.phone || "",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : daysAgo(5),
    coordinate: hasCoordinates
      ? { latitude, longitude }
      : {
          latitude: MAP_REGION.latitude + index * 0.002,
          longitude: MAP_REGION.longitude - index * 0.002
        },
    approved: row.approval_status === "approved",
    rejected: row.approval_status === "rejected",
    qrCode: row.qr_code || "",
    source: "supabase"
  };
};

const INVITE_ROLE_LABELS = {
  consumer: "Member",
  business_owner: "Business",
  admin: "Admin"
};

const generateInviteCode = () => {
  const segment = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WELLO-${segment()}-${segment()}`;
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

const formatBusinessHours = (startTime, startMeridiem, endTime, endMeridiem) =>
  `${startTime} ${startMeridiem} - ${endTime} ${endMeridiem}`;

const MAP_STYLE = [
  {
    featureType: "all",
    elementType: "labels.text.fill",
    stylers: [{ color: "#4B5563" }]
  },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#E2E8F0" }]
  },
  {
    featureType: "poi",
    elementType: "geometry.fill",
    stylers: [{ color: "#EEF2F7" }]
  },
  {
    featureType: "poi.park",
    elementType: "geometry.fill",
    stylers: [{ color: "#D7E6DD" }]
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#F5F7FB" }]
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#D7DEE8" }]
  },
  {
    featureType: "water",
    elementType: "geometry.fill",
    stylers: [{ color: "#CFE3F1" }]
  }
];

const FILTERS = [
  { key: "open", label: "Open now" },
  { key: "top", label: "Top rated" },
  { key: "new", label: "New offers" },
  { key: "family", label: "Family friendly" }
];

const CATEGORY_OPTIONS = [
  { key: "restaurant", label: "Restaurant" },
  { key: "retail", label: "Retail" },
  { key: "nail", label: "Nail salon" },
  { key: "barber", label: "Barbershop" },
  { key: "cafe", label: "Cafe" },
  { key: "fitness", label: "Fitness" },
  { key: "grocery", label: "Grocery" },
  { key: "books", label: "Bookshop" }
];

const PLAN_OPTIONS = [
  {
    key: "starter",
    label: "Starter",
    price: "$50/mo",
    desc: "Map listing and offers",
    enabled: true
  },
  {
    key: "growth",
    label: "Growth",
    price: "$75/mo",
    desc: "Priority placement + insights",
    enabled: false
  },
  {
    key: "premium",
    label: "Premium",
    price: "$99/mo",
    desc: "Featured badge + campaigns",
    enabled: false
  }
];

const CATEGORY_CONFIG = {
  restaurant: {
    label: "R",
    color: "#C45B3C",
    display: "Restaurant",
    icon: "restaurant"
  },
  retail: {
    label: "S",
    color: "#2E4C66",
    display: "Retail",
    icon: "storefront"
  },
  nail: {
    label: "N",
    color: "#B07A3C",
    display: "Nail Salon",
    icon: "color-palette"
  },
  barber: {
    label: "B",
    color: "#2F6B62",
    display: "Barbershop",
    icon: "cut"
  },
  cafe: {
    label: "C",
    color: "#6E5142",
    display: "Cafe",
    icon: "cafe"
  },
  fitness: {
    label: "F",
    color: "#3D5E7A",
    display: "Fitness",
    icon: "fitness"
  },
  grocery: {
    label: "G",
    color: "#4E6B3F",
    display: "Grocery",
    icon: "basket"
  },
  books: {
    label: "K",
    color: "#4F5D6A",
    display: "Bookshop",
    icon: "book"
  },
  default: {
    label: "L",
    color: COLORS.coral,
    display: "Local",
    icon: "pin"
  }
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
  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardName}>{item.name}</Text>
        <View style={styles.cardBadge}>
          <Text style={styles.cardBadgeText}>{item.distance}</Text>
        </View>
      </View>
      <Text style={styles.cardCategory}>{category.display}</Text>
      <Text style={styles.cardOffer}>{item.offer}</Text>
      <TouchableOpacity
        style={styles.redeemButton}
        onPress={onRedeem}
        activeOpacity={0.85}
      >
        <Text style={styles.redeemButtonText}>Redeem offer</Text>
      </TouchableOpacity>
      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMeta}>{item.subscription}</Text>
        <Text style={styles.cardMeta}>Rating {ratingLabel}</Text>
      </View>
      <View style={styles.cardTags}>
        {item.tags.map((tag) => (
          <View key={tag} style={styles.tagPill}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        ))}
      </View>
      <View style={styles.cardMedia}>
        <Ionicons name="image-outline" size={18} color={COLORS.muted} />
        <Text style={styles.cardMediaLabel}>Offer image</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function App() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [fontError, setFontError] = useState(null);
  const mapRef = useRef(null);
  const cardListRef = useRef(null);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("discover");
  const [activeFilters, setActiveFilters] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [mapRegion, setMapRegion] = useState(MAP_REGION);
  const initialBusinesses =
    SUPABASE_URL && SUPABASE_ANON_KEY ? [] : BUSINESSES;
  const [businesses, setBusinesses] = useState(initialBusinesses);
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
  const [signUpCode, setSignUpCode] = useState("");
  const [signUpError, setSignUpError] = useState(null);
  const [businessEmail, setBusinessEmail] = useState("");
  const [businessPassword, setBusinessPassword] = useState("");
  const [businessInviteCode, setBusinessInviteCode] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessCategoryKey, setBusinessCategoryKey] = useState("restaurant");
  const [businessAddress, setBusinessAddress] = useState("");
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
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerBusiness, setScannerBusiness] = useState(null);
  const [scannerStatus, setScannerStatus] = useState(null);
  const [scannerEnabled, setScannerEnabled] = useState(true);
  const [qrExpandedId, setQrExpandedId] = useState(null);
  const [isEditingBusiness, setIsEditingBusiness] = useState(false);
  const [remoteStatus, setRemoteStatus] = useState({
    loading: false,
    error: null
  });
  const [inviteRole, setInviteRole] = useState("business_owner");
  const [inviteStatus, setInviteStatus] = useState({
    loading: false,
    error: null,
    code: null
  });
  const [inviteList, setInviteList] = useState([]);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [ownerBusinessId, setOwnerBusinessId] = useState(defaultOwnerId);
  const [androidMarkerIcons, setAndroidMarkerIcons] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    addressPlaceId: null,
    addressCoords: null,
    categoryKey: "restaurant",
    offer: "",
    hours: "",
    planKey: "starter",
    tags: "",
    isOpen: true
  });
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
      .select("full_name, email, role")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      console.warn("Wello profile fetch failed:", error.message);
    }
    const metadataRole = user.user_metadata?.role;
    let nextRole = roleOverride || data?.role || metadataRole || "consumer";
    const fullName = data?.full_name || fallbackName;
    const profileEmailValue = data?.email || email;

    if (!data || roleOverride) {
      const { error: upsertError } = await supabase.from("profiles").upsert({
        id: user.id,
        email: profileEmailValue,
        full_name: fullName,
        role: nextRole
      });
      if (upsertError && !data) {
        console.warn("Wello profile upsert failed:", upsertError.message);
        nextRole = roleOverride || "consumer";
      }
    }

    setProfileName(fullName);
    setProfileEmail(profileEmailValue);
    setAccountRole(nextRole);
    console.log("Wello role hydrate:", {
      email: profileEmailValue,
      role: nextRole,
      profileFound: Boolean(data)
    });
    return nextRole;
  }, []);

  useEffect(() => {
    let isMounted = true;
    Font.loadAsync({
      "Rubik-Regular": require("./assets/rubik/static/Rubik-Regular.ttf"),
      "Rubik-Medium": require("./assets/rubik/static/Rubik-Medium.ttf"),
      "Rubik-SemiBold": require("./assets/rubik/static/Rubik-SemiBold.ttf"),
      "Rubik-Bold": require("./assets/rubik/static/Rubik-Bold.ttf")
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
      }
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
          accuracy: Location.Accuracy.Balanced
        });
        if (!isMounted) return;
        const nextRegion = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          latitudeDelta: MAP_REGION.latitudeDelta,
          longitudeDelta: MAP_REGION.longitudeDelta
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
            "created_at"
          ].join(",")
        )
        .order("created_at", { ascending: false });

      if (!isMounted) return;
      if (error) {
        setRemoteStatus({
          loading: false,
          error: error.message || "Unable to load businesses."
        });
        return;
      }

      if (Array.isArray(data) && data.length) {
        const mapped = data.map(mapSupabaseBusiness);
        setBusinesses(mapped);
      }
      setRemoteStatus({ loading: false, error: null });
    };

    loadRemoteBusinesses();
    return () => {
      isMounted = false;
    };
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
                config.color
              ),
              Ionicons.getImageSource(
                config.icon,
                ANDROID_MARKER_SELECTED_SIZE,
                COLORS.white
              )
            ]);
            if (normalSource) normal[key] = normalSource;
            if (haloSource) halo[key] = haloSource;
          })
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
          query
        )}&types=address&key=${GOOGLE_PLACES_KEY}`
      )
        .then((response) => response.json())
        .then((data) => {
          if (addressRequestRef.current !== requestId) return;
          if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
            setAddressError(data.error_message || "Unable to load suggestions.");
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
          query
        )}&types=address&key=${GOOGLE_PLACES_KEY}`
      )
        .then((response) => response.json())
        .then((data) => {
          if (businessAddressRequestRef.current !== requestId) return;
          if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
            setBusinessAddressError(
              data.error_message || "Unable to load suggestions."
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
        business.createdAt &&
        Date.now() - business.createdAt <= NEW_WINDOW_MS,
      family: (business) => business.tags.includes("family")
    }),
    []
  );

  const approvedBusinesses = useMemo(
    () => businesses.filter((business) => business.approved && !business.rejected),
    [businesses]
  );

  const filteredBusinesses = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const baseList = approvedBusinesses.filter((business) =>
      activeFilters.every((filterKey) =>
        filterPredicates[filterKey]
          ? filterPredicates[filterKey](business)
          : true
      )
    );
    if (!trimmed) return baseList;
    return baseList.filter((business) => {
      const haystack = [
        business.name,
        business.category,
        business.offer,
        business.subscription,
        business.tags.join(" ")
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [query, approvedBusinesses, activeFilters, filterPredicates]);

  const ownerBusiness = useMemo(() => {
    if (authUserId) {
      return (
        businesses.find((business) => business.ownerId === authUserId) || null
      );
    }
    if (!ownerBusinessId) return null;
    return businesses.find((business) => business.id === ownerBusinessId) || null;
  }, [businesses, ownerBusinessId, authUserId]);
  const canRequestEdits = Boolean(ownerBusiness) && !ownerBusiness?.pendingEdits;
  const canEditBusiness = isEditingBusiness && !ownerBusiness?.pendingEdits;

  const ownerMetrics = useMemo(() => {
    if (!ownerBusiness) return DEFAULT_ANALYTICS;
    return BUSINESS_ANALYTICS[ownerBusiness.id] || DEFAULT_ANALYTICS;
  }, [ownerBusiness]);

  const pendingEditBusinesses = useMemo(
    () => businesses.filter((business) => business.pendingEdits),
    [businesses]
  );
  const isAdmin = accountRole === "admin";
  const isOwner = accountRole === "business_owner";
  const roleLabel = isAdmin ? "Admin" : isOwner ? "Owner" : "Member";
  const visibleTabs = useMemo(
    () => [
      { key: "discover", label: "Discover", show: true },
      { key: "business", label: "Business", show: isOwner },
      { key: "admin", label: "Admin", show: isAdmin },
      { key: "profile", label: "Profile", show: true }
    ].filter((tab) => tab.show),
    [isOwner, isAdmin]
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
    () => businesses.filter((business) => !business.approved && !business.rejected),
    [businesses]
  );
  const averageRating = useMemo(() => {
    const rated = approvedBusinesses.filter(
      (business) => business.rating && Number.isFinite(business.rating)
    );
    if (!rated.length) return "--";
    const sum = rated.reduce((acc, business) => acc + business.rating, 0);
    return (sum / rated.length).toFixed(1);
  }, [approvedBusinesses]);

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
      loadInvites();
    }
  }, [activeTab, isAdmin, loadInvites]);

  useEffect(() => {
    if (activeTab === "admin" && !isAdmin) {
      setActiveTab("discover");
    }
    if (activeTab === "business" && !isOwner) {
      setActiveTab("discover");
    }
  }, [activeTab, isAdmin, isOwner]);

  const buildFormFromBusiness = (business) => ({
    name: business?.name || "",
    address: business?.address || "",
    addressPlaceId: null,
    addressCoords: business?.coordinate || null,
    categoryKey: business?.categoryKey || "restaurant",
    offer: business?.offer || "",
    hours: business?.hours || "",
    planKey: getPlanKeyFromSubscription(business?.subscription || ""),
    tags: business?.tags?.join(", ") || "",
    isOpen: business?.isOpen ?? true
  });

  useEffect(() => {
    if (activeTab !== "business" || !ownerBusiness) return;
    setFormData(buildFormFromBusiness(ownerBusiness));
    setFormMessage(null);
    setIsEditingBusiness(false);
  }, [activeTab, ownerBusiness?.id]);

  const ensureSupabaseReady = (setError) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setError("Supabase is not configured yet.");
      return false;
    }
    return true;
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
        password: signInPassword
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
      let inviteRole = null;
      let inviteId = null;

      if (signUpCode.trim()) {
        const normalizedCode = signUpCode.trim().toUpperCase();
        const { data, error } = await supabase
          .from("invites")
          .select("id, role, used_at")
          .eq("code", normalizedCode)
          .limit(1)
          .maybeSingle();

        if (error || !data || data.used_at) {
          setSignUpError("That invite code is not valid.");
          return;
        }
        if (data.role === "business_owner") {
          setSignUpError(
            "Use the business signup form for business invites."
          );
          return;
        }
        inviteRole = data.role || "admin";
        inviteId = data.id;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password: signUpPassword,
        options: inviteRole ? { data: { role: inviteRole } } : undefined
      });
      if (error) {
        setSignUpError(error.message || "Unable to create account.");
        return;
      }
      if (!data.user) {
        setSignUpError("Check your email to confirm your account.");
        return;
      }
      if (inviteId) {
        const { error: updateError } = await supabase
          .from("invites")
          .update({
            used_at: new Date().toISOString(),
            used_by: email,
            used_by_name: formatDisplayName(email),
            used_by_user_id: data.user.id
          })
          .eq("id", inviteId)
          .is("used_at", null);
        if (updateError) {
          setSignUpError("Unable to claim invite code. Try again.");
          return;
        }
      }
      await hydrateProfile(data.user, inviteRole || "consumer");
      setIsSignedIn(true);
      setSignUpPassword("");
      setSignUpCode("");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleBusinessSignUp = async () => {
    if (!businessEmail.trim() || !businessPassword.trim()) {
      setBusinessSignUpError("Email and password are required.");
      return;
    }
    if (!businessInviteCode.trim()) {
      setBusinessSignUpError("A business invite code is required.");
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
      const normalizedCode = businessInviteCode.trim().toUpperCase();
      const { data: invite, error } = await supabase
        .from("invites")
        .select("id, role, used_at")
        .eq("code", normalizedCode)
        .limit(1)
        .maybeSingle();

      if (error || !invite || invite.used_at) {
        setBusinessSignUpError("That invite code is not valid.");
        return;
      }
      if (invite.role !== "business_owner") {
        setBusinessSignUpError("This invite is not for business accounts.");
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password: businessPassword,
        options: { data: { role: "business_owner" } }
      });
      if (signUpError) {
        setBusinessSignUpError(signUpError.message || "Unable to create account.");
        return;
      }
      if (!data.user) {
        setBusinessSignUpError("Check your email to confirm your account.");
        return;
      }

      const { error: updateError } = await supabase
        .from("invites")
        .update({
          used_at: new Date().toISOString(),
          used_by: email,
          used_by_name: formatDisplayName(email),
          used_by_business_name: businessName.trim(),
          used_by_user_id: data.user.id
        })
        .eq("id", invite.id)
        .is("used_at", null);
      if (updateError) {
        setBusinessSignUpError("Unable to claim invite code. Try again.");
        return;
      }

      await hydrateProfile(data.user, "business_owner");

      const categoryConfig = getCategoryConfig(businessCategoryKey);
      const hoursValue = formatBusinessHours(
        businessHoursStart,
        businessHoursStartMeridiem,
        businessHoursEnd,
        businessHoursEndMeridiem
      );
      const { data: businessRows, error: businessError } = await supabase
        .from("businesses")
        .insert({
          owner_id: data.user.id,
          name: businessName.trim(),
          address: businessAddress.trim(),
          phone: businessPhone.trim() || null,
          category_key: businessCategoryKey,
          category_label: categoryConfig.display,
          hours: hoursValue,
          subscription_plan: "Starter",
          subscription_price_cents: 5000,
          approval_status: "pending",
          status: "active",
          is_open: true
        })
        .select(
          [
            "id",
            "owner_id",
            "name",
            "address",
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
            "created_at"
          ].join(",")
        )
        .limit(1);

      if (businessError) {
        setBusinessSignUpError(
          "Account created, but business profile needs review."
        );
      } else if (businessRows?.[0]) {
        const mapped = mapSupabaseBusiness(businessRows[0], 0);
        setBusinesses((prev) => [mapped, ...prev]);
        setOwnerBusinessId(mapped.id);
      }

      setIsSignedIn(true);
      setBusinessPassword("");
      setBusinessInviteCode("");
      setBusinessName("");
      setBusinessAddress("");
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
    } else {
      setBusinessHoursEnd(time);
    }
    setTimePickerVisible(false);
  };

  const handleProfileSave = () => {
    setProfileMessage("Profile updated.");
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
    setSignInError(null);
    setSignUpError(null);
    setBusinessSignUpError(null);
    setSignInEmail("");
    setSignUpEmail("");
    setSignUpCode("");
    setBusinessEmail("");
    setBusinessInviteCode("");
    setBusinessName("");
    setBusinessAddress("");
    setBusinessPhone("");
    setBusinessHoursStart("");
    setBusinessHoursEnd("");
    setBusinessHoursStartMeridiem("AM");
    setBusinessHoursEndMeridiem("PM");
    setTimePickerVisible(false);
    setTimePickerTarget("start");
    setAuthView("menu");
    setActiveTab("discover");
  };

  const handleRedeemOffer = (business) => {
    setScannerBusiness(business);
    setScannerStatus(null);
    setScannerEnabled(true);
    setScannerVisible(true);
  };

  const handleCloseScanner = () => {
    setScannerVisible(false);
    setScannerStatus(null);
    setScannerEnabled(true);
  };

  const handleScanCode = ({ data }) => {
    if (!scannerEnabled || !scannerBusiness) return;
    setScannerEnabled(false);
    const expected = getBusinessQrCode(scannerBusiness);
    if (data && expected && data.includes(expected)) {
      setScannerStatus("success");
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
        accuracy: Location.Accuracy.Balanced
      });
      mapRef.current?.animateToRegion(
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          latitudeDelta: MAP_REGION.latitudeDelta,
          longitudeDelta: MAP_REGION.longitudeDelta
        },
        700
      );
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
      friction: 12
    }).start();
  };

  const scrollToBusiness = (business) => {
    const index = filteredBusinesses.findIndex((item) => item.id === business.id);
    if (index >= 0 && cardListRef.current) {
      cardListRef.current.scrollToIndex({ index, animated: true });
    }
  };

  const openSheetForBusiness = (business) => {
    setSelectedId(business.id);
    openSheet("discover");
    scrollToBusiness(business);
  };

  const handleCardPress = (business) => {
    openSheetForBusiness(business);
    mapRef.current?.animateToRegion(
      {
        ...business.coordinate,
        latitudeDelta: MAP_REGION.latitudeDelta,
        longitudeDelta: MAP_REGION.longitudeDelta
      },
      500
    );
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
        : [...prev, filterKey]
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
      addressCoords: null
    }));
  };

  const handleBusinessAddressChange = (value) => {
    businessAddressSelectionRef.current = false;
    setBusinessAddressError(null);
    setBusinessAddress(value);
  };

  const handleSelectBusinessSuggestion = async (suggestion) => {
    businessAddressSelectionRef.current = true;
    setBusinessAddressResults([]);
    setBusinessAddressError(null);
    setBusinessAddress(suggestion.description);

    if (!GOOGLE_PLACES_KEY) return;
    try {
      setBusinessAddressLoading(true);
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
          suggestion.place_id
        )}&fields=formatted_address&key=${GOOGLE_PLACES_KEY}`
      );
      const data = await response.json();
      if (data.status && data.status !== "OK") {
        throw new Error(data.error_message || "Unable to load place details.");
      }
      if (data.result?.formatted_address) {
        setBusinessAddress(data.result.formatted_address);
      }
    } catch (error) {
      setBusinessAddressError(error.message || "Unable to load place details.");
    } finally {
      setBusinessAddressLoading(false);
    }
  };

  const handleSelectSuggestion = async (suggestion) => {
    addressSelectionRef.current = true;
    setAddressResults([]);
    setAddressError(null);
    setFormData((prev) => ({
      ...prev,
      address: suggestion.description,
      addressPlaceId: suggestion.place_id
    }));

    if (!GOOGLE_PLACES_KEY) return;
    try {
      setAddressLoading(true);
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
          suggestion.place_id
        )}&fields=geometry,formatted_address&key=${GOOGLE_PLACES_KEY}`
      );
      const data = await response.json();
      if (data.status && data.status !== "OK") {
        throw new Error(data.error_message || "Unable to load place details.");
      }
      const location = data.result?.geometry?.location;
      if (location) {
        setFormData((prev) => ({
          ...prev,
          address: data.result.formatted_address || prev.address,
          addressCoords: { latitude: location.lat, longitude: location.lng }
        }));
        mapRef.current?.animateToRegion(
          {
            latitude: location.lat,
            longitude: location.lng,
            latitudeDelta: MAP_REGION.latitudeDelta,
            longitudeDelta: MAP_REGION.longitudeDelta
          },
          600
        );
      }
    } catch (error) {
      setAddressError(error.message || "Unable to load place details.");
    } finally {
      setAddressLoading(false);
    }
  };

  const handleSaveBusiness = () => {
    if (!ownerBusiness) return;
    if (!formData.name.trim() || !formData.offer.trim()) {
      setFormMessage({
        type: "error",
        text: "Business name and offer are required."
      });
      return;
    }

    const tagList = formData.tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    const trimmedName = formData.name.trim();
    const trimmedAddress = formData.address.trim();
    const trimmedOffer = formData.offer.trim();
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
    if (formData.categoryKey !== ownerBusiness.categoryKey) {
      pendingEdits.categoryKey = formData.categoryKey;
    }
    if (trimmedOffer !== ownerBusiness.offer) {
      pendingEdits.offer = trimmedOffer;
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
      category: categoryDisplay,
      categoryKey: nextCategoryKey,
      offer: hasPendingEdits ? ownerBusiness.offer : trimmedOffer,
      subscription: `${approvedPlan.label} ${approvedPlan.price}`,
      tags: tagList.length ? tagList : ["local"],
      isOpen: formData.isOpen,
      hours: formData.hours.trim() || ownerBusiness.hours,
      coordinate: hasPendingEdits
        ? ownerBusiness.coordinate
        : formData.addressCoords || ownerBusiness.coordinate,
      pendingEdits: hasPendingEdits ? pendingEdits : null,
      pendingEditsAt: hasPendingEdits ? Date.now() : null
    };

    setBusinesses((prev) =>
      prev.map((business) =>
        business.id === ownerBusiness.id ? updatedBusiness : business
      )
    );
    setFormMessage({
      type: "success",
      text: hasPendingEdits
        ? "Changes sent for approval. You'll see updates once approved."
        : "Changes saved."
    });
    setIsEditingBusiness(false);
  };

  const handleApprove = (id) => {
    setBusinesses((prev) =>
      prev.map((business) =>
        business.id === id ? { ...business, approved: true } : business
      )
    );
  };

  const handleApproveEdits = (id) => {
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
          pendingEditsAt: null
        };
      })
    );
  };

  const handleRejectEdits = (id) => {
    setBusinesses((prev) =>
      prev.map((business) =>
        business.id === id
          ? { ...business, pendingEdits: null, pendingEditsAt: null }
          : business
      )
    );
  };

  const handleReject = (id) => {
    setBusinesses((prev) =>
      prev.map((business) =>
        business.id === id ? { ...business, rejected: true } : business
      )
    );
  };

  const handleScrollToIndexFailed = (info) => {
    const target = Math.max(0, info.highestMeasuredFrameIndex);
    cardListRef.current?.scrollToIndex({ index: target, animated: true });
  };

  const loadInvites = useCallback(async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setInviteStatus({
        loading: false,
        error: "Supabase is not configured for invites yet.",
        code: null
      });
      return;
    }
    const { data, error } = await supabase
      .from("invites")
      .select(
        "id, code, role, used_at, created_at, used_by, used_by_name, used_by_business_name"
      )
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) {
      setInviteStatus({
        loading: false,
        error: error.message || "Unable to load invite codes.",
        code: null
      });
      return;
    }
    setInviteList(Array.isArray(data) ? data : []);
    setInviteStatus((prev) => ({ ...prev, error: null }));
  }, []);

  const handleGenerateInvite = async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setInviteStatus({
        loading: false,
        error: "Supabase is not configured for invites yet.",
        code: null
      });
      return;
    }
    setInviteStatus({ loading: true, error: null, code: null });
    const code = generateInviteCode();
    const { error } = await supabase.from("invites").insert({
      code,
      role: inviteRole,
      generated_by: profileEmail || authEmail || null
    });
    if (error) {
      setInviteStatus({
        loading: false,
        error: error.message || "Unable to create invite code.",
        code: null
      });
      return;
    }
    setInviteStatus({ loading: false, error: null, code });
    await loadInvites();
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
          COLLAPSED_Y
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
          friction: 12
        }).start();
      }
    })
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
            return (
              <React.Fragment key={business.id}>
                {Platform.OS === "android" && useAndroidImages && isSelected && androidHalo && (
                  <Marker
                    coordinate={business.coordinate}
                    anchor={{ x: 0.5, y: 0.5 }}
                    image={androidHalo}
                    zIndex={1}
                    onPress={() => handleMarkerPress(business)}
                  />
                )}
                <Marker
                  coordinate={business.coordinate}
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
                          isSelected && styles.markerIconSelected
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
                            { backgroundColor: category.color }
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
                        isActive && styles.navPillTextActive
                      ]}
                    >
                      {tab.label}
                    </Text>
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
                ) : (
                  <CameraView
                    onBarcodeScanned={scannerEnabled ? handleScanCode : undefined}
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    style={styles.scanner}
                  />
                )}
                <View style={styles.scannerFrameOutline} pointerEvents="none" />
              </View>

              <View style={styles.scannerStatus}>
                <Text style={styles.scannerStatusText}>
                  {scannerStatus === "success"
                    ? "Offer redeemed. Show this confirmation to the staff."
                    : scannerStatus === "invalid"
                    ? "That code does not match this offer. Try again."
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
                style={[styles.searchRow, IS_COMPACT && styles.searchRowCompact]}
              >
                <TextInput
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
                          isActive && styles.filterPillActive
                        ]}
                        onPress={() => toggleFilter(filter.key)}
                      >
                        <Text
                          style={[
                            styles.filterText,
                            isActive && styles.filterTextActive
                          ]}
                        >
                          {filter.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {(remoteStatus.loading || remoteStatus.error) && (
                <View style={styles.remoteNotice}>
                  <Text style={styles.remoteNoticeText}>
                    {remoteStatus.loading
                      ? "Loading businesses from Wello..."
                      : remoteStatus.error}
                  </Text>
                </View>
              )}

              <View style={styles.cardHeaderRow}>
                <Text style={styles.sectionTitle}>Offer cards</Text>
                <Text style={styles.sectionMeta}>
                  {filteredBusinesses.length} nearby
                </Text>
              </View>

              {filteredBusinesses.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>No listings match.</Text>
                  <Text style={styles.emptyCopy}>
                    Try a different search or reset filters.
                  </Text>
                </View>
              ) : (
                <FlatList
                  ref={cardListRef}
                  data={filteredBusinesses}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <OfferCard
                      item={item}
                      onPress={() => handleCardPress(item)}
                      onRedeem={() => handleRedeemOffer(item)}
                      selected={selectedId === item.id}
                    />
                  )}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.cardList}
                  getItemLayout={(_, index) => ({
                    length: CARD_WIDTH + CARD_GAP,
                    offset: (CARD_WIDTH + CARD_GAP) * index,
                    index
                  })}
                  onScrollToIndexFailed={handleScrollToIndexFailed}
                />
              )}

            </>
          ) : (
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              style={styles.sheetScroll}
            >
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.sheetScrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {activeTab === "business" && isOwner ? (
                  <>
                    <View style={styles.sectionBlock}>
                      <Text style={styles.sectionTitleAlt}>
                        Business dashboard
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
                      <Text style={styles.sectionTitleAlt}>Business info</Text>
                      <Text style={styles.sectionBody}>
                        Update what customers see on your listing. Changes to name,
                        address, category, and offers require approval.
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
                              {getCategoryConfig(ownerBusiness.categoryKey).display}{" "}
                              - {ownerBusiness.subscription}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.statusPill,
                              ownerBusiness.isOpen
                                ? styles.statusApproved
                                : styles.statusRejected
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
                              Updates to your name, address, category, or offer
                              are reviewed before they go live.
                            </Text>
                            <View style={styles.pendingList}>
                              {Object.keys(ownerBusiness.pendingEdits)
                                .filter((field) => field !== "coordinate")
                                .map((field) => (
                                  <View key={field} style={styles.pendingPill}>
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
                                !canRequestEdits && styles.primaryButtonDisabled
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
                        <TextInput
                          style={[
                            styles.formInput,
                            !canEditBusiness && styles.formInputDisabled
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
                        <TextInput
                          style={[
                            styles.formInput,
                            !canEditBusiness && styles.formInputDisabled
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
                                {result.structured_formatting?.secondary_text && (
                                  <Text style={styles.suggestionSubtitle}>
                                    {result.structured_formatting.secondary_text}
                                  </Text>
                                )}
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}

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
                                  !canEditBusiness && styles.categoryChipDisabled
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
                                      styles.categoryChipTextDisabled
                                  ]}
                                >
                                  {option.label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>

                        <Text style={styles.formLabel}>Offer highlight</Text>
                        <TextInput
                          style={[
                            styles.formInput,
                            !canEditBusiness && styles.formInputDisabled
                          ]}
                          placeholder="Example: 15% off first visit"
                          placeholderTextColor={COLORS.muted}
                          value={formData.offer}
                          editable={canEditBusiness}
                          onChangeText={(value) =>
                            handleFormChange("offer", value)
                          }
                        />

                        <Text style={styles.formLabel}>Operating hours</Text>
                        <TextInput
                          style={[
                            styles.formInput,
                            !canEditBusiness && styles.formInputDisabled
                          ]}
                          placeholder="Example: 9:00 AM - 6:00 PM"
                          placeholderTextColor={COLORS.muted}
                          value={formData.hours}
                          editable={canEditBusiness}
                          onChangeText={(value) =>
                            handleFormChange("hours", value)
                          }
                        />

                        <Text style={styles.formLabel}>Subscription plan</Text>
                        <View style={styles.planRow}>
                          {PLAN_OPTIONS.filter((plan) => plan.enabled).map((plan) => {
                            const isActive = formData.planKey === plan.key;
                            const isLocked = !canEditBusiness;
                            return (
                              <TouchableOpacity
                                key={plan.key}
                                style={[
                                  styles.planOption,
                                  isActive && styles.planOptionActive,
                                  isLocked && styles.planOptionDisabled
                                ]}
                                onPress={() => handleFormChange("planKey", plan.key)}
                                disabled={isLocked}
                              >
                                <Text
                                  style={[
                                    styles.planOptionName,
                                    isActive && styles.planOptionNameActive,
                                    isLocked && styles.planOptionTextDisabled
                                  ]}
                                >
                                  {plan.label}
                                </Text>
                                <Text
                                  style={[
                                    styles.planOptionPrice,
                                    isActive && styles.planOptionPriceActive,
                                    isLocked && styles.planOptionTextDisabled
                                  ]}
                                >
                                  {plan.price}
                                </Text>
                                <Text
                                  style={[
                                    styles.planOptionDesc,
                                    isActive && styles.planOptionDescActive,
                                    isLocked && styles.planOptionTextDisabled
                                  ]}
                                >
                                  {plan.desc}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>

                        <Text style={styles.formLabel}>Tags</Text>
                        <TextInput
                          style={[
                            styles.formInput,
                            !canEditBusiness && styles.formInputDisabled
                          ]}
                          placeholder="wifi, family, happy-hour"
                          placeholderTextColor={COLORS.muted}
                          value={formData.tags}
                          editable={canEditBusiness}
                          onChangeText={(value) =>
                            handleFormChange("tags", value)
                          }
                        />

                        <Text style={styles.formHint}>
                          {formData.addressCoords
                            ? `Pinned location: ${formData.address || "Custom location"}`
                            : "Add an address to update your map pin."}
                        </Text>

                        {isEditingBusiness && (
                          <View style={styles.formActions}>
                            <TouchableOpacity
                              style={styles.primaryButton}
                              onPress={handleSaveBusiness}
                            >
                              <Text style={styles.primaryButtonText}>
                                Submit for review
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.secondaryButton}
                              onPress={() => {
                                if (ownerBusiness) {
                                  setFormData(buildFormFromBusiness(ownerBusiness));
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
                      <View style={styles.emptyState}>
                        <Text style={styles.emptyTitle}>
                          No business profile yet.
                        </Text>
                        <Text style={styles.emptyCopy}>
                          Add a business listing to manage it here.
                        </Text>
                      </View>
                    )}

                    {formMessage && (
                      <View
                        style={[
                          styles.alertBox,
                          formMessage.type === "error"
                            ? styles.alertError
                            : styles.alertSuccess
                        ]}
                      >
                        <Text style={styles.alertText}>{formMessage.text}</Text>
                      </View>
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
                              Sign in to manage your account or create a new one
                              to get started.
                            </Text>

                            <TouchableOpacity
                              style={styles.authPrimaryButton}
                              onPress={() => setAuthView("signin")}
                            >
                              <Text style={styles.authButtonText}>Sign in</Text>
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
                              Access your account to manage listings and offers.
                            </Text>

                            <Text style={styles.formLabel}>Email</Text>
                            <TextInput
                              style={styles.authInput}
                              placeholder="name@business.com"
                              placeholderTextColor={COLORS.muted}
                              value={signInEmail}
                              onChangeText={setSignInEmail}
                              keyboardType="email-address"
                              autoCapitalize="none"
                            />

                            <Text style={styles.formLabel}>Password</Text>
                            <TextInput
                              style={styles.authInput}
                              placeholder="--------"
                              placeholderTextColor={COLORS.muted}
                              value={signInPassword}
                              onChangeText={setSignInPassword}
                              secureTextEntry
                            />

                            {signInError && (
                              <Text style={styles.formError}>{signInError}</Text>
                            )}

                            <TouchableOpacity
                              style={[
                                styles.authButton,
                                authBusy && styles.authButtonDisabled
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

                            <Text style={styles.authTitle}>Create account</Text>
                            <Text style={styles.authSubtitle}>
                              Create a member account. Admin invite codes work
                              here.
                            </Text>

                            <Text style={styles.formLabel}>Email</Text>
                            <TextInput
                              style={styles.authInput}
                              placeholder="name@business.com"
                              placeholderTextColor={COLORS.muted}
                              value={signUpEmail}
                              onChangeText={setSignUpEmail}
                              keyboardType="email-address"
                              autoCapitalize="none"
                            />

                            <Text style={styles.formLabel}>Password</Text>
                            <TextInput
                              style={styles.authInput}
                              placeholder="--------"
                              placeholderTextColor={COLORS.muted}
                              value={signUpPassword}
                              onChangeText={setSignUpPassword}
                              secureTextEntry
                            />

                            <Text style={styles.formLabel}>Invite code</Text>
                            <TextInput
                              style={styles.authInput}
                              placeholder="Optional"
                              placeholderTextColor={COLORS.muted}
                              value={signUpCode}
                              onChangeText={(value) =>
                                setSignUpCode(value.toUpperCase())
                              }
                              autoCapitalize="characters"
                            />
                            <Text style={styles.formHint}>
                              Optional. Admin codes unlock admin access.
                            </Text>

                            {signUpError && (
                              <Text style={styles.formError}>{signUpError}</Text>
                            )}

                            <TouchableOpacity
                              style={[
                                styles.authButton,
                                authBusy && styles.authButtonDisabled
                              ]}
                              onPress={handleCreateAccount}
                              disabled={authBusy}
                            >
                              <Text style={styles.authButtonText}>
                                {authBusy ? "Please wait..." : "Create account"}
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
                              Business invites require full business details for
                              review.
                            </Text>

                            <Text style={styles.formLabel}>Business name</Text>
                            <TextInput
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
                                      isActive && styles.categoryChipActive
                                    ]}
                                    onPress={() =>
                                      setBusinessCategoryKey(option.key)
                                    }
                                  >
                                    <Text
                                      style={[
                                        styles.categoryChipText,
                                        isActive &&
                                          styles.categoryChipTextActive
                                      ]}
                                    >
                                      {option.label}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>

                            <Text style={styles.formLabel}>Business address</Text>
                            <TextInput
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

                            <Text style={styles.formLabel}>Phone</Text>
                            <TextInput
                              style={styles.authInput}
                              placeholder="(555) 123-4567"
                              placeholderTextColor={COLORS.muted}
                              value={businessPhone}
                              onChangeText={setBusinessPhone}
                              keyboardType="phone-pad"
                            />

                            <Text style={styles.formLabel}>Operating hours</Text>
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
                                        businessHoursStartMeridiem === label;
                                      return (
                                        <TouchableOpacity
                                          key={label}
                                          style={[
                                            styles.timeMeridiemPill,
                                            isActive &&
                                              styles.timeMeridiemPillActive
                                          ]}
                                          onPress={() =>
                                            setBusinessHoursStartMeridiem(label)
                                          }
                                        >
                                          <Text
                                            style={[
                                              styles.timeMeridiemText,
                                              isActive &&
                                                styles.timeMeridiemTextActive
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
                                        businessHoursEndMeridiem === label;
                                      return (
                                        <TouchableOpacity
                                          key={label}
                                          style={[
                                            styles.timeMeridiemPill,
                                            isActive &&
                                              styles.timeMeridiemPillActive
                                          ]}
                                          onPress={() =>
                                            setBusinessHoursEndMeridiem(label)
                                          }
                                        >
                                          <Text
                                            style={[
                                              styles.timeMeridiemText,
                                              isActive &&
                                                styles.timeMeridiemTextActive
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
                            <TextInput
                              style={styles.authInput}
                              placeholder="owner@business.com"
                              placeholderTextColor={COLORS.muted}
                              value={businessEmail}
                              onChangeText={setBusinessEmail}
                              keyboardType="email-address"
                              autoCapitalize="none"
                            />

                            <Text style={styles.formLabel}>Password</Text>
                            <TextInput
                              style={styles.authInput}
                              placeholder="--------"
                              placeholderTextColor={COLORS.muted}
                              value={businessPassword}
                              onChangeText={setBusinessPassword}
                              secureTextEntry
                            />

                            <Text style={styles.formLabel}>Invite code</Text>
                            <TextInput
                              style={styles.authInput}
                              placeholder="Required"
                              placeholderTextColor={COLORS.muted}
                              value={businessInviteCode}
                              onChangeText={(value) =>
                                setBusinessInviteCode(value.toUpperCase())
                              }
                              autoCapitalize="characters"
                            />

                            {businessSignUpError && (
                              <Text style={styles.formError}>
                                {businessSignUpError}
                              </Text>
                            )}

                            <TouchableOpacity
                              style={[
                                styles.authButton,
                                authBusy && styles.authButtonDisabled
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

                        <View style={styles.formCard}>
                          <Text style={styles.formLabel}>Full name</Text>
                          <TextInput
                            style={styles.formInput}
                            placeholder="Your name"
                            placeholderTextColor={COLORS.muted}
                            value={profileName}
                            onChangeText={setProfileName}
                          />

                          <Text style={styles.formLabel}>Email</Text>
                          <TextInput
                            style={styles.formInput}
                            placeholder="name@business.com"
                            placeholderTextColor={COLORS.muted}
                            value={profileEmail}
                            onChangeText={setProfileEmail}
                            keyboardType="email-address"
                            autoCapitalize="none"
                          />

                          <Text style={styles.formLabel}>Phone</Text>
                          <TextInput
                            style={styles.formInput}
                            placeholder="(555) 123-4567"
                            placeholderTextColor={COLORS.muted}
                            value={profilePhone}
                            onChangeText={setProfilePhone}
                            keyboardType="phone-pad"
                          />

                          <Text style={styles.formLabel}>Company</Text>
                          <TextInput
                            style={styles.formInput}
                            placeholder="Business name"
                            placeholderTextColor={COLORS.muted}
                            value={profileCompany}
                            onChangeText={setProfileCompany}
                          />

                          {isAdmin && (
                            <View style={styles.roleRow}>
                              <Text style={styles.formLabel}>Account role</Text>
                              <View style={styles.rolePillRow}>
                                {[
                                  { key: "consumer", label: "Member" },
                                  { key: "business_owner", label: "Business" },
                                  { key: "admin", label: "Admin" }
                                ].map((role) => {
                                  const isActive = accountRole === role.key;
                                  return (
                                    <TouchableOpacity
                                      key={role.key}
                                      style={[
                                        styles.rolePill,
                                        isActive && styles.rolePillActive
                                      ]}
                                      onPress={() => {
                                        setAccountRole(role.key);
                                        setProfileMessage(null);
                                      }}
                                    >
                                      <Text
                                        style={[
                                          styles.rolePillText,
                                          isActive && styles.rolePillTextActive
                                        ]}
                                      >
                                        {role.label}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </View>
                          )}

                          <View style={styles.profileMetaRow}>
                            <View style={styles.profileMetaCard}>
                              <Text style={styles.profileMetaLabel}>Plan</Text>
                              <Text style={styles.profileMetaValue}>
                                {ownerBusiness?.subscription || "Starter $50/mo"}
                              </Text>
                            </View>
                            <View style={styles.profileMetaCard}>
                              <Text style={styles.profileMetaLabel}>Listings</Text>
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
                          <View style={[styles.alertBox, styles.alertSuccess]}>
                            <Text style={styles.alertText}>{profileMessage}</Text>
                          </View>
                        )}
                      </>
                    )}
                  </>
                ) : activeTab === "admin" && isAdmin ? (
                  <>
                    <View style={styles.sectionBlock}>
                      <Text style={styles.sectionTitleAlt}>Admin review</Text>
                      <Text style={styles.sectionBody}>
                        Approve new listings before they go live.
                      </Text>
                    </View>

                    <View style={styles.sectionBlock}>
                      <Text style={styles.sectionTitleAlt}>Pending edits</Text>
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
                              {getCategoryConfig(business.categoryKey).display}
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
                                  styles.adminActionTextDark
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
                      <Text style={styles.sectionTitleAlt}>Invite codes</Text>
                      <Text style={styles.sectionBody}>
                        Generate one-time codes for business owners and admins.
                      </Text>
                    </View>

                    <View style={styles.invitePanel}>
                      <View style={styles.rolePillRow}>
                        {[
                          { key: "business_owner", label: "Business" },
                          { key: "admin", label: "Admin" }
                        ].map((role) => {
                          const isActive = inviteRole === role.key;
                          return (
                            <TouchableOpacity
                              key={role.key}
                              style={[
                                styles.rolePill,
                                isActive && styles.rolePillActive
                              ]}
                              onPress={() => setInviteRole(role.key)}
                            >
                              <Text
                                style={[
                                  styles.rolePillText,
                                  isActive && styles.rolePillTextActive
                                ]}
                              >
                                {role.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.primaryButton,
                          inviteStatus.loading && styles.primaryButtonDisabled
                        ]}
                        onPress={handleGenerateInvite}
                        disabled={inviteStatus.loading}
                      >
                        <Text style={styles.primaryButtonText}>
                          {inviteStatus.loading
                            ? "Generating..."
                            : "Generate invite code"}
                        </Text>
                      </TouchableOpacity>

                      {inviteStatus.code && (
                        <View style={styles.inviteCodeBox}>
                          <Text style={styles.inviteCodeLabel}>
                            New invite code
                          </Text>
                          <Text style={styles.inviteCodeText}>
                            {inviteStatus.code}
                          </Text>
                        </View>
                      )}

                      {inviteStatus.error && (
                        <Text style={styles.formError}>{inviteStatus.error}</Text>
                      )}
                    </View>

                    {inviteList.length === 0 ? (
                      <View style={styles.emptyState}>
                        <Text style={styles.emptyTitle}>No invites yet.</Text>
                        <Text style={styles.emptyCopy}>
                          Generate a code to invite a business or admin account.
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.inviteList}>
                        {inviteList.map((invite) => {
                          const isUsed = Boolean(invite.used_at);
                          const usedByLine = isUsed
                            ? [
                                invite.used_by_name,
                                invite.used_by,
                                invite.used_by_business_name
                              ]
                                .filter(Boolean)
                                .join(" • ")
                            : null;
                          return (
                            <View key={invite.id} style={styles.inviteRow}>
                              <View>
                                <Text style={styles.inviteRowCode}>
                                  {invite.code}
                                </Text>
                                <Text style={styles.inviteRowMeta}>
                                  {INVITE_ROLE_LABELS[invite.role] ||
                                    "Invite"}{" "}
                                  • {isUsed ? "Used" : "Unused"}
                                </Text>
                                {usedByLine && (
                                  <Text style={styles.inviteRowMeta}>
                                    {usedByLine}
                                  </Text>
                                )}
                              </View>
                              <View
                                style={[
                                  styles.inviteStatus,
                                  isUsed
                                    ? styles.inviteStatusUsed
                                    : styles.inviteStatusActive
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.inviteStatusText,
                                    isUsed && styles.inviteStatusTextUsed
                                  ]}
                                >
                                  {isUsed ? "Used" : "Active"}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}

                    <View style={styles.sectionBlock}>
                      <Text style={styles.sectionTitleAlt}>Business QR codes</Text>
                      <Text style={styles.sectionBody}>
                        Expand a business to show its unique QR code for in-store
                        redemption.
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
                                setQrExpandedId(isExpanded ? null : business.id)
                              }
                            >
                              <View style={styles.qrHeaderText}>
                                <Text style={styles.qrTitle}>
                                  {business.name}
                                </Text>
                                <Text style={styles.qrMeta}>
                                  {getCategoryConfig(business.categoryKey).display}
                                </Text>
                              </View>
                              <Ionicons
                                name={isExpanded ? "chevron-up" : "chevron-down"}
                                size={18}
                                color={COLORS.muted}
                              />
                            </TouchableOpacity>
                            {isExpanded && (
                              <View style={styles.qrBody}>
                                <View style={styles.qrCodeWrap}>
                                  {BUSINESS_QR_IMAGES[business.id] ? (
                                    <Image
                                      source={BUSINESS_QR_IMAGES[business.id]}
                                      style={styles.qrImage}
                                      resizeMode="contain"
                                    />
                                  ) : (
                                    <View style={styles.qrFallback}>
                                      <Text style={styles.qrFallbackText}>
                                        QR pending
                                      </Text>
                                    </View>
                                  )}
                                </View>
                                <Text style={styles.qrCodeLabel}>{payload}</Text>
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
                              {getCategoryConfig(business.categoryKey).display}
                            </Text>
                          </View>
                          <Text style={styles.adminOffer}>{business.offer}</Text>
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
                                  styles.adminActionTextDark
                                ]}
                              >
                                Reject
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
    backgroundColor: COLORS.cream
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: COLORS.cream
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.cream
  },
  authScreen: {
    flex: 1,
    backgroundColor: COLORS.cream
  },
  authContainer: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: "center"
  },
  authStack: {
    marginTop: 4,
    marginBottom: 12,
    gap: 16
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
    elevation: 3
  },
  authBrand: {
    fontSize: 22,
    color: COLORS.pine,
    fontFamily: FONT_DISPLAY,
    marginBottom: 6
  },
  authTitle: {
    fontSize: 18,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
    marginBottom: 6
  },
  authSubtitle: {
    fontSize: 13,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 18,
    marginBottom: 14
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
    marginBottom: 12
  },
  authButton: {
    backgroundColor: COLORS.pine,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4
  },
  authPrimaryButton: {
    backgroundColor: COLORS.pine,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8
  },
  authButtonDisabled: {
    backgroundColor: "#9AA7B8"
  },
  authButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontFamily: FONT_MEDIUM
  },
  authBack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8
  },
  authBackText: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM
  },
  timeRow: {
    flexDirection: "column",
    gap: 12,
    marginBottom: 12
  },
  timeBlock: {
    flex: 1,
    alignItems: "flex-start",
    gap: 6
  },
  timeLabel: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM
  },
  timeInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "stretch",
    flexWrap: "wrap"
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
    minHeight: 42
  },
  timeSelectText: {
    fontSize: IS_COMPACT ? 12 : 13,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    flexShrink: 1
  },
  timeMeridiem: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: COLORS.sand,
    borderRadius: 12,
    overflow: "hidden",
    minHeight: 42,
    width: 84
  },
  timeMeridiemPill: {
    flex: 1,
    minWidth: 42,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center"
  },
  timeMeridiemPillActive: {
    backgroundColor: COLORS.pine
  },
  timeMeridiemText: {
    fontSize: IS_COMPACT ? 10 : 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM
  },
  timeMeridiemTextActive: {
    color: COLORS.white
  },
  timePickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    padding: 20
  },
  timePickerCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 14,
    maxHeight: SCREEN_HEIGHT * 0.6
  },
  timePickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10
  },
  timePickerTitle: {
    fontSize: 14,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM
  },
  timePickerClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.mint,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  timePickerList: {
    gap: 6
  },
  timePickerItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white
  },
  timePickerText: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM
  },
  authSecondaryButton: {
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8
  },
  authToggleText: {
    textAlign: "center",
    marginTop: 12,
    color: COLORS.coral,
    fontSize: 12,
    fontFamily: FONT_MEDIUM
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
    elevation: 3
  },
  redeemButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: FONT_SEMIBOLD,
    letterSpacing: 0.3
  },
  map: {
    ...StyleSheet.absoluteFillObject
  },
  mapShade: {
    ...StyleSheet.absoluteFillObject
  },
  topMeta: {
    position: "absolute",
    top: SAFE_TOP,
    left: IS_COMPACT ? 12 : 16,
    right: IS_COMPACT ? 12 : 16
  },
  navContainer: {
    alignSelf: "center",
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: IS_COMPACT ? 16 : 18,
    padding: NAV_PADDING,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4
  },
  navScroll: {
    flexDirection: "row",
    gap: NAV_GAP,
    paddingHorizontal: 2
  },
  locateRow: {
    alignItems: "flex-end",
    marginTop: IS_COMPACT ? 8 : 10
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
    elevation: 4
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
    maxWidth: 180
  },
  locateErrorText: {
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    textAlign: "center"
  },
  scannerOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    padding: 20
  },
  scannerCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  scannerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12
  },
  scannerTitle: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY
  },
  scannerSubtitle: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2
  },
  scannerClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.mint,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  scannerFrame: {
    height: SCANNER_FRAME,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: COLORS.ink,
    justifyContent: "center",
    alignItems: "center"
  },
  scanner: {
    ...StyleSheet.absoluteFillObject
  },
  scannerFrameOutline: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.8)"
  },
  scannerBlocked: {
    padding: 20
  },
  scannerBlockedText: {
    fontSize: 12,
    color: COLORS.white,
    fontFamily: FONT_TEXT,
    textAlign: "center"
  },
  scannerStatus: {
    marginTop: 12,
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  scannerStatusText: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    textAlign: "center"
  },
  scannerActions: {
    marginTop: 12
  },
  confettiOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    overflow: "hidden"
  },
  confettiPiece: {
    position: "absolute",
    top: -24,
    borderRadius: 3,
    opacity: 0.85
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
    borderColor: COLORS.sand
  },
  navPillActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine
  },
  navPillText: {
    fontSize: IS_COMPACT ? 12 : 13,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM
  },
  navPillTextActive: {
    color: COLORS.white
  },
  primaryButton: {
    backgroundColor: COLORS.pine,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12
  },
  primaryButtonDisabled: {
    backgroundColor: "#AEB9C7"
  },
  primaryButtonText: {
    color: COLORS.white,
    fontFamily: FONT_DISPLAY,
    fontSize: 13
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12
  },
  secondaryButtonText: {
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    fontSize: 13
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
    elevation: 10
  },
  sheetScroll: {
    flex: 1
  },
  sheetScrollContent: {
    paddingBottom: 24
  },
  sheetHandle: {
    alignItems: "center",
    paddingBottom: 12
  },
  handleBar: {
    width: 48,
    height: 5,
    borderRadius: 999,
    backgroundColor: COLORS.sand,
    marginBottom: 8
  },
  sheetHint: {
    fontSize: IS_COMPACT ? 11 : 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_COMPACT ? 8 : 10,
    marginBottom: 12
  },
  searchRowCompact: {
    flexDirection: "column",
    alignItems: "stretch"
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
    borderColor: COLORS.sand
  },
  filterButton: {
    backgroundColor: COLORS.white,
    paddingVertical: IS_COMPACT ? 8 : 10,
    paddingHorizontal: IS_COMPACT ? 12 : 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  filterButtonText: {
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    fontSize: IS_COMPACT ? 12 : 13
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 12,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  statValue: {
    fontSize: 17,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10
  },
  filterPill: {
    backgroundColor: COLORS.white,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  filterPillActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine
  },
  filterText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM
  },
  filterTextActive: {
    color: COLORS.white
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8
  },
  sectionTitle: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY
  },
  sectionMeta: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT
  },
  analyticsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14
  },
  analyticsCard: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  analyticsValue: {
    fontSize: 18,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY
  },
  analyticsLabel: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2
  },
  cardList: {
    paddingBottom: 16,
    paddingRight: 8
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: IS_COMPACT ? 14 : 16,
    marginRight: CARD_GAP,
    minHeight: IS_SHORT ? 240 : 270,
    borderWidth: 1,
    borderColor: COLORS.sand,
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2
  },
  cardSelected: {
    borderColor: COLORS.coral
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  cardName: {
    fontSize: IS_COMPACT ? 14 : 15,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY
  },
  cardBadge: {
    backgroundColor: COLORS.mint,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  cardBadgeText: {
    fontSize: 10,
    color: COLORS.pine,
    fontFamily: FONT_MEDIUM
  },
  cardCategory: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 8,
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  cardOffer: {
    fontSize: IS_COMPACT ? 14 : 15,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    marginTop: 8,
    lineHeight: 20
  },
  cardMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12
  },
  cardMeta: {
    fontSize: IS_COMPACT ? 10 : 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT
  },
  cardTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10
  },
  cardMedia: {
    flexGrow: 1,
    minHeight: IS_SHORT ? 90 : 110,
    marginTop: 12,
    alignSelf: "stretch",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    borderStyle: "dashed",
    backgroundColor: "#EFF3F8",
    alignItems: "center",
    justifyContent: "center"
  },
  cardMediaLabel: {
    marginTop: 6,
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT
  },
  tagPill: {
    backgroundColor: COLORS.mint,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  tagText: {
    fontSize: 10,
    color: COLORS.ink,
    fontFamily: FONT_TEXT
  },
  emptyState: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12
  },
  emptyTitle: {
    fontSize: 14,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
    marginBottom: 4
  },
  emptyCopy: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16
  },
  sectionBlock: {
    marginBottom: 12
  },
  sectionTitleAlt: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY,
    marginBottom: 4
  },
  sectionBody: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16
  },
  formCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12
  },
  formHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12
  },
  formHeaderTitle: {
    fontSize: 15,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY
  },
  formHeaderMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2
  },
  pendingNotice: {
    backgroundColor: "#FFF7E6",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#F1D4A8",
    marginBottom: 12
  },
  pendingNoticeTitle: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginBottom: 4
  },
  pendingNoticeBody: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16,
    marginBottom: 8
  },
  pendingList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
    marginBottom: 6
  },
  pendingPill: {
    backgroundColor: COLORS.white,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#E5D1B2"
  },
  pendingPillText: {
    fontSize: 10,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM
  },
  profileCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  profileAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.mint,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  profileInitials: {
    fontSize: 16,
    color: COLORS.pine,
    fontFamily: FONT_DISPLAY
  },
  profileHeaderText: {
    flex: 1
  },
  profileName: {
    fontSize: 15,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY
  },
  profileEmail: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2
  },
  profileRolePill: {
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  profileRoleText: {
    fontSize: 11,
    color: COLORS.pine,
    fontFamily: FONT_MEDIUM
  },
  roleRow: {
    marginTop: 8,
    marginBottom: 12
  },
  rolePillRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8
  },
  rolePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white
  },
  rolePillActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine
  },
  rolePillText: {
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM
  },
  rolePillTextActive: {
    color: COLORS.white
  },
  invitePanel: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 14,
    gap: 10,
    marginBottom: 12
  },
  inviteCodeBox: {
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 12
  },
  inviteCodeLabel: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  inviteCodeText: {
    fontSize: 16,
    color: COLORS.ink,
    fontFamily: FONT_BOLD,
    marginTop: 6
  },
  inviteList: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 12,
    gap: 10,
    marginBottom: 16
  },
  inviteRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6
  },
  inviteRowCode: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM
  },
  inviteRowMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 4
  },
  inviteStatus: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1
  },
  inviteStatusActive: {
    backgroundColor: "#E8F3EC",
    borderColor: "#9AC9AE"
  },
  inviteStatusUsed: {
    backgroundColor: "#F4F6F9",
    borderColor: "#D7DEE8"
  },
  inviteStatusText: {
    fontSize: 10,
    fontFamily: FONT_MEDIUM,
    color: COLORS.pine
  },
  inviteStatusTextUsed: {
    color: COLORS.muted
  },
  profileMetaRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
    marginBottom: 6
  },
  profileMetaCard: {
    flex: 1,
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  profileMetaLabel: {
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  profileMetaValue: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginTop: 4
  },
  formLabel: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginBottom: 6
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
    marginBottom: 12
  },
  formInputDisabled: {
    backgroundColor: "#EEF2F7",
    color: "#94A3B8"
  },
  editGate: {
    backgroundColor: COLORS.mint,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.sand,
    padding: 12,
    marginBottom: 14,
    gap: 10
  },
  editGateText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 16
  },
  editGateActive: {
    backgroundColor: "#E8F3EC",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#9AC9AE",
    padding: 12,
    marginBottom: 14
  },
  editGateActiveText: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    lineHeight: 16
  },
  formHint: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginBottom: 12
  },
  remoteNotice: {
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12
  },
  remoteNoticeText: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    textAlign: "center"
  },
  formError: {
    fontSize: 11,
    color: "#B42318",
    fontFamily: FONT_TEXT,
    marginBottom: 12
  },
  suggestionList: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12,
    overflow: "hidden"
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.sand
  },
  suggestionTitle: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM
  },
  suggestionSubtitle: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2
  },
  formActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12
  },
  categoryChip: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.sand,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10
  },
  categoryChipDisabled: {
    backgroundColor: "#EEF2F7",
    borderColor: "#D6DEE8"
  },
  categoryChipActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine
  },
  categoryChipText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM
  },
  categoryChipTextDisabled: {
    color: "#9AA7B8"
  },
  categoryChipTextActive: {
    color: COLORS.white
  },
  planRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12
  },
  planOption: {
    width: "48%",
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  planOptionActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine
  },
  planOptionDisabled: {
    backgroundColor: "#EEF2F7",
    borderColor: "#D6DEE8"
  },
  planOptionName: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    marginBottom: 4
  },
  planOptionNameActive: {
    color: COLORS.white
  },
  planOptionPrice: {
    fontSize: 14,
    color: COLORS.ink,
    fontFamily: FONT_BOLD,
    marginBottom: 6
  },
  planOptionPriceActive: {
    color: COLORS.white
  },
  planOptionDesc: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    lineHeight: 15
  },
  planOptionDescActive: {
    color: "rgba(255, 255, 255, 0.8)"
  },
  planOptionTextDisabled: {
    color: "#9AA7B8"
  },
  planOptionBadge: {
    marginTop: 8,
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12
  },
  alertBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12
  },
  alertSuccess: {
    backgroundColor: "#E8F3EC",
    borderColor: "#9AC9AE"
  },
  alertError: {
    backgroundColor: "#F8E7E7",
    borderColor: "#E3A2A2"
  },
  alertText: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_TEXT
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
    alignItems: "center"
  },
  submissionTitle: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY
  },
  submissionMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2
  },
  statusPill: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  statusPending: {
    backgroundColor: "#F2E8D5"
  },
  statusApproved: {
    backgroundColor: "#DDEBE2"
  },
  statusRejected: {
    backgroundColor: "#F5DDDD"
  },
  statusText: {
    fontSize: 11,
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM
  },
  adminSummary: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12
  },
  adminCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12
  },
  adminHeader: {
    marginBottom: 6
  },
  adminTitle: {
    fontSize: 14,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY
  },
  adminMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2
  },
  adminOffer: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    marginBottom: 10
  },
  adminActions: {
    flexDirection: "row",
    gap: 8
  },
  qrCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.sand,
    marginBottom: 12
  },
  qrHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  qrHeaderText: {
    flex: 1,
    paddingRight: 12
  },
  qrTitle: {
    fontSize: 14,
    color: COLORS.ink,
    fontFamily: FONT_DISPLAY
  },
  qrMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginTop: 2
  },
  qrBody: {
    marginTop: 12,
    alignItems: "center"
  },
  qrCodeWrap: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.sand,
    backgroundColor: COLORS.white
  },
  qrImage: {
    width: QR_SIZE,
    height: QR_SIZE
  },
  qrFallback: {
    width: QR_SIZE,
    height: QR_SIZE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.mint
  },
  qrFallbackText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT
  },
  qrCodeLabel: {
    marginTop: 10,
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT
  },
  qrCodeNote: {
    marginTop: 6,
    fontSize: 10,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    textAlign: "center"
  },
  adminApprove: {
    flex: 1,
    backgroundColor: COLORS.pine,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center"
  },
  adminReject: {
    flex: 1,
    backgroundColor: COLORS.white,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    alignItems: "center"
  },
  adminActionText: {
    fontSize: 12,
    color: COLORS.white,
    fontFamily: FONT_MEDIUM
  },
  adminActionTextDark: {
    color: COLORS.ink
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
    borderColor: COLORS.sand
  },
  planStripCompact: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 10
  },
  planTextWrap: {
    flex: 1,
    paddingRight: 10
  },
  planTitle: {
    color: COLORS.ink,
    fontSize: IS_COMPACT ? 12 : 13,
    fontFamily: FONT_MEDIUM,
    marginBottom: 4
  },
  planCopy: {
    color: COLORS.muted,
    fontSize: IS_COMPACT ? 11 : 12,
    fontFamily: FONT_TEXT,
    lineHeight: 16
  },
  planButton: {
    backgroundColor: COLORS.pine,
    paddingHorizontal: IS_COMPACT ? 12 : 14,
    paddingVertical: IS_COMPACT ? 8 : 10,
    borderRadius: 12
  },
  planButtonCompact: {
    alignSelf: "stretch",
    alignItems: "center"
  },
  planButtonText: {
    color: COLORS.white,
    fontSize: IS_COMPACT ? 11 : 12,
    fontFamily: FONT_MEDIUM
  },
  markerWrap: {
    width: 52,
    height: 62,
    alignItems: "center",
    justifyContent: "flex-start",
    overflow: "visible"
  },
  markerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent"
  },
  markerIconSelected: {
    borderColor: COLORS.white
  },
  markerPointerWrap: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -4
  },
  markerPointer: {
    width: 10,
    height: 10,
    borderRadius: 2,
    transform: [{ rotate: "45deg" }]
  }
});
