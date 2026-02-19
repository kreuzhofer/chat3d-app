import type { Schema, IChatMessage } from "../../amplify/data/resource";
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function ChatMessageUser(item: Schema["ChatItem"]["type"])
{
    const messages = item.messages ? JSON.parse(item.messages as string) as IChatMessage[] : [];

    return (
        <>
            {messages.map((message) => (
                <div className="message user" key={message.id}>
                    <div className="content">
                        <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
                    </div>
                </div>
            ))}
        </>
    );
}

export default ChatMessageUser;