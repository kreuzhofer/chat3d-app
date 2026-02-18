import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createChatContext,
  createChatItem,
  listChatContexts,
  listChatItems,
  type ChatContext,
  type ChatItem,
} from "../api/chat.api";
import { uploadFileBase64 } from "../api/files.api";
import { useAuth } from "../hooks/useAuth";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getMessagePreview(messages: unknown): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "";
  }

  const first = messages[0];
  if (typeof first !== "object" || first === null) {
    return "";
  }

  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

export function ChatWorkspace() {
  const { token } = useAuth();
  const [contexts, setContexts] = useState<ChatContext[]>([]);
  const [activeContextId, setActiveContextId] = useState<string>("");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [newContextName, setNewContextName] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [filePath, setFilePath] = useState("upload/manual-note.txt");
  const [fileContent, setFileContent] = useState("example file content");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const activeContext = useMemo(
    () => contexts.find((ctx) => ctx.id === activeContextId) ?? null,
    [activeContextId, contexts],
  );

  const refreshContexts = useCallback(async () => {
    if (!token) {
      return;
    }
    const loaded = await listChatContexts(token);
    setContexts(loaded);
    if (!activeContextId && loaded[0]) {
      setActiveContextId(loaded[0].id);
    }
  }, [activeContextId, token]);

  const refreshItems = useCallback(async () => {
    if (!token || !activeContextId) {
      setItems([]);
      return;
    }
    const loaded = await listChatItems(token, activeContextId);
    setItems(loaded);
  }, [activeContextId, token]);

  useEffect(() => {
    void refreshContexts().catch((loadError) => setError(toErrorMessage(loadError)));
  }, [refreshContexts]);

  useEffect(() => {
    void refreshItems().catch((loadError) => setError(toErrorMessage(loadError)));
  }, [refreshItems]);

  const createContextAction = useCallback(async () => {
    if (!token) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const created = await createChatContext(token, newContextName);
      setNewContextName("");
      await refreshContexts();
      setActiveContextId(created.id);
      setMessage("Chat context created.");
    } catch (createError) {
      setError(toErrorMessage(createError));
    } finally {
      setBusy(false);
    }
  }, [newContextName, refreshContexts, token]);

  const addMessageAction = useCallback(async () => {
    if (!token || !activeContextId) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await createChatItem({
        token,
        contextId: activeContextId,
        role: "user",
        messages: [{ itemType: "message", text: newMessage, state: "completed", stateMessage: "" }],
      });
      setNewMessage("");
      await refreshItems();
      setMessage("Message saved to chat.");
    } catch (actionError) {
      setError(toErrorMessage(actionError));
    } finally {
      setBusy(false);
    }
  }, [activeContextId, newMessage, refreshItems, token]);

  const uploadFileAction = useCallback(async () => {
    if (!token) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await uploadFileBase64({
        token,
        path: filePath,
        contentBase64: toBase64(fileContent),
        contentType: "text/plain",
      });
      setMessage("File uploaded via /api/files.");
    } catch (uploadError) {
      setError(toErrorMessage(uploadError));
    } finally {
      setBusy(false);
    }
  }, [fileContent, filePath, token]);

  return (
    <section className="space-y-4 bg-[hsl(var(--background))] p-4">
      <header>
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Chat Workspace</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          REST-based chat contexts/items with file operations and SSE updates.
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
          <CardTitle>Contexts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex gap-2">
            <Input
              value={newContextName}
              onChange={(event) => setNewContextName(event.target.value)}
              placeholder="New context name"
            />
            <Button disabled={busy || !token} onClick={() => void createContextAction()}>
              Create
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contexts.map((context) => (
                <TableRow key={context.id}>
                  <TableCell>{context.name}</TableCell>
                  <TableCell>{new Date(context.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={activeContextId === context.id ? "secondary" : "outline"}
                      onClick={() => setActiveContextId(context.id)}
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Messages {activeContext ? `(${activeContext.name})` : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex gap-2">
            <Input
              value={newMessage}
              onChange={(event) => setNewMessage(event.target.value)}
              placeholder="Write a message"
            />
            <Button disabled={busy || !token || !activeContextId} onClick={() => void addMessageAction()}>
              Send
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Preview</TableHead>
                <TableHead>Rating</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.role}</TableCell>
                  <TableCell>{getMessagePreview(item.messages)}</TableCell>
                  <TableCell>{item.rating}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Label htmlFor="chat-file-path">Path</Label>
            <Input
              id="chat-file-path"
              value={filePath}
              onChange={(event) => setFilePath(event.target.value)}
              placeholder="upload/notes.txt"
            />
            <Label htmlFor="chat-file-content">Content</Label>
            <Input
              id="chat-file-content"
              value={fileContent}
              onChange={(event) => setFileContent(event.target.value)}
              placeholder="File text"
            />
            <Button variant="outline" disabled={busy || !token} onClick={() => void uploadFileAction()}>
              Upload File
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
