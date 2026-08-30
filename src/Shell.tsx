// src/Shell.tsx
import { useState } from "react";
import App from "./App";
import HomePage, { type ModuleId } from "./HomePage";
import SimulatorPage from "./SimulatorPage";
import AIStrategyPage from "./AIStrategyPage";
import ScenarioSelectorPage, { type SelectorState } from "./ScenarioSelectorPage";
import ErrorBoundary from "@/components/ErrorBoundary";
import { MarginErrorDialog } from "@/components/dialogs";
import { openSimPosition, loadSimAccount, InsufficientMarginError, type MarginCheckResult } from "@/lib/simAccount";
import type { Leg } from "@/lib/types";

type View = "home" | "workspace" | "simulator" | "simOrigin" | "ai" | "scenarioSelector";

export default function Shell() {
  const [view, setView] = useState<View>("home");
  // When entering the workspace via the "Tracking" card, jump straight into
  // the manage-strategies dialog so the user can pick what to track — reuses
  // the existing tracking UI as-is, no need to duplicate it.
  const [autoOpenManage, setAutoOpenManage] = useState(false);
  // Set whenever openSimPosition rejects a position for lack of margin, from
  // EITHER entry point below — rendered as an overlay on top of whatever
  // view is currently showing, since the person could be coming from the
  // simOrigin flow or the analysis-mode shortcut when this happens.
  const [marginError, setMarginError] = useState<MarginCheckResult | null>(null);
  // Set when the scenario selector's "use this" button is pressed — carried
  // into simOrigin as its pre-fill (see App.tsx's simOriginInitial prop),
  // then cleared once simOrigin is left via a successful open or a plain
  // "New Position" click (not via cancel — see cameFromScenario below).
  const [simOriginInitial, setSimOriginInitial] = useState<{ symbol: string; legs: Leg[]; spot: number } | null>(null);
  // Whether the CURRENT simOrigin session was reached via the scenario
  // selector — determines where "cancel" goes back to: the selector's
  // results list (so a rejected candidate can be swapped for another one
  // from the same list) vs. the plain simulator home for the ordinary
  // "New Position" flow.
  const [cameFromScenario, setCameFromScenario] = useState(false);
  // The scenario selector's own inputs/results, kept alive here across a
  // simOrigin round trip — see ScenarioSelectorPage's Props comment.
  const [scenarioState, setScenarioState] = useState<SelectorState | undefined>(undefined);

  const goHome = () => setView("home");
  const goSimulator = () => setView("simulator");

  const handleSelectModule = (id: ModuleId) => {
    if (id === "analysis") {
      setAutoOpenManage(false);
      setView("workspace");
    } else if (id === "tracking") {
      setAutoOpenManage(true);
      setView("workspace");
    } else if (id === "simulator") {
      setView("simulator");
    } else {
      setView("ai");
    }
  };

  const handleConfirmSimOpen = async (payload: { symbol: string; legs: Leg[]; spot: number }) => {
    try {
      await openSimPosition(payload);
      setSimOriginInitial(null);
      setCameFromScenario(false);
      setScenarioState(undefined);
      goSimulator();
    } catch (e) {
      if (e instanceof InsufficientMarginError) {
        setMarginError(e.detail);
        return; // stay on the simOrigin leg-builder so the person can adjust the combo, rather than bouncing them to the simulator on a failed open
      }
      throw e;
    }
  };

  // Shortcut used from ordinary analysis mode (not the simOrigin flow) to
  // paper-trade the combo that's already built, without leaving to rebuild
  // it a second time from the simulator's "New Position" screen. If there's
  // no simulated account yet, send the person to the simulator instead of
  // silently failing — its own onboarding screen handles setting one up.
  const handleAddToSimAccount = async (payload: { symbol: string; legs: Leg[]; spot: number }) => {
    const account = await loadSimAccount();
    if (!account) {
      goSimulator();
      return { ok: false, needsSetup: true };
    }
    try {
      await openSimPosition(payload);
      goSimulator();
      return { ok: true };
    } catch (e) {
      if (e instanceof InsufficientMarginError) {
        setMarginError(e.detail);
        return { ok: false, needsSetup: false };
      }
      throw e;
    }
  };

  let content: JSX.Element;
  if (view === "home") {
    content = (
      <ErrorBoundary>
        <HomePage onSelectModule={handleSelectModule} />
      </ErrorBoundary>
    );
  } else if (view === "workspace") {
    content = (
      <ErrorBoundary onGoHome={goHome}>
        <App onBackHome={goHome} autoOpenManage={autoOpenManage} onAddToSimAccount={handleAddToSimAccount} />
      </ErrorBoundary>
    );
  } else if (view === "simOrigin") {
    content = (
      <ErrorBoundary onGoHome={goSimulator}>
        <App
          simOrigin
          simOriginInitial={simOriginInitial ?? undefined}
          onConfirmSimOpen={handleConfirmSimOpen}
          onCancelSimOrigin={() => {
            if (cameFromScenario) {
              setView("scenarioSelector"); // back to the results list, not a blank simulator home — the candidate just didn't fit, the rest of the list might still have one that does
            } else {
              setSimOriginInitial(null);
              goSimulator();
            }
          }}
        />
      </ErrorBoundary>
    );
  } else if (view === "simulator") {
    content = (
      <ErrorBoundary onGoHome={goHome}>
        <SimulatorPage
          onBack={goHome}
          onNewPosition={() => { setSimOriginInitial(null); setCameFromScenario(false); setView("simOrigin"); }}
          onStartFromScenario={() => setView("scenarioSelector")}
        />
      </ErrorBoundary>
    );
  } else if (view === "scenarioSelector") {
    content = (
      <ErrorBoundary onGoHome={goSimulator}>
        <ScenarioSelectorPage
          onBack={goSimulator}
          persisted={scenarioState}
          onPersist={setScenarioState}
          onUseCandidate={(payload) => {
            setSimOriginInitial(payload);
            setCameFromScenario(true);
            setView("simOrigin");
          }}
        />
      </ErrorBoundary>
    );
  } else {
    content = (
      <ErrorBoundary onGoHome={goHome}>
        <AIStrategyPage onBack={goHome} />
      </ErrorBoundary>
    );
  }

  return (
    <>
      {content}
      {marginError && <MarginErrorDialog detail={marginError} onClose={() => setMarginError(null)} />}
    </>
  );
}