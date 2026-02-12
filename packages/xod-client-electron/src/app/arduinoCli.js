import * as R from 'ramda';
import * as xdb from 'xod-deploy-bin';

import subscribeIpc from './subscribeIpc';
import { loadWorkspacePath } from './workspaceActions';
import { getPathToBundledWorkspace } from './utils';
import {
  LIST_BOARDS,
  LIST_INSTALLED_BOARDS,
  UPLOAD_TO_ARDUINO,
  UPDATE_INDEXES,
  CHECK_ARDUINO_DEPENDENCY_UPDATES,
  UPGRADE_ARDUINO_DEPENDECIES,
} from '../shared/events';

/**
 * Begins upload through USB pipeline.
 *
 * Returns Promise with an upload log. TODO: Is it right?
 *
 * :: (Object -> _) -> ArduinoCli -> UploadPayload -> Promise String Error
 */
export const upload = (onProgress, cli, payload) => {
  const payloadWithUpdatedFqbn = R.over(
    R.lensProp('board'),
    xdb.patchFqbnWithOptions,
    payload
  );
  return ensureCliWorkspace(cli, payload.ws)
    .then(() => xdb.uploadThroughUSB(onProgress, cli, payloadWithUpdatedFqbn));
};

// =============================================================================
//
// Subscribers
//
// =============================================================================
const ensureCliWorkspace = (cli, preferredWorkspacePath = null) =>
  Promise.resolve(preferredWorkspacePath)
    .then(ws => ws || loadWorkspacePath())
    .then(ws =>
      xdb.switchWorkspace(cli, getPathToBundledWorkspace(), ws).then(() => ws)
    );

export const subscribeListBoards = cli =>
  subscribeIpc(
    (_, payload) =>
      ensureCliWorkspace(cli, R.path(['workspacePath'], payload)).then(ws =>
        xdb.listBoards(getPathToBundledWorkspace(), ws, cli)
      ),
    LIST_BOARDS
  );

export const subscribeListInstalledBoards = cli =>
  subscribeIpc(
    (_, payload) =>
      ensureCliWorkspace(cli, R.path(['workspacePath'], payload)).then(ws =>
        xdb.listInstalledBoards(getPathToBundledWorkspace(), ws, cli)
      ),
    LIST_INSTALLED_BOARDS
  );

export const subscribeUpload = cli =>
  subscribeIpc(
    (_, payload, onProgress) => upload(onProgress, cli, payload),
    UPLOAD_TO_ARDUINO
  );

export const subscribeUpdateIndexes = cli =>
  subscribeIpc(
    (_, payload) =>
      ensureCliWorkspace(cli, R.path(['workspacePath'], payload)).then(ws =>
        xdb.updateIndexes(getPathToBundledWorkspace(), ws, cli)
      ),
    UPDATE_INDEXES
  );

export const subscribeCheckUpdates = cli =>
  subscribeIpc(() => xdb.checkUpdates(cli), CHECK_ARDUINO_DEPENDENCY_UPDATES);

export const subscribeUpgradeArduinoPackages = cli =>
  subscribeIpc(
    (_, _2, onProgress) => xdb.upgradeArduinoPackages(onProgress, cli),
    UPGRADE_ARDUINO_DEPENDECIES
  );
