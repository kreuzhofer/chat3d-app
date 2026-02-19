import { IRenderingProvider, RenderModelResult } from "./IRenderingProvider";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "$amplify/env/submitQueryFunction";

const template = `
from build123d import *

###CODE###

export_step(root_part, "###FILENAME###.step")
exporter = Mesher()
exporter.add_shape(root_part)
exporter.write("###FILENAME###.3mf")
exporter.write("###FILENAME###.stl")
`;

export class Build123dRenderingProvider implements IRenderingProvider {
    private s3 = new S3Client({});

    async generateSourceCodeFile(code: string, messageId: string, bucket: string): Promise<string> {
        console.log("Uploading code: ", code);
        const key = `modelcreator/${messageId}.b123d`;
        await this.s3.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: code,
                ContentType: "text/plain",
            }),
        );
        return key;
    }

    async renderModel(sourceFileName: string, targetFileName: string, bucket: string): Promise<RenderModelResult> {
        // Placeholder: Replace with actual Build123d rendering logic
        console.log(`Rendering model from ${sourceFileName} to ${targetFileName} in bucket ${bucket}...`);

        const build123dUrl = env.BUILD123D_URL;
        const build123dToken = env.BUILD123D_TOKEN;

        //read code from bucket into code variable
        const codeFileFromS3 = await this.s3.send(
            new GetObjectCommand({
                Bucket: bucket,
                Key: sourceFileName,
            }),
        );
        console.log("CodeFileFromS3: ", codeFileFromS3);
        const code = await codeFileFromS3.Body?.transformToString();
        console.log("Code: ", code);

        if(!code) {
            return {
                success: false,
                errorMessage: "Code is undefined",
            };
        }
        const combinedCode = template.replace("###CODE###", code).replaceAll("###FILENAME###", targetFileName.replace(".3mf", ""));

        const response = await fetch(`${build123dUrl}/render/`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${build123dToken}`,
            },
            body: JSON.stringify({
                code: combinedCode,
                filename: targetFileName,
            }),
        });
        console.log("Response: ", response);

        if(response.ok) {
            var responseJson = await response.json();
            console.log("ResponseJson: ", responseJson);

            /*
            Responses can have the success property either true or false
            for errors, success will be false and the result will look like this:
            {
                "success": false,
                "files": [],
                "message": "Syntax error in code: invalid syntax (<string>, line 1)"
            }

            for successful results, the files array will contain entries like this:
            {
                "success": true,
                "files": [
                    {
                        "filename": "filename.step",
                        "content": "SVNPLTEwMzAzLTIx..." // base64 encoded content
                    }
                ]
            }
            */
            if(responseJson.success)
            {
                for(var file of responseJson.files)
                {
                    const fileContent = Buffer.from(file.content, "base64");
                    const targetModelKey = `modelcreator/${file.filename}`;
                    await this.s3.send(
                        new PutObjectCommand({
                            Bucket: bucket,
                            Key: targetModelKey,
                            Body: fileContent,
                            ContentType: "application/octet-stream",
                        }),
                    );
                }
                const targetModelKey = 'modelcreator/'+responseJson.files.filter((f: any)=>f.filename.endsWith(".3mf")).pop().filename;
                return {
                    success: true,
                    targetModelKey: targetModelKey,
                };
            }
            else
            {
                return {
                    success: false,
                    errorMessage: responseJson.message,
                };
            }
        }
        return {
            success: false,
            errorMessage: "Rendering failed: " + response.statusText,
        };
    }
}

export default Build123dRenderingProvider;
