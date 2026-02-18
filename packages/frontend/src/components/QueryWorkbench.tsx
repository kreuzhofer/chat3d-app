import { useMemo, useState } from "react";
import { listLlmModels, submitQuery, type QuerySubmitResult } from "../api/query.api";
import { useAuth } from "../hooks/useAuth";
import { useNotifications } from "../contexts/NotificationsContext";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

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
    <section className="space-y-4 bg-[hsl(var(--background))] p-4">
      <header>
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Query Workbench</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Submit render queries and track `chat.query.state` transitions over SSE.
        </p>
      </header>

      {message ? <p className="rounded-md border p-2 text-sm">{message}</p> : null}
      {error ? (
        <p className="rounded-md border border-[hsl(var(--destructive))] p-2 text-sm text-[hsl(var(--destructive))]">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Submit Query</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Label htmlFor="query-context-id">Context ID</Label>
            <Input
              id="query-context-id"
              value={contextId}
              onChange={(event) => setContextId(event.target.value)}
              placeholder="UUID of chat context"
            />
            <Label htmlFor="query-prompt">Prompt</Label>
            <Input
              id="query-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the model to generate"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" disabled={busy || !token} onClick={() => void loadModels()}>
              Load Models
            </Button>
            <Button disabled={busy || !token} onClick={() => void runQuery()}>
              Submit Query
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model Registry</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Realtime Query State</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Last Query Result</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
