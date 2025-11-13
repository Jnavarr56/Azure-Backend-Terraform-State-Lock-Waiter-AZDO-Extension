import * as ma from 'azure-pipelines-task-lib/mock-answer';
import * as tmrm from 'azure-pipelines-task-lib/mock-run';
import * as path from 'path';

const taskPath = path.join(__dirname, '..', 'src', 'index.js');
const tmr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(taskPath);

// Set inputs
tmr.setInput('azureSubscription', 'test-subscription');
tmr.setInput('terraformProjectPath', '/test/path');
tmr.setInput('maxWaitTimeSeconds', '1800');
tmr.setInput('pollIntervalSeconds', '10');

// Mock answers
const a: ma.TaskLibAnswers = {
    which: {
        node: '/usr/bin/node',
    },
    checkPath: {
        '/usr/bin/node': true,
    },
};
tmr.setAnswers(a);

// Mock endpoint authorization
process.env['ENDPOINT_AUTH_test-subscription'] = JSON.stringify({
    parameters: {
        serviceprincipalid: 'test-sp-id',
        serviceprincipalkey: 'test-sp-key',
        tenantid: 'test-tenant-id',
    },
    scheme: 'ServicePrincipal',
});

process.env['ENDPOINT_DATA_test-subscription'] = JSON.stringify({
    subscriptionid: 'test-subscription-id',
});

// Run the task
tmr.run();
