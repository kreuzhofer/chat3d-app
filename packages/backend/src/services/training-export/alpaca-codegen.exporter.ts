import { createLogger } from "../../utils/logger.js";
import { fetchCodegenRows } from "./codegen-rows.service.js";
import type { ExportRequest } from "./types.js";

const logger = createLogger("training-export-alpaca");

export async function exportAlpacaCodegenJsonl(req: ExportRequest): Promise<string> {
  const rows = await fetchCodegenRows(req);

  const lines = rows.map((r) =>
    JSON.stringify({
      instruction: r.prompt,
      input: r.systemPrompt,
      output: r.code,
    }),
  );

  logger.info({ rowCount: rows.length, lineCount: lines.length }, "alpaca-codegen export complete");
  return lines.join("\n");
}
