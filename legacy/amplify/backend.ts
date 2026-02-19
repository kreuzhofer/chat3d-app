import { defineBackend } from '@aws-amplify/backend';
import * as iam from "aws-cdk-lib/aws-iam"
import * as apigw from "aws-cdk-lib/aws-apigateway";
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { submitQueryFunction } from './functions/submitqueryfunction/resources';
import { claimPatreonBenefitsFunction } from './functions/claimPatreonBenefitsFunction/resources';
import { patreonOauthRequestHandlerFunction } from './functions/handlePatreonOauthRequest/resources';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Duration } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { checkPatreonStatusFunction } from './functions/checkPatreonStatusFunction/resources';

const backend = defineBackend({
  auth,
  data,
  storage,
  submitQueryFunction,
  claimPatreonBenefitsFunction,
  patreonOauthRequestHandlerFunction,
  checkPatreonStatusFunction,
});

/* Rotating the api key, this is not needed for now
backend.data.resources.cfnResources.cfnApiKey?.overrideLogicalId(
  `recoverApiKey${new Date().getTime()}`
);
*/

const submitQueryLambda = backend.submitQueryFunction.resources.lambda;

const statement = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    "lambda:InvokeFunction",
    "sqs:SendMessage",
    "bedrock:InvokeModel",
    "bedrock:InvokeModelWithResponseStream"
    ],
  resources: ['*'],
});

submitQueryLambda.addToRolePolicy(statement);

// add permissions for checkPatreonStatusFunction to access DynamoDB in another region
const checkPatreonStatusLambda = backend.checkPatreonStatusFunction.resources.lambda;
const checkPatreonStatusStatement = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:GetItem",
    "dynamodb:Scan",
    "dynamodb:Query",
  ],
  resources: ['*'],
});
checkPatreonStatusLambda.addToRolePolicy(checkPatreonStatusStatement);

const patreonOauthLambda = backend.patreonOauthRequestHandlerFunction.resources.lambda;
const customResourceStack = backend.createStack('LambdaCustomResourceStack');

const endpoint = new apigw.LambdaRestApi(customResourceStack, `ApiGwEndpoint`, {
  handler: patreonOauthLambda,
  restApiName: `PatreonOauthAPI`,
});

//const repository = ecr.Repository.fromRepositoryName(customResourceStack, 'OpenscadExecutorRepository', 'chat3lambdadopenscad');

// const role = new iam.Role(customResourceStack, 'LambdaPromptEvaluationRole', {
//   assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
//   managedPolicies: [
//     iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
//   ],
//   inlinePolicies: {
//     "S3AccessPolicy": new iam.PolicyDocument({
//       statements: [
//         new iam.PolicyStatement({
//           effect: iam.Effect.ALLOW,
//           actions: [
//             "s3:GetObject",
//             "s3:PutObject",
//             ],
//           resources: ['*'],
//         }),
//       ]
//     })
//   }
// });

// const openscadExecutorLogGroup = new logs.LogGroup(customResourceStack, 'OpenscadExecutorFunctionWithImageLogGroup', {
//   retention: RetentionDays.ONE_WEEK
// });

// const openscadExecutorFunctionWithImage = new lambda.Function(customResourceStack, 'OpenscadExecutorFunctionWithImage', {
//   code: lambda.Code.fromEcrImage(repository, {
//     tagOrDigest: 'latest',
//   }),
//   handler: lambda.Handler.FROM_IMAGE,
//   runtime: lambda.Runtime.FROM_IMAGE,
//   environment: {
//     // Add any environment variables if needed
//   },
//   timeout: Duration.seconds(240),
//   role: role,
//   memorySize: 2048,
//   logGroup: openscadExecutorLogGroup
// });

// backend.addOutput({
//   custom : {
//     openscadExecutorFunctionWithImageName: openscadExecutorFunctionWithImage.functionName,
//   }  
// });

