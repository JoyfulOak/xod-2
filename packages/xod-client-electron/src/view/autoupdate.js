import * as R from 'ramda';
import * as EVENTS from '../shared/events';
import { updateAvailableMessage } from '../shared/messages';

export const UPDATE_IDE_MESSAGE_ID = 'updateIde';

// :: ipcRenderer -> AppContainer -> ()
export const subscribeAutoUpdaterEvents = (ipcRenderer, App) => {
  ipcRenderer.on(EVENTS.APP_UPDATE_ERROR, (event, error) => {
    console.error(error); // eslint-disable-line no-console
    App.setState(R.assoc('downloadProgressPopupError', error.message));
    App.setState(R.assoc('downloadProgressPopup', true));
  });
  ipcRenderer.on(EVENTS.APP_UPDATE_AVAILABLE, (event, info) => {
    console.log('Update available: ', info); // eslint-disable-line no-console
    App.props.actions.addNotification(
      updateAvailableMessage(info.version),
      UPDATE_IDE_MESSAGE_ID
    );
  });
  ipcRenderer.on(EVENTS.APP_UPDATE_PROGRESS, (event, progress) => {
    console.log('Downloading update: ', progress); // eslint-disable-line no-console
  });
  ipcRenderer.on(EVENTS.APP_UPDATE_DOWNLOADED, (event, info) => {
    console.log('Update downloaded. Will be restarted soon!', info); // eslint-disable-line no-console
  });
  ipcRenderer.on(EVENTS.APP_UPDATE_DOWNLOAD_STARTED, () => {
    App.setState(R.assoc('downloadProgressPopup', true));
    console.log('Download has been started!'); // eslint-disable-line no-console
  });
};

const getStartupUpdatePopupState = payload => {
  const latestVersion = payload && payload.latestVersion;

  switch (payload && payload.status) {
    case 'started':
      return {
        startupUpdatePopupVisible: true,
        startupUpdatePopupTitle: 'Checking for update',
        startupUpdatePopupMessage:
          'Checking GitHub for the latest XOD 2 release...',
        startupUpdatePopupClosable: false,
        startupUpdatePopupCanInstall: false,
        startupUpdatePopupAutoDismissMs: 0,
      };
    case 'update-available':
      return {
        startupUpdatePopupVisible: true,
        startupUpdatePopupTitle: 'Update available',
        startupUpdatePopupMessage: latestVersion
          ? `Latest version on GitHub: ${latestVersion}`
          : 'A newer version is available on GitHub.',
        startupUpdatePopupClosable: true,
        startupUpdatePopupCanInstall: true,
        startupUpdatePopupAutoDismissMs: 0,
      };
    case 'no-update':
      return null;
    case 'skipped':
      if (!(payload && payload.updateAvailable)) {
        return null;
      }
      return {
        startupUpdatePopupVisible: true,
        startupUpdatePopupTitle: 'Update available',
        startupUpdatePopupMessage: latestVersion
          ? `Latest version on GitHub: ${latestVersion}`
          : 'A newer version is available on GitHub.',
        startupUpdatePopupClosable: true,
        startupUpdatePopupCanInstall: true,
        startupUpdatePopupAutoDismissMs: 0,
      };
    case 'timed-out':
      return {
        startupUpdatePopupVisible: true,
        startupUpdatePopupTitle: 'Update check timed out',
        startupUpdatePopupMessage:
          'Could not reach GitHub quickly. Startup continues normally.',
        startupUpdatePopupClosable: true,
        startupUpdatePopupCanInstall: false,
        startupUpdatePopupAutoDismissMs: 15000,
      };
    case 'failed':
      return {
        startupUpdatePopupVisible: true,
        startupUpdatePopupTitle: 'Update check failed',
        startupUpdatePopupMessage:
          'Could not check GitHub right now. Startup continues normally.',
        startupUpdatePopupClosable: true,
        startupUpdatePopupCanInstall: false,
        startupUpdatePopupAutoDismissMs: 15000,
      };
    default:
      return null;
  }
};

export const subscribeStartupUpdateEvents = (ipcRenderer, App) => {
  ipcRenderer.on(EVENTS.STARTUP_UPDATE_CHECK_STATUS, (event, payload) => {
    const nextState = getStartupUpdatePopupState(payload);
    if (nextState) {
      App.setState(nextState);
    }
  });
};

export const downloadUpdate = ipcRenderer => {
  ipcRenderer.send(EVENTS.APP_UPDATE_DOWNLOAD_REQUEST);
};
