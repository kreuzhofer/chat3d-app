import Handlebars from "handlebars";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getI18n } from "../i18n/config.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("email-template");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(__dirname, "..", "templates", "email");

let layoutTemplate: Handlebars.TemplateDelegate | null = null;
const bodyTemplateCache = new Map<string, Handlebars.TemplateDelegate>();

export function initializeEmailTemplates(): void {
  Handlebars.registerHelper(
    "t",
    function (key: string, options: Handlebars.HelperOptions) {
      const lng = (options.hash["lng"] as string) || "en";
      return getI18n().t(key, { lng, ns: "emails" });
    },
  );

  const layoutPath = path.join(templateDir, "layout.hbs");
  const layoutSource = fs.readFileSync(layoutPath, "utf-8");
  layoutTemplate = Handlebars.compile(layoutSource);

  const files = fs
    .readdirSync(templateDir)
    .filter((f) => f !== "layout.hbs" && f.endsWith(".hbs"));

  for (const file of files) {
    const name = file.replace(".hbs", "");
    const source = fs.readFileSync(path.join(templateDir, file), "utf-8");
    bodyTemplateCache.set(name, Handlebars.compile(source));
  }

  logger.info(
    { templateCount: bodyTemplateCache.size },
    "email templates initialized",
  );
}

function templateNameToI18nKey(templateName: string): string {
  return templateName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function renderEmail(
  templateName: string,
  language: string,
  data: Record<string, unknown>,
): { subject: string; text: string; html: string } {
  if (!layoutTemplate) {
    throw new Error(
      "Email templates not initialized. Call initializeEmailTemplates() first.",
    );
  }

  const bodyTemplate = bodyTemplateCache.get(templateName);
  if (!bodyTemplate) {
    throw new Error(`Unknown email template: ${templateName}`);
  }

  const i18n = getI18n();
  const i18nKey = templateNameToI18nKey(templateName);

  const templateData = { ...data, lang: language };
  const bodyHtml = bodyTemplate(templateData);
  const html = layoutTemplate({ body: bodyHtml, lang: language });

  const subject = i18n.t(`${i18nKey}.subject`, {
    lng: language,
    ns: "emails",
    ...data,
  });
  const text = i18n.t(`${i18nKey}.textBody`, {
    lng: language,
    ns: "emails",
    ...data,
  });

  return { subject, text, html };
}
