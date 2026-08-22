import type { ReactNode } from "react";

// A deliberately small markdown-to-JSX renderer, not a general-purpose
// parser. It only handles what the AI strategy prompt's requested output
// format actually produces: #/##/### headers, **bold**, --- rules, "| a |
// b |" pipe tables, plain paragraphs, and 【...】-bracketed section labels
// (the prompt's own template uses 【走势判断】 etc. as its section markers —
// not markdown headers — so every model reliably produces these regardless
// of whether it also decorates its answer with extra # / ** on top, the
// way Claude tends to but GPT-4o/Grok/Gemini often don't).

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-${i}`} className="font-semibold text-slate-100">{part.slice(2, -2)}</strong>;
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

function renderTable(rows: string[], keyPrefix: string): ReactNode {
  const cells = rows.map((row) =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim()),
  );
  // Row 1 = header, row 2 = the "|---|---|" separator (skip it), rest = body.
  const [header, , ...body] = cells;
  return (
    <div key={keyPrefix} className="my-2 overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full text-left text-[12px]">
        <thead>
          <tr className="bg-slate-900/60 text-slate-400">
            {header.map((h, i) => (
              <th key={i} className="px-3 py-1.5 font-semibold">{renderInline(h, `${keyPrefix}-h${i}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="border-t border-slate-800/60 text-slate-300">
              {row.map((c, ci) => (
                <td key={ci} className="px-3 py-1.5">{renderInline(c, `${keyPrefix}-r${ri}c${ci}`)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function renderMarkdown(text: string): ReactNode {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "---") {
      blocks.push(<hr key={key++} className="my-3 border-slate-800" />);
      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push(<h3 key={key++} className="mt-3 mb-1 text-[13px] font-bold text-sky-300">{renderInline(line.slice(4), `h3-${key}`)}</h3>);
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push(<h2 key={key++} className="mt-4 mb-1.5 text-sm font-bold text-emerald-300">{renderInline(line.slice(3), `h2-${key}`)}</h2>);
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push(<h1 key={key++} className="mb-2 text-base font-bold text-slate-100">{renderInline(line.slice(2), `h1-${key}`)}</h1>);
      i++;
      continue;
    }

    // A whole line that's just 【something】 — the prompt template's own
    // section-label style, distinct from markdown headers but meant to
    // read as one. Gets the same visual treatment as a ## header.
    const bracketMatch = line.trim().match(/^【(.+)】$/);
    if (bracketMatch) {
      blocks.push(<h2 key={key++} className="mt-4 mb-1.5 text-sm font-bold text-emerald-300">【{bracketMatch[1]}】</h2>);
      i++;
      continue;
    }

    if (line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push(renderTable(tableLines, `table-${key++}`));
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Plain paragraph. If it opens with a short "标签：" / "label:" prefix
    // (关键支撑：, 止损：, 策略：, etc. — the same detail-line convention
    // the prompt template uses throughout), bold just that label so the
    // line reads the way Claude's own **label** styling already does,
    // instead of running together as one flat sentence.
    const labelMatch = line.match(/^([^：:]{1,14}[：:])(.*)$/);
    if (labelMatch) {
      blocks.push(
        <p key={key++} className="mb-1.5 text-[12px] leading-relaxed text-slate-300">
          <strong className="font-semibold text-slate-100">{labelMatch[1]}</strong>
          {renderInline(labelMatch[2], `p-${key}`)}
        </p>,
      );
      i++;
      continue;
    }

    blocks.push(<p key={key++} className="mb-1.5 text-[12px] leading-relaxed text-slate-300">{renderInline(line, `p-${key}`)}</p>);
    i++;
  }

  return <>{blocks}</>;
}