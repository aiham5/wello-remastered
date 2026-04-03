import { PropsWithChildren, useCallback, useEffect, useState } from "react";

type AdminProfile = {
  id?: string;
  email?: string;
  full_name?: string;
  role?: string;
};

type GateState =
  | { status: "loading"; profile: null; message: string }
  | { status: "ready"; profile: AdminProfile; message: string }
  | { status: "error"; profile: null; message: string };

const ACCESS_LOGIN_BASE = "https://wello-admin.cloudflareaccess.com/cdn-cgi/access/login";

const normalizeErrorMessage = (error: unknown) => {
  const message = String((error as { message?: string })?.message || "").trim();
  if (!message) return "Unable to verify admin access.";
  const lower = message.toLowerCase();
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("timeout")) {
    return "Network issue while validating admin access.";
  }
  if (lower.includes("forbidden") || lower.includes("unauthorized")) {
    return "Access denied. Admin or supervisor role required.";
  }
  return message;
};

export function AccessGate({ children }: PropsWithChildren) {
  const [state, setState] = useState<GateState>({
    status: "loading",
    profile: null,
    message: "Checking secure admin access...",
  });

  const verifyAccess = useCallback(async () => {
    setState({
      status: "loading",
      profile: null,
      message: "Checking secure admin access...",
    });
    try {
      const response = await fetch("/api/admin/me", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      const profile = (payload?.data?.profile || {}) as AdminProfile;
      const isAllowed = Boolean(response.ok && profile?.id);
      if (!isAllowed) {
        throw new Error(
          String(
            payload?.error?.message ||
              payload?.message ||
              `Access check failed (${response.status}).`,
          ),
        );
      }
      setState({
        status: "ready",
        profile,
        message: "",
      });
    } catch (error) {
      setState({
        status: "error",
        profile: null,
        message: normalizeErrorMessage(error),
      });
    }
  }, []);

  useEffect(() => {
    verifyAccess();
  }, [verifyAccess]);

  if (state.status === "ready") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">Wello Admin Access</h1>
        <p className="text-sm text-gray-600 mt-2">{state.message}</p>
        {state.status === "error" && (
          <div className="mt-4 flex flex-col gap-3">
            <button
              type="button"
              onClick={verifyAccess}
              className="w-full px-4 py-2 bg-black text-white text-sm hover:bg-gray-800 transition-colors"
            >
              Retry
            </button>
            <a
              className="w-full px-4 py-2 border border-gray-300 text-center text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              href={`${ACCESS_LOGIN_BASE}?returnTo=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "/")}`}
            >
              Re-authenticate
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
