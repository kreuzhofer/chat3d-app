import {ILLMAdapter, ILLMMessage, ILLMResponse} from './ILLMAdapter';
import { ILLMDefinition } from './LLMDefinitions';
import { env } from '$amplify/env/submitQueryFunction';
import OpenAI from "openai";
import { ChatCompletionMessageParam } from 'openai/resources/index.mjs';
import { zodResponseFormat } from "openai/helpers/zod";
import { ZodTypeAny } from "zod";

export class OpenAIAdapter implements ILLMAdapter {
    private modelDefinition: ILLMDefinition;
    openai: OpenAI;
    constructor(modelDefinition: ILLMDefinition) {
        this.modelDefinition = modelDefinition;
        //console.log("OpenAI Key:"+env.OPENAI_API_KEY);
        this.openai = new OpenAI({ 
            apiKey: env.OPENAI_API_KEY,
            project: env.OPENAI_PROJECT_ID,
            organization: env.OPENAI_ORGANIZATION_ID
        });
    }

    async submitQuery(conversation: ILLMMessage[], context: string, resultSchema: ZodTypeAny): Promise<ILLMResponse> {
        const response_format = zodResponseFormat(resultSchema as any, "response");

        const messages: ChatCompletionMessageParam[] = [
            { role: "developer", content: this.modelDefinition.systemPrompt(context) },
            ...conversation.map((message) => ({
                role: message.role,
                content: message.content.map((content) => ({ type: content.type, text: content.text }))
            } as ChatCompletionMessageParam))
        ];

        const completion = await this.openai.chat.completions.create({
            messages: messages,
            model: this.modelDefinition.modelName,
            store: false,
            //...(this.modelDefinition.modelName.startsWith("gpt") ? { max_tokens: 4096 } : { max_completion_tokens: 4096 }),
            response_format: response_format
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
        console.log("OpenAI Response:"+response.content);
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