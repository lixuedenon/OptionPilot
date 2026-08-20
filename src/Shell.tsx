import { useState } from "react";
import { Sparkles } from "lucide-react";
import App from "./App";
import HomePage, { type ModuleId } from "./HomePage";
import ComingSoonPage from "./ComingSoonPage";
import SimulatorPage from "./SimulatorPage";
import { openSimPosition } from "@/lib/simAccount";
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

  if (view === "home") {
    return <HomePage onSelectModule={handleSelectModule} />;
  }

  if (view === "workspace") {
    return <App onBackHome={goHome} autoOpenManage={autoOpenManage} />;
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