import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, ImageIcon, LoaderCircle, Loader2 } from "lucide-react";
import { downloadFileBinary } from "../../api/files.api";

export function InlineImagePreview({ filePath, token }: { filePath: string; token: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    downloadFileBinary({ token, path: filePath })
      .then(({ blob }) => {
        if (revoked) return;
        setObjectUrl(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (!revoked) setError(true);
      });
    return () => {
      revoked = true;
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [filePath, token]);

  if (error) {
    return (
      <div className="flex h-24 w-32 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.3)]">
        <ImageIcon className="h-6 w-6 text-[hsl(var(--muted-foreground))]" />
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="flex h-24 w-32 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.3)]">
        <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--muted-foreground))]" />
      </div>
    );
  }

  return (
    <img
      src={objectUrl}
      alt="Uploaded image"
      className="max-h-64 max-w-xs rounded-md border border-[hsl(var(--border))] object-contain"
    />
  );
}

export function InlinePipelineProgress({ detail, isLongRunning, showEnableNotifications, busyNotifications, onEnableNotifications }: {
  detail: string;
  isLongRunning?: boolean;
  showEnableNotifications?: boolean;
  busyNotifications?: boolean;
  onEnableNotifications?: () => void;
}) {
  const { t } = useTranslation(["pages", "common"]);
  return (
    <div className="mt-2 space-y-1.5" data-testid="inline-pending-indicator">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
          <span className="typing-dot typing-dot-delay-1 h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
          <span className="typing-dot typing-dot-delay-2 h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
        </span>
        <span className="text-xs text-[hsl(var(--muted-foreground))]">{detail}</span>
      </div>
      {isLongRunning ? (
        <div className="space-y-1.5">
          <p className="text-xs leading-relaxed text-[hsl(var(--muted-foreground)_/_0.7)]">
            {t("pages:chat.longRunning.message")}
            {showEnableNotifications
              ? t("pages:chat.longRunning.enableNotifications")
              : t("pages:chat.longRunning.willNotify")}
          </p>
          {showEnableNotifications && onEnableNotifications ? (
            <button
              type="button"
              disabled={busyNotifications}
              onClick={onEnableNotifications}
              className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--primary)_/_0.3)] bg-[hsl(var(--primary)_/_0.08)] px-3 py-1 text-xs font-medium text-[hsl(var(--primary))] transition active:scale-95 active:bg-[hsl(var(--primary)_/_0.2)] hover:bg-[hsl(var(--primary)_/_0.15)] disabled:opacity-50"
            >
              {busyNotifications
                ? <LoaderCircle className="h-3 w-3 animate-spin" />
                : <Bell className="h-3 w-3" />}
              {busyNotifications ? t("pages:chat.longRunning.enablingButton") : t("pages:chat.longRunning.enableButton")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
