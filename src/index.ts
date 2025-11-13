import tl = require('azure-pipelines-task-lib/task');
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';
import * as path from 'path';
import * as fs from 'fs';
import * as z from 'zod';
import { error } from 'console';

interface TerraformBackendConfig {
    storage_account_name?: string;
    container_name?: string;
    key?: string;
    resource_group_name?: string;
}

interface TerraformState {
    version?: number;
    terraform_version?: string;
    backend?: {
        type?: string;
        config?: TerraformBackendConfig;
    };
}

const maxWaitTimeSeconds_MIN = 60;
const maxWaitTimeSeconds_MAX = 7200;
const maxWaitTimeSeconds_DEFAULT = '1800';

const pollIntervalSeconds_MIN = 10;
const pollIntervalSeconds_MAX = 300;
const pollIntervalSeconds_DEFAULT = '30';


async function run() {
    try {
        console.log('============  Starting Terraform State Lease Checker Task ============');

        const connectedServiceName = tl.getInputRequired('azureServiceConnection');
        console.log(`azureServiceConnection: ${connectedServiceName}`);

        const servicePrincipalId = tl.getEndpointAuthorizationParameterRequired(
            connectedServiceName,
            'serviceprincipalid'
        );
        console.log(`servicePrincipalId: ${servicePrincipalId}`);

        const servicePrincipalKey = tl.getEndpointAuthorizationParameterRequired(
            connectedServiceName,
            'serviceprincipalkey'
        );
        console.log(`servicePrincipalKey: ${servicePrincipalKey}`);

        // const servicePrincipalSubscriptionId =  tl.getEndpointDataParameterRequired(
        //     connectedServiceName, 'subscriptionid'
        // );

        //     const tenantId = tl.getEndpointAuthorizationParameter(connectedServiceName, 'tenantid', false);
        //     const subscriptionId = tl.getEndpointDataParameter(connectedServiceName, 'subscriptionid', false);

        //     console.log('Azure subscription configured successfully');

        const terraformProjectPath = tl.getInputRequired('terraformProjectPath');
        if (!fs.existsSync(terraformProjectPath)) {
            throw new Error(`Terraform project not found at: ${terraformProjectPath}`);
        }
        console.log(`terraformProjectPath: ${terraformProjectPath}`);

        const terraformDirPath = path.join(terraformProjectPath, '.terraform');
        if (!fs.existsSync(terraformDirPath)) {
            throw new Error(`.terraform directory not found at: ${terraformDirPath}`);
        }
        console.log(`terraformDirPath: ${terraformProjectPath}`);

        const tfStateFilePath = path.join(terraformDirPath, 'terraform.tfstate');
        if (!fs.existsSync(tfStateFilePath)) {
            throw new Error(`Terraform state file not found at: ${tfStateFilePath}`);
        }
        console.log(`tfStateFilePath: ${tfStateFilePath}`);

        const maxWaitTimeSecondsInput = tl.getInput('maxWaitTimeSeconds', false) || maxWaitTimeSeconds_DEFAULT;
        let maxWaitTimeSeconds: number;
        try {
            maxWaitTimeSeconds = z.coerce
                .number()
                .int()
                .positive()
                .max(maxWaitTimeSeconds_MAX)
                .min(maxWaitTimeSeconds_MIN)
                .parse(maxWaitTimeSecondsInput);
        } catch (err: any) {
            throw new Error(
                `For maxWaitTimeSeconds -> ${err.issues[0].message} | maxWaitTimeSeconds must be an integer between ${maxWaitTimeSeconds_MIN} and ${maxWaitTimeSeconds_MAX}.`
            );
        }
        console.log(`maxWaitTimeSeconds: ${maxWaitTimeSeconds}`);

        const pollIntervalSecondsInput = tl.getInput('pollIntervalSeconds', false) || pollIntervalSeconds_DEFAULT;
        let pollIntervalSeconds: number;
        try {
            pollIntervalSeconds = z.coerce
                .number()
                .int()
                .positive()
                .max(pollIntervalSeconds_MAX)
                .min(pollIntervalSeconds_MIN)
                .parse(pollIntervalSecondsInput);
        } catch (err: any) {
            throw new Error(
                `For pollIntervalSeconds -> ${err.issues[0].message} | pollIntervalSeconds must be an integer between ${pollIntervalSeconds_MIN} and ${pollIntervalSeconds_MAX}.`
            );
        }
        console.log(`pollIntervalSeconds: ${pollIntervalSeconds}`);        

        console.log(`Reading Terraform state file from: ${tfStateFilePath}`);
        const tfStateContent = fs.readFileSync(tfStateFilePath, 'utf8');



        let tfState: TerraformState;

        try {
            tfState =  z.object({
                version: z.number(),
                terraform_version: z.string(),
                backend: z.object({
                    type: z.literal('azurerm'),
                    config: z.object({
                        storage_account_name: z.string(),
                        container_name: z.string(),
                        key: z.string(),
                        resource_group_name: z.string()
                    })
                })
            }).parse(JSON.parse(tfStateContent));
        } catch (err: any) {
            if (err instanceof SyntaxError) {
                throw new Error(`Failed to parse Terraform state file as JSON: ${err}`);
            } else if (err instanceof z.ZodError) {
                throw new Error(`Failed to validate Terraform state file: ${err.issues[0].message}`);
            }
            throw err;
        }

        const environmentFilePath = path.join(terraformDirPath, 'environment');
        let currentWorkspace: string | null = null;

        if (fs.existsSync(environmentFilePath)) {
            const workspaceContent = fs.readFileSync(environmentFilePath, 'utf8').trim();
            if (workspaceContent) {
                currentWorkspace = workspaceContent;
                console.log(`Detected Terraform workspace: ${currentWorkspace}`);
            }
        }

        //     if (!currentWorkspace) {
        //         console.log('No workspace detected, using default workspace');
        //     }

        tl.setResult(tl.TaskResult.Succeeded, 'Fake Successful Run');

   

        //     const backendConfig = tfState.backend.config;
        //     if (!backendConfig) {
        //         throw new Error('Backend configuration is missing in Terraform state file');
        //     }

        //     const storageAccountName = backendConfig.storage_account_name;
        //     const containerName = backendConfig.container_name;
        //     let blobName = backendConfig.key;

        //     if (!storageAccountName || !containerName || !blobName) {
        //         throw new Error('Backend configuration is incomplete. Required: storage_account_name, container_name, key');
        //     }

        //     // If a workspace is selected (not default), derive the blob name
        //     if (currentWorkspace && currentWorkspace !== 'default') {
        //         blobName = `${blobName}env:${currentWorkspace}`;

        //         console.log(`Using workspace-specific blob path for workspace '${currentWorkspace}'`);
        //     }

        //     console.log(`Storage Account: ${storageAccountName}`);
        //     console.log(`Container: ${containerName}`);
        //     console.log(`Blob: ${blobName}`);

        //     // Create Azure credential
        //     let credential;
        //     if (servicePrincipalId && servicePrincipalKey && tenantId) {
        //         console.log('Using Service Principal authentication');
        //         credential = new ClientSecretCredential(tenantId, servicePrincipalId, servicePrincipalKey);
        //     } else {
        //         console.log('Using Default Azure Credential');
        //         credential = new DefaultAzureCredential();
        //     }

        //     // Create BlobServiceClient
        //     const blobServiceClient = new BlobServiceClient(
        //         `https://${storageAccountName}.blob.core.windows.net`,
        //         credential
        //     );

        //     const containerClient = blobServiceClient.getContainerClient(containerName);
        //     const blobClient = containerClient.getBlobClient(blobName);

        //     console.log('Checking for lease on Terraform state file...');

        //     // Poll until the blob is not leased
        //     const maxWaitTime = maxWaitTimeSeconds * 1000; // Convert to milliseconds
        //     const pollInterval = pollIntervalSeconds * 1000; // Convert to milliseconds
        //     const startTime = Date.now();

        //     // eslint-disable-next-line
        //     while (true) {
        //         try {
        //             const properties = await blobClient.getProperties();
        //             const leaseState = properties.leaseState;
        //             const leaseStatus = properties.leaseStatus;

        //             console.log(`Lease Status: ${leaseStatus}, Lease State: ${leaseState}`);

        //             if (leaseState === 'available' || leaseStatus === 'unlocked') {
        //                 console.log('✓ Terraform state file is not leased. Proceeding...');
        //                 break;
        //             }

        //             const elapsedTime = Date.now() - startTime;
        //             if (elapsedTime >= maxWaitTime) {
        //                 throw new Error(
        //                     `Timeout: Terraform state file still has a lease after ${maxWaitTimeSeconds} seconds (${Math.round(maxWaitTimeSeconds / 60)} minutes)`
        //                 );
        //             }

        //             const remainingTime = Math.round((maxWaitTime - elapsedTime) / 1000);
        //             console.log(`Terraform state file is currently leased. Waiting... (${remainingTime}s remaining)`);

        //             await new Promise((resolve) => setTimeout(resolve, pollInterval));
        //         } catch (error: any) {
        //             if (error.statusCode === 404) {
        //                 console.log('✓ Terraform state file does not exist yet (no lease). Proceeding...');
        //                 break;
        //             }
        //             throw error;
        //         }
        //     }

        // tl.setResult(tl.TaskResult.Succeeded, 'Terraform state file is available (no lease)');
    } catch (err: any) {
        console.log(err);
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

run();
