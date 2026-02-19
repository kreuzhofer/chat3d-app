import type { Schema } from "../../amplify/data/resource";
import ChatMessageAI from "./ChatMessageAI";
import ChatMessageUser from "./ChatMessageUser";

interface ChatMessageProps {
    item: Schema["ChatItem"]["type"];
    onRefreshClick: (id: string) => void;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ item, onRefreshClick }) => 
{
    if(item.role === "user")
    return (
        <ChatMessageUser {...item} />
    )
    else if(item.role === "assistant")
    return (
        <ChatMessageAI item={item} onRefreshClick={onRefreshClick} />
    );
}

export default ChatMessage;