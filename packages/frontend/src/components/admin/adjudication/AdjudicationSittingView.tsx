/**
 * One sitting, one card at a time (the shape Daniel chose on the #92
 * prototype): the views large, the judges' answers and the triage beneath,
 * a left rail with the tally and a dot per item. Deciding advances to the
 * next open card; "careful look first" is the order. Decisions go to the
 * database on every click; the tally shown is the server's.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { InlineAlert } from "../../layout/InlineAlert";
import { Button } from "../../ui/button";
import {
  carefulLookRank, completeSitting, getSitting, recordDecision, startTriage, VIEW_ORDER,
  type AdjudicationTally, type DecisionInput, type Sitting, type SittingItem, type ViewName,
} from "../../../api/adjudication.api";
import { getJobStatus } from "../../../api/workbench.api";
import { DecisionButtons, DirectionChip, JudgeColumns, Lightbox, stepView, TallyMeters, ViewsGrid } from "./AdjudicationParts";

interface Props { token: string; sittingId: string; onBack: () => void }

export function AdjudicationSittingView({ token, sittingId, onBack }: Props) {
  const [sitting, setSitting] = useState<Sitting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<"careful" | "sheet">("careful");
  const [pos, setPos] = useState(0);
  const [lightbox, setLightbox] = useState<ViewName | null>(null);
  const [saving, setSaving] = useState(false);
  const [triageJob, setTriageJob] = useState<{ jobId: string; completed: number; total: number; failed: number } | null>(null);

  const load = useCallback(async () => {
    try { setSitting(await getSitting(token, sittingId)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [token, sittingId]);
  useEffect(() => { load(); }, [load]);

  const ordered = useMemo(() => {
    const items = sitting?.items.slice() ?? [];
    if (order === "careful") items.sort((a, b) => carefulLookRank(a) - carefulLookRank(b));
    return items;
  }, [sitting, order]);
  useEffect(() => {
    // Start on the first open card.
    const first = ordered.findIndex((it) => !it.decision);
    setPos(first >= 0 ? first : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sittingId, order, sitting?.items.length]);

  const item: SittingItem | undefined = ordered[pos];
  const readOnly = !!sitting?.completedAt;

  const applyResult = (itemId: string, patch: Partial<SittingItem>, tally: AdjudicationTally) => {
    setSitting((s) => s && { ...s, tally, items: s.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) });
  };

  const decide = useCallback(async (input: DecisionInput) => {
    if (!item || !sitting || readOnly) return;
    setSaving(true);
    try {
      const r = await recordDecision(token, sitting.id, item.id, input);
      applyResult(item.id, { decision: r.item.decision, note: r.item.note, agreedWithTriage: r.item.agreedWithTriage, decidedAt: r.item.decidedAt }, r.tally);
      setError(null);
      // The card stays: moving on is the adjudicator's own click (Previous / Next), never a side effect of deciding.
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, sitting, readOnly, token, ordered, pos]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input, textarea, select, [contenteditable]")) return;
      if (lightbox) return;
      if (e.key === "ArrowRight" || e.key === "j") { e.preventDefault(); setPos((p) => Math.min(ordered.length - 1, p + 1)); }
      if (e.key === "ArrowLeft" || e.key === "k") { e.preventDefault(); setPos((p) => Math.max(0, p - 1)); }
      if (!item || readOnly) return;
      if (e.key === "a" && item.triage) decide({ decision: item.triage.verdict, note: item.note, agreedWithTriage: true });
      if (e.key === "r" || e.key === "c" || e.key === "n") decide({ decision: e.key.toUpperCase() as "R" | "C" | "N", note: item.note });
      if (e.key >= "1" && e.key <= "8") setLightbox(VIEW_ORDER[Number(e.key) - 1]);
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [item, readOnly, decide, ordered.length, lightbox]);

  // The triage job runs on the server; poll it and reload the sitting when it ends.
  useEffect(() => {
    if (!triageJob) return;
    const timer = setInterval(async () => {
      try {
        const j = await getJobStatus(token, triageJob.jobId);
        setTriageJob({ jobId: j.jobId, completed: j.completed, total: j.total, failed: j.failed });
        if (j.status !== "running") {
          clearInterval(timer);
          setTriageJob(null);
          if (j.failed > 0) setError(`Triage finished with ${j.failed} of ${j.total} reads failed${j.error ? `: ${j.error}` : ""}`);
          await load();
        }
      } catch (e) { clearInterval(timer); setTriageJob(null); setError(e instanceof Error ? e.message : String(e)); }
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageJob?.jobId]);

  const runTriage = async (redo = false) => {
    if (!sitting) return;
    try { const j = await startTriage(token, sitting.id, redo); setTriageJob({ jobId: j.jobId, completed: j.completed, total: j.total, failed: j.failed }); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const toggleComplete = async () => {
    if (!sitting) return;
    try { setSitting(await completeSitting(token, sitting.id, !!sitting.completedAt)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  if (!sitting) return <div className="p-4 text-[hsl(var(--muted-foreground))]">{error ? <InlineAlert tone="danger">{error}</InlineAlert> : "Loading the sitting…"}</div>;
  const agreed = sitting.items.filter((it) => it.decision && it.agreedWithTriage).length;
  const decidedCount = sitting.items.filter((it) => it.decision).length;
  const t = sitting.tally;

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <Button variant="outline" size="sm" onClick={onBack} className="mb-2">Back to sittings</Button>
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">{sitting.title}</h2>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            candidate <b>{sitting.candidateLabel}</b> vs reference <b>{sitting.referenceLabel}</b> · <span className="font-mono">{sitting.instrumentId}</span> · {sitting.itemCount} items on {sitting.exampleCount} examples
            {sitting.completedAt ? ` · completed ${new Date(sitting.completedAt).toLocaleString()}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-2 py-1 text-xs" value={order} onChange={(e) => setOrder(e.target.value as "careful" | "sheet")}>
            <option value="careful">Careful look first</option>
            <option value="sheet">Sheet order</option>
          </select>
          {!sitting.completedAt ? (
            <Button size="sm" variant="outline" disabled={!!triageJob} onClick={() => runTriage(sitting.items.every((it) => it.triage))}
              title="A third model reads each item before you do: R / C / N with a confidence and the deciding view. Triage, never a decision.">
              {triageJob ? `Triage ${triageJob.completed + triageJob.failed} / ${triageJob.total}…` : sitting.items.every((it) => it.triage) ? "Re-run triage" : sitting.items.some((it) => it.triage) ? "Triage the rest" : "Run triage"}
            </Button>
          ) : null}
          <Button size="sm" variant={sitting.completedAt ? "outline" : "default"} disabled={!sitting.completedAt && !t.complete} onClick={toggleComplete}>
            {sitting.completedAt ? "Reopen" : t.complete ? "Complete the sitting" : `${t.open} still open`}
          </Button>
        </div>
      </div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
        <aside className="space-y-3 self-start lg:sticky lg:top-4">
          <TallyMeters t={t} agreed={agreed} overruled={decidedCount - agreed} layout="column" />
          <div className="rounded border border-[hsl(var(--border))] p-2">
            <div className="mb-1 text-xs text-[hsl(var(--muted-foreground))]">Items · {order === "careful" ? "careful look first" : "sheet order"}</div>
            <div className="flex flex-wrap gap-1">
              {ordered.map((it, i) => (
                <button key={it.id} type="button" title={`${it.category} · ${it.exampleId.slice(0, 8)} · ${it.question}`} onClick={() => setPos(i)}
                  className={`h-5 w-5 rounded text-[10px] ${i === pos ? "ring-2 ring-[hsl(var(--primary))]" : ""} ${it.decision ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-[hsl(var(--muted))]"}`}>{it.decision ?? ""}</button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">← → move · a agree with the triage · r / c / n decide (the card stays) · 1–8 open a view</p>
        </aside>

        {item ? (
          <section>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
              <span className="font-mono">{pos + 1} / {ordered.length}</span><span>{item.category}</span><span className="font-mono">{item.exampleId.slice(0, 8)} · item {item.itemIndex + 1}</span><DirectionChip item={item} />
              {item.decision ? <span className={`rounded px-1.5 ${item.decisionSource === "auto-triage" ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] ring-1 ring-[hsl(var(--primary))]" : "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"}`} title={item.decisionSource === "auto-triage" ? item.note : undefined}>{item.decision}{item.decisionSource === "auto-triage" ? ` · auto (${item.triage?.model ?? "third judge"}${item.triage?.confidence ? `, ${item.triage.confidence}` : ""}) — yours to overrule` : item.agreedWithTriage ? " · with triage" : ""}</span> : null}
              {saving ? <span>saving…</span> : null}
            </div>
            <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">{item.question}</h3>
            <p className="mb-3 text-xs text-[hsl(var(--muted-foreground))]">{item.prompt}</p>
            <ViewsGrid exampleId={item.exampleId} token={token} deciding={item.triage?.view} cols={4} onOpen={setLightbox} />
            <div className="mt-3"><JudgeColumns item={item} refLabel={sitting.referenceLabel} candLabel={sitting.candidateLabel} /></div>
            <div className="mt-3 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.3)] p-2">
              <DecisionButtons item={item} disabled={readOnly || saving} onDecide={decide} />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <Button variant="outline" size="sm" disabled={pos === 0} onClick={() => setPos((p) => Math.max(0, p - 1))}>← Previous</Button>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">{pos + 1} of {ordered.length}{(() => { const n = ordered.findIndex((it, i) => i > pos && !it.decision); return n >= 0 ? ` · next open: ${n + 1}` : ""; })()}</span>
              <Button variant="outline" size="sm" disabled={pos >= ordered.length - 1} onClick={() => setPos((p) => Math.min(ordered.length - 1, p + 1))}>Next →</Button>
            </div>
          </section>
        ) : <p className="text-sm text-[hsl(var(--muted-foreground))]">This sitting has no items.</p>}
      </div>
      {lightbox && item ? <Lightbox exampleId={item.exampleId} view={lightbox} token={token} onClose={() => setLightbox(null)} onStep={(d) => setLightbox((v) => v && stepView(v, d))} /> : null}
    </div>
  );
}
