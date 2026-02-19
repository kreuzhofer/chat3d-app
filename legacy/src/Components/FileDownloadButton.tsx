import { getUrl } from "aws-amplify/storage";
import { Button, Icon } from "semantic-ui-react";

interface FileDownloadButtonProps {
    fileName: string;
    text: string;
}

const FileDownloadButton: React.FC<FileDownloadButtonProps> = ({ fileName, text }) => {

    function downloadFile(){
        getUrl({
            path: fileName,
            options:
            {
                expiresIn: 900,
            }
            // Alternatively, path: ({identityId}) => `album/{identityId}/1.jpg`
            }).then(linkToStorageFile => {
                // console.log('signed URL: ', linkToStorageFile.url);
                // console.log('URL expires at: ', linkToStorageFile.expiresAt);
                window.location.href = linkToStorageFile.url.toString();
            });
    }

    return (
        <Button onClick={downloadFile}>{text}&nbsp;&nbsp;<Icon name="download"></Icon></Button>
    );
}

export default FileDownloadButton;