import { createLogger } from "../../utils/logger.js";
import { fetchCodegenRows } from "./codegen-rows.service.js";
import { stripComments } from "./strip-comments.js";
import type { ExportRequest } from "./types.js";

const logger = createLogger("training-export-alpaca");

export async function exportAlpacaCodegenJsonl(req: ExportRequest): Promise<string> {
  const rows = await fetchCodegenRows(req);
  const mode = req.commentMode ?? "none";

  const lines = rows.map((r) => {
    const code = stripComments(r.code, mode);
    return JSON.stringify({
      instruction: r.prompt,
      input: r.systemPrompt,
      output: code,
    });
  });

  logger.info(
    { rowCount: rows.length, lineCount: lines.length, commentMode: mode },
    "alpaca-codegen export complete",
  );
  return lines.join("\n");
}
