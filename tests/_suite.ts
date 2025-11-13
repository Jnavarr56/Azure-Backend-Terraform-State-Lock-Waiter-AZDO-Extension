import * as path from 'path';
import * as assert from 'assert';
import * as ttm from 'azure-pipelines-task-lib/mock-test';
import * as dotenv from 'dotenv';


const TESTS_ROOT_PATH = path.join(__dirname, 'test-cases');
const TASK_JSON_PATH = path.join(__dirname, '..', 'src', 'task.json');

dotenv.config({
    path: path.join(__dirname, '.env'),
});

function getAbsPathToTest(testDirectoryName: string): string {
    return path.join(TESTS_ROOT_PATH, testDirectoryName, 'index.js');
}

function printNonDebugLines(tr: ttm.MockTestRunner): void {
    console.log(tr.stdout.split('\n').filter(l => !l.match(/^##vso(.*)/)).join('\n'), tr.stderr);
}

type AzureRMServiceConnectionVarPrefix =
    | 'TEST_AUTHORIZED_AZURERM_SERVICE_CONNECTION_'
    | 'TEST_UNAUTHORIZED_AZURERM_SERVICE_CONNECTION_';

// https://github.com/microsoft/azure-pipelines-task-lib/issues/291
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

    // process.env["ENDPOINT_AUTH_SCHEME_AzureRMSpn"] = "ServicePrincipal";
    // process.env["ENDPOINT_DATA_AzureRMSpn_ENVIRONMENTAUTHORITYURL"] = "https://login.windows.net/";
    // process.env["ENDPOINT_DATA_AzureRMSpn_ACTIVEDIRECTORYSERVICEENDPOINTRESOURCEID"] = "https://login.windows.net/";
    // process.env["ENDPOINT_DATA_AzureRMSpn_GRAPHURL"] = "https://graph.windows.net/";
    // process.env["ENDPOINT_DATA_AzureRMSpn_AzureKeyVaultServiceEndpointResourceId"] = "https://vault.azure.net";
    // process.env["ENDPOINT_URL_AzureRMSpn"] = "https://management.azure.com/";
}

async function prepareMockTestRunner(testDirectoryName: string): Promise<ttm.MockTestRunner> {
    const testPath = getAbsPathToTest(testDirectoryName);
    const tr: ttm.MockTestRunner = new ttm.MockTestRunner();
    
    await tr.LoadAsync(testPath, TASK_JSON_PATH);
    await tr.runAsync();

    return tr;
}

describe('Terraform State Lease Checker Tests', function () {
    // Set timeout for tests
    this.timeout(10000);

    beforeEach(function () {
        process.env['system.debug'] = 'false';
        loadMockAzureRMServiceConnectionEnvVars('TEST_AUTHORIZED_AZURERM_SERVICE_CONNECTION_');
        // loadMockAzureRMServiceConnectionEnvVars('TEST_UNAUTHORIZED_AZURERM_SERVICE_CONNECTION_');
    });

    it('0: should fail when .terraform directory is missing', async function () {
        const tr = await prepareMockTestRunner('0.no-dot-terraform-directory');
        console.log(`task suceeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('.terraform directory not found at: '),
            true,
            'should throw indicate missing directory'
        );
    });

    it('1: should fail when .terraform directory is missing', async function () {
        const tr = await prepareMockTestRunner('1.no-dot-terraform-tfstate-file');
        console.log(`task suceeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('Terraform state file not found at: '),
            true,
            'should throw indicate missing file'
        );
    });

    it('2: should fail when terraformProjectPath input is to a nonexistent directory', async function () {
        const tr = await prepareMockTestRunner('2.invalid-terraformProjectPath-input-doesnt-exist');
        console.log(`task suceeded: ${tr.succeeded}`);
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
        console.log(`task suceeded: ${tr.succeeded}`);
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
        console.log(`task suceeded: ${tr.succeeded}`);
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
        console.log(`task suceeded: ${tr.succeeded}`);
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
        console.log(`task suceeded: ${tr.succeeded}`);
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
        console.log(`task suceeded: ${tr.succeeded}`);
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
        console.log(`task suceeded: ${tr.succeeded}`);
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
        console.log(`task suceeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('For pollIntervalSeconds -> Too big: expected number to be'),
            true,
            'should throw value above maximum'
        );
    });

    it('11: should fail when terraform.tfstate file is not valid JSON', async function () {
        const tr = await prepareMockTestRunner('11.terraform-tfstate-file-not-valid-json');
        console.log(`task suceeded: ${tr.succeeded}`);
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
        console.log(`task suceeded: ${tr.succeeded}`);
        assert.equal(tr.succeeded, false, 'should have failed');
        assert.equal(tr.errorIssues.length, 1, 'should have 1 error issue');
        assert.equal(
            tr.errorIssues[0].includes('Failed to validate Terraform state file: Invalid input: expected "azurerm"'),
            true,
            'should throw invalid backend type error'
        );
    });

    // it('should handle workspace correctly', function (done: Mocha.Done) {
    //     // Test workspace detection and blob name derivation
    //     assert.ok(true, 'Test placeholder - should handle workspace');
    //     done();
    // });

    // it('should succeed when blob has no lease', function (done: Mocha.Done) {
    //     // Test successful completion when blob is not leased
    //     assert.ok(true, 'Test placeholder - should succeed with unlocked blob');
    //     done();
    // });

    // it('should wait when blob is leased', function (done: Mocha.Done) {
    //     // Test that task waits when blob has a lease
    //     assert.ok(true, 'Test placeholder - should wait for lease release');
    //     done();
    // });

    // it('should timeout when lease is not released within maxWaitTime', function (done: Mocha.Done) {
    //     // Test timeout behavior
    //     assert.ok(true, 'Test placeholder - should timeout appropriately');
    //     done();
    // });

    // it('should succeed when blob does not exist (404)', function (done: Mocha.Done) {
    //     // Test that task succeeds when state file doesn't exist yet
    //     assert.ok(true, 'Test placeholder - should handle non-existent blob');
    //     done();
    // });

    // it('should respect custom pollIntervalSeconds', function (done: Mocha.Done) {
    //     // Test custom poll interval configuration
    //     assert.ok(true, 'Test placeholder - should respect custom poll interval');
    //     done();
    // });
});
