import type { Schema, IChatMessage } from "../../data/resource"
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { BedrockRuntimeClient, ConverseCommand, Message  } from "@aws-sdk/client-bedrock-runtime";
import { generateClient } from "aws-amplify/data";
//import { list } from 'aws-amplify/storage';

import { Amplify } from 'aws-amplify';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/submitQueryFunction';
import { v4 as uuidv4 } from 'uuid';

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import * as fs from 'fs';
import { GetS3FileAsByteArrayAsync } from "./GetS3FileAsByteArrayAsync";
import { Buffer } from 'buffer';

import * as winston from "winston";
import { LLMDefinitions, RenderingProvider } from "./LLMDefinitions";
const logger = winston.createLogger({
    transports: [new winston.transports.Console()],
  });

import mixpanel from 'mixpanel';
import { OpenScadExamples } from "./OpenScadExamples";
import { ILLMMessage } from "./ILLMAdapter";
console.log("MIXPANEL_TOKEN: "+env.MIXPANEL_TOKEN);
const tracker = mixpanel.init(env.MIXPANEL_TOKEN);
//console.log("OpenAI Key:"+env.OPENAI_API_KEY);

import { LLMAdapterFactory } from "./LLMAdapterFactory";
import { extractDocumentSections } from "./Helpers";
import { z } from "zod";
import { StaticDocuments } from "./StaticDocuments";
import { RenderingProviderFactory } from "./RenderingProviderFactory";
import { retry } from './RetryUtils';
import { Build123dExamples } from "./Build123dExamples";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);


// This function has been moved to the rendering providers

