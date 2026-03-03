import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Send } from "lucide-react";
import {
  confirmWaitlistEmail,
  joinWaitlist,
} from "../api/waitlist.api";
import { InlineAlert } from "./layout/InlineAlert";
import { SectionCard } from "./layout/SectionCard";
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

export function WaitlistPanel({ compact = false }: WaitlistPanelProps) {
  const [email, setEmail] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const autoConfirmDoneRef = useRef(false);

  // Auto-confirm when arriving via /waitlist/confirm?token=...
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
    setBusy(true);
    setMessage(null);

    void confirmWaitlistEmail(queryToken)
      .then(() => {
        setMessage({
          kind: "success",
          text: "Email confirmed! You're on the waitlist. We'll notify you when your account is approved.",
        });
      })
      .catch((error) => {
        setMessage({ kind: "error", text: toErrorMessage(error) });
      })
      .finally(() => {
        setBusy(false);
      });
  }, []);

  function joinAction() {
    if (!marketingConsent) {
      setConsentError(true);
      return;
    }
    setConsentError(false);
    setBusy(true);
    setMessage(null);
    void joinWaitlist(email.trim(), marketingConsent)
      .then(() => {
        setJoined(true);
        setMessage({
          kind: "success",
          text: "Check your email to confirm your spot on the waitlist. If you don't receive it within 1–2 minutes, please check your spam folder.",
        });
      })
      .catch((error) => {
        setMessage({ kind: "error", text: toErrorMessage(error) });
      })
      .finally(() => {
        setBusy(false);
      });
  }

  const body = (
    <div className="space-y-4">
      {message ? (
        <InlineAlert tone={message.kind === "success" ? "success" : "danger"}>
          {message.text}
        </InlineAlert>
      ) : null}

      {!joined ? (
        <>
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <FormField label="Email" htmlFor="waitlist-email" required>
              <Input
                id="waitlist-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
              />
            </FormField>
            <Button
              disabled={busy || email.trim() === ""}
              loading={busy}
              iconLeft={<Send className="h-3.5 w-3.5" />}
              onClick={joinAction}
            >
              Join Waitlist
            </Button>
          </div>

          <div>
            <label className="flex items-start gap-3 text-sm text-[hsl(var(--muted-foreground))]">
              <Switch
                checked={marketingConsent}
                onCheckedChange={(checked) => {
                  setMarketingConsent(checked);
                  if (checked) {
                    setConsentError(false);
                  }
                }}
                className="mt-0.5 shrink-0"
              />
              <span>
                By providing my details, I consent to receiving emails and sms messages in accordance with the{" "}
                <Link to="/terms" className="text-[hsl(var(--primary))] hover:underline">Terms &amp; Conditions</Link>{" "}
                and{" "}
                <Link to="/privacy" className="text-[hsl(var(--primary))] hover:underline">Privacy Policy</Link>.
                Unsubscribe at any time.
              </span>
            </label>
            {consentError ? (
              <p className="mt-1 text-sm text-[hsl(var(--destructive))]">
                You must accept the terms to join the waitlist.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );

  if (compact) {
    return (
      <SectionCard title="Waitlist" description="Join the waitlist to get early access.">
        {body}
      </SectionCard>
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Waitlist</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Join the waitlist to get early access.
        </p>
      </header>
      <SectionCard title="Join the waitlist">
        {body}
      </SectionCard>
    </section>
  );
}
