import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Store,
  Download,
  MapPin,
  Tag,
  TrendingUp,
  Eye,
  Edit,
  Pause,
  Check,
  X,
  Save,
} from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import {
  apiRequest,
  formatDateTime,
  formatCurrencyFromCents,
  summarizeError,
} from "../lib/adminApi";
import { downloadCsv, type CsvColumn } from "../lib/csv";

interface BusinessRow {
  id: string;
  name: string;
  category_label?: string | null;
  approval_status?: string | null;
  status?: string | null;
  commission_rate_cents?: number | null;
  default_cashback_rate_bps?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

type DrawerMode = "view" | "edit";
type RatePresetKey = "10" | "15" | "20" | "custom";

interface RateDraft {
  presetKey: RatePresetKey;
  commissionRateCents: number;
  defaultCashbackRateBps: number;
  customCommissionPercentInput: string;
  customCashbackPercentInput: string;
}

interface BusinessMetricsSummary {
  verifiedReceiptCount: number;
  revenueCents: number;
  chargesCents: number;
  manualChargesCents?: number;
  manualPendingCents?: number;
  manualPaidCents?: number;
  cashbackCents: number;
  subsidyCents: number;
  profitCents: number;
}

interface ManualChargeRow {
  id: string;
  business_id: string;
  amount_cents: number;
  reason?: string | null;
  notes?: string | null;
  status?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_charge_id?: string | null;
  failure_reason?: string | null;
  charged_at?: string | null;
  canceled_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface BusinessEditForm {
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  categoryKey: string;
  categoryLabel: string;
  offerHighlight: string;
  hours: string;
  tagsText: string;
  merchantAliasesText: string;
  latitude: string;
  longitude: string;
  qrCode: string;
  approvalStatus: string;
  status: string;
  isOpen: boolean;
  stripeAccountId: string;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  stripePaymentMethodBrand: string;
  stripePaymentMethodLast4: string;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeOnboardedAt: string;
  commissionEnabled: boolean;
  offerHonorPolicyAccepted: boolean;
}

const BUSINESS_RATE_PRESET_OPTIONS: Array<{
  key: RatePresetKey;
  label: string;
  commissionRateCents: number | null;
  defaultCashbackRateBps: number | null;
}> = [
  { key: "10", label: "10%", commissionRateCents: 100, defaultCashbackRateBps: 600 },
  { key: "15", label: "15%", commissionRateCents: 150, defaultCashbackRateBps: 1000 },
  { key: "20", label: "20%", commissionRateCents: 200, defaultCashbackRateBps: 1500 },
  { key: "custom", label: "Custom Rate", commissionRateCents: null, defaultCashbackRateBps: null },
];

const BUSINESS_RATE_PRESET_BY_COMMISSION = new Map(
  BUSINESS_RATE_PRESET_OPTIONS
    .filter((option) => Number.isFinite(option.commissionRateCents))
    .map((option) => [option.commissionRateCents as number, option]),
);

const formatPercentLabel = (value?: number | null) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  const rounded = Math.round(numeric * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/, "");
};

const sanitizePercentInputText = (value: string) => {
  let text = String(value ?? "").replace(/[^0-9.]/g, "");
  const firstDotIndex = text.indexOf(".");
  if (firstDotIndex >= 0) {
    text =
      text.slice(0, firstDotIndex + 1) +
      text.slice(firstDotIndex + 1).replace(/\./g, "");
  }
  return text;
};

const parsePercentInputToScaledInt = (value: string, scale: number) => {
  const text = sanitizePercentInputText(value);
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.round(numeric * scale) : null;
};

const normalizeBusinessCommissionRateCents = (value: unknown, fallback = 150) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(10, Math.min(1000, Math.round(numeric)));
  }
  return Math.max(10, Math.min(1000, Math.round(Number(fallback) || 150)));
};

const deriveDefaultCashbackRateBpsFromCommission = (value: unknown) => {
  const normalizedCommission = normalizeBusinessCommissionRateCents(value);
  const preset = BUSINESS_RATE_PRESET_BY_COMMISSION.get(normalizedCommission);
  if (preset?.defaultCashbackRateBps != null) return preset.defaultCashbackRateBps;
  return Math.max(0, Math.min(normalizedCommission * 10, (normalizedCommission - 50) * 10));
};

const normalizeBusinessDefaultCashbackRateBps = (
  cashbackRateBps: unknown,
  commissionRateCents: unknown,
) => {
  const maxCashbackRateBps = normalizeBusinessCommissionRateCents(commissionRateCents) * 10;
  const numeric = Number(cashbackRateBps);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(maxCashbackRateBps, Math.round(numeric)));
  }
  return deriveDefaultCashbackRateBpsFromCommission(commissionRateCents);
};

const createBusinessRateDraft = (
  commissionRateCents: unknown,
  defaultCashbackRateBps: unknown = null,
): RateDraft => {
  const normalizedCommission = normalizeBusinessCommissionRateCents(commissionRateCents);
  const normalizedCashback = normalizeBusinessDefaultCashbackRateBps(
    defaultCashbackRateBps,
    normalizedCommission,
  );
  const preset =
    BUSINESS_RATE_PRESET_OPTIONS.find(
      (option) =>
        option.commissionRateCents === normalizedCommission &&
        option.defaultCashbackRateBps === normalizedCashback,
    )?.key || "custom";
  return {
    presetKey: preset,
    commissionRateCents: normalizedCommission,
    defaultCashbackRateBps: normalizedCashback,
    customCommissionPercentInput: formatPercentLabel(normalizedCommission / 10),
    customCashbackPercentInput: formatPercentLabel(normalizedCashback / 100),
  };
};

const createEmptyBusinessEditForm = (): BusinessEditForm => ({
  name: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
  phone: "",
  categoryKey: "",
  categoryLabel: "",
  offerHighlight: "",
  hours: "",
  tagsText: "",
  merchantAliasesText: "",
  latitude: "",
  longitude: "",
  qrCode: "",
  approvalStatus: "",
  status: "",
  isOpen: false,
  stripeAccountId: "",
  stripeCustomerId: "",
  stripePaymentMethodId: "",
  stripePaymentMethodBrand: "",
  stripePaymentMethodLast4: "",
  stripeChargesEnabled: false,
  stripePayoutsEnabled: false,
  stripeOnboardedAt: "",
  commissionEnabled: false,
  offerHonorPolicyAccepted: false,
});

