import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { LlmProviderRow } from "../../api/admin.api";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { FormField } from "../ui/form";
import { Input } from "../ui/input";
import { Select } from "../ui/select";

// ── Supported providers ────────────────────────────────────────────
// Must match the if-else chain in backend llm-config.service.ts

interface ProviderMeta {
  value: string;
  label: string;
  endpointHint: string;
  endpointPlaceholder: string;
  apiKeyHint: string;
}

const SUPPORTED_PROVIDERS: ProviderMeta[] = [
  { value: "openai", label: "OpenAI", endpointHint: "Leave empty for default, or enter a custom OpenAI-compatible URL.", endpointPlaceholder: "https://api.openai.com/v1", apiKeyHint: "Enter the OpenAI API key." },
  { value: "anthropic", label: "Anthropic", endpointHint: "Leave empty for default.", endpointPlaceholder: "", apiKeyHint: "Enter the Anthropic API key." },
  { value: "xai", label: "xAI", endpointHint: "Leave empty for default.", endpointPlaceholder: "", apiKeyHint: "Enter the xAI API key." },
  { value: "deepseek", label: "DeepSeek", endpointHint: "Leave empty for default.", endpointPlaceholder: "", apiKeyHint: "Enter the DeepSeek API key." },
  { value: "minimax", label: "MiniMax", endpointHint: "Leave empty for default.", endpointPlaceholder: "", apiKeyHint: "Enter the MiniMax API key." },
  { value: "ollama", label: "Ollama", endpointHint: "Ollama server URL. Leave empty for default (http://host.docker.internal:11434).", endpointPlaceholder: "http://host.docker.internal:11434", apiKeyHint: "Auth token (optional). Leave empty if not required." },
  { value: "bedrock", label: "Amazon Bedrock", endpointHint: "AWS region (e.g. us-east-1). Leave empty for SDK default.", endpointPlaceholder: "us-east-1", apiKeyHint: "Enter the Amazon Bedrock API key." },
];

const PROVIDER_SELECT_OPTIONS = SUPPORTED_PROVIDERS.map((p) => ({ value: p.value, label: p.label }));

function getProviderMeta(name: string): ProviderMeta | undefined {
  return SUPPORTED_PROVIDERS.find((p) => p.value === name);
}

// ── Form types ─────────────────────────────────────────────────────

export interface ProviderFormData {
  name: string;
  displayName: string;
  endpointUrl: string;
  apiKey: string;
}

function emptyForm(): ProviderFormData {
  return {
    name: "",
    displayName: "",
    endpointUrl: "",
    apiKey: "",
  };
}

function providerToForm(provider: LlmProviderRow): ProviderFormData {
  return {
    name: provider.name,
    displayName: provider.display_name ?? "",
    endpointUrl: provider.endpoint_url ?? "",
    apiKey: "", // Never pre-fill — masked value from backend is not the real key
  };
}

// ── Component ──────────────────────────────────────────────────────

export interface ProviderFormDialogProps {
  provider: LlmProviderRow | null;
  saving: boolean;
  onSave: (data: ProviderFormData) => void;
  onClose: () => void;
}

export function ProviderFormDialog({ provider, saving, onSave, onClose }: ProviderFormDialogProps) {
  const [form, setForm] = useState<ProviderFormData>(() =>
    provider ? providerToForm(provider) : emptyForm(),
  );

  useEffect(() => {
    setForm(provider ? providerToForm(provider) : emptyForm());
  }, [provider]);

  const isEdit = provider !== null;
  const canSubmit = form.name.trim() !== "";

  const [showApiKey, setShowApiKey] = useState(false);
  const hasExistingKey = isEdit && provider.api_key !== null;
  const meta = getProviderMeta(form.name);

  function patch(partial: Partial<ProviderFormData>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function handleProviderChange(value: string) {
    const selected = getProviderMeta(value);
    const updates: Partial<ProviderFormData> = { name: value };
    // Auto-fill display name from provider label when creating
    if (!isEdit && selected && form.displayName === "") {
      updates.displayName = selected.label;
    }
    patch(updates);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || saving) return;
    onSave(form);
  }

  return (
    <Dialog
      open
      title={isEdit ? "Edit Provider" : "Add Provider"}
      description={isEdit ? `Editing provider: ${provider.display_name ?? provider.name}` : "Configure a new LLM provider."}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Provider Name */}
        <FormField
          label="Provider"
          htmlFor="provider-name"
          required
          helperText={isEdit ? "Cannot be changed after creation." : "Select the LLM provider."}
        >
          <Select
            id="provider-name"
            value={form.name}
            options={PROVIDER_SELECT_OPTIONS}
            placeholder="Select a provider…"
            disabled={isEdit}
            onChange={(e) => handleProviderChange(e.target.value)}
          />
        </FormField>

        {/* Display Name */}
        <FormField label="Display Name" htmlFor="provider-display-name" helperText="Friendly label for the UI (optional).">
          <Input
            id="provider-display-name"
            value={form.displayName}
            placeholder="e.g. OpenAI"
            onChange={(e) => patch({ displayName: e.target.value })}
          />
        </FormField>

        {/* Endpoint URL */}
        <FormField
          label={form.name === "bedrock" ? "AWS Region" : "Endpoint URL"}
          htmlFor="provider-endpoint"
          helperText={meta?.endpointHint ?? "Leave empty for provider default."}
        >
          <Input
            id="provider-endpoint"
            value={form.endpointUrl}
            placeholder={meta?.endpointPlaceholder ?? ""}
            onChange={(e) => patch({ endpointUrl: e.target.value })}
          />
        </FormField>

        {/* API Key */}
        <FormField
          label="API Key"
          htmlFor="provider-api-key"
          helperText={
            hasExistingKey
              ? `Current key: ${provider.api_key}. Leave empty to keep current key.`
              : meta?.apiKeyHint ?? "Enter the API key for this provider."
          }
        >
          <div className="relative">
            <Input
              id="provider-api-key"
              type={showApiKey ? "text" : "password"}
              value={form.apiKey}
              placeholder={hasExistingKey ? "Leave empty to keep current key" : "Enter API key"}
              onChange={(e) => patch({ apiKey: e.target.value })}
              className="pr-10"
              autoComplete="off"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]"
              onClick={() => setShowApiKey((prev) => !prev)}
              aria-label={showApiKey ? "Hide API key" : "Show API key"}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FormField>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!canSubmit || saving}>
            {isEdit ? "Update Provider" : "Create Provider"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
