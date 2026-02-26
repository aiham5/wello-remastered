export const mapStatusBadge = (status) => {
  const normalized = String(status || "pending").toLowerCase();
  return `<span class="status-pill ${normalized}">${normalized}</span>`;
};

export const createSectionHeader = ({ title, subtitle = "", actions = "" }) => `
  <div class="module-header">
    <div>
      <h2>${title}</h2>
      ${subtitle ? `<p>${subtitle}</p>` : ""}
    </div>
    <div class="module-actions">${actions}</div>
  </div>
`;

export const card = ({ title, value, hint = "" }) => `
  <article class="kpi-card">
    <h4>${title}</h4>
    <div class="value">${value}</div>
    ${hint ? `<p>${hint}</p>` : ""}
  </article>
`;
