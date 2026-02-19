import { defineFunction, secret } from '@aws-amplify/backend';

export const claimPatreonBenefitsFunction = defineFunction({
  // optionally specify a name for the Function (defaults to directory name)
  name: 'claimPatreonBenefitsFunction',
  // optionally specify a path to your handler (defaults to "./handler.ts")
  entry: './handler.ts',
  timeoutSeconds: 60,
  environment: {
    PATREON_CLIENT_ID: secret('PATREON_CLIENT_ID'),
    PATREON_CLIENT_SECRET: secret('PATREON_CLIENT_SECRET'),
    PATREON_REDIRECT_URI: process.env.PATREON_REDIRECT_URI || '',
  } 
});