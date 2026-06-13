/** Payload for `library-updated` CustomEvent (WS broadcast + local dispatch). */

export type LibraryEntityType = "playlist" | "source" | "radio";
export type LibraryAction = "created" | "updated" | "deleted";

export type LibraryUpdatedDetail = {
  branchId?: string;
  entityType?: LibraryEntityType;
  action?: LibraryAction;
  /** Playlist id, source id, or radio id when known. */
  entityId?: string;
};

export const LIBRARY_UPDATED_EVENT = "library-updated";
