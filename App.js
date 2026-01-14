import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import MapView, { Callout, Marker } from "react-native-maps";
import { LinearGradient } from "expo-linear-gradient";
import * as Font from "expo-font";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_MIN = 160;
const SHEET_MAX = Math.min(SCREEN_HEIGHT * 0.72, 620);
const COLLAPSED_Y = SHEET_MAX - SHEET_MIN;
const SAFE_TOP = Platform.OS === "android"
  ? (StatusBar.currentHeight || 0) + 12
  : 12;
const CARD_WIDTH = 240;
const CARD_GAP = 12;
const NEW_WINDOW_MS = 1000 * 60 * 60 * 24 * 10;
const ADDRESS_DEBOUNCE_MS = 300;
const GOOGLE_PLACES_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

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

const BUSINESSES = [
  {
    id: "1",
    name: "Sunrise Cafe",
    category: "Cafe and Bakery",
    categoryKey: "cafe",
    offer: "Buy 1 latte, get a croissant",
    distance: "0.6 mi",
    subscription: "Growth $75/mo",
    rating: 4.8,
    tags: ["breakfast", "wifi", "open"],
    isOpen: true,
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
    distance: "1.1 mi",
    subscription: "Premium $99/mo",
    rating: 4.9,
    tags: ["classes", "trainers", "family"],
    isOpen: true,
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
    distance: "0.9 mi",
    subscription: "Starter $50/mo",
    rating: 4.6,
    tags: ["organic", "family"],
    isOpen: true,
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
    distance: "1.4 mi",
    subscription: "Growth $75/mo",
    rating: 4.7,
    tags: ["gel", "walk-in", "new"],
    isOpen: false,
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
    distance: "0.5 mi",
    subscription: "Starter $50/mo",
    rating: 4.9,
    tags: ["events", "cozy", "open"],
    isOpen: true,
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
    distance: "1.8 mi",
    subscription: "Premium $99/mo",
    rating: 4.5,
    tags: ["decor", "gifts"],
    isOpen: true,
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
    distance: "1.0 mi",
    subscription: "Starter $50/mo",
    rating: 4.6,
    tags: ["fade", "appointments", "open"],
    isOpen: true,
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
    distance: "0.8 mi",
    subscription: "Growth $75/mo",
    rating: 4.7,
    tags: ["patio", "happy-hour", "open"],
    isOpen: true,
    createdAt: daysAgo(1),
    coordinate: { latitude: 40.7161, longitude: -74.005 },
    approved: true,
    rejected: false,
    source: "seed"
  }
];

const MAP_REGION = {
  latitude: 40.7128,
  longitude: -74.006,
  latitudeDelta: 0.055,
  longitudeDelta: 0.045
};

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
    desc: "Map listing and offers"
  },
  {
    key: "growth",
    label: "Growth",
    price: "$75/mo",
    desc: "Priority placement + insights"
  },
  {
    key: "premium",
    label: "Premium",
    price: "$99/mo",
    desc: "Featured badge + campaigns"
  }
];

const CATEGORY_CONFIG = {
  restaurant: { label: "R", color: "#C45B3C", display: "Restaurant" },
  retail: { label: "S", color: "#2E4C66", display: "Retail" },
  nail: { label: "N", color: "#B07A3C", display: "Nail Salon" },
  barber: { label: "B", color: "#2F6B62", display: "Barbershop" },
  cafe: { label: "C", color: "#6E5142", display: "Cafe" },
  fitness: { label: "F", color: "#3D5E7A", display: "Fitness" },
  grocery: { label: "G", color: "#4E6B3F", display: "Grocery" },
  books: { label: "K", color: "#4F5D6A", display: "Bookshop" },
  default: { label: "L", color: COLORS.coral, display: "Local" }
};

function getCategoryConfig(categoryKey) {
  return CATEGORY_CONFIG[categoryKey] || CATEGORY_CONFIG.default;
}

