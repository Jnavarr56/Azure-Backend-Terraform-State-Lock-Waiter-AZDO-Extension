import * as ma from 'azure-pipelines-task-lib/mock-answer';
import * as tmrm from 'azure-pipelines-task-lib/mock-run';
import * as path from 'path';

const taskPath = path.join(__dirname, '..', 'src', 'index.js');
const tmr: tmrm.TaskMockRunner = new tmrm.TaskMockRunner(taskPath);

// Set inputs - missing required input
tmr.setInput('azureSubscription', '');

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

// Run the task - should fail
tmr.run();
