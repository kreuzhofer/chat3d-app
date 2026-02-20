import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import { WaitlistPanel } from "../../components/WaitlistPanel";

interface WaitlistPageProps {
  waitlistEnabled: boolean;
}

export function WaitlistPage({ waitlistEnabled }: WaitlistPageProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Waitlist</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Join, confirm your email, and track approval status.
            </p>
          </div>
        </div>
        {!waitlistEnabled ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Open registration is currently available. You can also{" "}
            <Link className="font-medium text-[hsl(var(--primary))] underline" to="/register">
              register directly
            </Link>
            .
          </p>
        ) : null}
      </header>

      <WaitlistPanel compact />
    </div>
  );
}
