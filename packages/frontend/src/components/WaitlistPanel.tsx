import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, Clock, Mail, Search, Send, ShieldCheck } from "lucide-react";
import {
  confirmWaitlistEmail,
  getWaitlistStatus,
  joinWaitlist,
  type WaitlistStatusResponse,
} from "../api/waitlist.api";
import { EmptyState } from "./layout/EmptyState";
import { InlineAlert } from "./layout/InlineAlert";
import { SectionCard } from "./layout/SectionCard";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { FormField } from "./ui/form";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface WaitlistPanelProps {
  compact?: boolean;
}

function statusLabel(status: WaitlistStatusResponse["status"]): string {
  if (status === "pending_email_confirmation") {
    return "Confirm your email";
  }
  if (status === "pending_admin_approval") {
    return "Awaiting admin approval";
  }
  if (status === "approved") {
    return "Approved for registration";
  }
  return "Rejected";
}

function statusTone(status: WaitlistStatusResponse["status"]) {
  if (status === "approved") {
    return "success";
  }
  if (status === "rejected") {
    return "danger";
  }
  if (status === "pending_admin_approval") {
    return "warning";
  }
  return "info";
}

function WaitlistFlow({
  email,
  setEmail,
  token,
  setToken,
  marketingConsent,
  setMarketingConsent,
  busyAction,
  message,
  status,
  onJoin,
  onConfirm,
  onCheckEmailStatus,
  onCheckTokenStatus,
}: {
  email: string;
  setEmail: (value: string) => void;
  token: string;
  setToken: (value: string) => void;
  marketingConsent: boolean;
  setMarketingConsent: (value: boolean) => void;
  busyAction: "join" | "confirm" | "status" | null;
  message: { kind: "success" | "error"; text: string } | null;
  status: WaitlistStatusResponse | null;
  onJoin: () => void;
  onConfirm: () => void;
  onCheckEmailStatus: () => void;
  onCheckTokenStatus: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Visual stepper */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]">
            <Mail className="h-4 w-4" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--primary))]">Step 1</p>
          <p className="mt-1 text-sm font-medium">Join waitlist</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Submit email and consent preference.</p>
        </div>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--accent)_/_0.1)] text-[hsl(var(--accent))]">
            <ClipboardCheck className="h-4 w-4" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--accent))]">Step 2</p>
          <p className="mt-1 text-sm font-medium">Confirm email</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Use token from confirmation email.</p>
        </div>
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--success)_/_0.1)] text-[hsl(var(--success))]">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--success))]">Step 3</p>
          <p className="mt-1 text-sm font-medium">Wait for approval</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Admin review unlocks registration link.</p>
        </div>
      </div>

      {message ? <InlineAlert tone={message.kind === "success" ? "success" : "danger"}>{message.text}</InlineAlert> : null}

      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <FormField label="Email" htmlFor="waitlist-email" required helperText="Use the email you want to register with.">
          <Input
            id="waitlist-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
          />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busyAction !== null || email.trim() === ""}
            loading={busyAction === "join"}
            iconLeft={<Send className="h-3.5 w-3.5" />}
            onClick={onJoin}
          >
            Join Waitlist
          </Button>
          <Button
            variant="outline"
            disabled={busyAction !== null || email.trim() === ""}
            loading={busyAction === "status"}
            iconLeft={<Search className="h-3.5 w-3.5" />}
            onClick={onCheckEmailStatus}
          >
            Check Status
          </Button>
        </div>
      </div>

      <label className="flex items-center justify-between rounded-md border border-[hsl(var(--border))] p-2">
        <span className="text-sm text-[hsl(var(--foreground))]">I agree to marketing communication emails.</span>
        <Switch checked={marketingConsent} onCheckedChange={setMarketingConsent} />
      </label>

      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <FormField
          label="Confirmation token"
          htmlFor="waitlist-token"
          helperText="Paste token from confirmation email, then confirm or check token status."
        >
          <Input
            id="waitlist-token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste token from confirmation email"
          />
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busyAction !== null || token.trim() === ""}
            loading={busyAction === "confirm"}
            iconLeft={<ClipboardCheck className="h-3.5 w-3.5" />}
            onClick={onConfirm}
          >
            Confirm Email
          </Button>
          <Button
            variant="outline"
            disabled={busyAction !== null || token.trim() === ""}
            iconLeft={<Search className="h-3.5 w-3.5" />}
            onClick={onCheckTokenStatus}
          >
            Check Token Status
          </Button>
        </div>
      </div>

      {status ? (
        <div className="rounded-md border border-[hsl(var(--border))] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{status.email}</p>
            <Badge tone={statusTone(status.status)}>{statusLabel(status.status)}</Badge>
          </div>
          <div className="mt-2 grid gap-1 text-sm text-[hsl(var(--muted-foreground))]">
            <p>Joined: {new Date(status.createdAt).toLocaleString()}</p>
            <p>Email confirmed: {status.emailConfirmedAt ? new Date(status.emailConfirmedAt).toLocaleString() : "Not yet"}</p>
            <p>Approved: {status.approvedAt ? new Date(status.approvedAt).toLocaleString() : "Not yet"}</p>
            <p>Marketing consent: {status.marketingConsent ? "yes" : "no"}</p>
          </div>
        </div>
      ) : (
        <EmptyState title="No status loaded" description="Check status with email or token to see your progress." />
      )}
    </div>
  );
}

