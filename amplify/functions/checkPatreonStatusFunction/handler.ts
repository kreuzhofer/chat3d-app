import type { Schema } from "../../data/resource";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";

export const handler: Schema["checkPatreonStatus"]["functionHandler"] = async (event) => {
  const { patreonEmail } = event.arguments;
  if (!patreonEmail) {
      throw new Error("Email is required");
  }
  console.log("patreonEmail: "+patreonEmail);
  const dynamoDb = new DynamoDBClient({
    region: "eu-west-1",
  });
  const params = {
    TableName: "Patron",
    IndexName: "patronsByEmail",
    KeyConditionExpression: "email = :patreonEmail",
    ExpressionAttributeValues: {
      ":patreonEmail": { S: patreonEmail },
    },
  };
  const data = await dynamoDb.send(new QueryCommand(params));
  console.log("data: "+JSON.stringify(data));
  if (!data.Items || data.Items.length === 0) {
    throw new Error("Patreon not found");
  }

  return "OK"
}
