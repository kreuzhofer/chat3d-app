import { defineFunction } from '@aws-amplify/backend';

export const postAuthentication = defineFunction({
  name: 'post-authentication',
  // optionally define an environment variable for your filter
  environment: {
    ALLOW_DOMAIN: 'amazon.com'
  }
});