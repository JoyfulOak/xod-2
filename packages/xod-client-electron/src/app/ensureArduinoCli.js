import os from 'os';
import path from 'path';
import https from 'https';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import extractZip from 'extract-zip';
import { createError } from 'xod-func-tools';
import { getResourcesRoot, getUserDataDir, IS_DEV } from './utils';

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/arduino/arduino-cli/releases/latest';

const getBundledCliPath = () => {
  const binName = os.platform() === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';
  return path.join(getResourcesRoot(), binName);
};

const getBundledArchivePath = () => {
  const platform = os.platform();
  const arch = os.arch();
  const resourcesRoot = getResourcesRoot();
  const binDir = path.join(resourcesRoot, 'arduino-cli-binaries');

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return path.join(binDir, 'arduino-cli_1.4.1_macOS_ARM64.tar');
    }
    return path.join(binDir, 'arduino-cli_1.4.1_macOS_64bit.tar');
  }
  if (platform === 'win32') {
    if (arch === 'arm64') return null;
    return path.join(binDir, 'arduino-cli.exe');
  }
  return null;
};

const getInstalledCliPath = () => {
  const binName = os.platform() === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';
  return path.join(getUserDataDir(), 'arduino-cli', binName);
};

const getAssetSelector = () => {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'darwin') {
    return arch === 'arm64' ? 'macOS_ARM64' : 'macOS_64bit';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'Linux_ARM64' : 'Linux_64bit';
  }
  if (platform === 'win32') {
    return arch === 'arm64' ? 'Windows_ARM64' : 'Windows_64bit';
  }
  return null;
};

const requestJson = url =>
  new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'xod-client-electron',
          Accept: 'application/vnd.github+json',
        },
      },
      res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(requestJson(res.headers.location));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            createError('ARDUINO_CLI_INSTALL_FAILED', {
              message: `HTTP ${res.statusCode} while fetching release metadata`,
              url,
            })
          );
          return;
        }
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(
              createError('ARDUINO_CLI_INSTALL_FAILED', {
                message: `Failed to parse release metadata: ${err.message}`,
                url,
              })
            );
          }
        });
      }
    );
    req.on('error', err =>
      reject(
        createError('ARDUINO_CLI_INSTALL_FAILED', {
          message: err.message,
          url,
        })
      )
    );
  });

const downloadToFile = (url, outPath) =>
  new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'xod-client-electron',
          Accept: 'application/octet-stream',
        },
      },
      res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(downloadToFile(res.headers.location, outPath));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            createError('ARDUINO_CLI_INSTALL_FAILED', {
              message: `HTTP ${res.statusCode} while downloading`,
              url,
            })
          );
          return;
        }
        const file = fs.createWriteStream(outPath);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', err =>
          reject(
            createError('ARDUINO_CLI_INSTALL_FAILED', {
              message: err.message,
              url,
            })
          )
        );
      }
    );
    req.on('error', err =>
      reject(
        createError('ARDUINO_CLI_INSTALL_FAILED', {
          message: err.message,
          url,
        })
      )
    );
  });

const extractArchive = async (archivePath, installDir) => {
  if (archivePath.endsWith('.zip')) {
    await extractZip(archivePath, { dir: installDir });
    return;
  }
  await new Promise((resolve, reject) => {
    const proc = spawn('tar', ['-xzf', archivePath, '-C', installDir]);
    proc.on('error', err =>
      reject(
        createError('ARDUINO_CLI_INSTALL_FAILED', {
          message: `Failed to run tar: ${err.message}`,
        })
      )
    );
    proc.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        createError('ARDUINO_CLI_INSTALL_FAILED', {
          message: `tar exited with code ${code}`,
        })
      );
    });
  });
};

let ensurePromise = null;

const ensureArduinoCli = async () => {
  if (process.env.XOD_ARDUINO_CLI && (await fs.pathExists(process.env.XOD_ARDUINO_CLI))) {
    return process.env.XOD_ARDUINO_CLI;
  }

  const bundled = getBundledCliPath();
  if (!IS_DEV && (await fs.pathExists(bundled))) {
    process.env.XOD_ARDUINO_CLI = bundled;
    return bundled;
  }

  const installed = getInstalledCliPath();
  if (await fs.pathExists(installed)) {
    process.env.XOD_ARDUINO_CLI = installed;
    return installed;
  }

  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const bundledArchive = getBundledArchivePath();
    if (bundledArchive && (await fs.pathExists(bundledArchive))) {
      const installDir = path.dirname(installed);
      await fs.ensureDir(installDir);

      if (bundledArchive.endsWith('.exe')) {
        await fs.copy(bundledArchive, installed);
      } else {
        await extractArchive(bundledArchive, installDir);
      }

      if (!(await fs.pathExists(installed))) {
        throw createError('ARDUINO_CLI_INSTALL_FAILED', {
          message: `arduino-cli binary not found after extracting bundled archive`,
          path: installed,
        });
      }

      if (os.platform() !== 'win32') {
        await fs.chmod(installed, 0o755);
      }

      process.env.XOD_ARDUINO_CLI = installed;
      return installed;
    }

    const selector = getAssetSelector();
    if (!selector) {
      throw createError('ARDUINO_CLI_INSTALL_FAILED', {
        message: `Unsupported platform: ${os.platform()} ${os.arch()}`,
      });
    }

    const release = await requestJson(GITHUB_RELEASES_URL);
    const asset = (release.assets || []).find(a =>
      a.name && a.name.includes(selector)
    );
    if (!asset) {
      throw createError('ARDUINO_CLI_INSTALL_FAILED', {
        message: `No release asset found for ${selector}`,
      });
    }

    const installDir = path.dirname(installed);
    await fs.ensureDir(installDir);
    const archivePath = path.join(installDir, asset.name);

    await downloadToFile(asset.browser_download_url, archivePath);
    await extractArchive(archivePath, installDir);
    await fs.remove(archivePath);

    if (!(await fs.pathExists(installed))) {
      throw createError('ARDUINO_CLI_INSTALL_FAILED', {
        message: `arduino-cli binary not found after extraction`,
        path: installed,
      });
    }

    if (os.platform() !== 'win32') {
      await fs.chmod(installed, 0o755);
    }

    process.env.XOD_ARDUINO_CLI = installed;
    return installed;
  })();

  return ensurePromise;
};

export default ensureArduinoCli;
