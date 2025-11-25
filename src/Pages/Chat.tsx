import type { IChatMessage, Schema } from "../../amplify/data/resource";
import { generateClient } from "aws-amplify/data";
import { useEffect, useState, useRef } from "react";
import { Button, Icon, Input, Image, Menu, MenuItem, Popup, Sidebar, SidebarPushable, SidebarPusher, Dropdown } from 'semantic-ui-react'
import { useParams, useNavigate, NavLink } from "react-router";
import { v4 as uuidv4 } from 'uuid';
import outputs from "../../amplify_outputs.json";
import { fetchUserAttributes, getCurrentUser, signOut } from "aws-amplify/auth";
import ChatMessage from "../Components/ChatMessage";
import { useResponsiveness } from "react-responsiveness";
import ChatContextComponent from "../Components/ChatContextComponent";
import { FileUploader } from "@aws-amplify/ui-react-storage";
import { list, remove } from "aws-amplify/storage";
import { LLMDefinitions } from "../../amplify/functions/submitqueryfunction/LLMDefinitions";

const client = generateClient<Schema>();
const isDev = import.meta.env.DEV;
interface IModelOption {
    key: string;
    text: string;
    value: string;
    image: { avatar: boolean, src: string };
}

function Chat()
{
    const [chatMessages, setChatMessages] = useState<Array<Schema["ChatItem"]["type"]>>([]);
    const [query, setQuery] = useState<string>("");
    const chatContextRef = useRef<any>(null);
    const chatIdRef = useRef<string>("");
    const navigate = useNavigate();
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const [subScriptions] = useState<any[]>([]);
    const [chatContexts, setChatContexts] = useState<Array<Schema["ChatContext"]["type"]>>([]);
    const [sideOverlayVisible, setSideOverlayVisible] = useState<boolean>(false);
    const chatAreaRef = useRef<HTMLDivElement | null>(null);
    const minimizeButtonRef = useRef<HTMLDivElement | null>(null);
    const [user, setUser] = useState<any>(null);
    const [userAttributes, setUserAttributes] = useState<any>(null);
    const { isMax, currentInterval } = useResponsiveness()
    const [currentScreenSize, setCurrentScreenSize] = useState<string>("");
    const [lastScreenSize, setLastScreenSize] = useState<string>("");
    const [uploadVisible, setUploadVisible] = useState<boolean>(false);
    const [files, setFiles] = useState<{ [key: string]: { status: string } }>({});

    const modelOptions: IModelOption[] = LLMDefinitions.filter((def)=>def.enabled).map((definition) => ({
        key: definition.id,
        text: definition.name,
        value: definition.id,
        image: { avatar: false, src: "" },
    } as IModelOption));

    var defaultLLMOption = "3dModelLLM_Ollama_Build123d";
    if(isDev)
    {
        defaultLLMOption = "3dModelLLM_Ollama_Build123d";
    }
    const [selectedLlmConfiguration, setSelectedLlmConfiguration] = useState<IModelOption>(modelOptions.find((o)=>o.key === defaultLLMOption) || modelOptions[1]);

    // console.log("Chat env: "+JSON.stringify(import.meta.env));
    // console.log("Chat vars: "+JSON.stringify(process.env));

    const handleScrollToBottom = () => {
        //
        messagesEndRef.current?.scrollIntoView();
      };

    var params = useParams();
    if(params.chatId !== undefined)
    {
        if(chatIdRef.current !== params.chatId)
            chatIdRef.current = (params.chatId);
    }

    async function createNewChatItems(chatContextId: string) {
        //console.log("creating new chat items for context: " + chatContextId);
        var newUserChatItem = await client.models.ChatItem.create({
            chatContextId: chatContextId, role: "user",
            messages: JSON.stringify([
                {
                    id: uuidv4(),
                    text: query,
                    itemType: "message",
                    state: "completed",
                    stateMessage: ""
                }
            ])
        });
        if(newUserChatItem.errors)
            console.log(newUserChatItem.errors);
        var newAssistantChatItem = await client.models.ChatItem.create({
            chatContextId: chatContextId, role: "assistant",
            messages: JSON.stringify([
                {
                    id: uuidv4(),
                    text: "",
                    itemType: "message",
                    state: "pending",
                    stateMessage: "thinking..."
                }
            ])
        });
        if(newAssistantChatItem.errors)
            console.log(newAssistantChatItem.errors);

        //console.log("created new chat items: " + newUserChatItem.data?.id + " and " + newAssistantChatItem.data?.id);
        return { newUserChatItem, newAssistantChatItem };
    }

    async function deleteChatItem(id: string) {
        const chatItem = chatMessages.find((item) => item.id === id);
        if(!chatItem)
        {
            console.error("Chat item not found: "+id);
            return;
        }
        if(chatItem.messages && typeof chatItem.messages === 'string')
        {
            const messages: IChatMessage[] = chatItem.messages ? JSON.parse(chatItem.messages as string) : [];
            //console.log(JSON.stringify(messages));
            messages.forEach(async (message) => {

            const key = "modelcreator/"+message.id;

            var filesForKey = await list({path: key});
            //console.log("filesForKey: "+JSON.stringify(filesForKey));
            filesForKey.items.forEach(async (file) => {
                //console.log("deleting file: "+file.path);
                await remove({path: file.path});
                });

            });
        }
        await client.models.ChatItem.delete({ id: id });
    }

    async function submitChatBackendCall() {
        if(query === "")
            return;
        //console.log("submitChatBackendCall");
        //console.log("chatId: "+chatIdRef.current);
        //console.log("chatContext: "+JSON.stringify(chatContextRef.current));
        if(chatIdRef.current === "new")
            chatIdRef.current = "";
        if (chatContextRef.current === null && chatIdRef.current === "") {
            //console.log("No context and no chatId");
            const chatContextCreate = await client.models.ChatContext.create({ name: "unnamed chat", conversationModelId: "conversationLLM", chat3DModelId: selectedLlmConfiguration.key });
            if(chatContextCreate.data)
            {
                chatIdRef.current = chatContextCreate.data.id;
                chatContextRef.current = chatContextCreate.data;
            }
            //console.log("chat context data: " + JSON.stringify(chatContextCreate.data));
            //console.log("chat context created: " + chatContextCreate.data?.id);
            //console.log("chat context owner: " + chatContextCreate.data?.owner);
            navigate("/chat/" + chatContextRef.current.id);
        }

        if(chatContextRef.current !== null)
        {
            setQuery(""); // remove last query
            var { newUserChatItem, newAssistantChatItem } = await createNewChatItems(chatContextRef.current.id);

            if(chatContextRef.current && chatContextRef.current.name === "unnamed chat")
            {
                // create name with ai
                //console.log("chatContextRef.current: "+JSON.stringify(chatContextRef.current));
                //console.log("naming chat context...");
                client.generations
                .chatNamer({
                  content: query,
                })
                .then(async (res) => {
                    var chatContextUpdate = await client.models.ChatContext.update({ id: chatContextRef.current.id, name: res.data?.name ?? "unnamed chat" });
                    if(chatContextUpdate.errors)
                        console.error(chatContextUpdate.errors);
                    chatContextRef.current = chatContextUpdate.data;
                });
            }

            client.queries.submitQuery({ // we are not waiting for this to return as any backend query in amplify is limited to 30s by the api gw
                chatContextId: chatContextRef.current.id, 
                query: query, 
                newUserChatItemId: newUserChatItem.data?.id, 
                newAssistantChatItemId: newAssistantChatItem.data?.id,
                openScadExecutorFunctionName: outputs.custom.openscadExecutorFunctionWithImageName,
                bucket: outputs.storage.bucket_name,
                llmconfiguration: selectedLlmConfiguration.value
             });
             handleScrollToBottom();
        }
    }

    const getUser = async () => {
        const user = await getCurrentUser();
        if (user) setUser(user);
        console.log(user);
        const attributes = await fetchUserAttributes();
        if(attributes) {
            console.log(attributes);
            setUserAttributes(attributes);

            // check patron status
            if(attributes.email)
            {
                console.log("checking patreon status for: "+attributes.email);
                const checkPatreonStatus = await client.queries.checkPatreonStatus({ patreonEmail: attributes.email });
                if(checkPatreonStatus.errors)
                    console.error(checkPatreonStatus.errors);
                else
                    console.log("checkPatreonStatus: "+checkPatreonStatus.data);
            }
        }
    };

    useEffect(() => {

        // try {
        //     console.log("user from useAuthenticator", user);
        //     console.log("user attributes: "+JSON.stringify(user?.attributes));
        //     getCurrentUser().then((user) => {  
        //         console.log("user", user);
        //         if(user !== null)
        //         {
        //             var username = user.username;
        //             console.log("username", username);
    
        //             fetchUserAttributes().then((attributes) => {
        //                 console.log("attributes", attributes);
        //             });
        //         }
        //         const user = await Auth.currentUserInfo();

        //     });
        // } catch (error) {
        //     console.error("error fetching user", error);
        // }
        getUser();

        async function fetchChatContext()
        {
            const chatContextGet = await client.models.ChatContext.get({ id: chatIdRef.current });
            chatContextRef.current = chatContextGet.data;
            if (chatContextGet?.data?.chat3DModelId) {
                var chat3DModelId = chatContextGet.data.chat3DModelId;
                const selectedOption = modelOptions.find(option => option.key === chat3DModelId);
                if (selectedOption) {
                    setSelectedLlmConfiguration(selectedOption);
                }
            }
            else
            {
                setSelectedLlmConfiguration(modelOptions.find((o)=>o.key === defaultLLMOption) || modelOptions[1]);
            }
            //console.log("Chat context auto loaded")
            handleScrollToBottom();
            setQuery("");
        }

        //console.log("chatId in useEffect: "+chatIdRef.current);
        if(chatIdRef.current === "new")
        {
            chatContextRef.current = null;
            chatIdRef.current = "";
            setChatMessages([]);
            setQuery("");
            setSelectedLlmConfiguration(modelOptions.find((o)=>o.key === defaultLLMOption) || modelOptions[1]);
            navigate("/chat");
        }

        if(chatIdRef.current !== "")
        {
            fetchChatContext();
        }

        if(chatIdRef.current !== "")
        {
            const subscription = client.models.ChatItem.observeQuery({
                filter: { chatContextId: { eq: chatIdRef.current } },
                }).subscribe({
                next: (data) => {
                    const sortedItems = data.items.sort((a, b) => (a.createdAt > b.createdAt) ? 1 : -1);
                    setChatMessages([...sortedItems])
                    //console.debug("data.items: "+JSON.stringify(data.items));
                    handleScrollToBottom();
                },
            });
            //console.log("ChatItem subscription created");
            subScriptions.push(subscription);
        }

        const chatContextSubscription = client.models.ChatContext.observeQuery().subscribe({
            next: (data) => {
                const sortedItems = data.items.sort((a, b) => (a.createdAt < b.createdAt) ? 1 : -1);
                setChatContexts([...sortedItems]);
            },
        });
        subScriptions.push(chatContextSubscription);

        return ()=>{
            subScriptions.forEach((subscription) => {
                subscription.unsubscribe()
                //console.log("subscription removed");
            });
            subScriptions.length = 0;
        };

    }, [chatIdRef.current]);

    useEffect(() => {
        if(currentInterval !== currentScreenSize)
        {
            setLastScreenSize(currentScreenSize);
            setCurrentScreenSize(currentInterval);
        }
    }, [currentInterval]);

    useEffect(() => {
        if(currentScreenSize === "xs" && lastScreenSize !== "xs")
        {
            setSideOverlayVisible(false);
        }
        if((lastScreenSize === "xs" && currentScreenSize !== "xs") || (lastScreenSize === "" && currentScreenSize !== "xs"))
        {
            setSideOverlayVisible(true);
        }

    }, [currentScreenSize]);

    const regenerateResponse = async (id: string) => {
        //alert("regenerateResponse: "+id);
        // delete chatitem by id
        const lastChatItem = chatMessages.find((item) => item.id === id);
        if(!lastChatItem)
        {
            console.error("Chat item not found: "+id);
            return;
        }
        const lastQueryChatItem = chatMessages[chatMessages.indexOf(lastChatItem) - 1];
        if(!lastQueryChatItem)
        {
            console.error("Query chat item not found: "+id);
            return;
        }

        setQuery(lastQueryChatItem.messages ? JSON.parse(lastQueryChatItem.messages as string)[0].text : "");
        await deleteChatItem(lastChatItem.id);
        await deleteChatItem(lastQueryChatItem.id);
    }

    return (
            <>
            <SidebarPushable>
                <Sidebar
                    animation={currentScreenSize !== "xs" ? "overlay" : "push"}
                    visible={sideOverlayVisible}
                    onHide={() => sideOverlayVisible ? setSideOverlayVisible(false) : null }
                    className="chat-sidebar"
                    target={isMax("sm") ? minimizeButtonRef.current || undefined : chatAreaRef.current || undefined }
                >

                <div className="top-menubar">
                    <div ref={minimizeButtonRef}>
                            <Icon bordered link name="columns" onClick={() => setSideOverlayVisible(!sideOverlayVisible)} />
                    </div>
                </div>
                <Menu vertical borderless fluid>
                    <MenuItem as={NavLink}
                        to="/chat/new"
                        onClick={() => {currentScreenSize === "xs" ? setSideOverlayVisible(false) : null;}}
                        >
                        <Icon name="edit"/>
                        New Chat
                    </MenuItem>
                </Menu>
                <Menu vertical borderless fluid className="chat-contexts">
                    {chatContexts.map((item) => (
                        <ChatContextComponent chatContext={item} key={item.id} onClick={() => {currentScreenSize === "xs" ? setSideOverlayVisible(false) : null;}} />
                    ))}
                </Menu>

                <div className="footer-menubar">
                    <div className="settings">
                        <Popup trigger={<Icon bordered link name="setting"/>}>Settings</Popup>
                    </div>
                    <div className="spacer"></div>
                    <div className="user">
                        <Popup on={"click"} trigger={
                            /* https://www.perplexity.ai/search/i-like-to-create-avatar-images-c4mY118TRlexy9NxCk2Fyw */
                            /* https://www.stefanjudis.com/blog/apis-to-generate-random-user-avatars/ */
                            <Image avatar src={userAttributes && userAttributes.picture ? userAttributes.picture : "https://api.dicebear.com/9.x/avataaars/svg?seed="+(user ? user.userId : "") } />
                            } hideOnScroll>
                            <Menu vertical borderless fluid>
                                <MenuItem onClick={() => signOut()}>
                                    <Icon name="sign-out"/>
                                    Sign out
                                </MenuItem>
                            </Menu>
                        </Popup>
                    </div>
                </div>

                </Sidebar>
                <SidebarPusher>

            <div className={sideOverlayVisible && currentScreenSize !== "xs" ? "chat-grid" : "chat-grid full-width"} ref={chatAreaRef}>
                <div className="top-menubar">
                    <div className="chat-buttons-left" style={{display: !sideOverlayVisible ? "block" : "none"}}>
                        <Icon bordered link name="columns" onClick={() => setSideOverlayVisible(!sideOverlayVisible)} />
                        <Icon bordered link name="edit" onClick={() => navigate("/chat/new")} />
                    </div>
                    <img src="/images/chat3dlogo.png" height={30} width={30}/>
                    <div className="chat-title">
                        Chat3D
                    </div>
                    {isDev && (
                        <div className="chat-buttons-right">
                            <Dropdown inline compact direction="left" icon={null} trigger={<Icon><Image src='/images/brain.svg'></Image></Icon>} options={modelOptions} value={selectedLlmConfiguration.value} onChange={(_e,v)=>{
                                var selectedOption = modelOptions.find((option)=>option.value === v.value);
                                if(selectedOption)
                                    setSelectedLlmConfiguration(selectedOption);
                                }} />
                        </div>
                    )}
                </div>
                <div className="chat-container" style={{display: chatIdRef.current === "" ? "none" : "block"}}>
                    {chatMessages.map((item) => (
                        <ChatMessage item={item} key={item.id} onRefreshClick={(id) => {regenerateResponse(id)} } />
                    ))}
                    <div ref={messagesEndRef}></div>
                </div>
                {chatMessages.length === 0 ? (
                    <div className="chat-welcome">
                        What can I create for you?
                    </div>
                ) : null}
                <div style={uploadVisible ? {display: "block"} : {display: "none"}} key={"file-uploader"}>
                    <FileUploader
                        acceptedFileTypes={['image/*']}
                        path="upload/"
                        maxFileCount={1}
                        isResumable
                        maxFileSize={1000000}
                        onUploadSuccess={(event: { key?: string }) => {
                            const key = event.key ?? '';
                            return setFiles((prevFiles) => {
                                return {
                                    ...prevFiles,
                                    [key]: {
                                        status: 'success',
                                    },
                                };
                            });
                          }}
                        onFileRemove={(event: { key?: string }) => {
                            const key = event.key ?? '';
                            return setFiles((prevFiles) => {
                                const { [key]: _, ...rest } = prevFiles;
                                return rest;
                            });
                          }}
                        onUploadError={(_error, { key }: { key: string }) => {
                            setFiles((prevFiles) => {
                              return {
                                ...prevFiles,
                                [key]: {
                                  status: 'error',
                                },
                              };
                            });
                          }}
                        onUploadStart={(event: { key?: string }) => {
                            const key = event.key ?? '';
                            return setFiles((prevFiles) => {
                                return {
                                    ...prevFiles,
                                    [key]: {
                                        status: 'uploading',
                                    },
                                };
                            });
                        }}
                        />
                        {Object.keys(files).map((key) => {
                            return files[key] ? (
                            <div>
                                {key}: {files[key].status}
                            </div>
                            ) : null;
                        })}
                </div>
                <div className="input-container">
                    {uploadVisible ? 
                        <Button icon="close" onClick={()=> setUploadVisible(false)} />
                        :
                        isDev ? <Button icon="plus" onClick={()=> setUploadVisible(true)} /> : ""
                    }   
                    <Input
                        type="multiline" 
                        placeholder="Type a message..." 
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyPress={(e: { key: string; }) => {
                            if (e.key === "Enter") {
                                submitChatBackendCall();
                            }
                        }}
                    >
                        <input />
                        <Button onClick={submitChatBackendCall}>Send</Button>
                    </Input>
                </div>
            </div>
                                
            </SidebarPusher>
            </SidebarPushable>
        </>
    );
}

export default Chat;