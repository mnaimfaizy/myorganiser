import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();

const sourcePath = path.resolve(
  workspaceRoot,
  'apps/backend/src/swagger/swagger.yaml',
);
const destinationPath = path.resolve(
  workspaceRoot,
  'libs/api-specs/src/api-specs.openapi.yaml',
);

if (!fs.existsSync(sourcePath)) {
  console.error(`[openapi-sync] Source spec not found: ${sourcePath}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
fs.copyFileSync(sourcePath, destinationPath);

console.log(`[openapi-sync] Copied ${sourcePath} -> ${destinationPath}`);
