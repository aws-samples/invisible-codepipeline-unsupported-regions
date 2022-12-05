import { Stack, StackProps, aws_kms, aws_s3, aws_events_targets, aws_codecommit, aws_codebuild,aws_iam, aws_codedeploy} from 'aws-cdk-lib';
import { AnyPrincipal, Effect } from 'aws-cdk-lib/aws-iam';

import { Construct } from 'constructs';

export class AppDevPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const kmskey = new aws_kms.Key(this, 'KmsKey', {
      enableKeyRotation: true,
    });



    const codedeployRole = new aws_iam.Role(this, 'CodeDeployRole', {
      assumedBy: new aws_iam.ServicePrincipal('codedeploy.amazonaws.com'),
      roleName: 'CodeDeployRole',
      managedPolicies: [
        aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSCodeDeployRole'),
        aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2RoleforAWSCodeDeploy'),
      ],
    });

    codedeployRole.addToPolicy(
      new aws_iam.PolicyStatement({
        sid: 'KmsAccess',
        actions: [
          'kms:Decrypt',
          'kms:DescribeKey',
          'kms:Encrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
        ],
        resources: [
          kmskey.keyArn
        ],
      }),
    );


 // Codedeploy Applications
 

 const configName = `${this.node.tryGetContext('configName')}`;
 const deploymentGroupName = `${this.node.tryGetContext('deploymentGroupName')}`;
 const applicationName = `${this.node.tryGetContext('applicationName')}`;

  const cfnApplication = new aws_codedeploy.CfnApplication(this, 'ProdtoDevAppDeployment', /* all optional props */ {
    applicationName: applicationName,
  });
 
 //***************************************************/
    // CodeDeploy Config and Deployment Group
 //***************************************************/
 
    const CfnDeploymentConfig = new aws_codedeploy.ServerDeploymentConfig(this, 'DeploymentConfigProdtoDev', {
      deploymentConfigName: configName,
      minimumHealthyHosts: aws_codedeploy.MinimumHealthyHosts.count(0)
      // Please select proper CodeDeploy Deployment Config.
    });
 
