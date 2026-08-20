import { useState } from "react";
import { Sparkles } from "lucide-react";
import App from "./App";
import HomePage, { type ModuleId } from "./HomePage";
import ComingSoonPage from "./ComingSoonPage";
import SimulatorPage from "./SimulatorPage";
import { openSimPosition, loadSimAccount } from "@/lib/simAccount";
import type { Leg } from "@/lib/types";
import { useI18n } from "@/i18n/I18nContext";

type View = "home" | "workspace" | "simulator" | "simOrigin" | "ai";

export default function Shell() {
  const { t } = useI18n();
  const [view, setView] = useState<View>("home");
  // When entering the workspace via the "Tracking" card, jump straight into
  // the manage-strategies dialog so the user can pick what to track — reuses
  // the existing tracking UI as-is, no need to duplicate it.
  const [autoOpenManage, setAutoOpenManage] = useState(false);

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
    await openSimPosition(payload);
    goSimulator();
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
    await openSimPosition(payload);
    goSimulator();
    return { ok: true };
  };

  if (view === "home") {
    return <HomePage onSelectModule={handleSelectModule} />;
  }

  if (view === "workspace") {
    return <App onBackHome={goHome} autoOpenManage={autoOpenManage} onAddToSimAccount={handleAddToSimAccount} />;
  }

  if (view === "simOrigin") {
    return (
      <App
        simOrigin
        onConfirmSimOpen={handleConfirmSimOpen}
        onCancelSimOrigin={goSimulator}
      />
    );
  }

  if (view === "simulator") {
    return <SimulatorPage onBack={goHome} onNewPosition={() => setView("simOrigin")} />;
  }

  return <ComingSoonPage title={t("home.aiTitle")} icon={<Sparkles size={26} />} onBack={goHome} />;
}