function OfferCard({ item, onPress, selected }) {
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
  const [businesses, setBusinesses] = useState(BUSINESSES);
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    addressPlaceId: null,
    addressCoords: null,
    categoryKey: "restaurant",
    offer: "",
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

  const selectedBusiness = useMemo(
    () => filteredBusinesses.find((business) => business.id === selectedId),
    [filteredBusinesses, selectedId]
  );

  const pendingBusinesses = useMemo(
    () => businesses.filter((business) => !business.approved && !business.rejected),
    [businesses]
  );
  const userSubmissions = useMemo(
    () => businesses.filter((business) => business.source === "user"),
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

  const handleCardPress = (business) => {
    setSelectedId(business.id);
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
    setSelectedId(business.id);
    const index = filteredBusinesses.findIndex((item) => item.id === business.id);
    if (index >= 0 && cardListRef.current) {
      cardListRef.current.scrollToIndex({ index, animated: true });
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

  const handleSubmitListing = () => {
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
    const categoryDisplay = getCategoryConfig(formData.categoryKey).display;
    const selectedPlan =
      PLAN_OPTIONS.find((plan) => plan.key === formData.planKey) ||
      PLAN_OPTIONS[0];
    const location =
      formData.addressCoords || {
        latitude: mapRegion.latitude,
        longitude: mapRegion.longitude
      };
    const newBusiness = {
      id: `${Date.now()}`,
      name: formData.name.trim(),
      address: formData.address.trim(),
      category: categoryDisplay,
      categoryKey: formData.categoryKey,
      offer: formData.offer.trim(),
      distance: "New",
      subscription: `${selectedPlan.label} ${selectedPlan.price}`,
      rating: null,
      tags: tagList.length ? tagList : ["new"],
      isOpen: formData.isOpen,
      createdAt: Date.now(),
      coordinate: location,
      approved: false,
      rejected: false,
      source: "user"
    };

    setBusinesses((prev) => [newBusiness, ...prev]);
    setFormMessage({
      type: "success",
      text: "Listing submitted. It will appear once approved."
    });
    setFormData({
      name: "",
      address: "",
      addressPlaceId: null,
      addressCoords: null,
      categoryKey: "restaurant",
      offer: "",
      planKey: "starter",
      tags: "",
      isOpen: true
    });
  };

  const handleApprove = (id) => {
    setBusinesses((prev) =>
      prev.map((business) =>
        business.id === id ? { ...business, approved: true } : business
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

  if (!fontsLoaded && !fontError) {
    return <View style={styles.loadingScreen} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={MAP_REGION}
          onRegionChangeComplete={setMapRegion}
          customMapStyle={MAP_STYLE}
          showsCompass={false}
          showsScale={false}
          showsPointsOfInterest={false}
        >
          {filteredBusinesses.map((business) => {
            return (
              <Marker
                key={business.id}
                coordinate={business.coordinate}
                title={business.name}
                description={business.offer}
                pinColor={getCategoryConfig(business.categoryKey).color}
                onPress={() => handleMarkerPress(business)}
              >
                <Callout tooltip>
                  <View style={styles.callout}>
                    <Text style={styles.calloutTitle}>{business.name}</Text>
                    <Text style={styles.calloutMeta}>
                      {getCategoryConfig(business.categoryKey).display}
                    </Text>
                    <Text style={styles.calloutOffer}>{business.offer}</Text>
                  </View>
                </Callout>
              </Marker>
            );
          })}
          {selectedBusiness && (
            <Marker
              key={`${selectedBusiness.id}-ring`}
              coordinate={selectedBusiness.coordinate}
              anchor={{ x: 0.5, y: 1 }}
              zIndex={3}
              tracksViewChanges={false}
            >
              <View pointerEvents="none" style={styles.selectedRingWrap}>
                <View style={styles.selectedRing} />
              </View>
            </Marker>
          )}
        </MapView>

        <LinearGradient
          pointerEvents="none"
          colors={["rgba(244, 246, 249, 0.04)", "rgba(244, 246, 249, 0.96)"]}
          style={styles.mapShade}
        />

        <View style={styles.topMeta} pointerEvents="box-none">
          <View style={styles.navContainer}>
            <View style={styles.navRow}>
              {[
                { key: "discover", label: "Discover" },
                { key: "business", label: "Business" },
                { key: "admin", label: "Admin" }
              ].map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[styles.navPill, isActive && styles.navPillActive]}
                    onPress={() => setActiveTab(tab.key)}
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
            </View>
          </View>
        </View>

        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
        >
          <View style={styles.sheetHandle} {...panResponder.panHandlers}>
            <View style={styles.handleBar} />
            <Text style={styles.sheetHint}>Swipe up to explore offers</Text>
          </View>
          {activeTab === "discover" ? (
            <>
              <View style={styles.searchRow}>
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

              <View style={styles.planStrip}>
                <View style={styles.planTextWrap}>
                  <Text style={styles.planTitle}>Business subscription</Text>
                  <Text style={styles.planCopy}>
                    Plans from $50/mo include map placement, offer cards, and analytics.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.planButton}
                  onPress={() => setActiveTab("business")}
                >
                  <Text style={styles.planButtonText}>Get started</Text>
                </TouchableOpacity>
              </View>
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
                {activeTab === "business" ? (
                  <>
                    <View style={styles.sectionBlock}>
                      <Text style={styles.sectionTitleAlt}>
                        Create a business listing
                      </Text>
                      <Text style={styles.sectionBody}>
                        Listings go live after admin approval. Location is set
                        to the current map view.
                      </Text>
                    </View>

                    <View style={styles.formCard}>
                      <Text style={styles.formLabel}>Business name</Text>
                      <TextInput
                        style={styles.formInput}
                        placeholder="Business name"
                        placeholderTextColor={COLORS.muted}
                        value={formData.name}
                        onChangeText={(value) =>
                          handleFormChange("name", value)
                        }
                      />

                      <Text style={styles.formLabel}>Business address</Text>
                      <TextInput
                        style={styles.formInput}
                        placeholder="Start typing an address"
                        placeholderTextColor={COLORS.muted}
                        value={formData.address}
                        onChangeText={handleAddressChange}
                      />
                      {!GOOGLE_PLACES_KEY && (
                        <Text style={styles.formHint}>
                          Add your Google Places key in `.env` to enable address
                          autocomplete.
                        </Text>
                      )}
                      {addressLoading && (
                        <Text style={styles.formHint}>Searching addresses...</Text>
                      )}
                      {addressError && (
                        <Text style={styles.formError}>{addressError}</Text>
                      )}
                      {addressResults.length > 0 && (
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
                                isActive && styles.categoryChipActive
                              ]}
                              onPress={() =>
                                handleFormChange("categoryKey", option.key)
                              }
                            >
                              <Text
                                style={[
                                  styles.categoryChipText,
                                  isActive && styles.categoryChipTextActive
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
                        style={styles.formInput}
                        placeholder="Example: 15% off first visit"
                        placeholderTextColor={COLORS.muted}
                        value={formData.offer}
                        onChangeText={(value) =>
                          handleFormChange("offer", value)
                        }
                      />

                      <Text style={styles.formLabel}>Choose a plan</Text>
                      <View style={styles.planRow}>
                        {PLAN_OPTIONS.map((plan) => {
                          const isActive = formData.planKey === plan.key;
                          return (
                            <TouchableOpacity
                              key={plan.key}
                              style={[
                                styles.planOption,
                                isActive && styles.planOptionActive
                              ]}
                              onPress={() =>
                                handleFormChange("planKey", plan.key)
                              }
                            >
                              <Text
                                style={[
                                  styles.planOptionName,
                                  isActive && styles.planOptionNameActive
                                ]}
                              >
                                {plan.label}
                              </Text>
                              <Text
                                style={[
                                  styles.planOptionPrice,
                                  isActive && styles.planOptionPriceActive
                                ]}
                              >
                                {plan.price}
                              </Text>
                              <Text
                                style={[
                                  styles.planOptionDesc,
                                  isActive && styles.planOptionDescActive
                                ]}
                              >
                                {plan.desc}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <View style={styles.switchRow}>
                        <Text style={styles.formLabel}>Open now</Text>
                        <Switch
                          value={formData.isOpen}
                          onValueChange={(value) =>
                            handleFormChange("isOpen", value)
                          }
                          trackColor={{
                            false: COLORS.sand,
                            true: COLORS.coral
                          }}
                          thumbColor={COLORS.white}
                        />
                      </View>

                      <Text style={styles.formLabel}>Tags</Text>
                      <TextInput
                        style={styles.formInput}
                        placeholder="wifi, family, happy-hour"
                        placeholderTextColor={COLORS.muted}
                        value={formData.tags}
                        onChangeText={(value) =>
                          handleFormChange("tags", value)
                        }
                      />

                      <Text style={styles.formHint}>
                        {formData.addressCoords
                          ? `Pinned address: ${formData.address}`
                          : `Current map center: ${mapRegion.latitude.toFixed(
                              4
                            )}, ${mapRegion.longitude.toFixed(4)}`}
                      </Text>

                      <View style={styles.formActions}>
                        <TouchableOpacity
                          style={styles.primaryButton}
                          onPress={handleSubmitListing}
                        >
                          <Text style={styles.primaryButtonText}>
                            Submit listing
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.secondaryButton}
                          onPress={() => {
                            setFormData({
                              name: "",
                              address: "",
                              addressPlaceId: null,
                              addressCoords: null,
                              categoryKey: "restaurant",
                              offer: "",
                              planKey: "starter",
                              tags: "",
                              isOpen: true
                            });
                            setFormMessage(null);
                          }}
                        >
                          <Text style={styles.secondaryButtonText}>Reset</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

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

                    <View style={styles.sectionBlock}>
                      <Text style={styles.sectionTitleAlt}>
                        Your submissions
                      </Text>
                      <Text style={styles.sectionBody}>
                        Track approval status for your recent listings.
                      </Text>
                    </View>

                    {userSubmissions.length === 0 ? (
                      <View style={styles.emptyState}>
                        <Text style={styles.emptyTitle}>
                          No submissions yet.
                        </Text>
                        <Text style={styles.emptyCopy}>
                          Submit a listing to appear here.
                        </Text>
                      </View>
                    ) : (
                      userSubmissions.map((business) => (
                        <View key={business.id} style={styles.submissionCard}>
                          <View>
                            <Text style={styles.submissionTitle}>
                              {business.name}
                            </Text>
                            <Text style={styles.submissionMeta}>
                              {getCategoryConfig(business.categoryKey).display}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.statusPill,
                              business.approved
                                ? styles.statusApproved
                                : business.rejected
                                ? styles.statusRejected
                                : styles.statusPending
                            ]}
                          >
                            <Text style={styles.statusText}>
                              {business.approved
                                ? "Approved"
                                : business.rejected
                                ? "Rejected"
                                : "Pending"}
                            </Text>
                          </View>
                        </View>
                      ))
                    )}
                  </>
                ) : (
                  <>
                    <View style={styles.sectionBlock}>
                      <Text style={styles.sectionTitleAlt}>Admin review</Text>
                      <Text style={styles.sectionBody}>
                        Approve new listings before they go live.
                      </Text>
                    </View>

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
  map: {
    ...StyleSheet.absoluteFillObject
  },
  mapShade: {
    ...StyleSheet.absoluteFillObject
  },
  topMeta: {
    position: "absolute",
    top: SAFE_TOP,
    left: 16,
    right: 16
  },
  navContainer: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderRadius: 16,
    padding: 6,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3
  },
  navRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 0
  },
  navPill: {
    flex: 1,
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 0,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  navPillActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine
  },
  navPillText: {
    fontSize: 12,
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
    paddingHorizontal: 16,
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
    fontSize: 12,
    color: COLORS.muted,
    fontFamily: FONT_TEXT
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12
  },
  searchInput: {
    flex: 1,
    backgroundColor: COLORS.mint,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: FONT_TEXT,
    fontSize: 14,
    color: COLORS.ink,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  filterButton: {
    backgroundColor: COLORS.white,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  filterButtonText: {
    color: COLORS.ink,
    fontFamily: FONT_MEDIUM,
    fontSize: 13
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
  cardList: {
    paddingBottom: 16,
    paddingRight: 8
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    marginRight: CARD_GAP,
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
    fontSize: 15,
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
    fontSize: 15,
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
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT
  },
  cardTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10
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
  formHint: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_TEXT,
    marginBottom: 12
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
  categoryChipActive: {
    backgroundColor: COLORS.pine,
    borderColor: COLORS.pine
  },
  categoryChipText: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM
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
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: COLORS.sand
  },
  planTextWrap: {
    flex: 1,
    paddingRight: 10
  },
  planTitle: {
    color: COLORS.ink,
    fontSize: 13,
    fontFamily: FONT_MEDIUM,
    marginBottom: 4
  },
  planCopy: {
    color: COLORS.muted,
    fontSize: 12,
    fontFamily: FONT_TEXT,
    lineHeight: 16
  },
  planButton: {
    backgroundColor: COLORS.pine,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12
  },
  planButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontFamily: FONT_MEDIUM
  },
  callout: {
    minWidth: 180,
    maxWidth: 240,
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.sand,
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.8,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4
  },
  calloutTitle: {
    fontSize: 13,
    color: COLORS.ink,
    fontFamily: FONT_SEMIBOLD
  },
  calloutMeta: {
    fontSize: 11,
    color: COLORS.muted,
    fontFamily: FONT_MEDIUM,
    marginTop: 2
  },
  calloutOffer: {
    fontSize: 12,
    color: COLORS.ink,
    fontFamily: FONT_TEXT,
    marginTop: 6,
    lineHeight: 16
  },
  selectedRingWrap: {
    height: 40,
    width: 40,
    alignItems: "center",
    justifyContent: "flex-start"
  },
  selectedRing: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    borderColor: COLORS.white,
    backgroundColor: "rgba(255, 255, 255, 0.1)"
  }
});
