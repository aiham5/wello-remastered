import { apiRequest } from "./adminApi";

const RECEIPT_BUCKET_CANDIDATES = ["receipt-images", "receipt_uploads", "receipts"];

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return String(value || "");
  }
};

const splitStoragePath = (storagePath: string) => {
  const raw = String(storagePath || "").trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    const fromStorageApi = raw.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/i);
    if (fromStorageApi) {
      return {
        directUrl: "",
        bucket: safeDecode(fromStorageApi[1]),
        objectPath: safeDecode(fromStorageApi[2]),
      };
    }
    return { directUrl: raw, bucket: "", objectPath: "" };
  }

  let normalized = raw.replace(/^\/+/, "");
  const fromPublicPrefix = normalized.match(/^public\/([^/]+)\/(.+)$/i);
  if (fromPublicPrefix) {
    normalized = `${fromPublicPrefix[1]}/${fromPublicPrefix[2]}`;
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return {
      directUrl: "",
      bucket: parts[0],
      objectPath: parts.slice(1).join("/"),
    };
  }

  return {
    directUrl: "",
    bucket: "",
    objectPath: normalized,
  };
};

const buildStorageTargets = (parsed: { bucket?: string; objectPath?: string }) => {
  const targets: Array<{ bucket: string; path: string }> = [];
  const seen = new Set<string>();

  const add = (bucket: string, objectPath: string) => {
    const cleanBucket = String(bucket || "").trim();
    const cleanPath = String(objectPath || "").trim().replace(/^\/+/, "");
    if (!cleanBucket || !cleanPath) return;
    const key = `${cleanBucket}/${cleanPath}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ bucket: cleanBucket, path: cleanPath });
  };

  if (parsed?.bucket && parsed?.objectPath) add(parsed.bucket, parsed.objectPath);
  const fallbackPath = parsed?.objectPath || "";
  if (fallbackPath) {
    RECEIPT_BUCKET_CANDIDATES.forEach((bucket) => add(bucket, fallbackPath));
  }
  return targets;
};

export interface SignedReceiptImage {
  signedUrl: string;
  resolvedPath: string;
  resolvedBucket: string;
  errorReason: string;
}

export const resolveReceiptImage = async (
  storagePath: string,
): Promise<SignedReceiptImage> => {
  const normalizedRawPath = String(storagePath || "").trim().replace(/^\/+/, "");
  if (!normalizedRawPath) {
    return {
      signedUrl: "",
      resolvedPath: "",
      resolvedBucket: "",
      errorReason: "Missing receipt path.",
    };
  }

  if (normalizedRawPath.startsWith("receipts/")) {
    const result = await apiRequest<{ signedUrl?: string }>(`/api/admin/storage/sign`, {
      method: "POST",
      body: { bucket: "__r2__", path: normalizedRawPath, expiresIn: 1800 },
    });
    if (!result.error && result.data?.signedUrl) {
      return {
        signedUrl: result.data.signedUrl,
        resolvedPath: normalizedRawPath,
        resolvedBucket: "r2",
        errorReason: "",
      };
    }
  }

  const parsed = splitStoragePath(storagePath);
  if (!parsed) {
    return {
      signedUrl: "",
      resolvedPath: "",
      resolvedBucket: "",
      errorReason: "Missing receipt path.",
    };
  }

  if (parsed.directUrl) {
    return {
      signedUrl: parsed.directUrl,
      resolvedPath: parsed.directUrl,
      resolvedBucket: "external",
      errorReason: "",
    };
  }

  const targets = buildStorageTargets(parsed);
  let lastError = "";

  for (const target of targets) {
    const signed = await apiRequest<{ signedUrl?: string }>("/api/admin/storage/sign", {
      method: "POST",
      body: { bucket: target.bucket, path: target.path, expiresIn: 1800 },
    });
    if (!signed.error && signed.data?.signedUrl) {
      return {
        signedUrl: signed.data.signedUrl,
        resolvedPath: target.path,
        resolvedBucket: target.bucket,
        errorReason: "",
      };
    }
    if (signed.error?.message) lastError = signed.error.message;
  }

  return {
    signedUrl: "",
    resolvedPath: parsed.objectPath || "",
    resolvedBucket: parsed.bucket || "",
    errorReason: lastError || "No readable image in configured receipt stores.",
  };
};
