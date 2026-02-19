import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';

export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    console.log(`Event: ${JSON.stringify(event, null, 2)}`);
    console.log("typeof(event): "+typeof(event));
    console.log(`Context: ${JSON.stringify(context, null, 2)}`);

    const result = "OK";

    return {
        statusCode: 200,
        body: JSON.stringify(result),
    };
}