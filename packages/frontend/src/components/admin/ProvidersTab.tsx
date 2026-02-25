import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  listLlmProviders,
  createLlmProvider,
  updateLlmProvider,
  deleteLlmProvider,
  type LlmProviderRow,
  type CreateLlmProviderInput,
} from "../../api/admin.api";
import { SectionCard } from "../layout/SectionCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ProviderFormDialog, type ProviderFormData } from "./ProviderFormDialog";
import { providerBadge } from "./ModelsTab";

export interface ProvidersTabProps {
  token: string;
}

export function ProvidersTab({ token }: ProvidersTabProps) {
  const [providers, setProviders] = useState<LlmProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Provider form dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LlmProviderRow | null>(null);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const prov = await listLlmProviders(token);
      setProviders(prov);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateProvider = () => {
    setEditingProvider(null);
    setDialogOpen(true);
  };

  const handleEditProvider = (provider: LlmProviderRow) => {
    setEditingProvider(provider);
    setDialogOpen(true);
  };

  const handleDeleteProvider = async (provider: LlmProviderRow) => {
    if (!confirm(`Delete provider "${provider.display_name ?? provider.name}"? This cannot be undone.`)) return;
    try {
      await deleteLlmProvider(token, provider.name);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete provider");
    }
  };

  const handleToggleActive = async (provider: LlmProviderRow) => {
    try {
      await updateLlmProvider(token, provider.name, { isActive: !provider.is_active });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle provider status");
    }
  };

  const handleSaveProvider = async (data: ProviderFormData) => {
    setSaving(true);
    try {
      if (editingProvider) {
        // Build patch — only include apiKey if user entered a new value
        const patch: Record<string, unknown> = {
          displayName: data.displayName || null,
          endpointUrl: data.endpointUrl || null,
        };
        if (data.apiKey.trim() !== "") {
          patch.apiKey = data.apiKey;
        }
        await updateLlmProvider(token, editingProvider.name, patch);
      } else {
        const input: CreateLlmProviderInput = {
          name: data.name,
          displayName: data.displayName || undefined,
          apiKey: data.apiKey.trim() !== "" ? data.apiKey : null,
          endpointUrl: data.endpointUrl || null,
        };
        await createLlmProvider(token, input);
      }
      setDialogOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save provider");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-[hsl(var(--muted-foreground))]">
        Loading provider configuration...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {/* Providers Table */}
      <SectionCard
        title="LLM Providers"
        description="API providers with endpoint and authentication settings. Configure API keys here."
        actions={
          <Button size="sm" onClick={handleCreateProvider}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Provider
          </Button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] text-left text-xs text-[hsl(var(--muted-foreground))]">
                <th className="pb-2 pr-3 font-medium">Provider</th>
                <th className="pb-2 pr-3 font-medium">Display Name</th>
                <th className="pb-2 pr-3 font-medium">Endpoint URL</th>
                <th className="pb-2 pr-3 font-medium">API Key</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.name} className="border-b border-[hsl(var(--border)_/_0.5)] last:border-0">
                  <td className="py-2 pr-3">{providerBadge(provider.name)}</td>
                  <td className="py-2 pr-3">
                    {provider.display_name ?? <span className="text-[hsl(var(--muted-foreground))]">—</span>}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {provider.endpoint_url ? (
                      <span className="font-mono">{provider.endpoint_url}</span>
                    ) : (
                      <span className="text-[hsl(var(--muted-foreground))]">Default</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {provider.api_key ? (
                      <span className="font-mono">{provider.api_key}</span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">Not set</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge
                      tone={provider.is_active ? "success" : "neutral"}
                      className="cursor-pointer"
                      onClick={() => handleToggleActive(provider)}
                    >
                      {provider.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      <button
                        className="rounded p-1 hover:bg-[hsl(var(--muted))]"
                        title="Edit"
                        onClick={() => handleEditProvider(provider)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded p-1 hover:bg-[hsl(var(--muted))] text-red-500"
                        title="Delete"
                        onClick={() => handleDeleteProvider(provider)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[hsl(var(--muted-foreground))]">
                    No providers configured. Click "Add Provider" to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Provider Form Dialog */}
      {dialogOpen && (
        <ProviderFormDialog
          provider={editingProvider}
          saving={saving}
          onSave={handleSaveProvider}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
