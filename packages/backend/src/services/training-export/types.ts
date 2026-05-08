export type ExportFormatId =
  | "openai-multitask"
  | "sharegpt-codegen"
  | "alpaca-codegen";

export type CommentMode = "none" | "smart" | "smarter";

export interface ExportRequest {
  minScore?: number;
  categoryId?: string;
  approvalOnly?: boolean;
  commentMode?: CommentMode;
}

export interface FormatDefinition {
  id: ExportFormatId;
  label: string;
  description: string;
  filename: string;
  exporter: (req: ExportRequest) => Promise<string>;
}
