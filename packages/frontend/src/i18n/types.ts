import type common from "../../public/locales/en/common.json";
import type pages from "../../public/locales/en/pages.json";
import type errors from "../../public/locales/en/errors.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof common;
      pages: typeof pages;
      errors: typeof errors;
    };
  }
}