//    const configGrpName = 'DeploymentConfigGroupProdtoDev';
    const cfnDeploymentGroup = new aws_codedeploy.CfnDeploymentGroup(this, 'DeploymentGroupProdtoDev', {
      applicationName: applicationName,
      serviceRoleArn: codedeployRole.roleArn,
      autoRollbackConfiguration: {
        enabled: true,
        events: ['DEPLOYMENT_FAILURE', 'DEPLOYMENT_STOP_ON_REQUEST'],
      },         
      deploymentConfigName: configName,
      deploymentGroupName: deploymentGroupName,
      ec2TagFilters: [{
        key: 'Name',
        value: `${this.node.tryGetContext('ec2_tag_key')}`,
        type: 'KEY_AND_VALUE'
      },
     ],
    });
 
    cfnDeploymentGroup.addDependsOn(cfnApplication)
 
 
 //***************************************************/
  // Code Commit Repositories
 //***************************************************/
 
    const repoProdtoDev = new aws_codecommit.Repository(this, 'repoProdtoDev', {
      repositoryName: `${this.node.tryGetContext('repo_name')}`
    });
 
 
    const AccessLogs = new aws_s3.Bucket(this, 'AccessLogsBucket', {
      encryption: aws_s3.BucketEncryption.KMS,
      encryptionKey: kmskey,
      versioned: true,
    });

    const AppCodebucket = new aws_s3.Bucket(this, 'AppCodebucket', {
      encryption: aws_s3.BucketEncryption.KMS,
      encryptionKey: kmskey,
      versioned: true,
      serverAccessLogsBucket: AccessLogs,
      serverAccessLogsPrefix: 'logs',
    });

    let buckets = [AppCodebucket, AccessLogs]
    
    for (var val of buckets) {
      val.addToResourcePolicy(
        new aws_iam.PolicyStatement({
          sid: 'DenyUnsecuredRequests',
          effect: Effect.DENY,
          resources: [`${val.bucketArn}/*`,
          val.bucketArn,],
          actions: ['s3:*'],
          principals: [new AnyPrincipal()],
          conditions: {
            Bool: {
              "aws:SecureTransport": "false"
            }
          }
        }));
  
        val.addToResourcePolicy(
          new aws_iam.PolicyStatement({
            sid: 'DenyIncorrectEncryptionHeader',
            effect: Effect.DENY,
            resources: [`${val.bucketArn}/*`],
            actions: ['s3:PutObject'],
            principals: [new AnyPrincipal()],
            conditions: {
              StringNotEquals: {
                "s3:x-amz-server-side-encryption-aws-kms-key-id": `${kmskey.keyArn}`
              }
            }
          }));
    }



 //***************************************************/   
    // Code Build
 //***************************************************/
 
 const codebuildRole = new aws_iam.Role(this, 'codebuildRole', {
  assumedBy: new aws_iam.ServicePrincipal('codebuild.amazonaws.com'),
  roleName: 'codebuildRole',
});

    const projectProdtoDev = new aws_codebuild.Project(this, 'CodeBuildProject', {
      source: aws_codebuild.Source.codeCommit({ repository: repoProdtoDev }),
      role: codebuildRole,
      projectName:  `${this.node.tryGetContext('projectName')}`,
      encryptionKey: kmskey,
      environment: {
        computeType: aws_codebuild.ComputeType.SMALL,
        buildImage: aws_codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
        privileged: true,
        environmentVariables: {
          'S3_REGION': {
            value: `${this.region}`
          },
          'S3_BUCKET': {
            value: `${AppCodebucket.bucketName}`
          },      
          'APP_REPO': {
            value: `${repoProdtoDev.repositoryName}`
          },   
          'configName': {
            value: `${this.node.tryGetContext('configName')}`
          },
          'deploymentGroupName': {
            value: `${this.node.tryGetContext('deploymentGroupName')}`
          },      
          'applicationName': {
            value: `${this.node.tryGetContext('applicationName')}`
          },            
        },
    },      
      buildSpec: aws_codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            commands: [
                'export Region=$AWS_REGION',  
                'npm install -g aws-cli'
            ]
          },       
          pre_build: {
            commands: [
              'env',
              'AppDepDate=`date +%Y-%m-%d-%H-%M-%S`',
              'WorkDirectory=`date +%Y-%m-%d`',
              'mkdir ${WorkDirectory} && aws s3 cp s3://${S3_BUCKET}/ ./ --recursive --region ${S3_REGION}',
              'git config --global credential.helper "!aws codecommit credential-helper $@"',
              'git config --global credential.UseHttpPath true',
              'git clone https://git-codecommit.${S3_REGION}.amazonaws.com/v1/repos/${APP_REPO}',
              "mv ${APP_REPO}/*.* ${WorkDirectory}/",
              'cd ${WorkDirectory}/ && tar -cvzf App.tgz *',
              'aws s3 cp App.tgz s3://${S3_BUCKET}/AppApp_${AppDepDate}.tgz',
              //'aws s3 rm s3://${S3_BUCKET}/${APP_RELEASE}', //optional
 
            ]
          },             
          build: {
            commands: [
              'env',
              'aws deploy create-deployment \
              --application-name ${applicationName} \
              --deployment-config-name ${configName} \
              --deployment-group-name ${deploymentGroupName} \
              --ignore-application-stop-failures \
              --file-exists-behavior OVERWRITE --s3-location bucket=${S3_BUCKET},bundleType=tgz,key=AppApp_${AppDepDate}.tgz',
            ]
          },
          post_build: {
            commands: [
              'bash -c "if [ /"$CODEBUILD_BUILD_SUCCEEDING/" == /"0/" ]; then exit 1; fi"',
              'echo Build completed on `date`',
              // optional
 
             ''
            ]
          }
        },
      })      
    });
    
 
    AppCodebucket.addToResourcePolicy(
      new aws_iam.PolicyStatement({
        sid: 'DenyUnsecuredRequests',
        effect: Effect.ALLOW,
        resources: [`${AppCodebucket.bucketArn}/*`,
        AppCodebucket.bucketArn,],
        actions: [ "s3:GetObject", "s3:List*", "s3:PutObject", "s3:PutObjectACL" ],
        principals: [codebuildRole],
      }));    

   codebuildRole.addManagedPolicy(aws_iam.ManagedPolicy.fromAwsManagedPolicyName("AWSCodeDeployDeployerAccess"));
   codebuildRole.addManagedPolicy(aws_iam.ManagedPolicy.fromAwsManagedPolicyName("AWSCodeBuildReadOnlyAccess"));
   codebuildRole.addToPrincipalPolicy(
    new aws_iam.PolicyStatement({
      sid: 'KmsAccess',
      actions: [
        'kms:Decrypt',
        'kms:DescribeKey',
        'kms:Encrypt',
        'kms:ReEncrypt*',
        'kms:GenerateDataKey*',
      ],
      resources: [
        kmskey.keyArn
      ],
    }),
  );

  codebuildRole.addToPrincipalPolicy(
    new aws_iam.PolicyStatement({
      sid: 'S3Access',
      actions: [
        "s3:GetObject",
        "s3:List*",
        "s3:PutObject",
        "s3:PutObjectACL",
        "s3:CreateBucket",
      ],
      resources: [
        AppCodebucket.bucketArn
      ],
    }),
  );


    const onCommitRule = repoProdtoDev.onCommit('OnCommit', {
      target: new aws_events_targets.CodeBuildProject(projectProdtoDev, {
      }),
      branches: ['main'],
    });
  }
}
