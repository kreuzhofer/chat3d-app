/**
 * Research Agent — Format research results for prompt injection.
 *
 * Formats deduplicated examples + knowledge + gap warnings into a
 * system prompt section within the ~3000 token budget.
 */

import type { FewShotMatch } from "./workbench-embeddings.service.js";
import type { KnowledgeSearchMatch } from "./knowledge-search.service.js";
import type { ResearchPackage } from "./research-agent.service.js";
import { truncateCode } from "../utils/code-truncate.js";

const MAX_EXAMPLE_LINES = 20;
const MAX_KNOWLEDGE_LINES = 30;

/**
 * Format a ResearchPackage into a prompt section for system prompt injection.
 * Prioritizes by similarity, caps at maxExamples + 3 knowledge entries.
 * @param maxExamplesOverride — if provided, overrides the default cap of 3 examples.
 */
export function formatResearchSection(pkg: ResearchPackage, maxExamplesOverride?: number): string {
  const parts: string[] = [];

  // Examples section
  const topExamples = pkg.examples.slice(0, maxExamplesOverride ?? 3);
  if (topExamples.length > 0) {
    const exEntries = topExamples.map((m, i) => {
      const code = truncateCode(m.code, MAX_EXAMPLE_LINES);
      return `### Example ${i + 1} (${(m.similarity * 100).toFixed(0)}% match)\nPrompt: ${m.prompt}\n\`\`\`python\n${code}\n\`\`\``;
    });
    parts.push(`## Relevant Code Examples\n\n${exEntries.join("\n\n")}`);
  }

  // Knowledge section
  const topKnowledge = pkg.knowledge.slice(0, 3);
  if (topKnowledge.length > 0) {
    const knEntries = topKnowledge.map((m, i) => {
      const content = m.sourceType === "reference"
        ? m.code
        : truncateCode(m.code, MAX_KNOWLEDGE_LINES);
      return `### ${m.title} (${(m.similarity * 100).toFixed(0)}% match)\n${content}`;
    });
    parts.push(`## Reference Knowledge\n\n${knEntries.join("\n\n---\n\n")}`);
  }

  // Gap warnings
  if (pkg.gapWarnings.length > 0) {
    parts.push(`## ⚠ Knowledge Gaps\n\nNo good examples found for these techniques — use simple, proven patterns:\n${pkg.gapWarnings.map(g => `- ${g}`).join("\n")}`);
  }

  if (parts.length === 0) {
    return "";
  }

  return parts.join("\n\n");
}
