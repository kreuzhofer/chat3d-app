import type { Schema, IChatMessage } from "../../amplify/data/resource";
import { Loader, Segment, Icon, Placeholder, PlaceholderImage } from "semantic-ui-react";
import { StorageImage } from '@aws-amplify/ui-react-storage';
import ModelViewer from "./ModelViewer";
import FileDownloadButton from "./FileDownloadButton";
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { generateClient } from "aws-amplify/api";

const client = generateClient<Schema>();
interface ChatMessageAIProps {
    item: Schema["ChatItem"]["type"];
    onRefreshClick: (id: string) => void;
}

const ChatMessageAI: React.FC<ChatMessageAIProps> = ({item, onRefreshClick}) =>
{
    const messages = item.messages ? JSON.parse(item.messages as string) as IChatMessage[] : [];
    const filePrefix = "modelcreator/";

    async function rateItem(rating: number)
    {
        var newrating = undefined;
        if(rating == item.rating) // unrate
            newrating = 0;
        else
            newrating = rating;
        // update chatitem in database
        await client.models.ChatItem.update({rating: newrating, id: item.id});
    }

    return(
        <>
        {messages.map((message) => {
            if(message.itemType === "message")
                return (
                    <div className="message ai" key={message.id}>
                        <div className="content">
                            <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
                            <Loader active={message.state==="pending"} inline />
                            {message.state==="pending" ? null : (
                                <div className="response-actions">
                                    <Icon link name="refresh" onClick={()=>onRefreshClick(item.id)}></Icon>
                                </div>
                            )}
                        </div>
                    </div>
                )
            else if(message.itemType === "errormessage")
                return (
                    <div className="message ai error" key={message.id}>
                        <div className="content">
                            <Icon name="lemon"/>
                            <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
                            <div className="response-actions">
                                <Icon link name="refresh" onClick={()=>onRefreshClick(item.id)}></Icon>
                            </div>
                        </div>
                    </div>
                )
            else if(message.itemType === "image")
                return(
                    <div className="message ai" key={message.id}>
                        <div className="content">
                            <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
                            <div className="response-3dmodel">
                                <Segment>
                                    <Loader active={message.state==="pending"}>{message.stateMessage}</Loader>
                                    {message.state==="pending" ? (
                                        message.attachment === null || message.attachment === "" ? (
                                            <Placeholder style={{height: "256px", width: "256px"}}>
                                                <PlaceholderImage square />
                                            </Placeholder>
                                        ) : (
                                            <StorageImage alt="image" path={message.attachment} />
                                        )
                                    ) : <StorageImage alt="image" path={message.attachment} /> }
                                </Segment>
                            </div>
                        </div>
                    </div>
                )
            else if(message.itemType === "3dmodel")
            {
                return(
                    <div className="message ai" key={message.id}>
                        <div className="content">
                            <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
                            <div className="response-3dmodel">
                                <Segment>
                                    <ModelViewer fileName={message.attachment} />
                                </Segment>
                            </div>
                            <div className="response-3dmodel">
                                <FileDownloadButton fileName={filePrefix+message.id+".3mf"} text="3MF" />
                                <FileDownloadButton fileName={filePrefix+message.id+".csg"} text="CSG" />
                                <FileDownloadButton fileName={filePrefix+message.id+".scad"} text="SCAD" />
                            </div>
                            <div className="response-actions">
                                <Icon link name={item.rating === 1 ? "thumbs up" : "thumbs up outline"} onClick={()=>rateItem(1)}/>
                                <Icon link name={item.rating === -1 ? "thumbs down" : "thumbs down outline"} onClick={()=>rateItem(-1)}/>
                                <Icon link name="refresh" onClick={()=>onRefreshClick(item.id)}></Icon>
                            </div>
                            <div className="response-actions ratingmsg">
                                {item.rating === 1 || item.rating === -1 ? "Thank you for leaving a rating! 🎉" : "Please rate this item 👍👎 to help me improve the results. Thank you so much!" }
                            </div>
                            <div className="response-3dmodel tokencost">
                                I:{message.intputTokens}, O:{message.outputTokens}, C:{message.tokenCost? message.tokenCost.toPrecision(4) : 0}
                            </div>
                        </div>
                    </div>
                )
            }         
            return null;
        })}
        </>
    );
}

export default ChatMessageAI;