import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getUserBusinesses } from "../lib/business";
import type { BusinessWithRole } from "../types/business";

type ActiveBusinessContextValue = {
  activeBusiness: BusinessWithRole | null;
  businesses: BusinessWithRole[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  setActiveBusiness: (business: BusinessWithRole | null) => void;
  refreshBusinesses: () => Promise<BusinessWithRole[]>;
};

const ActiveBusinessContext = createContext<ActiveBusinessContextValue | null>(null);

type ActiveBusinessProviderProps = {
  userId?: string | null;
  enabled?: boolean;
  preferredBusinessId?: string | null;
  children: ReactNode;
};

export function ActiveBusinessProvider({
  userId,
  enabled = true,
  preferredBusinessId = null,
  children,
}: ActiveBusinessProviderProps) {
  const [businesses, setBusinesses] = useState<BusinessWithRole[]>([]);
  const [activeBusiness, setActiveBusinessState] =
    useState<BusinessWithRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setActiveBusiness = useCallback((business: BusinessWithRole | null) => {
    setActiveBusinessState(business);
  }, []);

  const refreshBusinesses = useCallback(async () => {
    const normalizedUserId = String(userId || "").trim();
    if (!enabled || !normalizedUserId) {
      setBusinesses([]);
      setActiveBusinessState(null);
      setLoading(false);
      setLoaded(Boolean(enabled));
      setError(null);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const nextBusinesses = await getUserBusinesses(normalizedUserId);
      setBusinesses(nextBusinesses);
      setActiveBusinessState((current) => {
        const preferred =
          nextBusinesses.find((entry) => entry.id === preferredBusinessId) || null;
        if (preferred) return preferred;
        const matchingCurrent =
          current &&
          nextBusinesses.find((entry) => entry.id === current.id);
        if (matchingCurrent) return matchingCurrent;
        if (nextBusinesses.length === 1) return nextBusinesses[0];
        return nextBusinesses[0] || null;
      });
      setLoaded(true);
      return nextBusinesses;
    } catch (loadError: any) {
      setBusinesses([]);
      setActiveBusinessState(null);
      setLoaded(true);
      setError(loadError?.message || "Unable to load businesses.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [enabled, preferredBusinessId, userId]);

  useEffect(() => {
    void refreshBusinesses();
  }, [refreshBusinesses]);

  const value = useMemo(
    () => ({
      activeBusiness,
      businesses,
      loading,
      loaded,
      error,
      setActiveBusiness,
      refreshBusinesses,
    }),
    [activeBusiness, businesses, error, loaded, loading, refreshBusinesses, setActiveBusiness],
  );

  return (
    <ActiveBusinessContext.Provider value={value}>
      {children}
    </ActiveBusinessContext.Provider>
  );
}

export function useActiveBusiness() {
  const context = useContext(ActiveBusinessContext);
  if (!context) {
    throw new Error("useActiveBusiness must be used inside ActiveBusinessProvider.");
  }
  return context;
}
