#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const isFlag = value => typeof value === 'string' && value.startsWith('-');
const args = process.argv.slice(2);
const showHelp = args.includes('-h') || args.includes('--help');
const dryRun = args.includes('--dry-run');
const rawVersionArg = args.find(arg => !isFlag(arg));
const nextVersion = rawVersionArg || process.env.XOD_NEW_VERSION;

if (showHelp || !nextVersion) {
  console.log(
    [
      'Usage: yarn set-version <version> [--dry-run]',
      '',
      'Updates version in:',
      '  - lerna.json',
      '  - package.json files (root + packages/*)',
      '  - local package dependency ranges',
      '  - workspace/__lib__/xod*/**/project.xod',
      '',
      'Examples:',
      '  yarn set-version 2026.2.1',
      '  yarn set-version 2026.2.1 --dry-run',
    ].join('\n')
  );
  process.exit(showHelp ? 0 : 1);
}

if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(nextVersion)) {
  console.error(`Invalid version: "${nextVersion}"`);
  process.exit(1);
}

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (filePath, json) =>
  fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');

const updateJsonFile = (filePath, updater) => {
  const original = readJson(filePath);
  const updated = updater(original);
  if (!updated.changed) return false;
  if (!dryRun) writeJson(filePath, updated.json);
  return true;
};

const updateTextFile = (filePath, updater) => {
  if (!fs.existsSync(filePath)) return false;
  const original = fs.readFileSync(filePath, 'utf8');
  const updated = updater(original);
  if (updated === original) return false;
  if (!dryRun) fs.writeFileSync(filePath, updated, 'utf8');
  return true;
};

const lernaPath = path.join(rootDir, 'lerna.json');
const lerna = readJson(lernaPath);
const previousVersion = lerna.version;

if (typeof previousVersion !== 'string' || previousVersion.length === 0) {
  console.error(`Invalid version in ${lernaPath}`);
  process.exit(1);
}

let changedCount = 0;

if (
  updateJsonFile(lernaPath, json => {
    if (json.version === nextVersion) return { changed: false, json };
    json.version = nextVersion;
    return { changed: true, json };
  })
) {
  changedCount += 1;
}

const packagesDir = path.join(rootDir, 'packages');
const packageFiles = fs
  .readdirSync(packagesDir)
  .map(dirName => path.join(packagesDir, dirName, 'package.json'))
  .filter(filePath => fs.existsSync(filePath));

const rootPackageFile = path.join(rootDir, 'package.json');
const allPackageFiles = [rootPackageFile].concat(packageFiles);
const electronPackageFile = path.join(
  rootDir,
  'packages',
  'xod-client-electron',
  'package.json'
);
const electronPrebuiltBundle = path.join(
  rootDir,
  'packages',
  'xod-client-electron',
  'src-babel',
  'bundle.js'
);
const electronPrebuiltBundleMap = path.join(
  rootDir,
  'packages',
  'xod-client-electron',
  'src-babel',
  'bundle.js.map'
);

const localPackages = packageFiles
  .map(filePath => readJson(filePath))
  .filter(pkg => pkg && pkg.name);

const localPackageNames = new Set(localPackages.map(pkg => pkg.name));
const localPackageVersions = new Map(
  localPackages.map(pkg => [pkg.name, pkg.version]).filter(([, v]) => !!v)
);

const rewriteLocalSpec = (spec, depName) => {
  const currentLocalVersion = localPackageVersions.get(depName);
  if (spec === previousVersion) return nextVersion;
  if (spec === `^${previousVersion}`) return `^${nextVersion}`;
  if (spec === `~${previousVersion}`) return `~${nextVersion}`;
  if (!currentLocalVersion) return spec;
  if (spec === currentLocalVersion) return nextVersion;
  if (spec === `^${currentLocalVersion}`) return `^${nextVersion}`;
  if (spec === `~${currentLocalVersion}`) return `~${nextVersion}`;
  return spec;
};

allPackageFiles.forEach(filePath => {
  const fileChanged = updateJsonFile(filePath, json => {
    let changed = false;

    if (typeof json.version === 'string' && json.version !== nextVersion) {
      json.version = nextVersion;
      changed = true;
    }

    [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ].forEach(fieldName => {
      const deps = json[fieldName];
      if (!deps || typeof deps !== 'object') return;

      Object.keys(deps).forEach(depName => {
        if (!localPackageNames.has(depName)) return;
        const currentSpec = deps[depName];
        const updatedSpec = rewriteLocalSpec(currentSpec, depName);
        if (updatedSpec !== currentSpec) {
          deps[depName] = updatedSpec;
          changed = true;
        }
      });
    });

    return { changed, json };
  });

  if (fileChanged) changedCount += 1;
});

// Help menu version in the desktop app is read from this package.json.
if (fs.existsSync(electronPackageFile)) {
  const electronPkg = readJson(electronPackageFile);
  const expectedElectronVersion = dryRun ? nextVersion : electronPkg.version;
  if (expectedElectronVersion !== nextVersion) {
    console.error(
      `Failed to update Help menu version source: ${electronPackageFile}`
    );
    process.exit(1);
  }
}

// Keep stale prebuilt Electron assets in sync with the app version.
const updateEmbeddedElectronVersion = contents =>
  contents
    .replace(
      /("name":"xod-client-electron","version":")([^"]+)(")/g,
      `$1${nextVersion}$3`
    )
    .replace(
      /(\\"name\\":\\"xod-client-electron\\",\\"version\\":\\")([^"]+)(\\")/g,
      `$1${nextVersion}$3`
    );

if (updateTextFile(electronPrebuiltBundle, updateEmbeddedElectronVersion)) {
  changedCount += 1;
}
if (updateTextFile(electronPrebuiltBundleMap, updateEmbeddedElectronVersion)) {
  changedCount += 1;
}

const workspaceLibDir = path.join(rootDir, 'workspace', '__lib__');
if (fs.existsSync(workspaceLibDir)) {
  const vendorDirs = fs
    .readdirSync(workspaceLibDir)
    .filter(name => name.indexOf('xod') === 0);

  vendorDirs.forEach(vendor => {
    const vendorPath = path.join(workspaceLibDir, vendor);
    fs.readdirSync(vendorPath).forEach(libDir => {
      const projectPath = path.join(vendorPath, libDir, 'project.xod');
      if (!fs.existsSync(projectPath)) return;
      const fileChanged = updateJsonFile(projectPath, json => {
        if (typeof json.version !== 'string') return { changed: false, json };
        if (json.version === nextVersion) return { changed: false, json };
        json.version = nextVersion;
        return { changed: true, json };
      });
      if (fileChanged) changedCount += 1;
    });
  });
}

const mode = dryRun ? 'dry-run' : 'updated';
console.log(
  `[set-version] ${mode} version ${previousVersion} -> ${nextVersion}; files changed: ${changedCount}`
);
console.log(
  '[set-version] Help menu version source: packages/xod-client-electron/package.json'
);
console.log(
  '[set-version] Prebuilt help-menu bundle source: packages/xod-client-electron/src-babel/bundle.js'
);
