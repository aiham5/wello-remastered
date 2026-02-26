import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const APP_LOGO_PATH = "./assets/logo/logo.png";
const DEFAULT_BRAND_BACKGROUND = "#FFF03B";
const DEFAULT_NOTIFICATION_COLOR = "#0B2147";
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
const pluginName = (entry) => (Array.isArray(entry) ? entry[0] : entry);
const mergePlugins = (plugins) => {
  const source = Array.isArray(plugins) ? plugins : [];
  const output = [];
  let hasSecureStore = false;
  let hasWebBrowser = false;

  source.forEach((entry) => {
    const name = pluginName(entry);
    if (name === "expo-notifications") return;
    if (name === "expo-secure-store") hasSecureStore = true;
    if (name === "expo-web-browser") hasWebBrowser = true;
    output.push(entry);
  });

  if (!hasSecureStore) output.push("expo-secure-store");
  if (!hasWebBrowser) output.push("expo-web-browser");
  output.push([
    "expo-notifications",
    {
      icon: APP_LOGO_PATH,
      color: DEFAULT_NOTIFICATION_COLOR,
    },
  ]);

  return output;
};

if (!googleMapsApiKey) {
  throw new Error(
    "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is required for EAS builds."
  );
}

export default ({ config }) => ({
  ...config,
  icon: APP_LOGO_PATH,
  notification: {
    ...(config.notification ?? {}),
    icon: APP_LOGO_PATH,
    color: DEFAULT_NOTIFICATION_COLOR,
  },
  splash: {
    ...(config.splash ?? {}),
    image: APP_LOGO_PATH,
    backgroundColor: DEFAULT_BRAND_BACKGROUND,
  },
  plugins: mergePlugins(config.plugins),
  extra: {
    ...(config.extra ?? {}),
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: googleMapsApiKey,
    EXPO_PUBLIC_SUPABASE_URL: supabaseUrl,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
  },
  android: {
    ...config.android,
    icon: APP_LOGO_PATH,
    notification: {
      ...(config.android?.notification ?? {}),
      icon: APP_LOGO_PATH,
      color: DEFAULT_NOTIFICATION_COLOR,
    },
    adaptiveIcon: {
      ...(config.android?.adaptiveIcon ?? {}),
      foregroundImage: APP_LOGO_PATH,
      backgroundColor: DEFAULT_BRAND_BACKGROUND,
    },
    // Required for Android push tokens in dev/prod builds. File is uploaded to EAS via `.easignore`.
    googleServicesFile: "./google-services.json",
    config: {
      ...(config.android?.config ?? {}),
      googleMaps: {
        apiKey: googleMapsApiKey,
      },
    },
  },
  ios: {
    ...config.ios,
    icon: APP_LOGO_PATH,
    associatedDomains: uniqueValues([
      ...(Array.isArray(config.ios?.associatedDomains)
        ? config.ios.associatedDomains
        : []),
      ...parseCsv(plaidAssociatedDomainsEnv),
      derivePlaidAssociatedDomain(plaidRedirectUri),
    ]),
    config: {
      ...(config.ios?.config ?? {}),
      googleMapsApiKey,
    },
  },
});
