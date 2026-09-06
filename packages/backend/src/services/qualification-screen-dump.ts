/**
 * The disagreement dump: the material for adjudication (ADR 0004).
 *
 * Every item where the candidate and the reference answered differently,
 * with each judge's evidence, the second arm's answer where it moved, and
 * an empty verdict column for the human who decides who was right. Pure:
 * takes stored rows, returns Markdown.
 */
import {
  itemState,
  pairItems,
  type ItemState,
  type ScreenRun,
  type StoredChecklistItem,
} from "./qualification-screen.service.js";

export interface JudgeAnswer {
  state: ItemState;
  detail: string;
}

export interface DisagreementRow {
  exampleId: string;
  index: number;
  question: string;
  ref: JudgeAnswer;
  cand: JudgeAnswer;
  /** The second arm's answer, only when it differs from the first arm's. */
  arm2: JudgeAnswer | null;
}

function answer(item: StoredChecklistItem | undefined): JudgeAnswer {
  return { state: itemState(item), detail: (item?.detail ?? "").trim() };
}

/** Items where the candidate's final answer differs from the reference's, in example order. */
export function disagreements(cand: ScreenRun, ref: ScreenRun, arm2?: ScreenRun): DisagreementRow[] {
  const arm2Items = new Map<string, StoredChecklistItem[]>();
  for (const row of arm2?.rows ?? []) {
    if (Array.isArray(row.checklistResults)) arm2Items.set(row.exampleId, row.checklistResults);
  }
  const rows: DisagreementRow[] = [];
  for (const p of pairItems(cand, ref)) {
    const c = answer(p.cand), r = answer(p.ref);
    if (c.state === r.state) continue;
    const second = arm2Items.get(p.exampleId)?.[p.index];
    const a2 = second ? answer(second) : null;
    rows.push({ exampleId: p.exampleId, index: p.index, question: p.question, ref: r, cand: c, arm2: a2 && a2.state !== c.state ? a2 : null });
  }
  return rows;
}

export interface DumpMeta {
  candidateLabel: string;
  referenceLabel: string;
  arm2Label?: string;
  instrumentId: string;
  /** Prompt text and category per example id, for the reader's orientation. */
  prompts: Map<string, { prompt: string; category: string }>;
}

const STATE_WORD: Record<ItemState, string> = { P: "pass", F: "fail", U: "uncertain" };

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n+/g, " ").trim();
}

export function renderDisagreementDump(rows: DisagreementRow[], meta: DumpMeta): string {
  const byExample = new Map<string, DisagreementRow[]>();
  for (const r of rows) byExample.set(r.exampleId, [...(byExample.get(r.exampleId) ?? []), r]);
  const hardFlips = rows.filter((r) => r.ref.state !== "U" && r.cand.state !== "U").length;
  const unstable = rows.filter((r) => r.arm2 != null).length;

  const out: string[] = [];
  out.push(`# Disagreements: ${meta.candidateLabel} vs ${meta.referenceLabel}`);
  out.push("");
  out.push(`Instrument: \`${meta.instrumentId}\`. ${rows.length} disagreeing items on ${byExample.size} examples ` +
    `(${hardFlips} hard pass/fail flips, ${rows.length - hardFlips} with one side uncertain` +
    (meta.arm2Label ? `; ${unstable} where ${meta.arm2Label} answered differently from the first arm` : "") + ").");
  out.push("");
  out.push("Verdict column: `R` the reference is right, `C` the candidate is right, `N` neither or the item is unanswerable, " +
    "with a note if needed. The candidate's confirmed false passes must not exceed the reference's; its confirmed false fails " +
    "must not exceed twice the reference's (ADR 0004).");
  out.push("");

  let n = 0;
  for (const [exampleId, items] of byExample) {
    n++;
    const p = meta.prompts.get(exampleId);
    out.push(`## ${n}. ${p?.category ?? "?"} — example \`${exampleId}\``);
    out.push("");
    if (p?.prompt) out.push(`> ${cell(p.prompt)}`);
    out.push("");
    out.push(`| # | item | ${meta.referenceLabel} | ${meta.candidateLabel} |` + (meta.arm2Label ? ` ${meta.arm2Label} |` : "") + " verdict |");
    out.push("|---|---|---|---|" + (meta.arm2Label ? "---|" : "") + "---|");
    for (const it of items) {
      const line = [
        String(it.index + 1),
        cell(it.question),
        `**${STATE_WORD[it.ref.state]}** — ${cell(it.ref.detail)}`,
        `**${STATE_WORD[it.cand.state]}** — ${cell(it.cand.detail)}`,
      ];
      if (meta.arm2Label) line.push(it.arm2 ? `**${STATE_WORD[it.arm2.state]}** — ${cell(it.arm2.detail)}` : "same");
      line.push("");
      out.push(`| ${line.join(" | ")} |`);
    }
    out.push("");
  }
  return out.join("\n");
}
