import { useState } from "react";
import { RefreshCw, AlertTriangle, Sparkles } from "lucide-react";
import { useI18n } from "@/i18n/I18nContext";
import { renderMarkdown } from "@/lib/miniMarkdown";

interface Props {
  onBack: () => void;
}

interface StrategyResult {
  ticker: string;
  currentPrice: number;
  generatedAt: string;
  claude: string;
  gpt4o: string;
  grok: string;
  gemini: string;
}

const MODELS: { key: keyof Pick<StrategyResult, "claude" | "gpt4o" | "grok" | "gemini">; label: string }[] = [
  { key: "claude", label: "Claude" },
  { key: "gpt4o", label: "GPT-4o" },
  { key: "grok", label: "Grok" },
  { key: "gemini", label: "Gemini" },
];

// TEMPORARY dev-preview version. The real version reads a result that a
// daily Supabase Cron job already generated and stored — nobody's browser
// click should trigger a fresh model call, since that's exactly the "cost
// scales with users" problem the whole pipeline was designed to avoid (see
// the AI-strategy integration notes). This page exists so there's
// something to actually look at before that infrastructure (DB table +
// Cron schedule) is built; the button below is standing in for what will
// become a simple "read today's cached result" fetch.
export default function AIStrategyPage({ onBack }: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StrategyResult | null>(null);
  const [activeModel, setActiveModel] = useState<typeof MODELS[number]["key"]>("claude");

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-analysis`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      });
      if (!resp.ok) throw new Error(`请求失败 (${resp.status})`);
      const data = await resp.json();
      // A pipeline-level failure (data fetch, prompt build) throws here.
      // An individual model failing (bad/missing key, that provider's own
      // error) does NOT — each model's result renders in its own tab,
      // failed or not, same as daily_strategy.py showing "❌ Grok失败: ..."
      // inline in its terminal report rather than aborting the whole run.
      if (data.error) throw new Error(data.error);
      setResult(data);
      setActiveModel("claude");
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  };

  const activeContent = result?.[activeModel];
  const activeFailed = typeof activeContent === "string" && activeContent.startsWith("❌");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-2">
        <button
          onClick={onBack}
          title={t("home.backToHome")}
          className="flex items-center rounded transition hover:opacity-80"
        >
          <img src="/image copy 2.png" alt="OptionPilot" className="h-10 w-auto shrink-0 object-contain" />
        </button>
        <h1 className="text-sm font-bold text-slate-100">{t("home.aiTitle")}</h1>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-900/10 px-3 py-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-relaxed text-amber-200">
            临时预览版：点击按钮会立即真实调用四个模型（产生实际费用）。正式版会改成每天收盘后自动生成一次、存进数据库，用户打开只读当天已有的结果，不会每次点击都重新调用模型。
          </p>
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-emerald-600/60 bg-emerald-950/30 px-4 py-2 text-[12px] font-semibold text-emerald-300 transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {loading ? "生成中（价格数据+期权链+市场环境+调用四个模型，约30-90秒）..." : "生成今日 QQQ 策略分析"}
        </button>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-950/10 px-3 py-2 text-[12px] text-rose-300">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-2 text-[11px] text-slate-500">
              <span>{result.ticker} · 当前价 ${result.currentPrice}</span>
              <span>{new Date(result.generatedAt).toLocaleString("zh-CN")}</span>
            </div>

            <div className="mb-3 flex gap-1.5">
              {MODELS.map((m) => {
                const content = result[m.key];
                const failed = typeof content === "string" && content.startsWith("❌");
                return (
                  <button
                    key={m.key}
                    onClick={() => setActiveModel(m.key)}
                    className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${
                      activeModel === m.key
                        ? "bg-emerald-600 text-white"
                        : failed
                          ? "border border-rose-800/60 bg-slate-900 text-rose-400 hover:border-rose-600"
                          : "border border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    {m.label}{failed ? " ⚠" : ""}
                  </button>
                );
              })}
            </div>

            {activeFailed ? (
              <div className="rounded-lg border border-rose-500/30 bg-rose-950/10 px-3 py-2 text-[12px] text-rose-300">
                {activeContent}
              </div>
            ) : (
              renderMarkdown(activeContent ?? "")
            )}
          </div>
        )}
      </div>
    </div>
  );
}