import { exportCombinedTrainingJsonl } from "../workbench-training-export.service.js";
import type { ExportRequest } from "./types.js";

export async function exportOpenAiMultiTaskJsonl(req: ExportRequest): Promise<string> {
  return exportCombinedTrainingJsonl(req);
}
