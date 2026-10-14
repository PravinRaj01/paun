import { createContext, useContext } from "react";

/** What a page inside the app shell can ask the shell to do (the Settings dialog lives in the shell). */
export type ShellActions = { openSettings: () => void };

export const ShellContext = createContext<ShellActions>({ openSettings: () => {} });
export const useShell = () => useContext(ShellContext);
