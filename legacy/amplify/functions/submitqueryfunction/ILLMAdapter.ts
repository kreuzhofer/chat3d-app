import { ZodTypeAny } from "zod";

export interface ILLMMessageContent {
    type: string;
    text?: string;
    image_url?: string;
}

export interface ILLMMessage {
    role: string;
    content: ILLMMessageContent[];
}

export interface ILLMResponse {
    content: ILLMMessageContent[];
    inputTokens?: number;
    outputTokens?: number;
    inputTokenCost?: number;
    outputTokenCost?: number;
    tokensCost?: number;
}

export interface ILLMAdapter {
    submitQuery(conversation: ILLMMessage[], context: string, resultSchema: ZodTypeAny): Promise<ILLMResponse>;   
}
