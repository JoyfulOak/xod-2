import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import contextMenu from 'electron-context-menu';
import windowStateKeeper from 'electron-window-state';
import { URL } from 'url';
import * as R from 'ramda';
import * as xdb from 'xod-deploy-bin';
import { tapP, createError } from 'xod-func-tools';

import {
  URL_ACTION_PROTOCOL,
  URL_ACTION_PREFIX,
} from 'xod-client/dist/core/urlActions';

import * as EVENTS from '../shared/events';
import {
  listPortsHandler,
  loadTargetBoardHandler,
  saveTargetBoardHandler,
  startDebugSessionHandler,
  stopDebugSessionHandler,
} from './arduinoActions';
import {
  subscribeListBoards,
  subscribeListInstalledBoards,
  subscribeUpload,
  subscribeUpdateIndexes,
  subscribeCheckUpdates,
  subscribeUpgradeArduinoPackages,
} from './arduinoCli';
import migrateArduinoPackages from './migrateArduinoPackages';
import * as settings from './settings';
import {
  errorToPlainObject,
  IS_DEV,
  getFilePathToOpen,
  getPathToBundledWorkspace,
  setUserDataArg,
  getUserDataDir,
} from './utils';
import ensureArduinoCli from './ensureArduinoCli';
import * as WA from './workspaceActions';
import {
  subscribeOnCheckArduinoDependencies,
  subscribeOnInstallArduinoDependencies,
} from './arduinoDependencies';
import {
  configureAutoUpdater,
  subscribeOnAutoUpdaterEvents,
} from './autoupdate';
import checkForGithubUpdateOnceOnStartup from './updateCheck';
import createAppStore from './store/index';

import { STATES, getEventNameWithState } from '../shared/eventStates';

// =============================================================================
//
// Configure application
//
// =============================================================================

const DEFAULT_APP_TITLE = 'XOD 2 IDE';
const AUTOUPDATE_ENABLED = true;
const GITHUB_UPDATE_PROVIDER = {
  provider: 'github',
  owner: 'JoyfulOak',
  repo: 'xod-2',
};

app.setName('xod');

if (AUTOUPDATE_ENABLED) {
  configureAutoUpdater(autoUpdater, log);
}

if (process.env.USERDATA_DIR) {
  app.setPath('userData', process.env.USERDATA_DIR);
}

if (IS_DEV) {
  // To prevent GL_ERROR in development version (black rectangles).
  app.disableHardwareAcceleration();
}

const store = createAppStore();

let arduinoCliInstance;

// =============================================================================
//
// Application main process
//
// =============================================================================

const getFileToOpen = getFilePathToOpen(app);

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win;
let confirmedWindowClose = false;
let startupUpdateStatusPayload = null;
let startupUpdateInstallInProgress = false;
const UPDATE_INSTALL_RETRY_LIMIT = 2;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const getMacUpdateChannel = () => {
  const macChannelByArch = {
    arm64: 'mac-arm64',
    x64: 'mac-x64',
  };
  return macChannelByArch[process.arch] || 'latest';
};

const applyUpdaterFeedConfig = () => {
  if (process.platform !== 'darwin') return;

  const channel = getMacUpdateChannel();
  autoUpdater.channel = channel;
  autoUpdater.allowDowngrade = true;
  autoUpdater.setFeedURL({
    ...GITHUB_UPDATE_PROVIDER,
    channel,
  });
  log.debug(`[update-check] using update channel: ${channel}`);
};

const applyMacReleaseFeedConfig = latestVersion => {
  if (process.platform !== 'darwin') return;
  if (!latestVersion) return;

  const normalized = String(latestVersion).replace(/^v/i, '');
  const tag = `v${normalized}`;
  const channel = getMacUpdateChannel();

  autoUpdater.channel = channel;
  autoUpdater.allowDowngrade = true;
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: `https://github.com/JoyfulOak/xod-2/releases/download/${tag}`,
    channel,
  });
  log.debug(
    `[update-check] using release feed ${tag} with channel ${channel}`
  );
};

