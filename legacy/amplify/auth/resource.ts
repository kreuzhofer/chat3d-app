import { defineAuth, secret } from '@aws-amplify/backend';
//import { ProviderAttribute } from 'aws-cdk-lib/aws-cognito';
import { preSignUp } from './pre-sign-up/resource';
import { postAuthentication } from './post-authentication/resource';
import { postConfirmation } from './post-confirmation/resources';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: 'Welcome to Chat3D! Here is your email verification code',
      verificationEmailBody: (code) => `We're happy to have you!<br/><br/>Your verification code is: ${code()}<br/><br/>Best regards<br/>Chat3D Team`,
      userInvitation: {
        emailSubject: 'Welcome to Chat3D! Here is your temporary password',
        emailBody: (user, code) => 
          `We're happy to have you!<br/><br/> You can now login with username ${user()} and temporary password ${code()}<br/>
          Please change your password after logging in.<br/><br/>
          The link to the app is: ${process.env.GOOGLE_CALLBACK_URL}<br/><br/>
          Best regards<br/>Chat3D Team`,
      }
    },

    externalProviders: {
      google: {
        clientId: secret('GOOGLE_CLIENT_ID'),
        clientSecret: secret('GOOGLE_CLIENT_SECRET'),
        scopes: ['email', 'openid', 'profile', 'phone'],
        attributeMapping: {
          email: 'email',
          givenName: 'given_name',
          familyName: 'family_name',
          phoneNumber: 'phone_number',
          profilePicture: 'picture',
        }
      },
      callbackUrls: [
        process.env.GOOGLE_CALLBACK_URL || '',
      ],
      logoutUrls: [process.env.GOOGLE_LOGOUT_URL || ''],
    }
  },
  
  triggers: {
    preSignUp,
    postAuthentication,
    postConfirmation
  }
});
