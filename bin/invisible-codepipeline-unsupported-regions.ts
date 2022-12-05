#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';

import { AppDevPipelineStack } from '../lib/invisible-codepipeline-unsupported-regions-stack';



const app = new cdk.App();
const pipelineAccount = app.node.tryGetContext('pipeline_account');
const pipelineRegion = app.node.tryGetContext('pipeline_region');


new AppDevPipelineStack(app, 'AppDevPipelineStack', {
env: { account: pipelineAccount, region: pipelineRegion },
});

