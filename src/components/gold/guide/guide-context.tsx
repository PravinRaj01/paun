import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { isTopicId, type TopicId } from "./topics";

const GuideDialog = lazy(() => import("./GuideDialog"));

type GuideApi = {
  isOpen: boolean;
  /** Open the book, at a topic's page when one is given (an unknown topic opens the book where the reader left it). */
  open: (topic?: TopicId | string) => void;
  close: () => void;
};

const GuideContext = createContext<GuideApi>({ isOpen: false, open: () => {}, close: () => {} });

/** One guide for the whole app: the dock, the landing page, the More page and Check price all open the same book. */
export function GuideProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; topic: TopicId | undefined; ever: boolean }>({ open: false, topic: undefined, ever: false });
  const open = useCallback((topic?: string) => setState({ open: true, topic: isTopicId(topic) ? topic : undefined, ever: true }), []);
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const api = useMemo<GuideApi>(() => ({ isOpen: state.open, open, close }), [state.open, open, close]);
  return (
    <GuideContext.Provider value={api}>
      {children}
      {state.ever && (
        <Suspense fallback={null}>
          <GuideDialog open={state.open} topic={state.topic} onOpenChange={(o) => setState((s) => ({ ...s, open: o }))} />
        </Suspense>
      )}
    </GuideContext.Provider>
  );
}

export const useGuide = () => useContext(GuideContext);
