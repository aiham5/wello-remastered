export const renderPagination = ({ container, page, pageSize, rowCount, onPageChange }) => {
  if (!container) return;
  const safePage = Math.max(0, Number(page) || 0);
  const safePageSize = Math.max(1, Number(pageSize) || 25);
  const safeCount = Math.max(0, Number(rowCount) || 0);
  const hasPrev = safePage > 0;
  const hasNext = safeCount === safePageSize;

  container.innerHTML = `
    <div class="pagination-controls">
      <button class="button secondary" data-dir="prev" ${hasPrev ? "" : "disabled"}>Previous</button>
      <span>Page ${safePage + 1}</span>
      <button class="button secondary" data-dir="next" ${hasNext ? "" : "disabled"}>Next</button>
    </div>
  `;

  container.querySelector("button[data-dir='prev']")?.addEventListener("click", () => {
    if (hasPrev) onPageChange(Math.max(0, safePage - 1));
  });
  container.querySelector("button[data-dir='next']")?.addEventListener("click", () => {
    if (hasNext) onPageChange(safePage + 1);
  });
};
