export type ExportFormatId =
  | "openai-multitask"
  | "sharegpt-codegen"
  | "alpaca-codegen";

export interface ExportRequest {
  minScore?: number;
  categoryId?: string;
  approvalOnly?: boolean;
}

export interface FormatDefinition {
  id: ExportFormatId;
  label: string;
  description: string;
  filename: string;
  exporter: (req: ExportRequest) => Promise<string>;
}
