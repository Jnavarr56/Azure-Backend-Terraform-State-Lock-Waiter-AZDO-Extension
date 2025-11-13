import * as mr from 'azure-pipelines-task-lib/mock-run';
import * as path from 'path';

const taskPath = path.join(__dirname, '..', '..', '..', 'src', 'index.js');
const runner: mr.TaskMockRunner = new mr.TaskMockRunner(taskPath);

runner.setInput('azureServiceConnection', process.env['TEST_UNAUTHORIZED_AZURERM_SERVICE_CONNECTION_NAME'] as string);
runner.setInput('terraformProjectPath', path.resolve(__dirname));


runner.run();