export function WaitlistPanel({ compact = false }: WaitlistPanelProps) {
  const [email, setEmail] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get("token") ?? "");
  const [busyAction, setBusyAction] = useState<"join" | "confirm" | "status" | null>(null);
  const [status, setStatus] = useState<WaitlistStatusResponse | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const autoConfirmDoneRef = useRef(false);

  useEffect(() => {
    if (autoConfirmDoneRef.current) {
      return;
    }

    const path = window.location.pathname;
    const queryToken = new URLSearchParams(window.location.search).get("token");
    if (!path.startsWith("/waitlist/confirm") || !queryToken) {
      return;
    }

    autoConfirmDoneRef.current = true;
    setToken(queryToken);
    setBusyAction("confirm");
    setMessage(null);

    void confirmWaitlistEmail(queryToken)
      .then((result) => {
        setEmail(result.email);
        setMessage({
          kind: "success",
          text: "Email confirmed. Your request is now pending admin approval.",
        });
        return getWaitlistStatus({ token: queryToken });
      })
      .then((lookup) => {
        setStatus(lookup);
      })
      .catch((error) => {
        setMessage({ kind: "error", text: toErrorMessage(error) });
      })
      .finally(() => {
        setBusyAction(null);
      });
  }, []);

  function joinAction() {
    setBusyAction("join");
    setMessage(null);
    void joinWaitlist(email.trim(), marketingConsent)
      .then((result) => {
        setMessage({
          kind: "success",
          text: `Waitlist request submitted (${statusLabel(result.status)}). Check your email to confirm.`,
        });
        setStatus(null);
      })
      .catch((error) => {
        setMessage({ kind: "error", text: toErrorMessage(error) });
      })
      .finally(() => {
        setBusyAction(null);
      });
  }

  function checkEmailStatusAction() {
    setBusyAction("status");
    setMessage(null);
    void getWaitlistStatus({ email: email.trim() })
      .then((lookup) => {
        setStatus(lookup);
        setMessage({ kind: "success", text: `Current status: ${statusLabel(lookup.status)}` });
      })
      .catch((error) => {
        setMessage({ kind: "error", text: toErrorMessage(error) });
      })
      .finally(() => {
        setBusyAction(null);
      });
  }

  function confirmAction() {
    setBusyAction("confirm");
    setMessage(null);
    void confirmWaitlistEmail(token.trim())
      .then((result) => {
        setEmail(result.email);
        setMessage({
          kind: "success",
          text: "Email confirmed. Your request is now pending admin approval.",
        });
        return getWaitlistStatus({ token: token.trim() });
      })
      .then((lookup) => {
        setStatus(lookup);
      })
      .catch((error) => {
        setMessage({ kind: "error", text: toErrorMessage(error) });
      })
      .finally(() => {
        setBusyAction(null);
      });
  }

  function checkTokenStatusAction() {
    setBusyAction("status");
    setMessage(null);
    void getWaitlistStatus({ token: token.trim() })
      .then((lookup) => {
        setStatus(lookup);
        setEmail(lookup.email);
        setMessage({ kind: "success", text: `Current status: ${statusLabel(lookup.status)}` });
      })
      .catch((error) => {
        setMessage({ kind: "error", text: toErrorMessage(error) });
      })
      .finally(() => {
        setBusyAction(null);
      });
  }

  const body = (
    <WaitlistFlow
      email={email}
      setEmail={setEmail}
      token={token}
      setToken={setToken}
      marketingConsent={marketingConsent}
      setMarketingConsent={setMarketingConsent}
      busyAction={busyAction}
      message={message}
      status={status}
      onJoin={joinAction}
      onConfirm={confirmAction}
      onCheckEmailStatus={checkEmailStatusAction}
      onCheckTokenStatus={checkTokenStatusAction}
    />
  );

  if (compact) {
    return <SectionCard title="Waitlist" description="Join, confirm email, and track your approval status.">{body}</SectionCard>;
  }

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Waitlist</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Join with your email, confirm ownership, and monitor approval status until registration is unlocked.
        </p>
      </header>
      <SectionCard title="Join and track" description="All email capture and access requests flow through this waitlist.">
        {body}
      </SectionCard>
    </section>
  );
}
