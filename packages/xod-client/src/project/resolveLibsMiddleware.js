import * as R from 'ramda';
import { explode } from 'xod-func-tools';
import { listMissingLibraryNames, getLibraryName } from 'xod-project';
import { parseLibQuery } from 'xod-pm';

import { installLibraries } from '../editor/actions';
import { PROJECT_OPEN, PROJECT_IMPORT } from './actionTypes';
import { getProject } from './selectors';

export default store => next => action => {
  const res = next(action);

  if (R.contains(action.type, [PROJECT_OPEN, PROJECT_IMPORT])) {
    const project = getProject(store.getState());
    const removedLibraries = R.pathOr([], ['removedLibraries'], project);
    const removedLibraryPatches = R.pathOr(
      [],
      ['removedLibraryPatches'],
      project
    );
    const lockedLibraries = R.uniq(
      R.map(getLibraryName, removedLibraryPatches)
    );
    const missingLibParams = R.compose(
      R.map(R.compose(explode, parseLibQuery)),
      R.reject(R.contains(R.__, removedLibraries)),
      R.reject(R.contains(R.__, lockedLibraries)),
      listMissingLibraryNames
    )(project);

    if (missingLibParams.length > 0) {
      store.dispatch(installLibraries(missingLibParams));
    }
  }

  return res;
};
