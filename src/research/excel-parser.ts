/**
 * Excel/CSV Parser — Reads spreadsheet files into structured data
 * for the research engine to process.
 */

import { readFile } from "fs/promises";
import { getExecutionPolicy } from "../security/execution-policy.js";

const EXCEL_INSTALL_COMMAND = "npm install --save-exact xlsx-populate@1.21.0 ssf@0.11.2";

export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  rows: unknown[][];
  rowCount: number;
  columnCount: number;
}

/**
 * Parse an Excel (.xlsx) or CSV file into structured data.
 */
export async function parseExcel(filePath: string): Promise<ParsedSheet> {
  const ext = filePath.toLowerCase().split(".").pop();

  if (ext === "csv") {
    return parseCsv(filePath);
  }

  // Keep the XLSX parser off the CLI startup path; research imports it on demand.
  getExecutionPolicy().assert("host-integration-code", "load optional XLSX parsers");
  let excelDependencies: [typeof import("xlsx-populate"), typeof import("ssf")];
  try {
    excelDependencies = await Promise.all([
      import("xlsx-populate"),
      import("ssf"),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `MEMI_OPTIONAL_INTEGRATION_MISSING: XLSX research import requires optional parsers. Run \`${EXCEL_INSTALL_COMMAND}\`. ${detail}`,
    );
  }
  const [{ default: XlsxPopulate }, { is_date: isDateFormat }] = excelDependencies;
  const workbook = await XlsxPopulate.fromFileAsync(filePath);
  const sheet = workbook.sheet(0);
  if (!sheet) {
    throw new Error(`No worksheets found in ${filePath}`);
  }

  const sheetRows = sheet.usedRange()?.value() ?? [];
  const normalizedRows = sheetRows.map((row, rowIndex) => row.map((cell, columnIndex) => {
    if (typeof cell !== "number") return cellToValue(cell);
    const numberFormat = sheet.cell(rowIndex + 1, columnIndex + 1).style("numberFormat");
    if (typeof numberFormat === "string" && isDateFormat(numberFormat)) {
      return XlsxPopulate.numberToDate(cell).toISOString();
    }
    return cell;
  }));
  const [headerRow = [], ...dataRows] = normalizedRows;
  const headers = headerRow.map((cell, index) =>
    String(cell ?? `Column ${index + 1}`),
  );
  const rows = dataRows.filter((row) =>
    row.some((cell) => cell !== null && cell !== undefined),
  );

  return {
    sheetName: sheet.name(),
    headers,
    rows,
    rowCount: rows.length,
    columnCount: headers.length,
  };
}

/**
 * Parse a CSV file.
 */
async function parseCsv(filePath: string): Promise<ParsedSheet> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());

  if (lines.length === 0) {
    return {
      sheetName: "CSV",
      headers: [],
      rows: [],
      rowCount: 0,
      columnCount: 0,
    };
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);

  return {
    sheetName: "CSV",
    headers,
    rows,
    rowCount: rows.length,
    columnCount: headers.length,
  };
}

/**
 * Parse a single CSV line, handling quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Convert a spreadsheet cell value to a deterministic plain JS value.
 */
function cellToValue(cell: unknown): unknown {
  if (cell === null || cell === undefined) return null;

  // Preserve compatibility with structured values from older workbook readers.
  const obj = cell as Record<string, unknown>;
  if (typeof cell === "object" && typeof obj.text === "function") {
    return (obj.text as () => string)();
  }

  if (typeof cell === "object" && "richText" in obj) {
    return (obj.richText as { text: string }[]).map((rt) => rt.text).join("");
  }

  // ExcelJS hyperlink
  if (typeof cell === "object" && "hyperlink" in obj) {
    return (obj.text as string) ?? (obj.hyperlink as string);
  }

  // ExcelJS formula result
  if (typeof cell === "object" && "result" in obj) {
    return obj.result;
  }

  // Date
  if (cell instanceof Date) {
    return cell.toISOString();
  }

  return cell;
}
