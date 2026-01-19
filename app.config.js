import "dotenv/config";

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

if (!googleMapsApiKey) {
  throw new Error(
    "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is required to build the dev client."
  );
}

export default ({ config }) => ({
  ...config,
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
