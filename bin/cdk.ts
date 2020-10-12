#!/usr/bin/env node
import 'source-map-support/register'
import { execSync } from 'child_process'
import * as cdk from '@aws-cdk/core'
import { StackTags } from '@ndlib/ndlib-cdk'
import fs = require('fs')
import LibCalGatewayStack from '../src/libcal-gateway-stack'
import LibCalGatewayPipelineStack from '../src/libcal-gateway-pipeline-stack'

// The context values here are defaults only. Passing context in cli will override these
const username = execSync('id -un')
  .toString()
  .trim()
const app = new cdk.App({
  context: {
    owner: username,
    contact: `${username}@nd.edu`,
  },
})
app.node.applyAspect(new StackTags())

const stage = app.node.tryGetContext('stage') || 'dev'
const sentryProject = app.node.tryGetContext('sentryProject')
const secretsPath = app.node.tryGetContext('secretsPath')

let lambdaCodePath = app.node.tryGetContext('lambdaCodePath')
let sentryVersion = app.node.tryGetContext('sentryVersion')
if (!lambdaCodePath && fs.existsSync('../libcal-gateway')) {
  lambdaCodePath = '../libcal-gateway/src'
  sentryVersion = execSync(`cd ${lambdaCodePath} && git rev-parse HEAD`)
    .toString()
    .trim()
}

if (lambdaCodePath) {
  const stackName = app.node.tryGetContext('serviceStackName') || `libcal-gateway-${stage}`
  new LibCalGatewayStack(app, stackName, {
    stackName,
    description: `API service that stands between other apps/services and LibCal's APIs.`,
    stage,
    lambdaCodePath,
    sentryProject,
    sentryVersion,
    secretsPath,
  })
}

const pipelineName = app.node.tryGetContext('pipelineStackName') || `libcal-gateway-pipeline`
new LibCalGatewayPipelineStack(app, pipelineName, {
  stackName: pipelineName,
  gitOwner: app.node.tryGetContext('gitOwner'),
  gitTokenPath: app.node.tryGetContext('gitTokenPath'),
  serviceRepository: app.node.tryGetContext('serviceRepository'),
  serviceBranch: app.node.tryGetContext('serviceBranch'),
  blueprintsRepository: app.node.tryGetContext('blueprintsRepository'),
  blueprintsBranch: app.node.tryGetContext('blueprintsBranch'),
  contact: app.node.tryGetContext('contact'),
  owner: app.node.tryGetContext('owner'),
  sentryTokenPath: app.node.tryGetContext('sentryTokenPath'),
  sentryOrg: app.node.tryGetContext('sentryOrg'),
  sentryProject,
  emailReceivers: app.node.tryGetContext('emailReceivers'),
  slackNotifyStackName: app.node.tryGetContext('slackNotifyStackName'),
})
