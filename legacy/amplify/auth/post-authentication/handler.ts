import type { PostAuthenticationTriggerHandler } from 'aws-lambda';
//import { env } from '$amplify/env/pre-sign-up';
import { type Schema } from "../../data/resource";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from "$amplify/env/post-authentication";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

export const handler: PostAuthenticationTriggerHandler = async (event) => {
//   const email = event.request.userAttributes['email'];

//   if (!email.endsWith(env.ALLOW_DOMAIN)) {
//     throw new Error('Invalid email domain');
//   }

    const profileOwner = `${event.request.userAttributes.sub}::${event.userName}`;
    const existingProfile = await client.models.UserProfile.get({ id: profileOwner });
    console.log(`Existing profile: ${JSON.stringify(existingProfile.data?.id)}`);

    if (!existingProfile.data) {
        await client.models.UserProfile.create({
            email: event.request.userAttributes.email,
            profileOwner,
        });
    }

    console.log(JSON.stringify(event));
    return event;
    //throw new Error("You cannot sign up at this time.");
};