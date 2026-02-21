import { CheckCircle2, Circle, XCircle } from "lucide-react";

export type WaitlistStepperStatus =
  | "not_joined"
  | "pending_confirmation"
  | "pending_approval"
  | "approved"
  | "rejected";

export interface WaitlistStepperProps {
  status: WaitlistStepperStatus;
}

type StepState = "completed" | "active" | "upcoming" | "rejected";

interface StepDef {
  label: string;
  state: StepState;
}

export function mapStepStates(
  status: WaitlistStepperStatus,
): [StepState, StepState, StepState] {
  switch (status) {
    case "not_joined":
      return ["active", "upcoming", "upcoming"];
    case "pending_confirmation":
      return ["completed", "active", "upcoming"];
    case "pending_approval":
      return ["completed", "completed", "active"];
    case "approved":
      return ["completed", "completed", "completed"];
    case "rejected":
      return ["completed", "completed", "rejected"];
  }
}

const STEP_LABELS = ["Join", "Confirm Email", "Approved"] as const;

const stepIcon: Record<StepState, React.ReactNode> = {
  completed: <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" />,
  active: <Circle className="h-5 w-5 text-[hsl(var(--primary))]" />,
  upcoming: <Circle className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />,
  rejected: <XCircle className="h-5 w-5 text-[hsl(var(--destructive))]" />,
};

const stepTextColor: Record<StepState, string> = {
  completed: "text-[hsl(var(--success))]",
  active: "text-[hsl(var(--primary))]",
  upcoming: "text-[hsl(var(--muted-foreground))]",
  rejected: "text-[hsl(var(--destructive))]",
};

const connectorColor: Record<StepState, string> = {
  completed: "bg-[hsl(var(--success))]",
  active: "bg-[hsl(var(--primary))]",
  upcoming: "bg-[hsl(var(--muted-foreground)_/_0.3)]",
  rejected: "bg-[hsl(var(--destructive))]",
};

export function WaitlistStepper({ status }: WaitlistStepperProps) {
  const states = mapStepStates(status);

  const steps: StepDef[] = STEP_LABELS.map((label, i) => ({
    label,
    state: states[i],
  }));

  return (
    <div
      role="group"
      aria-label="Waitlist progress"
      className="flex items-center justify-between gap-2"
    >
      {steps.map((step, i) => (
        <div key={step.label} className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className="flex shrink-0 flex-col items-center gap-1"
            aria-label={`${step.label}, ${step.state}`}
            {...(step.state === "active" ? { "aria-current": "step" as const } : {})}
          >
            {stepIcon[step.state]}
            <span className={`text-xs font-medium ${stepTextColor[step.state]}`}>
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`h-0.5 flex-1 rounded-full ${connectorColor[step.state]}`}
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </div>
  );
}
