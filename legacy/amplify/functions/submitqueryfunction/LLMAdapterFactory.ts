import {InferenceProvider, ILLMDefinition} from './LLMDefinitions';
import { ILLMAdapter } from './ILLMAdapter';
import { OllamaAdapter } from './OllamaAdapter';
import { BedrockAdapter } from './BedrockAdapter';
import { OpenAIAdapter } from './OpenAIAdapter';
import { XAiGrokAdapter } from './XAiGrokAdapter';
import { DeepSeekAdapter } from './DeepSeekAdapter';

export class LLMAdapterFactory {
    static initializeAdapter(definition: ILLMDefinition): ILLMAdapter {
        switch (definition.inferenceProvider) {
            case InferenceProvider.Ollama:
                return new OllamaAdapter(definition);
            case InferenceProvider.AWS_Bedrock:
                return new BedrockAdapter(definition);
            case InferenceProvider.OpenAI:
                return new OpenAIAdapter(definition);
            case InferenceProvider.XAi:
                return new XAiGrokAdapter(definition);
            case InferenceProvider.DeepSeek:
                return new DeepSeekAdapter(definition);
            default:
                throw new Error(`Unsupported Execution Provider: ${definition.inferenceProvider}`);
        }
    }
}