const buildBusinessEditPayload = (business: BusinessRow) => {
  const editable = { ...business };
  delete editable.id;
  delete editable.created_at;
  delete editable.updated_at;
  return JSON.stringify(editable, null, 2);
};

const toInputDateTimeValue = (value: unknown) => {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

const businessToEditForm = (business: BusinessRow): BusinessEditForm => ({
  name: String(business.name || ""),
  address: String(business.address || ""),
  city: String(business.city || ""),
  state: String(business.state || ""),
  postalCode: String(business.postal_code || ""),
  phone: String(business.phone || ""),
  categoryKey: String(business.category_key || ""),
  categoryLabel: String(business.category_label || ""),
  offerHighlight: String(business.offer_highlight || ""),
  hours: String(business.hours || ""),
  tagsText: Array.isArray(business.tags) ? business.tags.map(String).join(", ") : "",
  merchantAliasesText: Array.isArray(business.merchant_descriptor_aliases)
    ? business.merchant_descriptor_aliases.map(String).join(", ")
    : "",
  latitude:
    business.latitude == null || business.latitude === ""
      ? ""
      : String(business.latitude),
  longitude:
    business.longitude == null || business.longitude === ""
      ? ""
      : String(business.longitude),
  qrCode: String(business.qr_code || ""),
  approvalStatus: String(business.approval_status || ""),
  status: String(business.status || ""),
  isOpen: Boolean(business.is_open),
  stripeAccountId: String(business.stripe_account_id || ""),
  stripeCustomerId: String(business.stripe_customer_id || ""),
  stripePaymentMethodId: String(business.stripe_payment_method_id || ""),
  stripePaymentMethodBrand: String(business.stripe_payment_method_brand || ""),
  stripePaymentMethodLast4: String(business.stripe_payment_method_last4 || ""),
  stripeChargesEnabled: Boolean(business.stripe_charges_enabled),
  stripePayoutsEnabled: Boolean(business.stripe_payouts_enabled),
  stripeOnboardedAt: toInputDateTimeValue(business.stripe_onboarded_at),
  commissionEnabled: Boolean(business.commission_enabled),
  offerHonorPolicyAccepted: Boolean(business.offer_honor_policy_accepted),
});

const toNullableText = (value: string) => {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : null;
};

const toNullableNumber = (value: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : trimmed;
};

const toNullableIsoString = (value: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? trimmed : date.toISOString();
};

const toTextList = (value: string) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const businessCsvColumns: CsvColumn<BusinessRow>[] = [
  { key: "id", label: "Business ID" },
  { key: "name", label: "Name" },
  { key: "category_label", label: "Category", format: (value) => String(value || "") },
  { key: "approval_status", label: "Approval Status", format: (value) => String(value || "") },
  { key: "status", label: "Status", format: (value) => String(value || "") },
  { key: "created_at", label: "Created At", format: (value) => String(value || "") },
  { key: "updated_at", label: "Updated At", format: (value) => String(value || "") },
];

const formatApproval = (value?: string | null) => String(value || "pending").toLowerCase();

export function Businesses() {
  const [rows, setRows] = useState<BusinessRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("view");
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessRow | null>(null);
  const [editPayload, setEditPayload] = useState("");
  const [editForm, setEditForm] = useState<BusinessEditForm>(createEmptyBusinessEditForm());
  const [businessMetrics, setBusinessMetrics] = useState<BusinessMetricsSummary | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [manualCharges, setManualCharges] = useState<ManualChargeRow[]>([]);
  const [manualChargesLoading, setManualChargesLoading] = useState(false);
  const [manualChargeAmountInput, setManualChargeAmountInput] = useState("");
  const [manualChargeReasonInput, setManualChargeReasonInput] = useState("");
  const [manualChargeNotesInput, setManualChargeNotesInput] = useState("");
  const [manualChargeEditingId, setManualChargeEditingId] = useState<string | null>(null);
  const [manualChargeBusyId, setManualChargeBusyId] = useState<string | null>(null);
  const [rateModalBusiness, setRateModalBusiness] = useState<BusinessRow | null>(null);
  const [rateDraft, setRateDraft] = useState<RateDraft | null>(null);

  const loadBusinesses = async () => {
    setLoading(true);
    const res = await apiRequest<BusinessRow[]>("/api/admin/businesses?limit=300");
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to load businesses."));
      setRows([]);
    } else {
      setRows(Array.isArray(res.data) ? res.data : []);
      setMessage("");
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadBusinesses();
  }, []);

  useEffect(() => {
    if (!drawerOpen || drawerMode !== "view" || !selectedBusiness?.id) {
      setBusinessMetrics(null);
      setMetricsLoading(false);
      return;
    }

    let cancelled = false;
    const loadBusinessMetrics = async () => {
      setMetricsLoading(true);
      const res = await apiRequest<BusinessMetricsSummary>(
        `/api/admin/businesses/${encodeURIComponent(selectedBusiness.id)}/metrics`,
      );
      if (cancelled) return;
      if (res.error || !res.data) {
        setBusinessMetrics(null);
      } else {
        setBusinessMetrics(res.data);
      }
      setMetricsLoading(false);
    };

    void loadBusinessMetrics();
    return () => {
      cancelled = true;
    };
  }, [drawerOpen, drawerMode, selectedBusiness?.id]);

  useEffect(() => {
    if (!drawerOpen || drawerMode !== "view" || !selectedBusiness?.id) {
      setManualCharges([]);
      setManualChargesLoading(false);
      setManualChargeEditingId(null);
      return;
    }

    let cancelled = false;
    const loadManualCharges = async () => {
      setManualChargesLoading(true);
      const res = await apiRequest<ManualChargeRow[]>(
        `/api/admin/businesses/${encodeURIComponent(selectedBusiness.id)}/manual-charges`,
      );
      if (cancelled) return;
      setManualCharges(Array.isArray(res.data) ? res.data : []);
      setManualChargesLoading(false);
    };

    void loadManualCharges();
    return () => {
      cancelled = true;
    };
  }, [drawerOpen, drawerMode, selectedBusiness?.id]);

  const resetManualChargeForm = () => {
    setManualChargeEditingId(null);
    setManualChargeAmountInput("");
    setManualChargeReasonInput("");
    setManualChargeNotesInput("");
  };

  const loadSelectedBusinessManualCharges = async (businessId: string) => {
    setManualChargesLoading(true);
    const res = await apiRequest<ManualChargeRow[]>(
      `/api/admin/businesses/${encodeURIComponent(businessId)}/manual-charges`,
    );
    setManualCharges(Array.isArray(res.data) ? res.data : []);
    setManualChargesLoading(false);
  };

  const loadSelectedBusinessMetrics = async (businessId: string) => {
    setMetricsLoading(true);
    const res = await apiRequest<BusinessMetricsSummary>(
      `/api/admin/businesses/${encodeURIComponent(businessId)}/metrics`,
    );
    if (res.error || !res.data) {
      setBusinessMetrics(null);
    } else {
      setBusinessMetrics(res.data);
    }
    setMetricsLoading(false);
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => {
      if (row.category_label) set.add(row.category_label);
    });
    return Array.from(set).sort();
  }, [rows]);

  const filteredBusinesses = useMemo(
    () =>
      rows.filter((business) => {
        const matchesSearch = String(business.name || "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());
        const matchesCategory =
          selectedCategory === "all" || business.category_label === selectedCategory;
        const currentStatus = formatApproval(business.approval_status);
        const matchesStatus =
          selectedStatus === "all" || currentStatus === selectedStatus.toLowerCase();
        return matchesSearch && matchesCategory && matchesStatus;
      }),
    [rows, searchQuery, selectedCategory, selectedStatus],
  );

  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((b) => formatApproval(b.approval_status) === "approved").length,
      pending: rows.filter((b) => formatApproval(b.approval_status) === "pending").length,
      rejected: rows.filter((b) => formatApproval(b.approval_status) === "rejected").length,
    }),
    [rows],
  );

  const startEditingManualCharge = (charge: ManualChargeRow) => {
    setManualChargeEditingId(charge.id);
    setManualChargeAmountInput(
      Number.isFinite(Number(charge.amount_cents))
        ? (Number(charge.amount_cents) / 100).toFixed(2)
        : "",
    );
    setManualChargeReasonInput(String(charge.reason || ""));
    setManualChargeNotesInput(String(charge.notes || ""));
  };

  const submitManualCharge = async () => {
    if (!selectedBusiness?.id) return;
    const amountCents = Math.round((Number(manualChargeAmountInput) || 0) * 100);
    if (!amountCents || !manualChargeReasonInput.trim()) {
      setMessage("Adjustment amount and reason are required.");
      return;
    }
    setManualChargeBusyId(manualChargeEditingId || "create");
    const endpoint = manualChargeEditingId
      ? `/api/admin/businesses/${encodeURIComponent(selectedBusiness.id)}/manual-charges/${encodeURIComponent(manualChargeEditingId)}/update`
      : `/api/admin/businesses/${encodeURIComponent(selectedBusiness.id)}/manual-charges/create`;
    const res = await apiRequest<ManualChargeRow>(endpoint, {
      method: "POST",
      body: {
        amountCents,
        reason: manualChargeReasonInput,
        notes: manualChargeNotesInput,
      },
    });
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to save manual charge."));
      setManualChargeBusyId(null);
      return;
    }
    await Promise.all([
      loadSelectedBusinessManualCharges(selectedBusiness.id),
      loadSelectedBusinessMetrics(selectedBusiness.id),
    ]);
    resetManualChargeForm();
    setManualChargeBusyId(null);
    setMessage(manualChargeEditingId ? "Adjustment updated." : "Adjustment added.");
  };

  const cancelManualCharge = async (charge: ManualChargeRow) => {
    if (!selectedBusiness?.id) return;
    if (!window.confirm(`Cancel adjustment "${charge.reason || charge.id}"?`)) return;
    setManualChargeBusyId(charge.id);
    const res = await apiRequest<ManualChargeRow>(
      `/api/admin/businesses/${encodeURIComponent(selectedBusiness.id)}/manual-charges/${encodeURIComponent(charge.id)}/cancel`,
      { method: "POST", body: {} },
    );
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to cancel manual charge."));
      setManualChargeBusyId(null);
      return;
    }
    await Promise.all([
      loadSelectedBusinessManualCharges(selectedBusiness.id),
      loadSelectedBusinessMetrics(selectedBusiness.id),
    ]);
    if (manualChargeEditingId === charge.id) resetManualChargeForm();
    setManualChargeBusyId(null);
    setMessage("Manual charge canceled.");
  };

  const chargeManualCharge = async (charge: ManualChargeRow) => {
    if (!selectedBusiness?.id) return;
    if (!window.confirm(`Charge ${formatCurrencyFromCents(Number(charge.amount_cents) || 0)} to ${selectedBusiness.name}?`)) {
      return;
    }
    setManualChargeBusyId(charge.id);
    const res = await apiRequest<ManualChargeRow>(
      `/api/admin/businesses/${encodeURIComponent(selectedBusiness.id)}/manual-charges/${encodeURIComponent(charge.id)}/charge`,
      { method: "POST", body: {} },
    );
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to charge manual balance."));
      setManualChargeBusyId(null);
      return;
    }
    await Promise.all([
      loadSelectedBusinessManualCharges(selectedBusiness.id),
      loadSelectedBusinessMetrics(selectedBusiness.id),
    ]);
    if (manualChargeEditingId === charge.id) resetManualChargeForm();
    setManualChargeBusyId(null);
    setMessage("Manual charge processed.");
  };

  const submitDecision = async (
    business: BusinessRow,
    nextStatus: "approved" | "rejected",
    nextRateDraft?: RateDraft | null,
  ) => {
    const confirmed = window.confirm(
      `${nextStatus === "approved" ? "Approve" : "Reject"} business "${business.name}"?`,
    );
    if (!confirmed) return;
    setWorkingId(business.id);
    const normalizedRateDraft =
      nextStatus === "approved"
        ? createBusinessRateDraft(
            nextRateDraft?.commissionRateCents ?? business.commission_rate_cents ?? 150,
            nextRateDraft?.defaultCashbackRateBps ?? business.default_cashback_rate_bps ?? null,
          )
        : null;
    const res = await apiRequest<BusinessRow>(
      `/api/admin/businesses/${encodeURIComponent(business.id)}/review`,
      {
        method: "POST",
        body: {
          nextApprovalStatus: nextStatus,
          ...(normalizedRateDraft != null
            ? {
                commissionRateCents: normalizedRateDraft.commissionRateCents,
                defaultCashbackRateBps:
                  normalizedRateDraft.defaultCashbackRateBps,
              }
            : {}),
        },
      },
    );
    if (res.error) {
      setMessage(summarizeError(res.error, "Unable to update business review."));
    } else {
      setRows((prev) =>
        prev.map((row) =>
          row.id === business.id
            ? {
                ...row,
                approval_status: nextStatus,
                status: nextStatus === "approved" ? "active" : "inactive",
                ...(normalizedRateDraft != null
                  ? {
                      commission_rate_cents:
                        normalizedRateDraft.commissionRateCents,
                      default_cashback_rate_bps:
                        normalizedRateDraft.defaultCashbackRateBps,
                    }
                  : {}),
              }
            : row,
        ),
      );
      setSelectedBusiness((prev) =>
        prev?.id === business.id
          ? {
              ...prev,
              approval_status: nextStatus,
              status: nextStatus === "approved" ? "active" : "inactive",
              ...(normalizedRateDraft != null
                ? {
                    commission_rate_cents:
                      normalizedRateDraft.commissionRateCents,
                    default_cashback_rate_bps:
                      normalizedRateDraft.defaultCashbackRateBps,
                  }
                : {}),
            }
          : prev,
      );
      setMessage(`Business ${nextStatus}.`);
    }
    setWorkingId(null);
  };

  const updateDecision = async (business: BusinessRow, nextStatus: "approved" | "rejected") => {
    if (nextStatus === "approved") {
      setRateModalBusiness(business);
      setRateDraft(
        createBusinessRateDraft(
          business.commission_rate_cents ?? 150,
          business.default_cashback_rate_bps ?? null,
        ),
      );
      return;
    }
    await submitDecision(business, nextStatus, null);
  };

  const openDrawer = (business: BusinessRow, mode: DrawerMode) => {
    setSelectedBusiness(business);
    setDrawerMode(mode);
    setEditForm(businessToEditForm(business));
    setEditPayload(buildBusinessEditPayload(business));
    resetManualChargeForm();
    setManualCharges([]);
    setRateDraft(
      createBusinessRateDraft(
        business.commission_rate_cents ?? 150,
        business.default_cashback_rate_bps ?? null,
      ),
    );
    setBusinessMetrics(null);
    setDrawerOpen(true);
  };

  const saveBusiness = async () => {
    if (!selectedBusiness) return;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(editPayload || "{}");
    } catch {
      setMessage("Invalid JSON in business editor.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setMessage("Business editor must be a JSON object.");
      return;
    }
    if (!editForm.name.trim()) {
      setMessage("Business name is required.");
      return;
    }
    const mergedPayload: Record<string, unknown> = {
      ...parsed,
      name: editForm.name.trim(),
      address: toNullableText(editForm.address),
      city: toNullableText(editForm.city),
      state: toNullableText(editForm.state),
      postal_code: toNullableText(editForm.postalCode),
      phone: toNullableText(editForm.phone),
      category_key: toNullableText(editForm.categoryKey),
      category_label: toNullableText(editForm.categoryLabel),
      offer_highlight: toNullableText(editForm.offerHighlight),
      hours: toNullableText(editForm.hours),
      tags: toTextList(editForm.tagsText),
      merchant_descriptor_aliases: toTextList(editForm.merchantAliasesText),
      latitude: toNullableNumber(editForm.latitude),
      longitude: toNullableNumber(editForm.longitude),
      qr_code: toNullableText(editForm.qrCode),
      approval_status: toNullableText(editForm.approvalStatus),
      status: toNullableText(editForm.status),
      is_open: editForm.isOpen,
      stripe_account_id: toNullableText(editForm.stripeAccountId),
      stripe_customer_id: toNullableText(editForm.stripeCustomerId),
      stripe_payment_method_id: toNullableText(editForm.stripePaymentMethodId),
      stripe_payment_method_brand: toNullableText(editForm.stripePaymentMethodBrand),
      stripe_payment_method_last4: toNullableText(editForm.stripePaymentMethodLast4),
      stripe_charges_enabled: editForm.stripeChargesEnabled,
      stripe_payouts_enabled: editForm.stripePayoutsEnabled,
      stripe_onboarded_at: toNullableIsoString(editForm.stripeOnboardedAt),
      commission_enabled: editForm.commissionEnabled,
      offer_honor_policy_accepted: editForm.offerHonorPolicyAccepted,
      commission_rate_cents:
        rateDraft?.commissionRateCents ??
        selectedBusiness.commission_rate_cents ??
        150,
      default_cashback_rate_bps:
        rateDraft?.defaultCashbackRateBps ??
        selectedBusiness.default_cashback_rate_bps ??
        null,
    };
    setWorkingId(selectedBusiness.id);
    const res = await apiRequest<BusinessRow>(
      `/api/admin/businesses/${encodeURIComponent(selectedBusiness.id)}/update`,
      {
        method: "POST",
        body: mergedPayload,
      },
    );
    if (res.error || !res.data) {
      setMessage(summarizeError(res.error, "Unable to update business."));
      setWorkingId(null);
      return;
    }

    setRows((prev) =>
      prev.map((row) => (row.id === selectedBusiness.id ? { ...row, ...res.data } : row)),
    );
    setSelectedBusiness((prev) => (prev ? { ...prev, ...res.data } : prev));
    setEditForm(businessToEditForm(res.data));
    setEditPayload(buildBusinessEditPayload(res.data));
    setRateDraft(
      createBusinessRateDraft(
        res.data.commission_rate_cents ?? 150,
        res.data.default_cashback_rate_bps ?? null,
      ),
    );
    setDrawerMode("view");
    setMessage("Business updated.");
    setWorkingId(null);
  };

  const archiveBusiness = async (business: BusinessRow) => {
    const confirmed = window.confirm(`Archive business "${business.name}"?`);
    if (!confirmed) return;
    setWorkingId(business.id);
    const res = await apiRequest<BusinessRow>(
      `/api/admin/businesses/${encodeURIComponent(business.id)}/archive`,
      { method: "POST" },
    );
    if (res.error || !res.data) {
      setMessage(summarizeError(res.error, "Unable to archive business."));
    } else {
      setRows((prev) =>
        prev.map((row) =>
          row.id === business.id ? { ...row, ...res.data, status: "inactive" } : row,
        ),
      );
      setSelectedBusiness((prev) =>
        prev?.id === business.id ? { ...prev, ...res.data, status: "inactive" } : prev,
      );
      setMessage("Business archived.");
    }
    setWorkingId(null);
  };

  const exportBusinesses = () => {
    downloadCsv("businesses-export.csv", filteredBusinesses, businessCsvColumns);
    setMessage(`Exported ${filteredBusinesses.length} businesses.`);
  };

  const statusBadge = (approval?: string | null) => {
    const normalized = formatApproval(approval);
    if (normalized === "approved") return <StatusBadge status="Approved" variant="success" />;
    if (normalized === "rejected") return <StatusBadge status="Rejected" variant="danger" />;
    return <StatusBadge status="Pending" variant="warning" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search businesses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2.5 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex gap-3 w-full sm:w-auto">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          >
            <option value="all">All Categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          >
            <option value="all">All Status</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>

          <button
            type="button"
            onClick={exportBusinesses}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>

          <button
            type="button"
            onClick={() => void loadBusinesses()}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
          >
            <Store className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {message ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Total Businesses</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.total}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Approved</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.active}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Pending Approval</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.pending}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Rejected</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.rejected}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {loading ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-gray-500">
            Loading businesses...
          </div>
        ) : filteredBusinesses.length ? (
          filteredBusinesses.map((business) => (
            <div
              key={business.id}
              className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-amber-400 to-amber-600 rounded-lg flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
                    {business.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{business.name}</h3>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                      <Tag className="w-4 h-4" />
                      <span>{business.category_label || "Uncategorized"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <MapPin className="w-4 h-4" />
                      <span>Location managed in app profile</span>
                    </div>
                  </div>
                </div>
                {statusBadge(business.approval_status)}
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-xs text-gray-600 mb-1">Business ID</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {business.id.slice(0, 8)}...
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Review State</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatApproval(business.approval_status)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Created</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatDateTime(business.created_at)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Updated</p>
                  <p className="text-sm font-semibold text-green-600">
                    {formatDateTime(business.updated_at)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Commission</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatPercentLabel(
                      normalizeBusinessCommissionRateCents(
                        business.commission_rate_cents,
                      ) / 10,
                    )}
                    %
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Cashback</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatPercentLabel(
                      normalizeBusinessDefaultCashbackRateBps(
                        business.default_cashback_rate_bps,
                        business.commission_rate_cents,
                      ) / 100,
                    )}
                    %
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-500">
                  Operational metrics are available in Reports.
                </span>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => openDrawer(business, "view")}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => openDrawer(business, "edit")}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  {formatApproval(business.approval_status) === "pending" ? (
                    <>
                      <button
                        disabled={workingId === business.id}
                        onClick={() => void updateDecision(business, "approved")}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-green-700 border border-green-300 rounded-lg hover:bg-green-50 transition-colors disabled:opacity-60"
                      >
                        <Check className="w-4 h-4" />
                        Approve
                      </button>
                      <button
                        disabled={workingId === business.id}
                        onClick={() => void updateDecision(business, "rejected")}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-red-700 border border-red-300 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-60"
                      >
                        <X className="w-4 h-4" />
                        Reject
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void archiveBusiness(business)}
                      disabled={workingId === business.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
                    >
                      <Pause className="w-4 h-4" />
                      Archive
                    </button>
                  )}
                </div>
                <span className="text-xs text-gray-500">
                  {business.status || "unknown"} state
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-gray-500">
            No businesses match current filters.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Showing <span className="font-medium">{filteredBusinesses.length}</span> of{" "}
          <span className="font-medium">{rows.length}</span> businesses
        </p>
      </div>

      {drawerOpen && selectedBusiness ? (
        <div className="fixed inset-0 z-40 bg-black/30 flex justify-end">
          <div className="w-full max-w-xl h-full bg-white shadow-xl border-l border-gray-200 flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {drawerMode === "edit" ? "Edit Business" : "Business Details"}
              </h3>
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {drawerMode === "view" ? (
                <>
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-5 space-y-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Business overview
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-gray-900">
                        {selectedBusiness.name}
                      </p>
                      <p className="text-sm text-gray-600">
                        {selectedBusiness.category_label || "Uncategorized"}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500">Business ID</p>
                        <p className="font-medium text-gray-900 break-all">{selectedBusiness.id}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Phone</p>
                        <p className="font-medium text-gray-900">
                          {String(selectedBusiness.phone || "--")}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Approval</p>
                        <p className="font-medium text-gray-900">
                          {selectedBusiness.approval_status || "--"}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Status</p>
                        <p className="font-medium text-gray-900">
                          {selectedBusiness.status || "--"}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Commission</p>
                        <p className="font-medium text-gray-900">
                          {formatPercentLabel(
                            Number(selectedBusiness.commission_rate_cents || 0) / 10,
                          )}
                          %
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Cashback</p>
                        <p className="font-medium text-gray-900">
                          {formatPercentLabel(
                            Number(selectedBusiness.default_cashback_rate_bps || 0) / 100,
                          )}
                          %
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Created</p>
                        <p className="font-medium text-gray-900">
                          {formatDateTime(selectedBusiness.created_at)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Updated</p>
                        <p className="font-medium text-gray-900">
                          {formatDateTime(selectedBusiness.updated_at)}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-gray-500 text-sm">Address</p>
                      <p className="font-medium text-gray-900">
                        {[
                          selectedBusiness.address,
                          selectedBusiness.city,
                          selectedBusiness.state,
                          selectedBusiness.postal_code,
                        ]
                          .filter(Boolean)
                          .join(", ") || "Location managed in app profile"}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 p-5 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Financial snapshot
                        </p>
                        <p className="text-sm text-gray-600">
                          Charges, cashback, profit, and verified sales for this business.
                        </p>
                      </div>
                      {metricsLoading ? (
                        <span className="text-xs font-medium text-gray-500">Loading...</span>
                      ) : null}
                    </div>
                    {businessMetrics ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Verified revenue
                          </p>
                          <p className="mt-1 text-lg font-semibold text-slate-900">
                            {formatCurrencyFromCents(businessMetrics.revenueCents)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Charges
                          </p>
                          <p className="mt-1 text-lg font-semibold text-slate-900">
                            {formatCurrencyFromCents(businessMetrics.chargesCents)}
                          </p>
                          {Number(businessMetrics.manualChargesCents || 0) !== 0 ? (
                            <p className="mt-1 text-xs text-slate-500">
                              Includes {formatCurrencyFromCents(businessMetrics.manualChargesCents || 0)} manual adjustments
                            </p>
                          ) : null}
                        </div>
                        <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Cashback
                          </p>
                          <p className="mt-1 text-lg font-semibold text-slate-900">
                            {formatCurrencyFromCents(businessMetrics.cashbackCents)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Platform subsidy
                          </p>
                          <p className="mt-1 text-lg font-semibold text-slate-900">
                            {formatCurrencyFromCents(businessMetrics.subsidyCents)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-emerald-50 p-4 border border-emerald-200">
                          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                            Profit
                          </p>
                          <p className="mt-1 text-lg font-semibold text-emerald-700">
                            {formatCurrencyFromCents(businessMetrics.profitCents)}
                          </p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Verified receipts
                          </p>
                          <p className="mt-1 text-lg font-semibold text-slate-900">
                            {businessMetrics.verifiedReceiptCount}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                        {metricsLoading
                          ? "Loading business metrics..."
                          : "No business metrics available yet."}
                      </div>
                    )}
                  </div>
                  <div className="rounded-2xl border border-gray-200 p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Manual adjustments
                        </p>
                        <p className="text-sm text-gray-600">
                          Add positive charges or negative credits. Positive pending amounts can be charged on demand.
                        </p>
                      </div>
                      {manualChargesLoading ? (
                        <span className="text-xs font-medium text-gray-500">Loading...</span>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-amber-50 p-4 border border-amber-200">
                        <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
                          Pending adjustments
                        </p>
                        <p className="mt-1 text-lg font-semibold text-amber-700">
                          {formatCurrencyFromCents(Number(businessMetrics?.manualPendingCents || 0))}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Paid adjustments
                        </p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">
                          {formatCurrencyFromCents(Number(businessMetrics?.manualPaidCents || 0))}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <label className="block">
                        <span className="text-sm font-medium text-gray-700">Adjustment amount (USD)</span>
                        <input
                          value={manualChargeAmountInput}
                          onChange={(event) => setManualChargeAmountInput(event.target.value)}
                          placeholder="25.00 or -25.00"
                          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm font-medium text-gray-700">Reason</span>
                        <input
                          value={manualChargeReasonInput}
                          onChange={(event) => setManualChargeReasonInput(event.target.value)}
                          placeholder="Platform adjustment"
                          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </label>
                      <label className="block col-span-2">
                        <span className="text-sm font-medium text-gray-700">Notes</span>
                        <textarea
                          value={manualChargeNotesInput}
                          onChange={(event) => setManualChargeNotesInput(event.target.value)}
                          rows={3}
                          placeholder="Optional internal note"
                          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </label>
                    </div>
                    <div className="flex items-center gap-3">
                      {(() => {
                        const isSubmitting =
                          manualChargeBusyId === "create" ||
                          (!!manualChargeEditingId && manualChargeBusyId === manualChargeEditingId);
                        return (
                      <button
                        type="button"
                        className={`px-4 py-2.5 rounded-lg font-medium transition-colors ${
                          isSubmitting
                            ? "bg-amber-200 text-white opacity-50 cursor-not-allowed"
                            : "bg-slate-900 text-white hover:bg-slate-800 cursor-pointer shadow-sm"
                        }`}
                        onClick={submitManualCharge}
                        disabled={isSubmitting}
                      >
                        {manualChargeEditingId ? "Save adjustment" : "Add adjustment"}
                      </button>
                        );
                      })()}
                      {manualChargeEditingId ? (
                        <button
                          type="button"
                          className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                          onClick={resetManualChargeForm}
                        >
                          Cancel edit
                        </button>
                      ) : null}
                    </div>
                    <div className="space-y-3">
                      {manualCharges.length ? (
                        manualCharges.map((charge) => {
                          const status = String(charge.status || "pending").toLowerCase();
                          const isActionable = ["pending", "failed"].includes(status);
                          const isBusy = manualChargeBusyId === charge.id;
                          const amountCents = Number(charge.amount_cents) || 0;
                          const isCredit = amountCents < 0;
                          const canChargeNow = isActionable && amountCents > 0;
                          return (
                            <div
                              key={charge.id}
                              className={`rounded-xl border p-4 flex items-start justify-between gap-4 ${
                                isCredit ? "border-emerald-200 bg-emerald-50/60" : "border-gray-200"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className={`text-base font-semibold ${isCredit ? "text-emerald-700" : "text-gray-900"}`}>
                                    {formatCurrencyFromCents(amountCents)}
                                  </p>
                                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 uppercase">
                                    {status}
                                  </span>
                                  {isCredit ? (
                                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 uppercase">
                                      Credit
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-sm font-medium text-gray-900">
                                  {charge.reason || "Manual adjustment"}
                                </p>
                                {charge.notes ? (
                                  <p className="mt-1 text-sm text-gray-600">{charge.notes}</p>
                                ) : null}
                                <p className="mt-2 text-xs text-gray-500">
                                  Created {formatDateTime(charge.created_at)}
                                  {charge.charged_at ? ` • Charged ${formatDateTime(charge.charged_at)}` : ""}
                                </p>
                                {charge.failure_reason ? (
                                  <p className="mt-1 text-xs text-red-600">{charge.failure_reason}</p>
                                ) : null}
                              </div>
                              <div className="flex flex-col gap-2 shrink-0">
                                {isActionable ? (
                                  <>
                                    <button
                                      type="button"
                                      className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                                      onClick={() => startEditingManualCharge(charge)}
                                      disabled={isBusy}
                                    >
                                      Edit
                                    </button>
                                    {canChargeNow ? (
                                      <button
                                        type="button"
                                        className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-800 transition-colors disabled:opacity-50"
                                        onClick={() => chargeManualCharge(charge)}
                                        disabled={isBusy}
                                      >
                                        Charge now
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="px-3 py-2 rounded-lg border border-red-200 text-red-700 text-sm hover:bg-red-50 transition-colors disabled:opacity-50"
                                      onClick={() => cancelManualCharge(charge)}
                                      disabled={isBusy}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                          No manual adjustments yet.
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    onClick={() => setDrawerMode("edit")}
                  >
                    Switch to Edit
                  </button>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Business name</span>
                      <input
                        value={editForm.name}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, name: event.target.value }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Phone</span>
                      <input
                        value={editForm.phone}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, phone: event.target.value }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block col-span-2">
                      <span className="text-sm font-medium text-gray-700">Address</span>
                      <input
                        value={editForm.address}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, address: event.target.value }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">City</span>
                      <input
                        value={editForm.city}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, city: event.target.value }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">State</span>
                      <input
                        value={editForm.state}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, state: event.target.value }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Postal code</span>
                      <input
                        value={editForm.postalCode}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            postalCode: event.target.value,
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">QR code</span>
                      <input
                        value={editForm.qrCode}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, qrCode: event.target.value }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Category key</span>
                      <input
                        value={editForm.categoryKey}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            categoryKey: event.target.value,
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Category label</span>
                      <input
                        value={editForm.categoryLabel}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            categoryLabel: event.target.value,
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block col-span-2">
                      <span className="text-sm font-medium text-gray-700">Offer highlight</span>
                      <input
                        value={editForm.offerHighlight}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            offerHighlight: event.target.value,
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block col-span-2">
                      <span className="text-sm font-medium text-gray-700">Hours</span>
                      <input
                        value={editForm.hours}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, hours: event.target.value }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block col-span-2">
                      <span className="text-sm font-medium text-gray-700">Tags</span>
                      <input
                        value={editForm.tagsText}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, tagsText: event.target.value }))
                        }
                        placeholder="Comma-separated"
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block col-span-2">
                      <span className="text-sm font-medium text-gray-700">
                        Merchant descriptor aliases
                      </span>
                      <input
                        value={editForm.merchantAliasesText}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            merchantAliasesText: event.target.value,
                          }))
                        }
                        placeholder="Comma-separated"
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Latitude</span>
                      <input
                        value={editForm.latitude}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, latitude: event.target.value }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Longitude</span>
                      <input
                        value={editForm.longitude}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            longitude: event.target.value,
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                  </div>

                  <div className="rounded-2xl border border-gray-200 p-4 space-y-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Rates</p>
                      <p className="text-xs text-gray-500">
                        Structured commission and cashback controls for the business profile.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {BUSINESS_RATE_PRESET_OPTIONS.map((option) => {
                        const selected = rateDraft?.presetKey === option.key;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() =>
                              setRateDraft((current) =>
                                option.key === "custom"
                                  ? {
                                      ...(current ||
                                        createBusinessRateDraft(
                                          selectedBusiness.commission_rate_cents ?? 150,
                                          selectedBusiness.default_cashback_rate_bps ?? null,
                                        )),
                                      presetKey: "custom",
                                    }
                                  : createBusinessRateDraft(
                                      option.commissionRateCents ?? current?.commissionRateCents,
                                      option.defaultCashbackRateBps ??
                                        current?.defaultCashbackRateBps,
                                    ),
                              )
                            }
                            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                              selected
                                ? "border-amber-500 bg-amber-50"
                                : "border-gray-200 hover:bg-gray-50"
                            }`}
                          >
                            <p className="text-sm font-semibold text-gray-900">{option.label}</p>
                            <p className="text-xs text-gray-500">
                              {option.commissionRateCents == null
                                ? "Choose your own charge and cashback split."
                                : `${formatPercentLabel(option.commissionRateCents / 10)}% charge / ${formatPercentLabel((option.defaultCashbackRateBps || 0) / 100)}% cashback`}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                    {rateDraft?.presetKey === "custom" ? (
                      <div className="grid grid-cols-2 gap-4">
                        <label className="block">
                          <span className="text-sm font-medium text-gray-700">
                            Commission %
                          </span>
                          <input
                            value={rateDraft.customCommissionPercentInput}
                            onChange={(event) =>
                              setRateDraft((current) => {
                                if (!current) return current;
                                const nextInput = sanitizePercentInputText(event.target.value);
                                const parsed = parsePercentInputToScaledInt(nextInput, 10);
                                return {
                                  ...current,
                                  presetKey: "custom",
                                  customCommissionPercentInput: nextInput,
                                  commissionRateCents:
                                    parsed == null ? current.commissionRateCents : parsed,
                                  defaultCashbackRateBps:
                                    parsed == null
                                      ? current.defaultCashbackRateBps
                                      : Math.min(
                                          current.defaultCashbackRateBps,
                                          Math.max(0, parsed * 10),
                                        ),
                                };
                              })
                            }
                            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        </label>
                        <label className="block">
                          <span className="text-sm font-medium text-gray-700">Cashback %</span>
                          <input
                            value={rateDraft.customCashbackPercentInput}
                            onChange={(event) =>
                              setRateDraft((current) => {
                                if (!current) return current;
                                const nextInput = sanitizePercentInputText(event.target.value);
                                const parsed = parsePercentInputToScaledInt(nextInput, 100);
                                return {
                                  ...current,
                                  presetKey: "custom",
                                  customCashbackPercentInput: nextInput,
                                  defaultCashbackRateBps:
                                    parsed == null
                                      ? current.defaultCashbackRateBps
                                      : Math.min(
                                          Math.max(0, current.commissionRateCents * 10),
                                          parsed,
                                        ),
                                };
                              })
                            }
                            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Approval</span>
                      <select
                        value={editForm.approvalStatus}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            approvalStatus: event.target.value,
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                      >
                        <option value="">Unset</option>
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Status</span>
                      <select
                        value={editForm.status}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, status: event.target.value }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                      >
                        <option value="">Unset</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="pending">Pending</option>
                        <option value="archived">Archived</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={editForm.isOpen}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, isOpen: event.target.checked }))
                        }
                        className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                      />
                      <span className="text-sm font-medium text-gray-700">Business is open</span>
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={editForm.commissionEnabled}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            commissionEnabled: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                      />
                      <span className="text-sm font-medium text-gray-700">
                        Commission enabled
                      </span>
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={editForm.stripeChargesEnabled}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            stripeChargesEnabled: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                      />
                      <span className="text-sm font-medium text-gray-700">
                        Stripe charges enabled
                      </span>
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={editForm.stripePayoutsEnabled}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            stripePayoutsEnabled: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                      />
                      <span className="text-sm font-medium text-gray-700">
                        Stripe payouts enabled
                      </span>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Stripe account ID</span>
                      <input
                        value={editForm.stripeAccountId}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            stripeAccountId: event.target.value,
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">
                        Stripe customer ID
                      </span>
                      <input
                        value={editForm.stripeCustomerId}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            stripeCustomerId: event.target.value,
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">
                        Stripe payment method ID
                      </span>
                      <input
                        value={editForm.stripePaymentMethodId}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            stripePaymentMethodId: event.target.value,
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">
                        Stripe onboarded at
                      </span>
                      <input
                        type="datetime-local"
                        value={editForm.stripeOnboardedAt}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            stripeOnboardedAt: event.target.value,
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Card brand</span>
                      <input
                        value={editForm.stripePaymentMethodBrand}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            stripePaymentMethodBrand: event.target.value,
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Card last4</span>
                      <input
                        value={editForm.stripePaymentMethodLast4}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            stripePaymentMethodLast4: event.target.value,
                          }))
                        }
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={editForm.offerHonorPolicyAccepted}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          offerHonorPolicyAccepted: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      Offer honor policy accepted
                    </span>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-gray-700">
                      Manual JSON overrides
                    </span>
                    <textarea
                      rows={12}
                      value={editPayload}
                      onChange={(event) => setEditPayload(event.target.value)}
                      className="mt-1 w-full px-3 py-2 font-mono text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </label>
                  <p className="text-xs text-gray-500">
                    Structured fields above are the primary editor. Use the JSON block only for advanced manual fields not exposed here. Immutable fields (`id`, `created_at`, `updated_at`) are excluded automatically.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => void saveBusiness()}
                      disabled={workingId === selectedBusiness.id}
                      className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawerMode("view")}
                      className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {rateModalBusiness && rateDraft ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Approve Business</h3>
                <p className="text-sm text-gray-500">{rateModalBusiness.name}</p>
              </div>
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                onClick={() => {
                  setRateModalBusiness(null);
                  setRateDraft(null);
                }}
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <p className="text-sm font-medium text-gray-900 mb-3">Choose a rate</p>
                <div className="grid grid-cols-2 gap-3">
                  {BUSINESS_RATE_PRESET_OPTIONS.map((option) => {
                    const selected = rateDraft.presetKey === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() =>
                          setRateDraft((current) =>
                            option.key === "custom"
                              ? { ...(current || rateDraft), presetKey: "custom" }
                              : createBusinessRateDraft(
                                  option.commissionRateCents,
                                  option.defaultCashbackRateBps,
                                ),
                          )
                        }
                        className={`px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                          selected
                            ? "border-amber-500 bg-amber-50 text-amber-900"
                            : "border-gray-300 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {rateDraft.presetKey === "custom" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Commission %
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={rateDraft.customCommissionPercentInput}
                      onChange={(e) => {
                        const sanitized = sanitizePercentInputText(e.target.value);
                        const parsed = parsePercentInputToScaledInt(sanitized, 10);
                        setRateDraft((current) => {
                          const base = current || rateDraft;
                          const nextCommission =
                            parsed == null
                              ? base.commissionRateCents
                              : normalizeBusinessCommissionRateCents(parsed, base.commissionRateCents);
                          const nextCashback = normalizeBusinessDefaultCashbackRateBps(
                            base.defaultCashbackRateBps,
                            nextCommission,
                          );
                          return {
                            ...base,
                            presetKey: "custom",
                            customCommissionPercentInput: sanitized,
                            commissionRateCents: nextCommission,
                            defaultCashbackRateBps: nextCashback,
                            customCashbackPercentInput: formatPercentLabel(nextCashback / 100),
                          };
                        });
                      }}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Cashback %
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={rateDraft.customCashbackPercentInput}
                      onChange={(e) => {
                        const sanitized = sanitizePercentInputText(e.target.value);
                        const parsed = parsePercentInputToScaledInt(sanitized, 100);
                        setRateDraft((current) => {
                          const base = current || rateDraft;
                          const nextCashback =
                            parsed == null
                              ? base.defaultCashbackRateBps
                              : normalizeBusinessDefaultCashbackRateBps(
                                  parsed,
                                  base.commissionRateCents,
                                );
                          return {
                            ...base,
                            presetKey: "custom",
                            customCashbackPercentInput: sanitized,
                            defaultCashbackRateBps: nextCashback,
                            customCommissionPercentInput: formatPercentLabel(
                              base.commissionRateCents / 10,
                            ),
                          };
                        });
                      }}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Business pays {formatPercentLabel(rateDraft.commissionRateCents / 10)}%, users get{" "}
                {formatPercentLabel(rateDraft.defaultCashbackRateBps / 100)}%, Wello keeps{" "}
                {formatPercentLabel(
                  Math.max(
                    rateDraft.commissionRateCents / 10 -
                      rateDraft.defaultCashbackRateBps / 100,
                    0,
                  ),
                )}
                %.
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setRateModalBusiness(null);
                  setRateDraft(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={workingId === rateModalBusiness.id}
                className="px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-60"
                onClick={async () => {
                  await submitDecision(rateModalBusiness, "approved", rateDraft);
                  setRateModalBusiness(null);
                  setRateDraft(null);
                }}
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
