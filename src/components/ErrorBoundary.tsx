import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";

interface Props {
  children: ReactNode;
  // Shown as a secondary action alongside "Retry" when provided — lets a
  // whole-module crash (analysis mode, simulator, etc.) recover by
  // navigating away instead of retrying in place, since some crashes are
  // triggered by the current state and would just happen again immediately.
  onGoHome?: () => void;
  // Overrides the default "something went wrong" copy for boundaries that
  // want a more specific message (e.g. the chart-only boundary in App.tsx).
  title?: string;
  description?: string;
}

interface State {
  hasError: boolean;
}

// React error boundaries must be class components — there is no hook
// equivalent (getDerivedStateFromError/componentDidCatch have no useX form)
// — so this stays a class while the actual fallback UI below is an ordinary
// function component that can use useI18n normally.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No crash-reporting service wired up yet — at minimum this keeps the
    // real error visible in devtools instead of disappearing silently.
    console.error("ErrorBoundary caught an error:", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          onRetry={this.handleRetry}
          onGoHome={this.props.onGoHome}
          title={this.props.title}
          description={this.props.description}
        />
      );
    }
    return this.props.children;
  }
}

function ErrorFallback({
  onRetry,
  onGoHome,
  title,
  description,
}: {
  onRetry: () => void;
  onGoHome?: () => void;
  title?: string;
  description?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border border-rose-500/30 bg-rose-950/10 p-6 text-center">
      <AlertTriangle size={22} className="text-rose-400" />
      <div>
        <p className="text-sm font-semibold text-rose-200">{title ?? t("error.boundaryTitle")}</p>
        <p className="mt-1 text-[12px] text-slate-400">{description ?? t("error.boundaryDesc")}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-rose-500"
        >
          <RefreshCw size={12} />
          {t("error.retry")}
        </button>
        {onGoHome && (
          <button
            onClick={onGoHome}
            className="flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            <Home size={12} />
            {t("home.backToHome")}
          </button>
        )}
      </div>
    </div>
  );
}