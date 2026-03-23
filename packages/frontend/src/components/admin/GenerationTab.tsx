import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import {
  listGenerationSettings,
  updateGenerationSetting,
  revertGenerationSetting,
  type GenerationSettingDescriptor,
} from "../../api/admin.api";
import { SectionCard } from "../layout/SectionCard";
import { InlineAlert } from "../layout/InlineAlert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

interface GenerationTabProps {
  token: string;
}

export function GenerationTab({ token }: GenerationTabProps) {
  const [settings, setSettings] = useState<GenerationSettingDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  // Tracks the value the user has typed (may differ from effectiveValue)
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const data = await listGenerationSettings(token);
      setSettings(data);
      const values: Record<string, string> = {};
      for (const s of data) {
        values[s.key] = String(s.effectiveValue);
      }
      setEditValues(values);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(key: string) {
    const raw = editValues[key];
    if (raw === undefined) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;

    setBusyKeys((prev) => new Set(prev).add(key));
    setError(null);
    try {
      await updateGenerationSetting(token, key, value);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function handleRevert(key: string) {
    setBusyKeys((prev) => new Set(prev).add(key));
    setError(null);
    try {
      await revertGenerationSetting(token, key);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  /** True when the user has typed a value different from the server's effective value. */
  function isDirty(setting: GenerationSettingDescriptor): boolean {
    const raw = editValues[setting.key];
    if (raw === undefined) return false;
    const num = Number(raw);
    return Number.isFinite(num) && num !== setting.effectiveValue;
  }

  const globalSettings = settings.filter((s) => s.pipeline === "global");
  const workbenchSettings = settings.filter((s) => s.pipeline === "workbench");
  const chatSettings = settings.filter((s) => s.pipeline === "chat" || s.pipeline === "chat-only");

  function isBoolean(setting: GenerationSettingDescriptor): boolean {
    return setting.min === 0 && setting.max === 1 && setting.step === 1;
  }

  async function handleToggle(key: string, checked: boolean) {
    const value = checked ? 1 : 0;
    setEditValues((prev) => ({ ...prev, [key]: String(value) }));
    setBusyKeys((prev) => new Set(prev).add(key));
    setError(null);
    try {
      await updateGenerationSetting(token, key, value);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  function renderSettingRow(setting: GenerationSettingDescriptor) {
    const busy = busyKeys.has(setting.key);
    const overridden = setting.isOverridden;
    const dirty = isDirty(setting);
    const isBool = isBoolean(setting);
    return (
      <div
        key={setting.key}
        className="rounded-md border p-3"
        style={overridden
          ? { borderColor: "hsl(var(--warning) / 0.5)", backgroundColor: "hsl(var(--warning) / 0.05)" }
          : { borderColor: "hsl(var(--border))" }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium">{setting.label}</h4>
            <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{setting.description}</p>
            {!isBool && (
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                Default: {setting.defaultValue} &middot; Range: {setting.min}–{setting.max}
              </p>
            )}
            {isBool && (
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                Default: {setting.defaultValue === 1 ? "On" : "Off"}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isBool ? (
              <Switch
                checked={Number(editValues[setting.key] ?? setting.effectiveValue) === 1}
                disabled={busy}
                onCheckedChange={(checked) => void handleToggle(setting.key, checked)}
              />
            ) : (
              <>
                <Input
                  type="number"
                  min={setting.min}
                  max={setting.max}
                  step={setting.step}
                  value={editValues[setting.key] ?? String(setting.effectiveValue)}
                  disabled={busy}
                  className="w-20 text-center"
                  style={overridden ? { borderColor: "hsl(var(--warning))", color: "hsl(var(--warning))" } : undefined}
                  onChange={(e) => {
                    setEditValues((prev) => ({ ...prev, [setting.key]: e.target.value }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleSave(setting.key);
                    }
                  }}
                />
                <Button
                  variant="default"
                  size="sm"
                  disabled={!dirty || busy}
                  onClick={() => void handleSave(setting.key)}
                  title="Save override"
                >
                  <Save className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!overridden || busy}
              onClick={() => void handleRevert(setting.key)}
              title="Revert to default"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {overridden && setting.updatedAt ? (
          <p className="mt-1 text-xs" style={{ color: "hsl(var(--warning))" }}>
            Overridden &middot; {new Date(setting.updatedAt).toLocaleString()}
          </p>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return <InlineAlert tone="info">Loading generation settings...</InlineAlert>;
  }

  return (
    <div className="space-y-4">
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {globalSettings.length > 0 && (
        <SectionCard title="Global" description="Settings that apply to both workbench and chat pipelines.">
          <div className="grid gap-3">
            {globalSettings.map(renderSettingRow)}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Workbench Pipeline" description="Settings for the workbench example generation pipeline.">
        <div className="grid gap-3">
          {workbenchSettings.map(renderSettingRow)}
        </div>
      </SectionCard>

      <SectionCard title="Chat Pipeline" description="Settings for the chat-based 3D model generation pipeline.">
        <div className="grid gap-3">
          {chatSettings.map(renderSettingRow)}
        </div>
      </SectionCard>
    </div>
  );
}
