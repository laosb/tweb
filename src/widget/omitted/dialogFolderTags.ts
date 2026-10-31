// Reaction-participant rows never belong to a folder list.
export default function attachDialogFolderTags() {
  return {setDialog() {}, hasTags: () => false};
}
