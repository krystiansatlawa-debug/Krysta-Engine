import { useEffect } from "react";
import { useAppDispatch } from "./redux";
import { updateGameNewDownloadOptionsBatch } from "@renderer/features";

export function useDownloadOptionsListener() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const unsubscribe = window.electron.onNewDownloadOptions(
      (gamesWithNewOptions) => {
        if (gamesWithNewOptions.length) dispatch(updateGameNewDownloadOptionsBatch(gamesWithNewOptions));
      }
    );

    return unsubscribe;
  }, [dispatch]);
}
