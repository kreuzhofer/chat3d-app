import { createLogger } from "../../utils/logger.js";
import { fetchCodegenRows } from "./codegen-rows.service.js";
import type { ExportRequest } from "./types.js";

const logger = createLogger("training-export-sharegpt");

export async function exportShareGptCodegenJsonl(req: ExportRequest): Promise<string> {
  const rows = await fetchCodegenRows(req);

  const lines = rows.map((r) =>
    JSON.stringify({
      conversations: [
        { from: "system", value: r.systemPrompt },
        { from: "human", value: r.prompt },
        { from: "gpt", value: `\`\`\`python\n${r.code}\n\`\`\`` },
      ],
    }),
  );

  logger.info({ rowCount: rows.length, lineCount: lines.length }, "sharegpt-codegen export complete");
  return lines.join("\n");
}
