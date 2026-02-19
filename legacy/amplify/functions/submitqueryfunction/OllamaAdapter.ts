import { ZodTypeAny } from 'zod';
import {ILLMAdapter, ILLMMessage, ILLMResponse} from './ILLMAdapter';
import { ILLMDefinition } from './LLMDefinitions';
import { env } from '$amplify/env/submitQueryFunction';
import { Ollama } from 'ollama'
export class OllamaAdapter implements ILLMAdapter {
    private modelDefinition: ILLMDefinition;
    ollama: any;
    constructor(modelDefinition: ILLMDefinition) {
        this.modelDefinition = modelDefinition;
        this.ollama = new Ollama({ 
            host: env.OLLAMA_BASEURL, 
            headers: { Authorization: "Bearer " + env.OLLAMA_TOKEN } 
        })
    }

    async submitQuery(messages: ILLMMessage[], context: string, resultSchema: ZodTypeAny): Promise<ILLMResponse> {
        // Implement the submitQuery method

        const ollamaMessages = [
            { role: "system", content: this.modelDefinition.systemPrompt(context) },
            ...messages.map((message) => ({
                role: message.role,
                content: message.content.filter((content) => content.type === "text").map((content) => content.text).join(' ')
            }))
        ];
        console.log("Ollama Messages:"+JSON.stringify(ollamaMessages));

        const response = await this.ollama.chat({
            model: this.modelDefinition.modelName,
            messages: ollamaMessages,
            stream: false
          })
        console.log(response);
        console.log(response.message.content)

        return {
            content: [{ type: 'text', text: response.message.content }]
        };
    }
}