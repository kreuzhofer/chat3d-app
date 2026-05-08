export type ExportFormatId = "openai-multitask" | "sharegpt-codegen" | "alpaca-codegen";
export type CommentMode = "none" | "smart" | "smarter";

export interface ExportMenuItem {
  /** Stable id for use as the dropdown menu item key. */
  menuId: string;
  formatId: ExportFormatId;
  commentMode: CommentMode;
  label: string;
  filename: string;
}

export const EXPORT_MENU_ITEMS: ExportMenuItem[] = [
  {
    menuId: "openai-multitask",
    formatId: "openai-multitask",
    commentMode: "none",
    label: "OpenAI multi-task (combined)",
    filename: "training-data-combined.jsonl",
  },
  {
    menuId: "sharegpt-codegen-none",
    formatId: "sharegpt-codegen",
    commentMode: "none",
    label: "ShareGPT — full comments",
    filename: "training-data-sharegpt-codegen.jsonl",
  },
  {
    menuId: "sharegpt-codegen-smarter",
    formatId: "sharegpt-codegen",
    commentMode: "smarter",
    label: "ShareGPT — smarter strip (keep CoT)",
    filename: "training-data-sharegpt-codegen-smarter.jsonl",
  },
  {
    menuId: "sharegpt-codegen-smart",
    formatId: "sharegpt-codegen",
    commentMode: "smart",
    label: "ShareGPT — smart strip (densest UI-safe)",
    filename: "training-data-sharegpt-codegen-smart.jsonl",
  },
  {
    menuId: "alpaca-codegen-none",
    formatId: "alpaca-codegen",
    commentMode: "none",
    label: "Alpaca — full comments",
    filename: "training-data-alpaca-codegen.jsonl",
  },
  {
    menuId: "alpaca-codegen-smarter",
    formatId: "alpaca-codegen",
    commentMode: "smarter",
    label: "Alpaca — smarter strip (keep CoT)",
    filename: "training-data-alpaca-codegen-smarter.jsonl",
  },
  {
    menuId: "alpaca-codegen-smart",
    formatId: "alpaca-codegen",
    commentMode: "smart",
    label: "Alpaca — smart strip (densest UI-safe)",
    filename: "training-data-alpaca-codegen-smart.jsonl",
  },
];
