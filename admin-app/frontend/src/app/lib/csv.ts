export interface CsvColumn<Row extends Record<string, unknown>> {
  key: keyof Row | string;
  label: string;
  format?: (value: unknown, row: Row) => string;
}

const normalizeCsvCell = (value: unknown): string => {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  if (!text) return "";
  // Prevent CSV formula injection in spreadsheet apps.
  if (/^[=+\-@]/.test(text)) return `'${text}`;
  return text;
};

const escapeCsvCell = (value: string): string => {
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const rowsToCsv = <Row extends Record<string, unknown>>(
  rows: Row[],
  columns: CsvColumn<Row>[],
): string => {
  const header = columns.map((column) => escapeCsvCell(column.label)).join(",");
  const lines = rows.map((row) =>
    columns
      .map((column) => {
        const raw = column.format
          ? column.format((row as Record<string, unknown>)[String(column.key)], row)
          : (row as Record<string, unknown>)[String(column.key)];
        return escapeCsvCell(normalizeCsvCell(raw));
      })
      .join(","),
  );
  return [header, ...lines].join("\n");
};

export const downloadCsv = <Row extends Record<string, unknown>>(
  filename: string,
  rows: Row[],
  columns: CsvColumn<Row>[],
) => {
  const csv = rowsToCsv(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};
