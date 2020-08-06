import * as cdk from '@aws-cdk/core'
import { SecretValue } from '@aws-cdk/core'
import apigateway = require('@aws-cdk/aws-apigateway')
import lambda = require('@aws-cdk/aws-lambda')
import { RetentionDays } from '@aws-cdk/aws-logs'
import { StringParameter } from '@aws-cdk/aws-ssm'

export interface ILibCalGatewayStackProps extends cdk.StackProps {
  readonly stage: string
  readonly lambdaCodePath: string
  readonly sentryProject: string
  readonly sentryVersion: string
  readonly secretsPath: string
}

export default class LibCalGatewayStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: ILibCalGatewayStackProps) {
    super(scope, id, props)

    // LAMBDAS
    const paramStorePath = `/all/libcal-gateway/${props.stage}`
    const env = {
      SENTRY_DSN: StringParameter.valueForStringParameter(this, `${paramStorePath}/sentry_dsn`),
      SENTRY_ENVIRONMENT: props.stage,
      SENTRY_RELEASE: `${props.sentryProject}@${props.sentryVersion}`,
      LIBCAL_API_URL: StringParameter.valueForStringParameter(this, `${paramStorePath}/libcal_api_url`),
      API_CLIENT_ID: SecretValue.secretsManager(props.secretsPath, { jsonField: 'api_client_id' }).toString(),
      API_CLIENT_SECRET: SecretValue.secretsManager(props.secretsPath, { jsonField: 'api_client_secret' }).toString(),
    }

    const spaceLocationsLambda = new lambda.Function(this, 'SpaceLocationsFunction', {
      functionName: `${props.stackName}-getSpaceLocations`,
      description: 'Get a list of spaces available.',
      code: lambda.Code.fromAsset(props.lambdaCodePath),
      handler: 'getSpaceLocations.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
      logRetention: RetentionDays.ONE_WEEK,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: env,
    })

    const spaceBookingsLambda = new lambda.Function(this, 'spaceBookingsFunction', {
      functionName: `${props.stackName}-getSpaceBookings`,
      description: 'Get a list of space bookings for the authenticated user.',
      code: lambda.Code.fromAsset(props.lambdaCodePath),
      handler: 'getSpaceBookings.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
      logRetention: RetentionDays.ONE_WEEK,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: env,
    })

    const cancelBookingLambda = new lambda.Function(this, 'cancelBookingFunction', {
      functionName: `${props.stackName}-cancelBooking`,
      description: 'Cancel a given booking that the authenticated user has reserved.',
      code: lambda.Code.fromAsset(props.lambdaCodePath),
      handler: 'cancelBooking.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
      logRetention: RetentionDays.ONE_WEEK,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: env,
    })

    // API GATEWAY
    const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: props.stackName,
      description: 'LibCal Gateway API',
      endpointExportName: `${props.stackName}-api-url`,
      deployOptions: {
        stageName: props.stage,
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowCredentials: false,
        statusCode: 200,
      },
    })
    api.addRequestValidator('RequestValidator', {
      validateRequestParameters: true,
    })

    const authMethodOptions = {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: new apigateway.TokenAuthorizer(this, 'JwtAuthorizer', {
        handler: lambda.Function.fromFunctionArn(
          this,
          'AuthorizerFunction',
          `arn:aws:lambda:${this.region}:${this.account}:function:lambda-auth-${props.stage}`,
        ),
        identitySource: 'method.request.header.Authorization',
        authorizerName: 'jwt',
        resultsCacheTtl: cdk.Duration.minutes(5),
      }),
      requestParameters: {
        'method.request.header.Authorization': true,
      },
    }

    const endpointData = [
      { path: '/space/locations', method: 'GET', lambda: spaceLocationsLambda, requiresAuth: false },
      { path: '/space/bookings', method: 'GET', lambda: spaceBookingsLambda, requiresAuth: true },
    ]
    endpointData.forEach(endpoint => {
      const newResource = api.root.resourceForPath(endpoint.path)
      const methodOptions = endpoint.requiresAuth ? authMethodOptions : undefined
      newResource.addMethod(endpoint.method, new apigateway.LambdaIntegration(endpoint.lambda), methodOptions)
    })
    // This one needs extra options because of the path parameter
    const cancelResource = api.root.resourceForPath('/space/cancel/{id}')
    const cancelIntegrationOptions = {
      passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_MATCH,
      requestParameters: {
        'integration.request.path.id': 'method.request.path.id',
      },
    }
    const cancelMethodOptions = {
      ...authMethodOptions,
      requestParameters: {
        'method.request.path.id': true,
      },
    }
    cancelResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(cancelBookingLambda, cancelIntegrationOptions),
      cancelMethodOptions,
    )
  }
}
