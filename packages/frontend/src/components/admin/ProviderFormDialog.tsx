import { useEffect, useState } from "react";
import type { LlmProviderRow } from "../../api/admin.api";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { FormField } from "../ui/form";
import { Input } from "../ui/input";

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

  const hasExistingKey = isEdit && provider.api_key !== null;

  function patch(partial: Partial<ProviderFormData>) {
    setForm((prev) => ({ ...prev, ...partial }));
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
          label="Provider Name"
          htmlFor="provider-name"
          required
          helperText={isEdit ? "Cannot be changed after creation." : "Lowercase identifier (e.g. openai, anthropic)"}
        >
          <Input
            id="provider-name"
            value={form.name}
            placeholder="e.g. openai"
            disabled={isEdit}
            onChange={(e) => patch({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
          />
        </FormField>

        {/* Display Name */}
        <FormField label="Display Name" htmlFor="provider-display-name" helperText="Friendly label for the UI (optional)">
          <Input
            id="provider-display-name"
            value={form.displayName}
            placeholder="e.g. OpenAI"
            onChange={(e) => patch({ displayName: e.target.value })}
          />
        </FormField>

        {/* Endpoint URL */}
        <FormField
          label="Endpoint URL"
          htmlFor="provider-endpoint"
          helperText="Leave empty for provider default. Use for custom OpenAI-compatible endpoints."
        >
          <Input
            id="provider-endpoint"
            value={form.endpointUrl}
            placeholder="https://api.example.com/v1"
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
              : "Enter the API key for this provider."
          }
        >
          <Input
            id="provider-api-key"
            type="password"
            value={form.apiKey}
            placeholder={hasExistingKey ? "Leave empty to keep current key" : "Enter API key"}
            onChange={(e) => patch({ apiKey: e.target.value })}
            autoComplete="off"
          />
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
