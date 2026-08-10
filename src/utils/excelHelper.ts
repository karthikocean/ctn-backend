import ExcelJS from "exceljs";
import { BadRequestError } from "routing-controllers";

export interface ParseExcelOptions {
  maxRows?: number;
  maxColumns?: number;
  maxFileSizeMB?: number;
}

/**
 * Parses an Excel buffer (.xlsx, .xls) safely into an array of objects
 * matching the key-value structure of SheetJS sheet_to_json.
 */
export async function parseExcelBufferToJson<T = any>(
  fileData: Buffer,
  options: ParseExcelOptions = {}
): Promise<T[]> {
  const { maxRows = 10000, maxColumns = 100, maxFileSizeMB = 20 } = options;

  if (!fileData || !Buffer.isBuffer(fileData)) {
    throw new BadRequestError("Invalid file buffer provided.");
  }

  if (fileData.length > maxFileSizeMB * 1024 * 1024) {
    throw new BadRequestError(`File size exceeds maximum allowed limit of ${maxFileSizeMB}MB.`);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(fileData as any);
  } catch {
    throw new BadRequestError("Failed to parse Excel file. The file may be corrupted or in an invalid format.");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) {
    return [];
  }

  if (worksheet.rowCount > maxRows + 1) {
    throw new BadRequestError(`Excel file contains too many rows. Maximum allowed limit is ${maxRows} rows.`);
  }

  const jsonData: T[] = [];
  let headers: string[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // ExcelJS row.values is 1-indexed. Index 0 is undefined.
    const rowValues: any[] = Array.isArray(row.values) ? row.values.slice(1) : [];

    if (rowNumber === 1) {
      headers = rowValues.map((h: any) => {
        if (h && typeof h === "object") {
          if ("result" in h) return String(h.result || "").trim();
          if ("text" in h) return String(h.text || "").trim();
          if ("richText" in h && Array.isArray(h.richText)) {
            return h.richText.map((r: any) => r.text).join("").trim();
          }
        }
        return String(h || "").trim();
      });

      if (headers.length > maxColumns) {
        throw new BadRequestError(`Excel file has too many columns. Maximum allowed is ${maxColumns}.`);
      }
    } else {
      const rowObj: Record<string, any> = {};
      let hasData = false;

      headers.forEach((header, index) => {
        if (header) {
          let val: any = rowValues[index];
          if (val !== undefined && val !== null) {
            if (typeof val === "object") {
              if (val instanceof Date) {
                // Keep Date instance as is
              } else if ("result" in val) {
                val = val.result;
              } else if ("text" in val) {
                val = val.text;
              } else if ("richText" in val && Array.isArray(val.richText)) {
                val = val.richText.map((r: any) => r.text).join("");
              } else if ("hyperlink" in val && "text" in val) {
                val = (val as any).text;
              }
            }
            rowObj[header] = val;
            if (val !== "") hasData = true;
          } else {
            rowObj[header] = "";
          }
        }
      });

      if (hasData) {
        jsonData.push(rowObj as T);
      }
    }
  });

  return jsonData;
}
