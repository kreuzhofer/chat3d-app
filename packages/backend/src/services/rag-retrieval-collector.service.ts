/**
 * In-memory accumulator for RAG retrieval events during one workbench
 * generation. A single instance is created at the top of the pipeline
 * (workbench-codegen.service.ts) and threaded through agent-codegen,
 * agent-multi, and agent-tools.service.ts. Post-loop, the calling code
 * computes "used" per event and bulk-inserts to rag_retrieval_events.
 *
 * Source values:
 *   - "preretrieved_example"   research package examples (workbench rows)
 *   - "preretrieved_knowledge" research package knowledge entries
 *   - "tool_search_examples"   agent called search_examples
 *   - "tool_search_knowledge"  agent called search_knowledge
 *   - "tool_lookup_api"        agent called lookup_api
 */

export type RagRetrievalSource =
  | "preretrieved_example"
  | "preretrieved_knowledge"
  | "tool_search_examples"
  | "tool_search_knowledge"
  | "tool_lookup_api";

export interface RagRetrievalEvent {
  source: RagRetrievalSource;
  /** Stable reference if known (e.g. workbench prompt id, knowledge source id, api topic). Null for unstructured. */
  snippetRef: string | null;
  /** Short human-readable label (<=200 chars) for UI/debug. */
  snippetSummary: string;
  /** High-signal identifiers extracted from the snippet body. */
  identifiers: string[];
  /** Agent step number when retrieval happened. Null for pre-retrieval. */
  retrievalStep: number | null;
}

export class RagRetrievalCollector {
  private events: RagRetrievalEvent[] = [];

  push(e: RagRetrievalEvent): void {
    this.events.push(e);
  }

  list(): readonly RagRetrievalEvent[] {
    return this.events;
  }

  size(): number {
    return this.events.length;
  }
}
