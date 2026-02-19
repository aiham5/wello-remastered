import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const plaidRedirectUri =
  process.env.PLAID_REDIRECT_URI ||
  process.env.EXPO_PUBLIC_PLAID_REDIRECT_URI ||
  "https://www.wellopartners.com/plaid-link";
const plaidAssociatedDomainsEnv =
  process.env.PLAID_IOS_ASSOCIATED_DOMAINS ||
  process.env.EXPO_PUBLIC_PLAID_IOS_ASSOCIATED_DOMAINS ||
  "applinks:www.wellopartners.com";

const parseCsv = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const derivePlaidAssociatedDomain = (uri) => {
  const raw = String(uri || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || !parsed.hostname) return null;
    return `applinks:${parsed.hostname}`;
  } catch {
    return null;
  }
};

const uniqueValues = (list) => Array.from(new Set(list.filter(Boolean)));

if (!googleMapsApiKey) {
  throw new Error(
    "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is required for EAS builds."
  );
}

export default ({ config }) => ({
  ...config,
  plugins: uniqueValues([
    ...(Array.isArray(config.plugins) ? config.plugins : []),
    "expo-secure-store",
    "expo-web-browser",
  ]),
  extra: {
    ...(config.extra ?? {}),
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: googleMapsApiKey,
    EXPO_PUBLIC_SUPABASE_URL: supabaseUrl,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey
  },
  android: {
    ...config.android,
    // Required for Android push tokens in dev/prod builds. File is uploaded to EAS via `.easignore`.
    googleServicesFile: "./android/app/google-services.json",
    config: {
      ...(config.android?.config ?? {}),
      googleMaps: {
        apiKey: googleMapsApiKey
      }
    }
  },
  ios: {
    ...config.ios,
    associatedDomains: uniqueValues([
      ...(Array.isArray(config.ios?.associatedDomains)
        ? config.ios.associatedDomains
        : []),
      ...parseCsv(plaidAssociatedDomainsEnv),
      derivePlaidAssociatedDomain(plaidRedirectUri),
    ]),
    config: {
      ...(config.ios?.config ?? {}),
      googleMapsApiKey
    }
  }
});
