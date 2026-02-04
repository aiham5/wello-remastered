import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!googleMapsApiKey) {
  throw new Error(
    "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is required to build the dev client."
  );
}

export default ({ config }) => ({
  ...config,
  extra: {
    ...(config.extra ?? {}),
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: googleMapsApiKey,
    EXPO_PUBLIC_SUPABASE_URL: supabaseUrl,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey
  },
  android: {
    ...config.android,
    config: {
      ...(config.android?.config ?? {}),
      googleMaps: {
        apiKey: googleMapsApiKey
      }
    }
  },
  ios: {
    ...config.ios,
    config: {
      ...(config.ios?.config ?? {}),
      googleMapsApiKey
    }
  }
});
