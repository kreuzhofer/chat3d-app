import { IRenderingProvider, RenderModelResult } from "./IRenderingProvider";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import * as fs from 'fs';
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { retry } from './RetryUtils';

export class OpenScadRenderingProvider implements IRenderingProvider {
    private executorFunctionName: string;
    
    constructor(executorFunctionName: string) {
        this.executorFunctionName = executorFunctionName;
    }
    
    async generateSourceCodeFile(code: string, messageId: string, bucket: string): Promise<string> {
        // Create a temporary file
        fs.writeFileSync("/tmp/code.scad", code);
        
        // Upload to S3
        const fileName = `${messageId}.scad`;
        const key = `modelcreator/${fileName}`;
        const s3Client = new S3Client({});
        const s3Params = {
            Bucket: bucket,
            Key: key,
            Body: fs.createReadStream("/tmp/code.scad")
        };
        
        await s3Client.send(new PutObjectCommand(s3Params));
        return fileName;
    }
    
    async renderModel(sourceFileName: string, targetFileName: string, bucket: string): Promise<RenderModelResult> {
        const response = await this.invokeLambdaFunction(sourceFileName, targetFileName, this.executorFunctionName, bucket);
        
        if ((response?.statusCode && response?.statusCode !== 200) || 
            (response?.errorMessage && response?.errorMessage !== "")) {
            return {
                success: false,
                errorMessage: response?.errorMessage || "Unknown error during model rendering"
            };
        }
        
        return {
            success: true,
            targetModelKey: `modelcreator/${targetFileName}`,
            sourceCodeKey: `modelcreator/${sourceFileName}`
        };
    }
    
    private async invokeLambdaFunction(fileName: string, targetFilename: string, functionName: string, bucketName: string) {
        const lambdaClient = new LambdaClient({});
        const invokeParams = {
            FunctionName: functionName,
            InvocationType: 'RequestResponse' as const,
            Payload: JSON.stringify({
                fileName: fileName,
                targetFilename: targetFilename,
                bucket: bucketName
            }),
        };
        
        const response = await retry(async () => {
            try {
                const response = await lambdaClient.send(new InvokeCommand(invokeParams));
                if (response.Payload) {
                    return JSON.parse(new TextDecoder().decode(response.Payload));
                }
                return undefined;
            } catch (error) {
                // Check if this is the specific exception we want to retry on
                if (error instanceof Error && 
                    (error.name === 'CodeArtifactUserPendingException' || 
                    error.message.includes('CodeArtifactUserPendingException'))) {
                    throw new Error('CodeArtifactUserPendingException');
                }
                // For any other error, we don't want to retry, so rethrow it
                throw error;
            }
        }, {
            delay: 5000,
            maxAttempts: 3,
            handleError: (error: { message: string; }) => error.message === 'CodeArtifactUserPendingException',
        });
        
        return response;
    }
}