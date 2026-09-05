import { readFileSync } from "node:fs";
import { buildEvaluationSystemPrompt } from "../../src/services/visual-eval-prompt.service.js";
const dir = new URL("./", import.meta.url).pathname;
const opts = {
  userPrompt: "A butt hinge with 5 interleaved knuckles and 3 holes per leaf",
  categoryName: "Hardware", complexity: 5,
  checklist: ["Do both leaves have a visible concave waist?", "Are there exactly 5 knuckles interleaved along the barrel?", "Does each leaf show exactly 3 circular mounting holes?"],
  hasZoomTool: false, providedAngles: ["front","back","left","right","top","bottom","ortho_45","ortho_45_bottom"],
  constructionSpec: "", evalPreamble: "", evalPlan: null,
};
const prod = buildEvaluationSystemPrompt(opts);
const ctrl = buildEvaluationSystemPrompt({ ...opts, instrumentTemplate: readFileSync(dir + "legacy-control.instrument.txt", "utf8") });
const vari = buildEvaluationSystemPrompt({ ...opts, instrumentTemplate: readFileSync(dir + "evidence-uncertain-v1.instrument.txt", "utf8") });
console.log("control == production:", ctrl === prod, "| control chars", ctrl.length, "| variant chars", vari.length);
console.log("=== VARIANT TAIL ===");
console.log(vari.slice(vari.indexOf("Verification Checklist")));
