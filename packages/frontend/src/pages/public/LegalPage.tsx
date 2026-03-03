import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileText, Shield, Building2, Trash2 } from "lucide-react";

interface LegalLink {
  to: string;
  titleKey: string;
  descriptionKey: string;
  icon: typeof FileText;
}

const legalLinks: LegalLink[] = [
  { to: "/terms", titleKey: "pages:legal.termsTitle", descriptionKey: "pages:legal.termsDescription", icon: FileText },
  { to: "/privacy", titleKey: "pages:legal.privacyTitle", descriptionKey: "pages:legal.privacyDescription", icon: Shield },
  { to: "/imprint", titleKey: "pages:legal.imprintTitle", descriptionKey: "pages:legal.imprintDescription", icon: Building2 },
  { to: "/data-deletion", titleKey: "pages:legal.dataDeletionTitle", descriptionKey: "pages:legal.dataDeletionDescription", icon: Trash2 },
];

export function LegalPage() {
  const { t } = useTranslation(["pages", "common"]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-6">
      <header>
        <h1 className="text-3xl font-semibold text-[hsl(var(--foreground))]">{t("pages:legal.title")}</h1>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">{t("pages:legal.subtitle")}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {legalLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.to}
              to={link.to}
              className="group flex gap-4 rounded-lg border border-[hsl(var(--border))] p-4 transition hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[hsl(var(--foreground))] group-hover:text-[hsl(var(--primary))]">
                  {t(link.titleKey)}
                </h2>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                  {t(link.descriptionKey)}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
