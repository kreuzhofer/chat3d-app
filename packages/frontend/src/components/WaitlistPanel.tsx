import { useEffect, useMemo, useRef, useState } from "react";
import {
  confirmWaitlistEmail,
  getWaitlistStatus,
  joinWaitlist,
  type WaitlistStatusResponse,
} from "../api/waitlist.api";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
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

  const body = (
    <CardContent>
      {message ? (
        <p
          className={`rounded-md border p-2 text-sm ${
            message.kind === "success"
              ? "border-[hsl(var(--primary))] text-[hsl(var(--foreground))]"
              : "border-[hsl(var(--destructive))] text-[hsl(var(--destructive))]"
          }`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="waitlist-email">Email</Label>
        <Input
          id="waitlist-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-[hsl(var(--border))] p-2">
        <span className="text-sm text-[hsl(var(--foreground))]">I agree to marketing communication emails.</span>
        <Switch checked={marketingConsent} onCheckedChange={setMarketingConsent} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busyAction !== null || email.trim() === ""}
          onClick={() => {
            setBusyAction("join");
            setMessage(null);
            void joinWaitlist(email.trim(), marketingConsent)
              .then((result) => {
                setMessage({
                  kind: "success",
                  text: `Waitlist request submitted (${result.status}). Check your email to confirm.`,
                });
                setStatus(null);
              })
              .catch((error) => {
                setMessage({ kind: "error", text: toErrorMessage(error) });
              })
              .finally(() => {
                setBusyAction(null);
              });
          }}
        >
          Join Waitlist
        </Button>
        <Button
          variant="outline"
          disabled={busyAction !== null || email.trim() === ""}
          onClick={() => {
            setBusyAction("status");
            setMessage(null);
            void getWaitlistStatus({ email: email.trim() })
              .then((lookup) => {
                setStatus(lookup);
                setMessage({ kind: "success", text: `Current status: ${lookup.status}` });
              })
              .catch((error) => {
                setMessage({ kind: "error", text: toErrorMessage(error) });
              })
              .finally(() => {
                setBusyAction(null);
              });
          }}
        >
          Check Status
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="waitlist-token">Confirmation token</Label>
        <Input
          id="waitlist-token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Paste token from confirmation email"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busyAction !== null || token.trim() === ""}
          onClick={() => {
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
          }}
        >
          Confirm Email
        </Button>
        <Button
          variant="outline"
          disabled={busyAction !== null || token.trim() === ""}
          onClick={() => {
            setBusyAction("status");
            setMessage(null);
            void getWaitlistStatus({ token: token.trim() })
              .then((lookup) => {
                setStatus(lookup);
                setEmail(lookup.email);
                setMessage({ kind: "success", text: `Current status: ${lookup.status}` });
              })
              .catch((error) => {
                setMessage({ kind: "error", text: toErrorMessage(error) });
              })
              .finally(() => {
                setBusyAction(null);
              });
          }}
        >
          Check Token Status
        </Button>
      </div>

      {status ? (
        <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 text-sm">
          <p>
            <span className="font-medium">Email:</span> {status.email}
          </p>
          <p>
            <span className="font-medium">Status:</span> {status.status}
          </p>
          <p>
            <span className="font-medium">Joined:</span> {new Date(status.createdAt).toLocaleString()}
          </p>
          <p>
            <span className="font-medium">Confirmed:</span>{" "}
            {status.emailConfirmedAt ? new Date(status.emailConfirmedAt).toLocaleString() : "Not yet"}
          </p>
          <p>
            <span className="font-medium">Approved:</span>{" "}
            {status.approvedAt ? new Date(status.approvedAt).toLocaleString() : "Not yet"}
          </p>
        </div>
      ) : null}
    </CardContent>
  );

  if (compact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Waitlist</CardTitle>
        </CardHeader>
        {body}
      </Card>
    );
  }

  return (
    <section className="space-y-4 bg-[hsl(var(--background))] p-4">
      <header>
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Waitlist</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Submit your email, confirm ownership, and monitor approval status.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Join or Confirm</CardTitle>
        </CardHeader>
        {body}
      </Card>
    </section>
  );
}
