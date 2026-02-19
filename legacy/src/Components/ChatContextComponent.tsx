import { Confirm, Icon, Menu, MenuItem, Popup } from "semantic-ui-react";
import { IChatMessage, Schema } from "../../amplify/data/resource";
import { NavLink, useNavigate } from "react-router";
import { generateClient } from "aws-amplify/api";
import { list, remove } from "aws-amplify/storage";
import { useState } from "react";
const client = generateClient<Schema>();

interface ChatContextComponentProps {
    chatContext: Schema["ChatContext"]["type"];
    onClick: (chatContext: Schema["ChatContext"]["type"]) => void;
}

const ChatContextComponent: React.FC<ChatContextComponentProps> = ({chatContext, onClick}) => {
    const navigate = useNavigate();
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

    async function onDeleteChatContext() {
        console.log("trying to delete: "+chatContext.id);
        // iterate over all chat items and delete them
        const chatContextToDelete = await client.models.ChatContext.get({ id: chatContext.id });
        if(chatContextToDelete.data)
        {
            const chatItemsForChatContext = await chatContextToDelete.data.chatItems();
            chatItemsForChatContext.data.forEach(async (item) => {
                console.log("deleting chat item: "+item.id);
                // iterate over all messages in the chatItem and delete all scad and png files in the s3 bucket matching the message id
                if(item.messages)
                {
                    if (typeof item.messages === 'string') {
                        const messages: IChatMessage[] = item.messages ? JSON.parse(item.messages as string) : [];
                        
                        messages.forEach(async (message) => {
                            if(message.itemType === "image")
                            {
                                const key = "modelcreator/"+message.id;

                                var filesForKey = await list({path: key});
                                //console.log("filesForKey: "+JSON.stringify(filesForKey));
                                filesForKey.items.forEach(async (file) => {
                                    //console.log("deleting file: "+file.path);
                                    await remove({path: file.path});
                                });
                            }
                        });
                    }
                }
                await client.models.ChatItem.delete({ id: item.id });
            });

            console.log("deleting chat context: "+chatContext.id);
            await client.models.ChatContext.delete({ id: chatContext.id });
            navigate("/chat/new");
        }
    }

    return(
        <MenuItem as={NavLink}
        to={"/chat/"+chatContext.id}
        onClick={() => onClick(chatContext)}
        >
        <div className="hover-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <span className="overflow ellipsis">{chatContext.name}</span>
                <Popup
                    contentStyle={{ display: 'flex', justifyContent: 'flex-end' }}
                    trigger={<Icon name="ellipsis horizontal" onClick={(e: { preventDefault: () => any; }) => e.preventDefault()} />}
                    on='click'
                    hideOnScroll
                >
                    <Menu vertical borderless fluid>
                        <MenuItem onClick={()=>setConfirmDeleteOpen(true)}>
                            <Icon name="trash"/>
                            Delete
                        </MenuItem>
                    </Menu>
                </Popup>
                <Confirm 
                    open={confirmDeleteOpen} 
                    onCancel={() => setConfirmDeleteOpen(false)} 
                    onConfirm={onDeleteChatContext} />
            </div>
        </div>   
        <div className="default-content overflow ellipsis">
            {chatContext.name}
        </div> 
    </MenuItem>
    )    
}

export default ChatContextComponent;