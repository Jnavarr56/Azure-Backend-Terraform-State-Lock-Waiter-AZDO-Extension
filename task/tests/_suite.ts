import * as path from 'path';
import * as assert from 'assert';
import * as ttm from 'azure-pipelines-task-lib/mock-test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

import { ClientSecretCredential } from '@azure/identity';
import { BlobLeaseClient, BlobServiceClient, RestError } from '@azure/storage-blob';
import { blob } from 'stream/consumers';

const TEST_CASES_ROOT_PATH = path.join(__dirname, 'test-cases');
const TASK_JSON_PATH = path.join(__dirname, '..', 'task.json');

function minutesMs(numMinutes: number): number {
    return numMinutes * 60 * 1000;
}

dotenv.config({
    path: path.join(__dirname, '.env'),
});

function getAbsPathToTest(testDirectoryName: string): string {
    return path.join(TEST_CASES_ROOT_PATH, testDirectoryName, 'index.js');
}

function printNonDebugLines(tr: ttm.MockTestRunner, testCaseName?: string): void {
    if (testCaseName) {
        const barLength = '============  Starting Terraform State Lease Checker Task ============'.length;
        const halfBarLength = Math.floor(barLength / 2);

        const testCaseHeaderCenterText = ` ${testCaseName} `;
        const testCaseHeaderCenterTextLength = testCaseHeaderCenterText.length;

        let testCaseHeaderPaddingLength: number;

        if (halfBarLength > testCaseHeaderCenterTextLength) {
            testCaseHeaderPaddingLength = halfBarLength - testCaseHeaderCenterTextLength;
        } else {
            testCaseHeaderPaddingLength = 0;
        }

        console.log('='.repeat(barLength));
        console.log(
            `${'='.repeat(testCaseHeaderPaddingLength)}${testCaseHeaderCenterText}${'='.repeat(testCaseHeaderPaddingLength)}`
        );
    }

    console.log(
        tr.stdout
            .split('\n')
            .filter((l) => !l.match(/^##vso(.*)/))
            .map((l) => `   ${l}`.replace(/servicePrincipalKey: \S+/g, 'servicePrincipalKey: ********'))
            .join('\n'),
        tr.stderr
    );
}

type AzureRMServiceConnectionVarPrefix =
    | 'TEST_AUTHORIZED_AZURERM_SERVICE_CONNECTION_'
    | 'TEST_UNAUTHORIZED_AZURERM_SERVICE_CONNECTION_';

//https://github.com/microsoft/azure-pipelines-task-lib/issues/291
function loadMockAzureRMServiceConnectionEnvVars(dotEnvVarNamePrefix: AzureRMServiceConnectionVarPrefix): void {
    const serviceConnectionName = process.env[`${dotEnvVarNamePrefix}NAME`];

    const mockedEndpointAuthParameterEnvVarNamePrefix = `ENDPOINT_AUTH_PARAMETER_${serviceConnectionName}_`;
    ['SERVICE_PRINCIPAL_ID', 'SERVICE_PRINCIPAL_KEY', 'TENANT_ID'].forEach((dotEnvVarNameSuffix) => {
        const dotEnvVarName = `${dotEnvVarNamePrefix}${dotEnvVarNameSuffix}`;
        const mockedEndpointAuthParameterEnvVarNameSuffix = dotEnvVarNameSuffix.replace(/_/g, '').toLowerCase();
        const mockedEndpointAuthParameterEnvVarName = `${mockedEndpointAuthParameterEnvVarNamePrefix}${mockedEndpointAuthParameterEnvVarNameSuffix}`;
        process.env[mockedEndpointAuthParameterEnvVarName] = process.env[dotEnvVarName];
    });

    const mockedEndpointDataEnvVarNamePrefix = `ENDPOINT_DATA_${serviceConnectionName}_`;
    ['SUBSCRIPTION_NAME', 'SUBSCRIPTION_ID', 'SPN_OBJECT_ID'].forEach((dotEnvVarNameSuffix) => {
        const dotEnvVarName = `${dotEnvVarNamePrefix}${dotEnvVarNameSuffix}`;
        const mockedEndpointDataEnvVarNameSuffix = dotEnvVarNameSuffix.replace(/_/g, '').toUpperCase();
        const mockedEndpointDataEnvVarName = `${mockedEndpointDataEnvVarNamePrefix}${mockedEndpointDataEnvVarNameSuffix}`;
        process.env[mockedEndpointDataEnvVarName] = process.env[dotEnvVarName];
    });
}

async function prepareMockTestRunner(testDirectoryName: string): Promise<ttm.MockTestRunner> {
    const testPath = getAbsPathToTest(testDirectoryName);

    const tr: ttm.MockTestRunner = await new ttm.MockTestRunner().LoadAsync(testPath, TASK_JSON_PATH);
    await tr.runAsync();

    return tr;
}

interface TerraformBackendConfig {
    storage_account_name: string;
    container_name: string;
    key: string;
    resource_group_name: string;
}

interface TerraformState {
    version?: number;
    terraform_version?: string;
    backend: {
        type: string;
        config: TerraformBackendConfig;
    };
}

async function resetSimulateRemoteStateFileLease(
    testCaseDirName: string
): Promise<{ blobLeaseClient: BlobLeaseClient; blobName: string; containerName: string; storageAccountName: string }> {
    const servicePrincipalId = process.env['TEST_AUTHORIZED_AZURERM_SERVICE_CONNECTION_SERVICE_PRINCIPAL_ID']!;
    const servicePrincipalKey = process.env['TEST_AUTHORIZED_AZURERM_SERVICE_CONNECTION_SERVICE_PRINCIPAL_KEY']!;
    const tenantId = process.env['TEST_AUTHORIZED_AZURERM_SERVICE_CONNECTION_TENANT_ID']!;
    const credential = new ClientSecretCredential(tenantId, servicePrincipalId, servicePrincipalKey);

    const localTfStateFilePath = path.join(TEST_CASES_ROOT_PATH, testCaseDirName, '.terraform', 'terraform.tfstate');
    const localEnvironmentFilePath = path.join(TEST_CASES_ROOT_PATH, testCaseDirName, '.terraform', 'environment');

    const tfStateContent = fs.readFileSync(localTfStateFilePath, 'utf8');
    const tfState: TerraformState = JSON.parse(tfStateContent);

    const storageAccountName = tfState.backend.config.storage_account_name;
    const containerName = tfState.backend.config.container_name;
    let blobName = tfState.backend.config.key;

    if (fs.existsSync(localEnvironmentFilePath)) {
        const environmentName = fs.readFileSync(localEnvironmentFilePath, 'utf8').trim();
        blobName += `env:${environmentName}`;
    }

    const blobServiceClient = new BlobServiceClient(`https://${storageAccountName}.blob.core.windows.net`, credential);

    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(blobName);

    const properties = await blobClient.getProperties();
    const leaseState = properties.leaseState;
    const leaseStatus = properties.leaseStatus;

    const blobLeaseClient = blobClient.getBlobLeaseClient();

    console.group(leaseState, leaseStatus);

    if (
        leaseState === 'broken' ||
        !(leaseState === 'available' || leaseState === 'expired' || leaseStatus === 'unlocked')
    ) {
        await blobLeaseClient.breakLease(0);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        await blobLeaseClient.acquireLease(-1);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        await blobLeaseClient.releaseLease();

        console.log('-- removed existing lease on blob');
    }

    return { blobLeaseClient, blobName, containerName, storageAccountName };
}

async function simulateRemoteStateFileLeaseAcquisition(testCaseDirName: string, seconds: number): Promise<void> {
    const { blobLeaseClient, blobName, containerName, storageAccountName } =
        await resetSimulateRemoteStateFileLease(testCaseDirName);
    console.log(
        `-- simulating lease acquisition for ${blobName} in container ${containerName} in storage account ${storageAccountName} for ${seconds} seconds`
    );
    let lease;
    if (seconds > 60) {
        lease = await blobLeaseClient.acquireLease(-1);

        setTimeout(async () => {
            await blobLeaseClient.releaseLease();
            console.log('-- released simulated lease');
        }, seconds * 1000);
    } else {
        lease = await blobLeaseClient.acquireLease(seconds);
    }

    console.log('-- lease info:');
    console.log(lease);
}

async function executeSuccessfulNoLeaseTestRun(
    testCaseDirName: string,
    printTaskOutput: boolean = false,
    testName?: string
): Promise<void> {
    await resetSimulateRemoteStateFileLease(testCaseDirName);

    const tr = await prepareMockTestRunner(testCaseDirName);

    if (printTaskOutput) {
        printNonDebugLines(tr, testName);
    }

    console.log(`-- task succeeded: ${tr.succeeded}`);

    assert.equal(tr.succeeded, true, 'should have succeeded');
    const workspaceDetectionLogMatch = tr.stdout.match(/(?<=Detected Terraform workspace: ).*/im);
    if (workspaceDetectionLogMatch) {
        const detectedWorkspaceName = workspaceDetectionLogMatch[0].trim();
        assert.equal(
            tr.stdout.includes(`Detected Terraform workspace: ${detectedWorkspaceName}`),
            true,
            'should have detected workspace'
        );

        assert.equal(
            !!tr.stdout.match(
                new RegExp(
                    `Using workspace-specific blob path for workspace '${detectedWorkspaceName}': .*:${detectedWorkspaceName}`,
                    'mi'
                )
            ),
            true,
            'should have detected workspace and targeted workspace-specific blob path'
        );
    }
    assert.equal(
        tr.stdout.includes('Lease Status: unlocked, Lease State: available') ||
            tr.stdout.includes('Lease Status: unlocked, Lease State: expired') ||
            tr.stdout.includes('Lease Status: unlocked, Lease State: broken'),
        true,
        'should indicate lease status unlocked'
    );
    assert.equal(
        tr.stdout.includes('✓ Terraform state file is not leased. Proceeding...'),
        true,
        'should indicate proceeding after no active lease detected'
    );

    if (!tr.succeeded) {
        console.log(tr.stderr);
        console.log(tr.errorIssues);
        tr.errorIssues.forEach((issue) => {
            console.log(issue);
        });
    }
}

async function executeSuccessfulActiveLeaseTestRun(
    testCaseDirName: string,
    leaseDurationSeconds: number,
    printTaskOutput: boolean = false,
    testName?: string
): Promise<void> {
    await simulateRemoteStateFileLeaseAcquisition(testCaseDirName, leaseDurationSeconds);
    const tr = await prepareMockTestRunner(testCaseDirName);

    if (printTaskOutput) {
        printNonDebugLines(tr, testName);
    }

    console.log(`-- task succeeded: ${tr.succeeded}`);

    assert.equal(tr.succeeded, true, 'should have succeeded');
    const workspaceDetectionLogMatch = tr.stdout.match(/(?<=Detected Terraform workspace: ).*/im);
    if (workspaceDetectionLogMatch) {
        const detectedWorkspaceName = workspaceDetectionLogMatch[0].trim();
        assert.equal(
            tr.stdout.includes(`Detected Terraform workspace: ${detectedWorkspaceName}`),
            true,
            'should have detected workspace'
        );

        assert.equal(
            !!tr.stdout.match(
                new RegExp(
                    `Using workspace-specific blob path for workspace '${detectedWorkspaceName}': .*:${detectedWorkspaceName}`,
                    'mi'
                )
            ),
            true,
            'should have detected workspace and targeted workspace-specific blob path'
        );
    }
    assert.equal(
        tr.stdout.includes('Terraform state file is currently leased. Waiting...'),
        true,
        'should indicate waiting due to existing lease'
    );
    assert.equal(
        tr.stdout.includes('Lease Status: locked') && tr.stdout.includes('Lease Status: unlocked'),
        true,
        'should indicate lease state "expired" or "available"'
    );
    assert.equal(
        tr.stdout.includes('✓ Terraform state file is not leased. Proceeding...'),
        true,
        'should indicate proceeding after no active lease detected'
    );

    if (!tr.succeeded) {
        console.log(tr.stderr);
        console.log(tr.errorIssues);
        tr.errorIssues.forEach((issue) => {
            console.log(issue);
        });
    }
}

describe('Azure Backend Terraform State Lock Waiter Tests', function () {
    this.timeout(10000);

    beforeEach(function () {
        process.env['system.debug'] = 'true';
        loadMockAzureRMServiceConnectionEnvVars('TEST_AUTHORIZED_AZURERM_SERVICE_CONNECTION_');
        loadMockAzureRMServiceConnectionEnvVars('TEST_UNAUTHORIZED_AZURERM_SERVICE_CONNECTION_');
    });

    it('0: should fail when .terraform directory is missing', async function () {
        const tr = await prepareMockTestRunner('0.no-dot-terraform-directory');
        printNonDebugLines(tr, this.test?.title);
        console.log(`-- task succeeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('.terraform directory not found at: '),
            true,
            'should throw indicate missing directory'
        );
    });

    it('1: should fail when .terraform state file is missing', async function () {
        const tr = await prepareMockTestRunner('1.no-dot-terraform-tfstate-file');
        printNonDebugLines(tr, this.test?.title);
        console.log(`-- task succeeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('Terraform state file not found at:'),
            true,
            'should throw indicate missing file'
        );
    });

    it('2: should fail when terraformProjectPath input is to a nonexistent directory', async function () {
        const tr = await prepareMockTestRunner('2.invalid-terraformProjectPath-input-doesnt-exist');
        printNonDebugLines(tr, this.test?.title);
        console.log(`-- task succeeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('Terraform project not found at: '),
            true,
            'should throw indicate invalid path'
        );
    });

    it('3: should fail when maxWaitTimeSeconds input is not an integer', async function () {
        const tr = await prepareMockTestRunner('3.invalid-maxWaitTimeSeconds-input-not-an-integer');
        printNonDebugLines(tr, this.test?.title);
        console.log(`-- task succeeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('For maxWaitTimeSeconds -> Invalid input: expected number, received NaN'),
            true,
            'should throw indicate not an integer'
        );
    });

    it('4: should fail when maxWaitTimeSeconds input is below minimum', async function () {
        const tr = await prepareMockTestRunner('4.invalid-maxWaitTimeSeconds-input-below-minimum');
        printNonDebugLines(tr, this.test?.title);
        console.log(`-- task succeeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('For maxWaitTimeSeconds -> Too small: expected number to be'),
            true,
            'should throw value below minimum'
        );
    });

    it('5: should fail when maxWaitTimeSeconds input is above maximum', async function () {
        const tr = await prepareMockTestRunner('5.invalid-maxWaitTimeSeconds-input-above-maximum');
        printNonDebugLines(tr, this.test?.title);
        console.log(`-- task succeeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('For maxWaitTimeSeconds -> Too big: expected number to be'),
            true,
            'should throw value above maximum'
        );
    });

    it('6: should fail when maxWaitTimeSeconds input is negative', async function () {
        const tr = await prepareMockTestRunner('6.invalid-maxWaitTimeSeconds-input-negative');
        printNonDebugLines(tr, this.test?.title);
        console.log(`-- task succeeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('For maxWaitTimeSeconds -> Too small: expected number to be'),
            true,
            'should throw value is negative'
        );
    });

    it('7: should fail when pollIntervalSeconds input is not an integer', async function () {
        const tr = await prepareMockTestRunner('7.invalid-pollIntervalSeconds-input-not-an-integer');
        printNonDebugLines(tr, this.test?.title);
        console.log(`-- task succeeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('For pollIntervalSeconds -> Invalid input: expected number, received NaN'),
            true,
            'should throw indicate not an integer'
        );
    });

    it('8: should fail when pollIntervalSeconds input is below minimum', async function () {
        const tr = await prepareMockTestRunner('8.invalid-pollIntervalSeconds-input-below-minimum');
        printNonDebugLines(tr, this.test?.title);
        console.log(`-- task succeeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('For pollIntervalSeconds -> Too small: expected number to be'),
            true,
            'should throw value below minimum'
        );
    });

    it('9: should fail when pollIntervalSeconds input is above maximum', async function () {
        const tr = await prepareMockTestRunner('9.invalid-pollIntervalSeconds-input-above-maximum');
        printNonDebugLines(tr, this.test?.title);
        console.log(`-- task succeeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('For pollIntervalSeconds -> Too big: expected number to be'),
            true,
            'should throw value above maximum'
        );
    });

    it('11: should fail when terraform.tfstate file is not valid JSON', async function () {
        const tr = await prepareMockTestRunner('11.invalid-terraform-tfstate-file-json');
        printNonDebugLines(tr, this.test?.title);
        console.log(`-- task succeeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('Failed to parse Terraform state file as JSON'),
            true,
            'should throw JSON parse error'
        );
    });

    it('12: should fail when terraform.tfstate file is not azurerm backend', async function () {
        const tr = await prepareMockTestRunner('12.terraform-tfstate-file-not-azurerm-backend');
        printNonDebugLines(tr, this.test?.title);
        console.log(`-- task succeeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('Failed to validate Terraform state file: Invalid input: expected "azurerm"'),
            true,
            'should throw invalid backend type error'
        );
    });

    it('13: [no workspaces] should succeed when remote terraform.tfstate file has no lock (blob lease) ', async function () {
        const TEST_CASE_TIMEOUT_MS = minutesMs(1.5);

        const TEST_CASE_DIR_NAME = '13.without-workspaces-terraform-tfstate-file-no-lease';
        const PRINT_TASK_OUTPUT = true;

        this.timeout(TEST_CASE_TIMEOUT_MS);

        await executeSuccessfulNoLeaseTestRun(TEST_CASE_DIR_NAME, PRINT_TASK_OUTPUT, this.test?.title);
    });

    it('14: [no workspaces] should succeed when remote terraform.tfstate file has a lock (blob lease)', async function () {
        const TEST_CASE_TIMEOUT_MS = minutesMs(1.5);
        const TEST_CASE_DIR_NAME = '14.without-workspaces-terraform-tfstate-file-has-lease';
        const PRINT_TASK_OUTPUT = true;

        this.timeout(TEST_CASE_TIMEOUT_MS);

        await executeSuccessfulActiveLeaseTestRun(TEST_CASE_DIR_NAME, 30, PRINT_TASK_OUTPUT, this.test?.title);
    });

    it('15: [workspaces] should succeed when remote terraform.tfstate file has no lock (blob lease) ', async function () {
        const TEST_CASE_TIMEOUT_MS = minutesMs(1.5);
        const TEST_CASE_DIR_NAME = '15.with-workspaces-terraform-tfstate-file-no-lease';
        const PRINT_TASK_OUTPUT = true;

        this.timeout(TEST_CASE_TIMEOUT_MS);

        await executeSuccessfulNoLeaseTestRun(TEST_CASE_DIR_NAME, PRINT_TASK_OUTPUT, this.test?.title);
    });

    it('16: [workspaces] should succeed when remote terraform.tfstate file has a lock (blob lease)', async function () {
        const TEST_CASE_TIMEOUT_MS = minutesMs(5);
        const TEST_CASE_DIR_NAME = '16.with-workspaces-terraform-tfstate-file-has-lease';
        const PRINT_TASK_OUTPUT = true;

        this.timeout(TEST_CASE_TIMEOUT_MS);

        await executeSuccessfulActiveLeaseTestRun(TEST_CASE_DIR_NAME, 30, PRINT_TASK_OUTPUT, this.test?.title);
    });

    it('17: [no workspaces] should fail when terraform backend storage account does not exist', async function () {
        this.timeout(minutesMs(2));

        const tr = await prepareMockTestRunner(
            '17.without-workspaces-terraform-tfstate-file-nonexistent-storage-account'
        );
        printNonDebugLines(tr, this.test?.title);

        console.log(`-- task succeeded: ${tr.succeeded}`);

        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            !!tr.errorIssues[0].match(
                /Failed to access storage account '.*'\. Please ensure the storage account exists and the supplied service connection has the permissions to access the blob: '.*'/im
            ),
            true,
            'should indicate storage account does not exist'
        );
    });

    it('18: [no workspaces] should fail when terraform backend container does not exist', async function () {
        this.timeout(minutesMs(2));

        const tr = await prepareMockTestRunner('18.without-workspaces-terraform-tfstate-file-nonexistent-container');
        printNonDebugLines(tr, this.test?.title);

        console.log(`-- task succeeded: ${tr.succeeded}`);

        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            !!tr.errorIssues[0].match(/Container '.*' does not exist in storage account '.*'/im),
            true,
            'should indicate container does not exist'
        );
    });

    it('19: [no workspaces] should fail when terraform backend state blob does not exist', async function () {
        this.timeout(minutesMs(2));

        const tr = await prepareMockTestRunner('19.without-workspaces-terraform-tfstate-file-nonexistent-blob');
        printNonDebugLines(tr, this.test?.title);

        console.log(`-- task succeeded: ${tr.succeeded}`);

        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            !!tr.errorIssues[0].match(/Blob '.*' does not exist in container '.*' in storage account '.*'/im),
            true,
            'should indicate blob does not exist'
        );
    });

    it('20: [no workspaces] should fail when the max wait time is exceeded', async function () {
        const TEST_CASE_DIR_NAME = '21.without-workspaces-maxWaitTimeSeconds-exceeded';
        const TEST_CASE_TIMEOUT_MS = minutesMs(5);
        const PRINT_TASK_OUTPUT = true;
        const LEASE_DURATION_SECONDS = 100;

        this.timeout(TEST_CASE_TIMEOUT_MS);

        await simulateRemoteStateFileLeaseAcquisition(TEST_CASE_DIR_NAME, LEASE_DURATION_SECONDS);

        const tr = await prepareMockTestRunner(TEST_CASE_DIR_NAME);

        if (PRINT_TASK_OUTPUT) {
            printNonDebugLines(tr, this.test?.title);
        }

        console.log(`-- task succeeded: ${tr.succeeded}`);

        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');

        assert.equal(
            tr.stdout.includes('Terraform state file is currently leased. Waiting...') &&
                tr.stdout.includes('Lease Status: locked, Lease State: leased'),
            true,
            'should indicate task was waiting for lease to be released'
        );
        assert.equal(
            tr.errorIssues[0].includes('Timeout: Terraform state file still has a lease after 60 seconds'),
            true,
            'should indicate max wait time exceeded'
        );

        await new Promise((resolve) => setTimeout(resolve, (LEASE_DURATION_SECONDS - 60 + 5) * 1000));
    });
});
