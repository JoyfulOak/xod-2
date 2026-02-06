import * as R from 'ramda';
import React from 'react';
import PropTypes from 'prop-types';

import { foldMaybe } from 'xod-func-tools';
import * as XP from 'xod-project';

import PopupForm from '../../utils/components/PopupForm';

const MANAGED_LIBRARY = 'my/nodes';

const byLabel = R.ascend(R.prop('label'));

class LibraryManagerPopup extends React.PureComponent {
  constructor(props) {
    super(props);

    const { defaultPatchPath, defaultLibName } = this.getDefaults(props);

    this.state = {
      patchPath: defaultPatchPath,
      libName: defaultLibName,
    };

    this.onPatchChange = this.onPatchChange.bind(this);
    this.onLibNameChange = this.onLibNameChange.bind(this);
    this.onMoveClicked = this.onMoveClicked.bind(this);
    this.onDeleteLibrary = this.onDeleteLibrary.bind(this);
  }

  componentDidUpdate(prevProps) {
    if (!prevProps.isVisible && this.props.isVisible) {
      const { defaultPatchPath, defaultLibName } = this.getDefaults(this.props);
      this.setState({
        patchPath: defaultPatchPath,
        libName: defaultLibName,
      });
    }
  }

  getDefaults(props) {
    const patchOptions = this.getEditablePatchOptions(props);
    return {
      defaultPatchPath: patchOptions.length ? patchOptions[0].value : '',
      defaultLibName: MANAGED_LIBRARY,
    };
  }

  getEditablePatchOptions(props = this.props) {
    const { localPatches } = props;
    return R.compose(
      R.sort(byLabel),
      R.map(p => ({
        value: XP.getPatchPath(p),
        label: XP.getBaseName(XP.getPatchPath(p)),
      }))
    )(localPatches);
  }

  getLibraryOptions(props = this.props) {
    const { libraryNames } = props;
    return R.compose(
      R.sortBy(R.prop('label')),
      R.map(name => ({ value: name, label: name }))
    )(libraryNames);
  }

  onPatchChange(event) {
    this.setState({ patchPath: event.target.value });
  }

  onLibNameChange(event) {
    this.setState({ libName: event.target.value });
  }

  onMoveClicked() {
    const { patchPath, libName } = this.state;
    if (!patchPath || !libName) return;
    this.props.onMovePatch(patchPath, libName);

    const isCurrentPatch = foldMaybe(
      false,
      R.equals(patchPath),
      this.props.currentPatchPath
    );
    if (isCurrentPatch) {
      const newPatchPath = `${libName}/${XP.getBaseName(patchPath)}`;
      this.props.onSwitchPatch(newPatchPath);
    }
  }

  onDeleteLibrary(event) {
    const libName = event.target.value;
    if (!libName) return;
    const shouldDelete = window.confirm(
      `Delete library "${libName}" and all its patches?`
    );
    if (!shouldDelete) return;

    this.props.onDeleteLibrary(libName);
  }

  render() {
    const patchOptions = this.getEditablePatchOptions();
    const libraryOptions = this.getLibraryOptions().filter(
      option => option.value !== MANAGED_LIBRARY
    );

    return (
      <PopupForm
        className="LibraryManagerPopup"
        title="Library Manager"
        isVisible={this.props.isVisible}
        onClose={this.props.onClose}
      >
        <div className="LibraryManagerPopup-section">
          <div className="LibraryManagerPopup-sectionTitle">Move Patch</div>
          <div className="LibraryManagerPopup-row">
            <label>Patch</label>
            <select value={this.state.patchPath} onChange={this.onPatchChange}>
              {patchOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="LibraryManagerPopup-row">
            <label>Target Library</label>
            <select value={this.state.libName} onChange={this.onLibNameChange}>
              <option value={MANAGED_LIBRARY}>{MANAGED_LIBRARY}</option>
            </select>
          </div>
          <div className="LibraryManagerPopup-actions">
            <button
              className="LibraryManagerPopup-primary"
              onClick={this.onMoveClicked}
              disabled={!this.state.patchPath || !this.state.libName}
            >
              Move Patch
            </button>
          </div>
          <div className="LibraryManagerPopup-hint">
            Move local patches into a library to reuse them across projects.
          </div>
        </div>

        <div className="LibraryManagerPopup-section">
          <div className="LibraryManagerPopup-sectionTitle">Delete Library</div>
          <div className="LibraryManagerPopup-row">
            <label>Library</label>
            <select defaultValue="" onChange={this.onDeleteLibrary}>
              <option value="" disabled>
                Select library
              </option>
              {libraryOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="LibraryManagerPopup-hint">
            Deleting a library removes all patches from your project.
          </div>
        </div>
      </PopupForm>
    );
  }
}

LibraryManagerPopup.propTypes = {
  isVisible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onMovePatch: PropTypes.func.isRequired,
  onDeleteLibrary: PropTypes.func.isRequired,
  onSwitchPatch: PropTypes.func.isRequired,
  currentPatchPath: PropTypes.object,
  localPatches: PropTypes.array.isRequired,
  libraryNames: PropTypes.array.isRequired,
};

LibraryManagerPopup.defaultProps = {
  currentPatchPath: null,
};

export default LibraryManagerPopup;
