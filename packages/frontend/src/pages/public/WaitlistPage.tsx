import { Link } from "react-router-dom";
import { WaitlistPanel } from "../../components/WaitlistPanel";

interface WaitlistPageProps {
  waitlistEnabled: boolean;
}

export function WaitlistPage({ waitlistEnabled }: WaitlistPageProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-900">Waitlist</h1>
        <p className="text-sm text-slate-600">
          Join, confirm your email, and track approval status. Approved entries receive a single-use registration link.
        </p>
        {!waitlistEnabled ? (
          <p className="text-sm text-slate-600">
            Open registration is currently available. You can also <Link className="underline" to="/register">register directly</Link>.
          </p>
        ) : null}
      </header>

      <WaitlistPanel compact />
    </div>
  );
}