function createWindow() {
  // Load the previous state with fallback to defaults
  const winState = windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 720,
  });

  // Create the browser window.
  win = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
    // 700px is the content width on xod.io and Medium. Resizing down to it
    // lets make 1-to-1 screencasts and snapshots
    minWidth: 700,
    minHeight: 600,
    title: DEFAULT_APP_TITLE,
    show: false,
    // Explicit opaque white is required for subpixel antialiasing to work
    backgroundColor: '#FFF',
    webPreferences: {
      partition: 'persist:main',
      nodeIntegration: true,
      enableRemoteModule: true,
      contextIsolation: false,
      additionalArguments: [
        IS_DEV ? 'ELECTRON_IS_DEV' : 'ELECTRON_IS_PACKAGED',
        setUserDataArg(getUserDataDir()),
      ],
    },
  });

  // Register listeners on the window, so it can update the state automatically
  // (the listeners will be removed when the window is closed) and restore the
  // maximized or full screen state
  winState.manage(win);

  // and load the index.html of the app.
  win.loadURL(`file://${__dirname}/../index.html`);

  // Open the DevTools.
  // win.webContents.openDevTools();

  contextMenu({
    window: win,
    // by default `electron-context-menu` uses
    // `electron-is-dev` for autodetecting this,
    // but it no longer works in Electron v10
    showInspectElement: IS_DEV,
  });

  const { webContents } = win;

  const handleRedirect = (e, href) => {
    if (href !== webContents.getURL()) {
      e.preventDefault();
      const url = new URL(href);
      if (
        url.protocol === URL_ACTION_PROTOCOL &&
        url.hostname === URL_ACTION_PREFIX
      ) {
        win.webContents.send(EVENTS.XOD_URL_CLICKED, {
          actionName: url.pathname,
          params: R.fromPairs(Array.from(url.searchParams.entries())),
        });
      } else {
        shell.openExternal(href);
      }
    }
  };
  webContents.on('will-navigate', handleRedirect);
  webContents.on('new-window', handleRedirect);

  win.on('close', e => {
    // a bit of magic, because of weird `onbeforeunload` behaviour.
    // see https://github.com/electron/electron/issues/7977
    if (!confirmedWindowClose) {
      e.preventDefault();
      win.webContents.send(EVENTS.REQUEST_CLOSE_WINDOW);
    }
  });

  // Emitted when the window is closed.
  win.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null;
  });

  win.on('ready-to-show', win.show);
}

const subscribeToRemoteAction = (processName, remoteAction) => {
  ipcMain.on(processName, (event, data) => {
    event.sender.send(getEventNameWithState(processName, STATES.PROCESS));
    remoteAction(event, data)
      .then(result => {
        event.sender.send(
          getEventNameWithState(processName, STATES.COMPLETE),
          result
        );
      })
      .catch(err => {
        event.sender.send(
          getEventNameWithState(processName, STATES.ERROR),
          errorToPlainObject(err)
        );
      });
  });
};

configureAutoUpdater(autoUpdater, log);
if (AUTOUPDATE_ENABLED) {
  applyUpdaterFeedConfig();
}

const runAutoUpdateInstallWithRetry = (attempt = 0) =>
  (startupUpdateStatusPayload && startupUpdateStatusPayload.latestVersion
    ? applyMacReleaseFeedConfig(startupUpdateStatusPayload.latestVersion)
    : applyUpdaterFeedConfig(),
  autoUpdater)
    .checkForUpdates()
    .then(() => autoUpdater.downloadUpdate())
    .catch(err => {
      const message = err && err.message ? err.message : '';
      const isDnsResolutionError =
        typeof message === 'string' &&
        message.indexOf('ERR_NAME_NOT_RESOLVED') !== -1;

      if (isDnsResolutionError && attempt < UPDATE_INSTALL_RETRY_LIMIT) {
        const retryDelayMs = (attempt + 1) * 1000;
        log.debug(
          `[update-check] DNS failure, retrying install in ${retryDelayMs}ms`
        );
        return wait(retryDelayMs).then(() =>
          runAutoUpdateInstallWithRetry(attempt + 1)
        );
      }

      return Promise.reject(err);
    });

