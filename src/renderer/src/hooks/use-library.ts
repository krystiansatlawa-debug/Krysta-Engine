import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import { store, type AppDispatch } from "@renderer/store";
import { setLibrary } from "@renderer/features";

type SetLibraryAction = ReturnType<typeof setLibrary>;

let inFlight: Promise<SetLibraryAction> | null = null;
let trailing: Promise<SetLibraryAction> | null = null;

const startLibraryUpdate = (dispatch: AppDispatch) => {
  const update = window.electron
    .getLibrary(true)
    .then((library) => {
      const previous = store.getState().library.downloadLibrary;
      const byId = new Map(previous.map(game => [game.id, game]));
      // Reuse unchanged rows rather than replacing every card's props.
      const next = library.map(game => {
        const old = byId.get(game.id);
        if (old && JSON.stringify(old) === JSON.stringify(game)) return old;
        return Object.freeze(game);
      });
      return dispatch(setLibrary(next));
    })
    .finally(() => {
      if (inFlight === update) inFlight = null;
    });
  inFlight = update;
  return update;
};

/**
 * Callers share the running library fetch. A caller arriving mid-fetch waits
 * for one follow-up fetch so it still observes writes made before its call.
 */
const requestLibraryUpdate = (dispatch: AppDispatch) => {
  if (inFlight === null) return startLibraryUpdate(dispatch);

  trailing ??= inFlight
    .catch(() => undefined)
    .then(() => {
      trailing = null;
      return inFlight ?? startLibraryUpdate(dispatch);
    });
  return trailing;
};

export function useLibrary() {
  const dispatch = useAppDispatch();
  const library = useAppSelector((state) => state.library.value);
  const downloadLibrary = useAppSelector(
    (state) => state.library.downloadLibrary
  );

  const updateLibrary = useCallback(
    () => requestLibraryUpdate(dispatch),
    [dispatch]
  );

  return { library, downloadLibrary, updateLibrary };
}
