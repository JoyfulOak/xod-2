import React from 'react';
import PropTypes from 'prop-types';

import {
  isValidUserDefinedPatchBasename,
  PATCH_BASENAME_RULES,
} from 'xod-project';
import { POPUP_ID } from '../../popups/constants';
import { isPopupVisible } from '../../popups/selectors';

import PopupPrompt from '../../utils/components/PopupPrompt';
import PopupConfirm from '../../utils/components/PopupConfirm';
import PopupAlert from '../../utils/components/PopupAlert';
import { patchBasenameMask } from '../../utils/inputFormatting';
import LibraryManagerPopup from './LibraryManagerPopup';

class ProjectBrowserPopups extends React.PureComponent {
  constructor(props) {
    super(props);

    this.onPatchDeleteConfirmed = this.onPatchDeleteConfirmed.bind(this);
    this.onPatchRenameConfirmed = this.onPatchRenameConfirmed.bind(this);
  }

  onPatchDeleteConfirmed() {
    this.props.onPatchDelete(this.props.selectedPatchPath);
  }

  onPatchRenameConfirmed(name) {
    this.props.onPatchRename(this.props.selectedPatchPath, name);
  }

  getProjectName() {
    return this.props.projectName;
  }

  getSelectedPatchName() {
    return this.props.selectedPatchName;
  }

  renderPatchRenamingPopup() {
    const selectedPatchName = this.getSelectedPatchName();

    return (
      <PopupPrompt
        key="rename_patch"
        title="Rename patch"
        value={selectedPatchName}
        onConfirm={this.onPatchRenameConfirmed}
        onClose={this.props.onCloseAllPopups}
        inputMask={patchBasenameMask}
        inputValidator={isValidUserDefinedPatchBasename}
        helpText={PATCH_BASENAME_RULES}
      >
        Type new name for patch &laquo;{selectedPatchName}&raquo;:
      </PopupPrompt>
    );
  }

  renderPatchDeletingPopup() {
    const selectedPatchName = this.getSelectedPatchName();

    return (
      <PopupConfirm
        key="delete_patch"
        title="Delete the patch"
        onConfirm={this.onPatchDeleteConfirmed}
        onClose={this.props.onCloseAllPopups}
      >
        Are you sure you want to delete patch &laquo;{selectedPatchName}&raquo;?
      </PopupConfirm>
    );
  }

  renderMovedToMyNodesPopup() {
    return (
      <PopupAlert
        key="moved_to_mynodes"
        title="Moved"
        onClose={this.props.onCloseAllPopups}
      >
        Moved to my/nodes.
      </PopupAlert>
    );
  }

  render() {
    if (isPopupVisible(POPUP_ID.RENAMING_PATCH, this.props.popups)) {
      return this.renderPatchRenamingPopup();
    }
    if (isPopupVisible(POPUP_ID.DELETING_PATCH, this.props.popups)) {
      return this.renderPatchDeletingPopup();
    }
    if (isPopupVisible(POPUP_ID.MOVED_TO_MYNODES, this.props.popups)) {
      return this.renderMovedToMyNodesPopup();
    }
    if (isPopupVisible(POPUP_ID.LIBRARY_MANAGER, this.props.popups)) {
      return (
        <LibraryManagerPopup
          isVisible
          onClose={this.props.onCloseAllPopups}
          onMovePatch={this.props.onMovePatchToLibrary}
          onDeleteLibrary={this.props.onDeleteLibrary}
          onUnhideLibraryNodes={this.props.onUnhideLibraryNodes}
          onSwitchPatch={this.props.onSwitchPatch}
          currentPatchPath={this.props.currentPatchPath}
          localPatches={this.props.localPatches}
          libraryNames={this.props.libraryNames}
          removedLibraryPatches={this.props.removedLibraryPatches}
        />
      );
    }
    return null;
  }
}

ProjectBrowserPopups.propTypes = {
  selectedPatchPath: PropTypes.string,
  selectedPatchName: PropTypes.string,
  popups: PropTypes.object,
  projectName: PropTypes.string,
  currentPatchPath: PropTypes.object,
  localPatches: PropTypes.array,
  libraryNames: PropTypes.array,
  removedLibraryPatches: PropTypes.array,
  onPatchRename: PropTypes.func.isRequired,
  onPatchDelete: PropTypes.func.isRequired,
  onMovePatchToLibrary: PropTypes.func.isRequired,
  onDeleteLibrary: PropTypes.func.isRequired,
  onUnhideLibraryNodes: PropTypes.func.isRequired,
  onSwitchPatch: PropTypes.func.isRequired,

  onCloseAllPopups: PropTypes.func.isRequired,
};

ProjectBrowserPopups.defaultProps = {
  selectedPatchPath: null,
  localPatches: [],
  libraryNames: [],
  removedLibraryPatches: [],
};

export default ProjectBrowserPopups;
