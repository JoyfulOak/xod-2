import * as R from 'ramda';
import { noop, isAmong } from 'xod-func-tools';

import promisifyIpc from '../view/promisifyIpc';
import { LIST_BOARDS, UPLOAD_TO_ARDUINO } from '../shared/events';

const listBoardsIpc = promisifyIpc(LIST_BOARDS);

const getPackageFromFqbn = R.pipe(R.split(':'), R.take(2), R.join(':'));

export const listBoards = workspacePath =>
  listBoardsIpc(
    noop,
    workspacePath ? { workspacePath } : null
  ).then(({ installed, available }) => {
    const installedPackages = R.compose(
      R.uniq,
      R.map(getPackageFromFqbn),
      R.pluck('fqbn')
    )(installed);

    const result = {
      installed,
      available: R.reject(
        R.propSatisfies(isAmong(installedPackages), 'package'),
        available || []
      ),
    };
    if (process.env.XOD_BOARD_LIST_DEBUG === '1') {
      // eslint-disable-next-line no-console
      console.log(
        `[xod] listBoards(renderer): installed=${result.installed.length} ` +
          `available=${result.available.length}`
      );
    }
    return result;
  });

export const upload = promisifyIpc(UPLOAD_TO_ARDUINO);
