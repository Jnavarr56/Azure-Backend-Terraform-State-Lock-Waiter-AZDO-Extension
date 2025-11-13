# Terraform State Lease Checker - Azure DevOps Extension

[![Build Status](https://dev.azure.com/pli-dev/DevOps/_apis/build/status%2FJnavarr56.Azure-Backend-Terraform-State-Lock-Waiter-AZDO-Extension?branchName=main)](https://dev.azure.com/pli-dev/DevOps/_build/latest?definitionId=669&branchName=main)

This Azure DevOps custom task extension checks if a Terraform state file stored in Azure Storage has a lease on it and waits until the lease is released.

## Features

- Accepts optional Terraform project path input
- Reads Terraform backend configuration from `.terraform/terraform.tfstate` file
- Detects Terraform workspace from `.terraform/environment` file
- Automatically derives workspace-specific blob name for non-default workspaces
- Connects to Azure Storage using Azure RM service connection
- Polls the state file blob to check lease status
- Waits until the lease is released (with configurable timeout)
- Supports both leased and non-existent state files

## Prerequisites

- Node.js (v16 or higher)
- Azure DevOps account
- Azure subscription with Storage Account containing Terraform state

## Building the Extension

1. Install dependencies:

    ```bash
    npm install
    ```

2. Format code (optional):

    ```bash
    npm run format
    ```

3. Lint code (optional):

    ```bash
    npm run lint
    ```

4. Compile TypeScript:

    ```bash
    npm run build
    ```

5. Package the extension:
    ```bash
    npm run package
    ```

## Development Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run lint` - Run ESLint to check for code issues
- `npm run lint:fix` - Run ESLint and automatically fix issues
- `npm run format` - Format all TypeScript, JSON, and Markdown files with Prettier
- `npm run format:check` - Check if files are formatted correctly without modifying them
- `npm test` - Run the test suite with Mocha
- `npm run package` - Create the extension package (.vsix file)

## Testing

The project includes a test suite using Mocha. Tests are located in the `tests/` directory.

To run tests:

```bash
npm test
```

The test suite includes:

- Input validation tests
- Terraform state file reading tests
- Workspace detection tests
- Azure Storage blob lease checking tests
- Timeout and polling configuration tests

See `tests/README.md` for more details on the test structure.

## Configuration

Before packaging, update the following in `vss-extension.json`:

- `publisher`: Your Azure DevOps publisher ID
- `id`: Unique extension ID
- `name`: Extension name

Update the `id` in `buildAndReleaseTask/task.json` with a unique GUID.

## Usage

1. Add the task to your Azure DevOps pipeline
2. Configure the Azure RM service connection
3. (Optional) Specify the Terraform project path, or leave empty to use the default working directory
4. (Optional) Configure maximum wait time and poll interval
5. Ensure `.terraform/terraform.tfstate` file exists in the project directory with azurerm backend configuration

The task will:

- Read the backend configuration from the state file
- Check for a workspace in `.terraform/environment`
- Derive the correct blob name based on the workspace (if applicable)
- Connect to the Azure Storage Account
- Poll at the specified interval (default 10 seconds) for up to the maximum wait time (default 30 minutes)
- Succeed when the lease is released or file doesn't exist
- Fail if timeout is reached

## Terraform Workspace Support

The extension automatically detects the current Terraform workspace by reading the `.terraform/environment` file:

- **Default workspace**: Uses the blob name from backend configuration as-is
- **Named workspace**: Constructs the blob path as `env:/{workspace}/{key}`

For example, if your backend key is `terraform.tfstate` and you're in workspace `dev`, the extension will look for `env:/dev/terraform.tfstate`.

## Terraform Backend Configuration

Your `.terraform/terraform.tfstate` should contain:

```json
{
    "backend": {
        "type": "azurerm",
        "config": {
            "storage_account_name": "mystorageaccount",
            "container_name": "tfstate",
            "key": "terraform.tfstate"
        }
    }
}
```

## Pipeline Example

```yaml
steps:
    - task: TerraformStateLeaseChecker@1
      displayName: 'Wait for Terraform State Lease'
      inputs:
          azureSubscription: 'My Azure Subscription'
          terraformProjectPath: '$(System.DefaultWorkingDirectory)/infrastructure'
          maxWaitTimeSeconds: '1800' # 30 minutes (default)
          pollIntervalSeconds: '10' # 10 seconds (default)
```

### Input Parameters

| Parameter              | Type                     | Required | Default                        | Description                                                                      |
| ---------------------- | ------------------------ | -------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `azureSubscription`    | connectedService:AzureRM | Yes      | -                              | Azure Resource Manager subscription for accessing the Terraform state file       |
| `terraformProjectPath` | string                   | No       | System.DefaultWorkingDirectory | Path to the root directory of the Terraform project                              |
| `maxWaitTimeSeconds`   | string                   | No       | 1800                           | Maximum time in seconds to wait for the blob to be available (1800 = 30 minutes) |
| `pollIntervalSeconds`  | string                   | No       | 10                             | Interval in seconds between polling attempts                                     |

## License

MIT
