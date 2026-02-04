import Constants from "expo-constants";

const processEnv = typeof process !== "undefined" ? process.env || {} : {};

const extraCandidates = [
  Constants?.expoConfig?.extra,
  Constants?.manifest?.extra,
  Constants?.manifest2?.extra,
  Constants?.manifest2?.expoClient?.extra,
  Constants?.manifest2?.expoGo?.extra,
  Constants?.manifest2?.developer?.extra,
].filter(Boolean);

const findInExtras = (key) => {
  for (const extra of extraCandidates) {
    if (extra && Object.prototype.hasOwnProperty.call(extra, key)) {
      return extra[key];
    }
  }
  return undefined;
};

export const getEnv = (key, fallback = "") => {
  if (processEnv?.[key]) return processEnv[key];
  const extraValue = findInExtras(key);
  if (extraValue !== undefined) return extraValue;
  return fallback;
};

export const getEnvSources = (key) => ({
  process: Boolean(processEnv?.[key]),
  expoConfig: Boolean(Constants?.expoConfig?.extra?.[key]),
  manifest: Boolean(Constants?.manifest?.extra?.[key]),
  manifest2: Boolean(Constants?.manifest2?.extra?.[key]),
  expoClient: Boolean(Constants?.manifest2?.expoClient?.extra?.[key]),
  expoGo: Boolean(Constants?.manifest2?.expoGo?.extra?.[key]),
  developer: Boolean(Constants?.manifest2?.developer?.extra?.[key]),
});