const onReady = () => {
  settings.setDefaults();

  const publishStartupUpdateStatus = payload => {
    startupUpdateStatusPayload = payload;
    if (win && win.webContents) {
      win.webContents.send(EVENTS.STARTUP_UPDATE_CHECK_STATUS, payload);
    }
  };

  subscribeToRemoteAction(EVENTS.SAVE_ALL, WA.subscribeToSaveAll(store));

  let debugPort = null;
  let userAttemptedCloseSerialPort = false;

  const stopDebugSession = event => {
    if (debugPort) {
      userAttemptedCloseSerialPort = true;
      stopDebugSessionHandler(event, debugPort).then(() =>
        event.sender.send(EVENTS.DEBUG_SESSION_STOPPED)
      );
    } else {
      event.sender.send(EVENTS.DEBUG_SESSION_STOPPED);
    }
  };

  WA.subscribeToWorkspaceEvents(ipcMain, store);
  ipcMain.on(
    EVENTS.START_DEBUG_SESSION,
    startDebugSessionHandler(
      port => {
        userAttemptedCloseSerialPort = false;
        debugPort = port;
      },
      sendErr => {
        if (!userAttemptedCloseSerialPort) {
          sendErr();
        }

        debugPort = null;
      }
    )
  );
  ipcMain.on(EVENTS.DEBUG_SERIAL_SEND, (event, str) => {
    if (!debugPort || !debugPort.write) return;

    debugPort.write(str);
  });
  ipcMain.on(EVENTS.STOP_DEBUG_SESSION, stopDebugSession);
  ipcMain.on(EVENTS.LIST_PORTS, listPortsHandler);
  ipcMain.on(EVENTS.GET_SELECTED_BOARD, loadTargetBoardHandler);
  ipcMain.on(EVENTS.SET_SELECTED_BOARD, saveTargetBoardHandler);
  ipcMain.on(EVENTS.ABORT_ARDUINO_UPLOAD, () => {
    if (arduinoCliInstance) {
      arduinoCliInstance.killProcesses();
    }
  });
  ipcMain.on(EVENTS.CONFIRM_CLOSE_WINDOW, () => {
    confirmedWindowClose = true;
    win.close();
  });
  ipcMain.on(EVENTS.INSTALL_LIBRARIES, WA.saveLibraries);
  ipcMain.on(EVENTS.CONFIRM_OPEN_PROJECT, (event, path) => {
    WA.onLoadProject(
      store.dispatch.updateProjectPath,
      (eventName, data) => win.webContents.send(eventName, data),
      path
    );
  });
  ipcMain.on(EVENTS.STARTUP_UPDATE_INSTALL_REQUEST, () => {
    const isSupportedPlatform =
      process.platform === 'win32' || process.platform === 'darwin';

    if (!AUTOUPDATE_ENABLED || !isSupportedPlatform) return;
    if (startupUpdateInstallInProgress) return;

    startupUpdateInstallInProgress = true;
    log.debug('[update-check] install requested');

    runAutoUpdateInstallWithRetry()
      .then(() => {
        if (win && win.webContents) {
          win.webContents.send(EVENTS.APP_UPDATE_DOWNLOAD_STARTED);
        }
      })
      .catch(err => {
        log.debug('[update-check] install failed');
        const message = err && err.message ? err.message : 'Update failed';
        const isDnsResolutionError =
          typeof message === 'string' &&
          message.indexOf('ERR_NAME_NOT_RESOLVED') !== -1;

        if (isDnsResolutionError) {
          shell.openExternal(
            'https://github.com/JoyfulOak/xod-2/releases/latest'
          );
        }

        if (win && win.webContents) {
          win.webContents.send(EVENTS.APP_UPDATE_ERROR, {
            message: isDnsResolutionError
              ? `${message}\nOpened GitHub releases page in your browser as fallback.`
              : message,
          });
        }
      })
      .then(() => {
        startupUpdateInstallInProgress = false;
      });
  });

  createWindow();

  setTimeout(
    () =>
      checkForGithubUpdateOnceOnStartup(app, log, publishStartupUpdateStatus),
    0
  );

  let unsubscribers = [];

  // Subscribe on changing of Project path once
  // It did not depends on Workspace path, so we don't need
  // to resubscribe on changing
  store.subscribe(() => {
    const projectPath = store.select.projectPath();
    win.webContents.send(EVENTS.PROJECT_PATH_CHANGED, projectPath);
    if (projectPath != null) {
      app.addRecentDocument(projectPath);
    }

    const newTitle = projectPath
      ? `${projectPath} — ${DEFAULT_APP_TITLE}`
      : DEFAULT_APP_TITLE;
    win.setTitle(newTitle);
  });

  win.webContents.on('did-finish-load', () => {
    if (startupUpdateStatusPayload) {
      win.webContents.send(
        EVENTS.STARTUP_UPDATE_CHECK_STATUS,
        startupUpdateStatusPayload
      );
    }

    WA.prepareWorkspaceOnLaunch(
      (eventName, data) => win.webContents.send(eventName, data),
      store.dispatch.updateProjectPath,
      getFileToOpen
    )
      .then(() => WA.loadWorkspacePath())
      .then(tapP(wsPath => migrateArduinoPackages(wsPath)))
      .then(wsPath => Promise.all([wsPath, xdb.prepareSketchDir(wsPath)]))
      .then(([wsPath, sketchDir]) =>
        ensureArduinoCli().then(() => [wsPath, sketchDir])
      )
      .then(([wsPath, sketchDir]) =>
        xdb.createCli(getPathToBundledWorkspace(), wsPath, sketchDir, IS_DEV)
      )
      .then(
        R.when(
          () => IS_DEV,
          arduinoCli =>
            arduinoCli
              .version()
              .then(v => {
                // eslint-disable-next-line no-console
                console.log('Arduino-cli bin: ', arduinoCli.getPathToBin());
                // eslint-disable-next-line no-console
                console.log('Arduino-cli version: ', v);
                return arduinoCli.dumpConfig();
              })
              .then(cfg => {
                // eslint-disable-next-line no-console
                console.log(
                  'Arduino-cli sketchbook directory:',
                  cfg.directories.user
                );
                return arduinoCli;
              })
              .catch(err =>
                Promise.reject(
                  createError('ARDUINO_CLI_EXITED_WITH_CODE', {
                    message: err.message,
                    stdout: err.stdout,
                    stderr: err.stderr,
                    path: arduinoCli.getPathToBin(),
                  })
                )
              )
        )
      )
      .then(arduinoCli => {
        arduinoCliInstance = arduinoCli;

        const subscribeSwitchWorkspace = () => {
          // On switching/creating workspace -> update arduino-cli config and run migration
          const onSwitchWorkspace = (event, newWsPath) =>
            Promise.resolve()
              .then(() => migrateArduinoPackages(newWsPath))
              .then(() =>
                xdb.switchWorkspace(
                  arduinoCli,
                  getPathToBundledWorkspace(),
                  newWsPath
                )
              )
              .catch(err => {
                win.webContents.send(
                  EVENTS.ERROR_IN_MAIN_PROCESS,
                  errorToPlainObject(err)
                );
              });
          ipcMain.on(EVENTS.SWITCH_WORKSPACE, onSwitchWorkspace);
          ipcMain.on(EVENTS.CREATE_WORKSPACE, onSwitchWorkspace);

          return () => {
            ipcMain.removeListener(EVENTS.SWITCH_WORKSPACE, onSwitchWorkspace);
            ipcMain.removeListener(EVENTS.CREATE_WORKSPACE, onSwitchWorkspace);
          };
        };

        // unsubscribe old listeners
        unsubscribers.forEach(R.call);
        unsubscribers = [
          subscribeSwitchWorkspace(),
          subscribeListBoards(arduinoCli),
          subscribeListInstalledBoards(arduinoCli),
          subscribeUpload(arduinoCli),
          subscribeUpdateIndexes(arduinoCli),
          subscribeCheckUpdates(arduinoCli),
          subscribeUpgradeArduinoPackages(arduinoCli),
          subscribeOnCheckArduinoDependencies(arduinoCli),
          subscribeOnInstallArduinoDependencies(arduinoCli),
        ];
      })
      .catch(err => {
        console.error(err); // eslint-disable-line no-console
        win.webContents.send(
          EVENTS.ERROR_IN_MAIN_PROCESS,
          errorToPlainObject(err)
        );
      });

    if (AUTOUPDATE_ENABLED) {
      subscribeOnAutoUpdaterEvents(
        (eventName, data) => win.webContents.send(eventName, data),
        ipcMain,
        autoUpdater
      );
    }
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', onReady);

app.on('before-quit', () => {
  // Kill all running `arduino-cli` processes
  // when IDE is closing
  if (arduinoCliInstance) {
    arduinoCliInstance.killProcesses();
  }
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    createWindow();
  }
});

// this is triggered on MacOS when a file is requested from the recent documents menu
// or by file association
app.on('open-file', (event, path) => {
  if (!win) return;

  win.webContents.send(EVENTS.REQUEST_OPEN_PROJECT, path);
});
