import { BedrockRuntimeClient, ConverseCommand, ConverseCommandOutput, InvokeModelCommand, Message } from "@aws-sdk/client-bedrock-runtime";
import { ILLMAdapter, ILLMMessage, ILLMResponse } from "./ILLMAdapter";
import { ILLMDefinition } from "./LLMDefinitions";
import { ZodTypeAny } from "zod";
export class BedrockAdapter implements ILLMAdapter {
    modelDefinition: ILLMDefinition;
    constructor(modelDefinition: ILLMDefinition) {
        this.modelDefinition = modelDefinition;
    }

    async submitQuery(messages: ILLMMessage[], context: string, resultSchema: ZodTypeAny): Promise<ILLMResponse> {
        const system_prompt_3d_generator = this.modelDefinition.systemPrompt;
        const generate3dmodelId = this.modelDefinition.modelName;
        const bedrockClient = new BedrockRuntimeClient({ region: "us-east-1" });

        const generate3dmodelMessages = messages.map((message) => ({
            role: message.role,
            content: message.content.map((content) => ({ type: content.type, text: content.text }) )
        } as Message));

        const inferenceConfig = {
            maxTokens: generate3dmodelId === "us.anthropic.claude-3-7-sonnet-20250219-v1:0" ? 131072 : 4096,
            temperature: 1.0,
            ...((generate3dmodelId !== "us.anthropic.claude-3-7-sonnet-20250219-v1:0" && 
                generate3dmodelId!=="us.anthropic.claude-sonnet-4-5-20250929-v1:0") && { topP: 0.9 })
        };
        console.log("inferenceConfig: "+JSON.stringify(inferenceConfig));

        const converse3DModelCommandInput = {
            modelId: generate3dmodelId,
            messages: generate3dmodelMessages as Message[],
            inferenceConfig,
            system: [{
            text: system_prompt_3d_generator(context)
            }],
            ...(this.modelDefinition.reasoning && {
            additionalModelRequestFields: generate3dmodelId === "us.anthropic.claude-3-7-sonnet-20250219-v1:0" ? {
                thinking: {
                type: "enabled",
                budget_tokens: 2000
                }
            } : undefined
            })
        };
        console.log("converse3DModelCommandInput: "+JSON.stringify(converse3DModelCommandInput));

        const converse3DModelCommand = new ConverseCommand(converse3DModelCommandInput);
        const converse3DModelResponse = await bedrockClient.send(converse3DModelCommand);
        console.log("converse3DModelResponse: "+JSON.stringify(converse3DModelResponse));

        const inputTokens3DModel = converse3DModelResponse.usage?.inputTokens || 0;
        const outputTokens3DModel = converse3DModelResponse.usage?.outputTokens || 0;
        const inputTokenCost3DModel = this.modelDefinition.inputTokenCostPerMille * inputTokens3DModel / 1000;
        const outputTokenCost3DModel = this.modelDefinition.outputTokenCostPerMille * outputTokens3DModel / 1000;
        const tokens3DModelCost = inputTokenCost3DModel + outputTokenCost3DModel;

        var converse3DModelAssistantMessages = converse3DModelResponse.output?.message?.content;
        console.log("converse3DModelAssistantMessages: "+JSON.stringify(converse3DModelAssistantMessages));
        var converse3DModelAssistantResponse = converse3DModelAssistantMessages?.find((item) => item.text);

        console.log("converse3DModelAssistantResponse: "+JSON.stringify(converse3DModelAssistantResponse));

        return {
            content: [{
                type: 'text',
                text: converse3DModelAssistantResponse?.text || undefined
            }],
            inputTokens: inputTokens3DModel,
            outputTokens: outputTokens3DModel,
            inputTokenCost: inputTokenCost3DModel,
            outputTokenCost: outputTokenCost3DModel,
            tokensCost: tokens3DModelCost
        };
    }
}