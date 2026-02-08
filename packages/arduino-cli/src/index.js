import * as R from 'ramda';
import path, { resolve } from 'path';
import { promisifyChildProcess } from 'promisify-child-process';
import crossSpawn from 'cross-spawn';
import YAML from 'yamljs';
import * as fse from 'fs-extra';

import { saveConfig, configure, setPackageIndexUrls } from './config';
import { patchBoardsWithOptions, getBoardsTxtPath } from './optionParser';
import listAvailableBoards from './listAvailableBoards';
import parseProgressLog from './parseProgressLog';

const spawn = (bin, args, options) =>
  promisifyChildProcess(crossSpawn(bin, args, options), {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });

const noop = () => {};

/**
 * Initializes object to work with `arduino-cli`
 * @param {String} pathToBin Path to `arduino-cli`
 * @param {Object} config Plain-object representation of `.cli-config.yml`
 */
const ArduinoCli = (pathToBin, config = null) => {
  const configureVal = configure(config);
  let configPath = configureVal.path;
  let cfg = configureVal.config;
  const configDir = configureVal.dir;
  let runningProcesses = [];

  const appendProcess = proc => {
    runningProcesses = R.append(proc, runningProcesses);
  };
  const deleteProcess = proc => {
    runningProcesses = R.reject(R.equals(proc), runningProcesses);
  };

  const runWithProgress = async (onProgress, args) => {
    const spawnArgs = R.compose(
      R.concat([`--config-file`, configPath]),
      R.reject(R.isEmpty)
    )(args);
    const proc = spawn(pathToBin, spawnArgs, {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', data => onProgress(data.toString()));
    proc.stderr.on('data', data => onProgress(data.toString()));
    proc.on('exit', () => deleteProcess(proc));

    appendProcess(proc);

    return proc.then(R.prop('stdout'));
  };

  const sketch = name => resolve(cfg.directories.user, name);

  const parseJsonOutput = text => {
    const trimmed = (text || '').trim();
    const jsonStart = trimmed.search(/[\[{]/);
    if (jsonStart === -1) {
      throw new Error('No JSON found in arduino-cli output');
    }
    const jsonText = jsonStart > 0 ? trimmed.slice(jsonStart) : trimmed;
    return JSON.parse(jsonText);
  };

  const runAndParseJson = args => {
    const spawnArgs = R.compose(
      R.concat([`--config-file`, configPath]),
      R.reject(R.isEmpty)
    )(args);
    const proc = spawn(pathToBin, spawnArgs, {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    return proc.then(({ stdout, stderr }) =>
      parseJsonOutput(`${stdout || ''}\n${stderr || ''}`)
    );
  };

  const runAndParseJsonGlobal = args => {
    const spawnArgs = R.reject(R.isEmpty)(args);
    const proc = spawn(pathToBin, spawnArgs, {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    return proc.then(({ stdout, stderr }) =>
      parseJsonOutput(`${stdout || ''}\n${stderr || ''}`)
    );
  };

  const normalizeCoresList = parsed => {
    if (R.is(Array, parsed)) return parsed;
    if (R.pathSatisfies(R.is(Array), ['platforms'], parsed)) {
      return R.path(['platforms'], parsed);
    }
    if (R.pathSatisfies(R.is(Array), ['installed_platforms'], parsed)) {
      return R.path(['installed_platforms'], parsed);
    }
    return [];
  };

  const listCores = () =>
    runWithProgress(noop, ['core', 'list', '--format=json'])
      .then(R.when(R.isEmpty, R.always('[]')))
      .then(JSON.parse)
      .then(normalizeCoresList);

  const normalizeBoards = boards =>
    R.map(
      board =>
        R.has('FQBN', board)
          ? R.merge({ fqbn: board.FQBN }, R.omit(['FQBN'], board))
          : board,
      boards
    );

  const addLegacyFqbn = board =>
    board && board.fqbn && !board.FQBN ? R.assoc('FQBN', board.fqbn, board) : board;

  const getInstalledBoardsFromListAll = boards =>
    R.filter(R.pathEq(['platform', 'release', 'installed'], true), boards);

  const getCoresFromBoards = boards =>
    R.compose(
      R.uniqBy(R.prop('ID')),
      R.reject(R.anyPass([R.propEq('ID', undefined), R.propEq('Installed', undefined)])),
      R.map(board => ({
        ID: R.path(['platform', 'metadata', 'id'], board),
        Installed: R.path(['platform', 'release', 'version'], board),
      }))
    )(boards);

  const listBoardsRaw = listCmd =>
    runAndParseJson(['board', listCmd, '--format=json'])
      .then(R.propOr([], 'boards'))
      .then(normalizeBoards);

  const listBoardsWith = (listCmd, boardsGetter) =>
    Promise.all([listCores(), runAndParseJson(['board', listCmd, '--format=json'])])
      .then(([cores, boards]) =>
        patchBoardsWithOptions(cfg.directories.data, cores, boardsGetter(boards))
      );

  const getConfig = () =>
    runWithProgress(noop, ['config', 'dump']).then(YAML.parse);

  const getGlobalConfig = () =>
    runAndParseJsonGlobal(['config', 'dump', '--format=json']);

  const ensureBoardsTxtFiles = async (workspaceDataDir, globalDataDir, boards) => {
    if (!globalDataDir) return;
    const cores = getCoresFromBoards(boards);
    await Promise.all(
      R.map(async core => {
        const dest = getBoardsTxtPath(workspaceDataDir, core.ID, core.Installed);
        const destExists = await fse.pathExists(dest);
        if (destExists) return;
        const src = getBoardsTxtPath(globalDataDir, core.ID, core.Installed);
        const srcExists = await fse.pathExists(src);
        if (!srcExists) return;
        await fse.ensureDir(path.dirname(dest));
        await fse.copy(src, dest);
      }, cores)
    );
  };

  return {
    getPathToBin: () => pathToBin,
    killProcesses: () => {
      R.forEach(proc => {
        proc.kill('SIGTERM');
        deleteProcess(proc);
      }, runningProcesses);
      return true;
    },
    getRunningProcesses: () => runningProcesses,
    dumpConfig: getConfig,
    updateConfig: newConfig => {
      const newCfg = saveConfig(configPath, newConfig);
      configPath = newCfg.path;
      cfg = newCfg.config;
      return cfg;
    },
    listConnectedBoards: () => listBoardsWith('list', R.prop('serialBoards')),
    listInstalledBoards: () => listBoardsWith('listall', R.prop('boards')),
    listInstalledBoardsRaw: () =>
      runAndParseJson(['board', 'listall', '--format=json'])
        .then(R.propOr([], 'boards'))
        .then(getInstalledBoardsFromListAll)
        .then(R.map(addLegacyFqbn))
        .then(async boards => {
          let globalDataDir = null;
          try {
            const globalCfg = await getGlobalConfig();
            globalDataDir = R.path(['config', 'directories', 'data'], globalCfg);
          } catch (err) {
            globalDataDir = null;
          }
          await ensureBoardsTxtFiles(cfg.directories.data, globalDataDir, boards);
          return patchBoardsWithOptions(
            cfg.directories.data,
            getCoresFromBoards(boards),
            boards
          );
        }),
    listAvailableBoards: () =>
      listAvailableBoards(getConfig, cfg.directories.data),
    compile: (onProgress, fqbn, sketchName, verbose = false) =>
      runWithProgress(onProgress, [
        'compile',
        `--fqbn=${fqbn}`,
        verbose ? '--verbose' : '',
        sketch(sketchName),
      ]),
    upload: (onProgress, port, fqbn, sketchName, verbose = false) =>
      runWithProgress(onProgress, [
        'upload',
        `--fqbn=${fqbn}`,
        `--port=${port}`,
        verbose ? '--verbose' : '',
        '-t',
        sketch(sketchName),
      ]),
    core: {
      download: (onProgress, pkgName) =>
        // TODO:
        // Get rid of `remove` the staging directory when
        // arduino-cli fix issue https://github.com/arduino/arduino-cli/issues/43
        fse.remove(resolve(cfg.directories.data, 'staging')).then(() =>
          runWithProgress(parseProgressLog(onProgress), [
            'core',
            'download',
            pkgName,
          ])
        ),
      install: (onProgress, pkgName) =>
        // TODO:
        // Get rid of `remove` the staging directory when
        // arduino-cli fix issue https://github.com/arduino/arduino-cli/issues/43
        fse.remove(resolve(cfg.directories.data, 'staging')).then(() =>
          runWithProgress(parseProgressLog(onProgress), [
            'core',
            'install',
            pkgName,
          ])
        ),
      list: listCores,
      search: query =>
        runWithProgress(noop, ['core', 'search', query, '--format=json'])
          .then(R.prop('Platforms'))
          .then(R.defaultTo([])),
      uninstall: pkgName =>
        runWithProgress(noop, ['core', 'uninstall', pkgName]),
      updateIndex: () => runWithProgress(noop, ['core', 'update-index']),
      upgrade: onProgress =>
        runWithProgress(parseProgressLog(onProgress), ['core', 'upgrade']),
    },
    version: () =>
      runAndParseJson(['version', '--format=json']).then(
        R.prop('VersionString')
      ),
    createSketch: sketchName =>
      runWithProgress(noop, ['sketch', 'new', sketch(sketchName)]).then(
        R.always(resolve(cfg.directories.user, sketchName, `${sketchName}.ino`))
      ),
    setPackageIndexUrls: urls => setPackageIndexUrls(configPath, urls),
  };
};

export default ArduinoCli;
