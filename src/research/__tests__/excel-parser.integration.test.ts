import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import XlsxPopulate from "xlsx-populate";
import { configureExecutionPolicy, resetExecutionPolicyForTests } from "../../security/execution-policy.js";
import { parseExcel } from "../excel-parser.js";

const temporaryDirectories: string[] = [];

beforeEach(() => {
  configureExecutionPolicy({
    projectRoot: "/workspace",
    profile: "connected",
    allow: ["host-integration-code"],
  });
});

afterEach(async () => {
  resetExecutionPolicyForTests();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("parseExcel XLSX integration", () => {
  it("reads a real workbook from disk", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memi-xlsx-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "survey.xlsx");
    const workbook = await XlsxPopulate.fromBlankAsync();
    const sheet = workbook.sheet(0);

    if (!sheet) throw new Error("Blank workbook did not contain a worksheet");
    sheet.cell("A1").value("Role");
    sheet.cell("B1").value("Created");
    sheet.cell("A2").value("Designer");
    sheet.cell("B2")
      .value(new Date("2026-07-18T00:00:00.000Z"))
      .style("numberFormat", "yyyy-mm-dd");
    await workbook.toFileAsync(filePath);

    await expect(parseExcel(filePath)).resolves.toEqual({
      sheetName: "Sheet1",
      headers: ["Role", "Created"],
      rows: [["Designer", "2026-07-18T00:00:00.000Z"]],
      rowCount: 1,
      columnCount: 2,
    });
  });
});
