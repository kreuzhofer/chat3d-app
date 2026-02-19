import { defineFunction } from '@aws-amplify/backend';

export const checkPatreonStatusFunction = defineFunction({
  // optionally specify a name for the Function (defaults to directory name)
  name: 'checkPatreonStatusFunction',
  // optionally specify a path to your handler (defaults to "./handler.ts")
  entry: './handler.ts',
  timeoutSeconds: 60
});