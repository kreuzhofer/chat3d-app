import { createLogger } from "../../utils/logger.js";
import { fetchCodegenRows } from "./codegen-rows.service.js";
import { stripComments } from "./strip-comments.js";
import { buildMinimalSystemPrompt } from "./minimal-system-prompt.js";
import type { ExportRequest } from "./types.js";

const logger = createLogger("training-export-sharegpt");

export async function exportShareGptCodegenJsonl(req: ExportRequest): Promise<string> {
  const rows = await fetchCodegenRows(req);
  const mode = req.commentMode ?? "none";

  const lines = rows.map((r) => {
    const code = stripComments(r.code, mode);
    const systemPrompt = buildMinimalSystemPrompt(r.code, "code-only");
    return JSON.stringify({
      conversations: [
        { from: "system", value: systemPrompt },
        { from: "human", value: r.prompt },
        { from: "gpt", value: `\`\`\`python\n${code}\n\`\`\`` },
      ],
    });
  });

  logger.info(
    { rowCount: rows.length, lineCount: lines.length, commentMode: mode },
    "sharegpt-codegen export complete",
  );
  return lines.join("\n");
}
