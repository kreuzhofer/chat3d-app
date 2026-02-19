import { defineStorage } from '@aws-amplify/backend';
import { submitQueryFunction } from '../functions/submitqueryfunction/resources';

export const storage = defineStorage({
  name: 'chat3dstorage',
  access: (allow) => ({
    'modelcreator/*': [allow.resource(submitQueryFunction).to(['read', 'write', 'delete']), allow.authenticated.to(['read', 'write', 'delete'])],
    'upload/*': [allow.authenticated.to(['read', 'write', 'delete'])],
  })
});