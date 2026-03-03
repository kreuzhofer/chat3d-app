export interface PasswordStrength {
  score: number;
  label: string;
  color: string;
}

export function getPasswordStrength(password: string, t: (key: string) => string): PasswordStrength {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z\d]/.test(password)) score++;

  if (score <= 1) return { score, label: t("common:passwordStrength.weak"), color: "bg-[hsl(var(--destructive))]" };
  if (score <= 2) return { score, label: t("common:passwordStrength.fair"), color: "bg-[hsl(var(--warning))]" };
  if (score <= 3) return { score, label: t("common:passwordStrength.good"), color: "bg-[hsl(var(--info))]" };
  return { score, label: t("common:passwordStrength.strong"), color: "bg-[hsl(var(--success))]" };
}
