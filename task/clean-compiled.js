const fs = require('fs');
const path = require('path');

/**
 * Recursively find and delete compiled TypeScript files
 * @param {string} dir - Directory to search
 * @param {string[]} excludeDirs - Directories to exclude
 * @param {string} scriptPath - Path to this script (to exclude from deletion)
 */
function deleteCompiledFiles(dir, excludeDirs = ['node_modules'], scriptPath) {
    const files = fs.readdirSync(dir);
    const deletedFiles = [];

    files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            // Skip excluded directories
            if (excludeDirs.includes(file)) {
                return;
            }
            // Recursively process subdirectories
            const deleted = deleteCompiledFiles(filePath, excludeDirs, scriptPath);
            deletedFiles.push(...deleted);
        } else {
            // Skip this script file itself
            if (path.resolve(filePath) === path.resolve(scriptPath)) {
                console.log(`Skipping self: ${filePath}`);
                return;
            }

            // Check if file should be deleted
            const ext = path.extname(file);
            if (ext === '.js' || ext === '.map' || file.endsWith('.d.ts')) {
                try {
                    fs.unlinkSync(filePath);
                    deletedFiles.push(filePath);
                    console.log(`Deleted: ${filePath}`);
                } catch (err) {
                    console.error(`Error deleting ${filePath}:`, err.message);
                }
            }
        }
    });

    return deletedFiles;
}

// Run the cleanup
const projectRoot = __dirname;
const thisScript = __filename;

console.log('Starting cleanup of compiled files...');
console.log(`Project root: ${projectRoot}`);
console.log(`This script: ${thisScript}\n`);

const deleted = deleteCompiledFiles(projectRoot, ['node_modules'], thisScript);

console.log(`\nCleanup complete!`);
console.log(`Total files deleted: ${deleted.length}`);
