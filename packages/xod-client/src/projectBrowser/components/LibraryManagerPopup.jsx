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

    const {
      defaultPatchPath,
      defaultLibName,
      defaultHiddenLibName,
    } = this.getDefaults(props);

    this.state = {
      patchPath: defaultPatchPath,
      libName: defaultLibName,
      hiddenLibName: defaultHiddenLibName,
      deleteLibName: '',
    };

    this.onPatchChange = this.onPatchChange.bind(this);
    this.onLibNameChange = this.onLibNameChange.bind(this);
    this.onMoveClicked = this.onMoveClicked.bind(this);
    this.onDeleteLibrary = this.onDeleteLibrary.bind(this);
    this.onDeleteLibraryChange = this.onDeleteLibraryChange.bind(this);
    this.onHiddenLibChange = this.onHiddenLibChange.bind(this);
    this.onUnhideLibraryNodes = this.onUnhideLibraryNodes.bind(this);
  }

  componentDidUpdate(prevProps) {
    if (!prevProps.isVisible && this.props.isVisible) {
      const {
        defaultPatchPath,
        defaultLibName,
        defaultHiddenLibName,
      } = this.getDefaults(this.props);
      this.setState({
        patchPath: defaultPatchPath,
        libName: defaultLibName,
        hiddenLibName: defaultHiddenLibName,
        deleteLibName: '',
      });
    }
  }

  getDefaults(props) {
    const patchOptions = this.getEditablePatchOptions(props);
    const hiddenLibraryOptions = this.getHiddenLibraryOptions(props);
    return {
      defaultPatchPath: patchOptions.length ? patchOptions[0].value : '',
      defaultLibName: MANAGED_LIBRARY,
      defaultHiddenLibName: hiddenLibraryOptions.length
        ? hiddenLibraryOptions[0].value
        : '',
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

  getHiddenLibraryOptions(props = this.props) {
    const { removedLibraryPatches } = props;
    const libraryNames = R.compose(
      R.sortBy(R.identity),
      R.uniq,
      R.map(XP.getLibraryName)
    )(removedLibraryPatches);
    return R.map(name => ({ value: name, label: name }))(libraryNames);
  }

  onPatchChange(event) {
    this.setState({ patchPath: event.target.value });
  }

  onLibNameChange(event) {
    this.setState({ libName: event.target.value });
  }

  onHiddenLibChange(event) {
    this.setState({ hiddenLibName: event.target.value });
  }

  onDeleteLibraryChange(event) {
    this.setState({ deleteLibName: event.target.value });
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

  onDeleteLibrary() {
    const { deleteLibName } = this.state;
    const libName = deleteLibName;
    if (!libName) return;
    const shouldDelete = window.confirm(
      `Delete library "${libName}" and all its patches?`
    );
    if (!shouldDelete) return;

    this.props.onDeleteLibrary(libName);
  }

  onUnhideLibraryNodes() {
    const { hiddenLibName } = this.state;
    if (!hiddenLibName) return;
    this.props.onUnhideLibraryNodes(hiddenLibName);
  }

  render() {
    const patchOptions = this.getEditablePatchOptions();
    const libraryOptions = this.getLibraryOptions().filter(
      option => option.value !== MANAGED_LIBRARY
    );
    const hiddenLibraryOptions = this.getHiddenLibraryOptions();
    const hasHiddenLibraries = hiddenLibraryOptions.length > 0;

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
            <select
              value={this.state.patchPath}
              onChange={this.onPatchChange}
              className="inspectorSelectInput inspectorInput--full-width"
            >
              {patchOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="LibraryManagerPopup-row">
            <label>Target Library</label>
            <select
              value={this.state.libName}
              onChange={this.onLibNameChange}
              className="inspectorSelectInput inspectorInput--full-width"
            >
              <option value={MANAGED_LIBRARY}>{MANAGED_LIBRARY}</option>
            </select>
          </div>
          <div className="LibraryManagerPopup-actions">
            <button
              className="Button Button--primary"
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
          <div className="LibraryManagerPopup-sectionTitle">Hidden Nodes</div>
          <div className="LibraryManagerPopup-row">
            <label>Library</label>
            <select
              value={this.state.hiddenLibName}
              onChange={this.onHiddenLibChange}
              disabled={!hasHiddenLibraries}
              className="inspectorSelectInput inspectorInput--full-width"
            >
              {!hasHiddenLibraries ? (
                <option value="" disabled>
                  No hidden nodes
                </option>
              ) : null}
              {hiddenLibraryOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="LibraryManagerPopup-actions">
            <button
              className="Button Button--primary"
              onClick={this.onUnhideLibraryNodes}
              disabled={!this.state.hiddenLibName}
            >
              Unhide
            </button>
          </div>
          <div className="LibraryManagerPopup-hint">
            Hidden nodes are removed from the library list only.
          </div>
        </div>

        <div className="LibraryManagerPopup-section">
          <div className="LibraryManagerPopup-sectionTitle">Delete Library</div>
          <div className="LibraryManagerPopup-row">
            <label>Library</label>
            <select
              value={this.state.deleteLibName}
              onChange={this.onDeleteLibraryChange}
              className="inspectorSelectInput inspectorInput--full-width"
            >
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
          <div className="LibraryManagerPopup-actions">
            <button
              className="Button Button--primary"
              onClick={this.onDeleteLibrary}
              disabled={!this.state.deleteLibName}
            >
              Delete
            </button>
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
  onUnhideLibraryNodes: PropTypes.func.isRequired,
  onSwitchPatch: PropTypes.func.isRequired,
  currentPatchPath: PropTypes.object,
  localPatches: PropTypes.array.isRequired,
  libraryNames: PropTypes.array.isRequired,
  removedLibraryPatches: PropTypes.array.isRequired,
};

LibraryManagerPopup.defaultProps = {
  currentPatchPath: null,
};

export default LibraryManagerPopup;
