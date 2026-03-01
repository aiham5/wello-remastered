import { FileText, LifeBuoy, Shield, Wallet, BarChart3, Receipt } from "lucide-react";

const sections = [
  {
    title: "Receipt Review Workflow",
    icon: Receipt,
    items: [
      "Open pending receipts from Receipt Reviews.",
      "Adjust totals, verify/reject, and leave review notes.",
      "Use 'Open image' to inspect full-size uploaded receipts.",
    ],
  },
  {
    title: "Cashout Approvals and Retries",
    icon: Wallet,
    items: [
      "Approve/reject pending bank transfers from Cashback Payouts.",
      "Use batch processing for selected pending bank-transfer rows.",
      "Retry is available only for failed bank-transfer payouts.",
    ],
  },
  {
    title: "Fraud and Reported Receipts",
    icon: Shield,
    items: [
      "Open Fraud & Disputes to review reported receipt cases.",
      "Use reported details and full-size receipt images before resolving.",
      "Log resolution notes when dismissing or resolving cases.",
    ],
  },
  {
    title: "Reports and Exports",
    icon: BarChart3,
    items: [
      "Refresh reports before exporting.",
      "CSV exports use current filters and include safe values.",
      "Use exported files for audit and finance reconciliation.",
    ],
  },
];

export function Help() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
            <LifeBuoy className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Admin Help Center</h2>
            <p className="text-sm text-gray-600 mt-1">
              Operational runbooks and quick guidance for moderation, payouts, and reporting.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {sections.map((section) => (
          <section key={section.title} className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center">
                <section.icon className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">{section.title}</h3>
            </div>
            <ul className="space-y-2 text-sm text-gray-700">
              {section.items.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-gray-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start gap-3">
          <FileText className="w-5 h-5 text-gray-600 mt-0.5" />
          <div>
            <h3 className="text-base font-semibold text-gray-900">Escalation</h3>
            <p className="text-sm text-gray-700 mt-1">
              For production incidents or unresolved payout/receipt anomalies, contact{" "}
              <a
                href="mailto:support@wellopartners.com"
                className="text-amber-700 hover:text-amber-800 underline"
              >
                support@wellopartners.com
              </a>{" "}
              and include affected record IDs.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
