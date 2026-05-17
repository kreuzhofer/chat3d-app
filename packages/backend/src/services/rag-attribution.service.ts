/**
 * Pure helpers for RAG retrieval attribution.
 *
 * extractIdentifiers picks "high-signal" tokens (PascalCase + multi-segment
 * snake_case) from a code/prose snippet. detectUsage tells whether any of
 * those identifiers appears in the agent's final output, after subtracting
 * tokens that already appear in the prompt or spec (which would make
 * attribution ambiguous).
 */

// Generic Python / typing keywords that show up everywhere and aren't useful
// as evidence of "this specific snippet helped".
const STOPWORDS = new Set<string>([
  "True", "False", "None", "Self",
  "Any", "List", "Dict", "Set", "Tuple", "Optional", "Union", "Type",
  "Exception", "ValueError", "TypeError", "Iterable",
  "If", "Else", "Return", "Import", "From",
]);

const MAX_IDS_PER_SNIPPET = 30;

export function extractIdentifiers(text: string): string[] {
  if (!text) return [];
  const set = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z][a-zA-Z0-9_]+\b/g)) {
    if (!STOPWORDS.has(m[0])) set.add(m[0]);
  }
  for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) {
    set.add(m[0]);
  }
  return Array.from(set).slice(0, MAX_IDS_PER_SNIPPET);
}

export interface UsageResult {
  used: boolean;
  evidence: string | null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectUsage(
  snippetIdentifiers: string[],
  finalCode: string,
  conversationText: string,
  promptText: string,
  specText: string,
): UsageResult {
  const ambiguous = new Set(extractIdentifiers(`${promptText} ${specText}`));
  const haystack = `${finalCode}\n${conversationText}`;
  for (const id of snippetIdentifiers) {
    if (ambiguous.has(id)) continue;
    const re = new RegExp(`\\b${escapeRegex(id)}\\b`);
    if (re.test(haystack)) {
      return { used: true, evidence: id };
    }
  }
  return { used: false, evidence: null };
}
