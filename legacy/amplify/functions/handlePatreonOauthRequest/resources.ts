import { defineFunction } from '@aws-amplify/backend';

export const patreonOauthRequestHandlerFunction = defineFunction({
  // optionally specify a name for the Function (defaults to directory name)
  name: 'patreonOauthRequestHandlerFunction',
  // optionally specify a path to your handler (defaults to "./handler.ts")
  entry: './patreonOauthRequestHandler.ts',
  timeoutSeconds: 60,
});