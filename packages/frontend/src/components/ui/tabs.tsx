import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface TabsProps {
  tabs: Array<{ id: string; label: string; icon?: ReactNode }>;
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  return (
    <div className={cn("inline-flex rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-1", className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
            activeTab === tab.id
              ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
              : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]",
          )}
          onClick={() => onChange(tab.id)}
        >
          {tab.icon ? <span className="shrink-0">{tab.icon}</span> : null}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

interface TabPanelProps {
  hidden: boolean;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ hidden, children, className }: TabPanelProps) {
  if (hidden) {
    return null;
  }

  return <div className={className}>{children}</div>;
}
