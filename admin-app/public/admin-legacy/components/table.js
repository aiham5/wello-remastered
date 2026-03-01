import { escapeHtml } from "../lib/format.js";

export const renderTable = ({ container, columns, rows, emptyText = "No records.", onRowClick, rowKey = (row, index) => row?.id || index }) => {
  if (!container) return;
  const safeRows = Array.isArray(rows) ? rows : [];

  const head = columns.map((column) => `<th>${escapeHtml(column.label || "")}</th>`).join("");

  if (!safeRows.length) {
    container.innerHTML = `
      <table class="admin-table"><thead><tr>${head}</tr></thead></table>
      <div class="admin-empty">${escapeHtml(emptyText)}</div>
    `;
    return;
  }

  const body = safeRows.map((row, index) => {
    const key = rowKey(row, index);
    const cells = columns.map((column) => {
      const value = typeof column.render === "function" ? column.render(row, index) : row?.[column.key];
      return `<td>${value == null ? "--" : value}</td>`;
    }).join("");
    return `<tr data-row-key="${escapeHtml(String(key))}">${cells}</tr>`;
  }).join("");

  container.innerHTML = `<table class="admin-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;

  if (typeof onRowClick === "function") {
    container.querySelectorAll("tr[data-row-key]").forEach((tr) => {
      tr.addEventListener("click", () => {
        const key = tr.getAttribute("data-row-key");
        const row = safeRows.find((candidate, idx) => String(rowKey(candidate, idx)) === key);
        if (row) onRowClick(row);
      });
    });
  }
};
