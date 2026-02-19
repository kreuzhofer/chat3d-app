import { useMemo, useState } from "react";
import { listLlmModels, submitQuery, type QuerySubmitResult } from "../api/query.api";
import { useAuth } from "../hooks/useAuth";
import { useNotifications } from "../contexts/NotificationsContext";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { FormField } from "./ui/form";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Textarea } from "./ui/textarea";
import { EmptyState } from "./layout/EmptyState";
import { InlineAlert } from "./layout/InlineAlert";
import { PageHeader } from "./layout/PageHeader";
import { SectionCard } from "./layout/SectionCard";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function QueryWorkbench() {
  const { token } = useAuth();
  const { notifications } = useNotifications();

  const [contextId, setContextId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<Array<{ id: string; stage: string; provider: string; modelName: string }>>(
    [],
  );
  const [result, setResult] = useState<QuerySubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const queryStates = useMemo(
    () =>
      notifications
        .filter((notification) => notification.eventType === "chat.query.state")
        .map((notification) => notification.payload)
        .slice(0, 10),
    [notifications],
  );

  async function loadModels() {
    if (!token) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const loaded = await listLlmModels(token);
      setModels(loaded);
      setMessage("Model registry loaded.");
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setBusy(false);
    }
  }

  async function runQuery() {
    if (!token) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const submitted = await submitQuery({
        token,
        contextId,
        prompt,
      });
      setResult(submitted);
      setMessage("Query submitted. Watch live state events below.");
    } catch (submitError) {
      setError(toErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Query Workbench"
        description="Submit render queries and track chat.query.state transitions in real time."
        breadcrumbs={["Workspace", "Query Workbench"]}
        actions={<Badge tone="info">SSE {notifications.length > 0 ? "active" : "idle"}</Badge>}
      />

      {message ? <InlineAlert tone="success">{message}</InlineAlert> : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      <SectionCard title="Submit Query" description="Use a context ID and prompt to trigger a generation run.">
        <div className="grid gap-3">
          <FormField label="Context ID" htmlFor="query-context-id" helperText="Existing chat context UUID.">
            <Input
              id="query-context-id"
              value={contextId}
              onChange={(event) => setContextId(event.target.value)}
              placeholder="UUID of chat context"
            />
          </FormField>
          <FormField label="Prompt" htmlFor="query-prompt" helperText="Be explicit about dimensions and constraints.">
            <Textarea
              id="query-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the model to generate"
            />
          </FormField>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy || !token} onClick={() => void loadModels()}>
              Load Models
            </Button>
            <Button disabled={busy || !token} onClick={() => void runQuery()}>
              Submit Query
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Model Registry">
        {models.length === 0 ? (
          <EmptyState
            title="No models loaded"
            description="Load the model registry first to inspect available conversation and codegen models."
            action={
              <Button variant="outline" disabled={busy || !token} onClick={() => void loadModels()}>
                Load Models
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((model) => (
                <TableRow key={model.id}>
                  <TableCell>{model.id}</TableCell>
                  <TableCell>{model.stage}</TableCell>
                  <TableCell>{model.provider}</TableCell>
                  <TableCell>{model.modelName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard title="Realtime Query State">
        {queryStates.length === 0 ? (
          <EmptyState title="No query events yet" description="Run a query and SSE events will appear here." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State</TableHead>
                <TableHead>Context</TableHead>
                <TableHead>Assistant Item</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queryStates.map((payload, index) => (
                <TableRow key={`${String(payload.state ?? "unknown")}-${index}`}>
                  <TableCell>{String(payload.state ?? "")}</TableCell>
                  <TableCell>{String(payload.contextId ?? "")}</TableCell>
                  <TableCell>{String(payload.assistantItemId ?? "")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {result ? (
        <SectionCard title="Last Query Result">
            <p className="text-sm">Assistant item: {result.assistantItem.id}</p>
            <p className="text-sm">
              Files:{" "}
              {result.generatedFiles.length > 0
                ? result.generatedFiles.map((file) => `${file.filename} (${file.path})`).join(", ")
                : "none"}
            </p>
            <p className="text-sm">
              Models: {result.llm.conversationModel} / {result.llm.codegenModel}
            </p>
        </SectionCard>
      ) : null}
    </section>
  );
}
