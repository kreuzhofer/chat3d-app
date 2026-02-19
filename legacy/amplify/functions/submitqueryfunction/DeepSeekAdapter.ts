import {ILLMAdapter, ILLMMessage, ILLMResponse} from './ILLMAdapter';
import { ILLMDefinition } from './LLMDefinitions';
import { env } from '$amplify/env/submitQueryFunction';
import OpenAI from "openai";
import { ChatCompletionMessageParam } from 'openai/resources/index.mjs';
import { zodResponseFormat } from "openai/helpers/zod";
import { ZodTypeAny } from "zod";

export class DeepSeekAdapter implements ILLMAdapter {
    private modelDefinition: ILLMDefinition;
    openai: OpenAI;
    constructor(modelDefinition: ILLMDefinition) {
        this.modelDefinition = modelDefinition;
        console.log("DeepSeek Key:"+env.OPENAI_API_KEY);
        this.openai = new OpenAI({ 
            apiKey: env.OPENAI_API_KEY,
        });
    }

    async submitQuery(conversation: ILLMMessage[], context: string, resultSchema: ZodTypeAny): Promise<ILLMResponse> {
        const completion = await this.openai.chat.completions.create({
            messages: [
            { role: "developer", content: this.modelDefinition.systemPrompt(context) },
            ...conversation.map((message) => ({
                role: message.role,
                content: message.content.map((content) => ({ type: content.type, text: content.text }))
            } as ChatCompletionMessageParam))
            ],
            model: this.modelDefinition.modelName,
            store: false,
            response_format: zodResponseFormat(resultSchema as any, "response")
        });
        
        console.log(JSON.stringify(completion));

        const inputTokens = completion.usage?.prompt_tokens || 0;
        const outputTokens = completion.usage?.completion_tokens || 0;
        const inputTokenCost = this.modelDefinition.inputTokenCostPerMille * inputTokens / 1000;
        const outputTokenCost = this.modelDefinition.outputTokenCostPerMille * outputTokens / 1000;
        const tokenCost = inputTokenCost + outputTokenCost;

        const response = completion.choices[0].message;
        if(response.refusal)
            return {
                content: [{ type: "text", text: "I'm sorry, I cannot do that." }],
                inputTokens: inputTokens,
                outputTokens: outputTokens,
                inputTokenCost: inputTokenCost,
                outputTokenCost: outputTokenCost,
                tokensCost: tokenCost
            };
        console.log("DeepSeek Response:"+response.content);
        return {
            content: [{ type: completion.choices[0].message.role, text: response.content ?? undefined }],
            inputTokens: inputTokens,
            outputTokens: outputTokens,
            inputTokenCost: inputTokenCost,
            outputTokenCost: outputTokenCost,
            tokensCost: tokenCost
        };
    }
}