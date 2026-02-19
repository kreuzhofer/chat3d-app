import { useEffect, useRef } from "react";
import type { Schema } from "../../amplify/data/resource";
import { generateClient } from "aws-amplify/data";
import { useSearchParams } from "react-router";

const client = generateClient<Schema>();

async function BackgroundTaskClaimPatreon(codeParam: string)
{
    try{
        console.log("codeParam: "+codeParam);

        var result = await client.queries.claimPatreonBenefits({ code: codeParam });
        if (result.data) {
            var resultObject = JSON.parse(result.data);
            console.log("result: "+JSON.stringify(resultObject));
            console.log(JSON.stringify(resultObject.data.attributes));
            console.log(JSON.stringify(resultObject.data.relationships.memberships));
            console.log(JSON.stringify(resultObject.included));
            console.log(JSON.stringify(resultObject.included[0].attributes.patron_status));
            console.log(JSON.stringify(resultObject.included[0].attributes.currently_entitled_amount_cents));
        } else {
            console.log("result data is null or undefined");
        }
    }
    catch(e)
    {
        console.log("error: "+e);
    }
}

function ClaimPatreon() 
{
    const taskInitialized = useRef(false);

    const [searchParams] = useSearchParams();
    const codeParam = searchParams.get('code');
    console.log("codeParam: "+codeParam);

    useEffect(() => {
        if (!taskInitialized.current) {
            // Your background task here
            const backgroundTask = () => {
                if(codeParam)
                    BackgroundTaskClaimPatreon(codeParam);
            };
            
            backgroundTask();
            taskInitialized.current = true;
        }
    }, []);

    return (
        <div>
            <h1>Claim Patreon</h1>
        </div>
    );
}

export default ClaimPatreon;