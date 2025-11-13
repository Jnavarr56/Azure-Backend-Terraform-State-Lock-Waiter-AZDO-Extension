# Test Configuration for Mocha

This directory contains the test suite for the Terraform State Lease Checker extension.

## Test Structure

- **`_suite.ts`** - Main test suite with all test cases
- **`success.ts`** - Mock test runner setup for successful scenarios
- **`failure.ts`** - Mock test runner setup for failure scenarios

## Running Tests

Install dependencies first:

```bash
npm install
```

Run all tests:

```bash
npm test
```

The test command will:

1. Compile TypeScript (`pretest` script runs `tsc`)
2. Run Mocha tests against the compiled JavaScript

## Test Framework

- **Mocha** - Test framework
- **Azure Pipelines Task Lib** - Provides mock testing utilities
- **Sinon** - Mocking and stubbing library
- **Assert** - Node.js assertion library

## Writing Tests

Tests use the Azure Pipelines Task Library mock-test utilities to simulate task execution in a controlled environment. Each test case should:

1. Set up mock inputs and environment variables
2. Create a MockTestRunner instance
3. Run the task
4. Assert expected outcomes

## Current Test Coverage

The test suite includes placeholder tests for:

- Valid inputs and successful execution
- Missing state file handling
- Backend type validation
- Workspace detection and blob name derivation
- Custom timeout and poll interval configuration (60-7200s for maxWaitTimeSeconds, 5-300s for pollIntervalSeconds)
- Input validation (azureServiceConnection and terraformProjectPath are required)
- Lease status checking
- Timeout behavior
- Non-existent blob handling

These are currently placeholder tests that need to be implemented with actual mock data and assertions.

## Input Parameters Tested

- **azureServiceConnection** (required): Azure RM Service Connection
- **terraformProjectPath** (required): Path to Terraform project root
- **maxWaitTimeSeconds** (optional): Max wait time in seconds (default: 1800, min: 60, max: 7200)
- **pollIntervalSeconds** (optional): Poll interval in seconds (default: 10, min: 5, max: 300)