export const handler: Schema["submitQuery"]["functionHandler"] = async (event) => {
    // arguments typed from `.arguments()`
    const { chatContextId, newUserChatItemId, newAssistantChatItemId, query, openScadExecutorFunctionName, bucket, llmconfiguration } = event.arguments;
    if (!query || !chatContextId || !newUserChatItemId || !newAssistantChatItemId || !openScadExecutorFunctionName || !bucket || !llmconfiguration) {
        throw new Error("Missing query parameter(s)");
    }

    // https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_bedrock-runtime_code_examples.html
    // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-runtime/command/ConverseCommand/
    // https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-examples.html
    const bedrockClient = new BedrockRuntimeClient({ region: "us-east-1" });
    const dataClient = generateClient<Schema>();

    const conversationLlmDefinition = LLMDefinitions.find((item) => item.id === "conversationLLM");
    if(!conversationLlmDefinition)
    {
      console.log("conversationLLM not found");
      return null;
    }
    const conversationLLM = LLMAdapterFactory.initializeAdapter(conversationLlmDefinition);
    
    // Set the model ID, e.g., Claude 3 Haiku.
    const conversationModelId = conversationLlmDefinition.modelName;
    const conversationSystemPrompt = conversationLlmDefinition.systemPrompt;

    // load all conversation items for the chat context
    const chatContext = await dataClient.models.ChatContext.get({ id: chatContextId });

    var fetchChatItems = await chatContext.data?.chatItems();
    var chatItems = fetchChatItems;
    while(fetchChatItems?.nextToken)
    {
      fetchChatItems = await chatContext.data?.chatItems({ nextToken: fetchChatItems.nextToken });
      if(fetchChatItems?.data)
        chatItems?.data.push(...fetchChatItems.data);
    }

    var sortedItems = chatItems ? chatItems.data.sort((a, b) => (a.createdAt > b.createdAt) ? 1 : -1) : [];
    console.log("sortedItems: "+JSON.stringify(sortedItems));

    const filteredItems = sortedItems?.filter((item) => item.id !== newAssistantChatItemId);
    const conversation = await Promise.all(filteredItems?.map(async (item) => {
      const messages = (JSON.parse(item.messages as string) as IChatMessage[]) // filter out meta items and only get messages or images
        .filter((message) => message.itemType === "message"/*  || message.itemType === "image" */);

      // only keep the last image if there are multiple images in the list
      const lastImageIndex = messages.map((message, index) => message.itemType === "image" ? index : -1).filter(index => index !== -1).pop();
      const filteredMessages = messages.filter((message, index) => message.itemType === "message" || index === lastImageIndex);
      return {
          role: item.role,
          content: await Promise.all(filteredMessages.map(async function (message) {
            if(message.itemType === "message")
              return { text: message.text }
            else if(message.itemType === "image")
            {
              var imageBytes = await GetS3FileAsByteArrayAsync(bucket, message.attachment);
              const base64Image = imageBytes ? Buffer.from(imageBytes).toString('base64') : '';
              return { image: {
                format: "jpeg",
                source: {
                  bytes: base64Image
                }
              }}
            }
          })),
        } as Message;
    }) || []);

    console.log("previous conversation: "+JSON.stringify(conversation));

    const converseCommandInput = {
      modelId: conversationModelId,
      messages: conversation as Message[],
      inferenceConfig: { maxTokens: 512, temperature: 0.5, topP: 0.9 },
      system: [{ text: conversationSystemPrompt("") }],
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: "get_3D_model",
              description: "Create a 3D model from the user's specification. "+
                  "Use this tool, when the user asks for something to create or the prompt is just something like an object. "+
                  "For example, if the prompt is 'a castle', then this is a request for a 3d model. ",
              inputSchema: {
                json: 
                  {
                    "type": "object",
                    "properties": {
                      "description": { "type": "string" },
                    },
                    "required": ["description"]
                  }
              }
            }
          }
        ],
      },
    }
    console.log("converseCommandInput: "+JSON.stringify(converseCommandInput));

    // Create a command with the model ID, the message, and a basic configuration.
    const command = new ConverseCommand(converseCommandInput);
    const response = await bedrockClient.send(command);
    console.log("converse command response: "+response);
    const inputTokensConversation = response.usage?.inputTokens || 0;
    const outputTokensConversation = response.usage?.outputTokens || 0;
    const inputTokenCost = conversationLlmDefinition.inputTokenCostPerMille * inputTokensConversation / 1000;
    const outputTokenCost = conversationLlmDefinition.outputTokenCostPerMille * outputTokensConversation / 1000;
    const tokenCost = inputTokenCost + outputTokenCost;
    tracker.track('bedrock_conversation', {
      modelId: conversationModelId,
      inputTokens: inputTokensConversation,
      outputTokens: outputTokensConversation,
      inputTokenCost: inputTokenCost,
      outputTokenCost: outputTokenCost,
      tokenCost: tokenCost,
    });

    // update response in database
    console.log(response);

    if(response.stopReason === "tool_use")
    {
      console.log("tool use detected");
    }

    // get first item in response.output?.message?.content
    var assistantMessages = response.output?.message?.content;
    console.log("assistantMessages: "+JSON.stringify(assistantMessages));
    var assistantMessage = assistantMessages?.find((item) => item.text);
    var assistantMessageText = assistantMessage?.text || "Let me think about that for a moment...";
    await dataClient.models.ChatItem.update({ id: newAssistantChatItemId, 
      messages : JSON.stringify(
        [
          { 
            id: uuidv4(),
            itemType: "message",
            text: assistantMessageText,
            state: "completed",
            stateMessage: "",
            intputTokens : inputTokensConversation,
            outputTokens : outputTokensConversation,
            inputTokenCost : inputTokenCost,
            outputTokenCost : outputTokenCost,
            tokenCost : tokenCost
          }
        ] as IChatMessage[])
      });

    if (response.stopReason === "tool_use") {
        const toolRequest = response.output?.message?.content?.find((item) => item.toolUse);
        console.log("tool request: " + JSON.stringify(toolRequest));

        if (toolRequest && toolRequest.toolUse?.name === "get_3D_model") {
            console.log("3d model request detected");

            // Type guard to check if input is an object with a description property
            const input = toolRequest.toolUse?.input;
            if (typeof input === 'object' && input !== null && 'description' in input) {
                const subject = input.description;

                var currentChatItem = await dataClient.models.ChatItem.get({ id: newAssistantChatItemId });
                var messages = JSON.parse(currentChatItem.data?.messages as string) as IChatMessage[];
                var messageId = uuidv4();

                messages.push(
                  {
                    id: messageId,
                    itemType: "image",
                    text: "", 
                    state: "pending",
                    stateMessage: "creating model sketch...",
                    attachment: ""
                  } as IChatMessage
                );
                await dataClient.models.ChatItem.update({ id: newAssistantChatItemId, 
                  messages: JSON.stringify(messages)
                  });                

                const lastAssistantMessageIndex = filteredItems.map((item, index) => item.role === "assistant" ? index : -1).filter(index => index !== -1).pop();
                const lastAssistantMessage = sortedItems[lastAssistantMessageIndex ? lastAssistantMessageIndex : 0];
                console.log("lastAssistantMessage: "+JSON.stringify(lastAssistantMessage));

                const generate3dmodelMessages = filteredItems?.map((item) => {
                  let tempMessages = (JSON.parse(item.messages as string) as IChatMessage[]) // filter out meta items and only get messages
                    .filter((message) => message.itemType === "message" || (message.itemType === "meta" && item === lastAssistantMessage));
                  return {
                      role: item.role,
                      content: tempMessages.map((message) => ({type:"text", text: message.text })),
                    } as ILLMMessage;
                });
                console.log("generate3dmodelMessages: "+JSON.stringify(generate3dmodelMessages));

                const modelDefinition3DGenerator = LLMDefinitions.find((item) => item.id === llmconfiguration);
                if(!modelDefinition3DGenerator)
                {
                  console.log("llmconfiguration not found");
                  // Handle error case
                  messages.pop();
                  messages.push({
                      id: messageId,
                      itemType: "errormessage",
                      text: "There was a problem creating the model. Please try again later.",
                      state: "error",
                      stateMessage: "",
                      attachment: ""
                  } as IChatMessage);
                  
                  await dataClient.models.ChatItem.update({
                      id: newAssistantChatItemId,
                      messages: JSON.stringify(messages)
                  });

                  return null;
                }
                // create adapter from factory
                const llmAdapter = LLMAdapterFactory.initializeAdapter(modelDefinition3DGenerator);
                const renderingProvider = RenderingProviderFactory.initializeProvider(modelDefinition3DGenerator.renderingProvider, openScadExecutorFunctionName);

                var context = "";
                if(modelDefinition3DGenerator.renderingProvider === RenderingProvider.OpenScad)
                {
                  context = OpenScadExamples.map((item) => "<example>//User: "+item.prompt+"\nAssistant: "+item.code+"</example>").join("\n");
                  context += StaticDocuments.map((item) => "<example>//User: "+item.prompt+"\nAssistant: "+item.code+"</example>").join("\n");
                }
                else if(modelDefinition3DGenerator.renderingProvider === RenderingProvider.Build123d)
                {
                  context = Build123dExamples.map((item) => "<example>//User: "+item.prompt+"\nAssistant: "+item.code+"</example>").join("\n");
                }

                const CADDesignResponse = z.object({
                    plan: z.string(),
                    code: z.string(),
                    parameters: z.array(z.string()),
                    comment: z.string()
                });

                const llmResponse = await llmAdapter.submitQuery(generate3dmodelMessages, context, CADDesignResponse);
                tracker.track('bedrock_conversation', {
                  modelId: modelDefinition3DGenerator.modelName,
                  inputTokens: llmResponse.inputTokens,
                  outputTokens: llmResponse.outputTokens,
                  inputTokenCost: llmResponse.inputTokenCost,
                  outputTokenCost: llmResponse.outputTokenCost,
                  tokenCost: llmResponse.tokensCost,
                });

                // Extract sections from LLM response
                const sections = extractDocumentSections(llmResponse.content[0].text ? llmResponse.content[0].text : "");

                const code = sections.code;
                const plan = sections.plan;
                const comment = sections.comment;

                // Use the rendering provider to generate source code file and upload to S3
                const fileName = await renderingProvider.generateSourceCodeFile(code, messageId, bucket);
                console.log("Generated source file: " + fileName);

                // Update message inside of newAssistantChatItem to show pending state
                messages.pop();
                messages.push({
                    id: messageId,
                    itemType: "image",
                    text: comment,
                    state: "pending",
                    stateMessage: "creating 3D model...",
                    attachment: ""
                } as IChatMessage);
                
                await dataClient.models.ChatItem.update({
                    id: newAssistantChatItemId,
                    messages: JSON.stringify(messages)
                });

                // Render the final model file using the appropriate rendering provider
                const targetModelFilename = messageId + ".3mf";
                const renderResult = await renderingProvider.renderModel(fileName, targetModelFilename, bucket);
                console.log("Render result: " + JSON.stringify(renderResult));

                if (!renderResult.success) {
                    console.log("Error creating model: " + renderResult.errorMessage);
                    
                    // Handle error case
                    messages.pop();
                    messages.push({
                        id: messageId,
                        itemType: "errormessage",
                        text: "There was a problem creating the model. Please try again later.",
                        state: "error",
                        stateMessage: "",
                        attachment: ""
                    } as IChatMessage);
                    
                    await dataClient.models.ChatItem.update({
                        id: newAssistantChatItemId,
                        messages: JSON.stringify(messages)
                    });
                    
                    return renderResult.errorMessage || null;
                }

                messages.pop();
                messages.push(
                  {
                    id: messageId,
                    itemType: "3dmodel",
                    text: comment,
                    state: "completed",
                    stateMessage: "",
                    attachment: renderResult.targetModelKey,
                    intputTokens: llmResponse.inputTokens,
                    outputTokens: llmResponse.outputTokens,
                    inputTokenCost: llmResponse.inputTokenCost,
                    outputTokenCost: llmResponse.outputTokenCost,
                    tokenCost: llmResponse.tokensCost
                  } as IChatMessage
                );
                await dataClient.models.ChatItem.update({ id: newAssistantChatItemId, 
                  messages: JSON.stringify(messages)
                  });  

                // add meta information that was created by the tool
                messages.push(
                  {
                    id: uuidv4(),
                    itemType: "meta",
                    text: llmResponse.content[0].text,
                    state: "completed",
                    stateMessage: "",
                  } as IChatMessage
                );

                await dataClient.models.ChatItem.update({ id: newAssistantChatItemId, 
                  messages: JSON.stringify(messages)
                  });

            } else {
                throw new Error("Input does not have a description property");
            }
        }
    }

    return JSON.stringify(response);
  }