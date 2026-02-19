import type { PreSignUpTriggerHandler } from 'aws-lambda';
import { type Schema } from '../../data/resource';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/pre-sign-up';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);

Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();

export const handler: PreSignUpTriggerHandler = async (event) => {
    console.log(JSON.stringify(event));
    
    const email = event.request.userAttributes.email?.toLowerCase();
    
    if (!email) {
        console.error('No email provided in user attributes');
        throw new Error('Email is required for sign up');
    }
    
    if (event.triggerSource === "PreSignUp_ExternalProvider") {
        console.log("PreSignUp_ExternalProvider for email: " + email);
    }
    
/*     // Query the WhiteListUserRegistrationItem table
    const { data: whitelistItems, errors } = await client.models.WhiteListUserRegistrationItem.list({
      filter: {
        email: { eq: email }
      }
    });
    
    if (errors && errors.length > 0) {
      console.error('Error querying whitelist:', errors);
      throw new Error('Failed to verify email authorization');
    }
    
    // Check if the email exists in the whitelist
    const isWhitelisted = whitelistItems && whitelistItems.length > 0;
    
    if (!isWhitelisted) {
      console.log(`Access denied for email: ${email} - not in whitelist`);
      throw new Error("You are not authorized to sign up at this time. Please contact support for access.");
    }
    
    console.log(`Access granted for whitelisted email: ${email}`); */
    return event;
};