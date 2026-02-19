export interface RenderModelResult {
    success: boolean;
    errorMessage?: string;
    targetModelKey?: string;
    sourceCodeKey?: string;
}

export interface IRenderingProvider {
    // Generate source code file and upload to S3
    generateSourceCodeFile(code: string, messageId: string, bucket: string): Promise<string>;
    
    // Render the model using the source code file
    renderModel(sourceFileName: string, targetFileName: string, bucket: string): Promise<RenderModelResult>;
}