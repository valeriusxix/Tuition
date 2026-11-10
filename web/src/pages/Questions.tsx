import type { QuestionRow } from "@tuition/shared";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { LINK, PageTitle, SELECT, StackTable, Status, type Column } from "../components/ui";
import { useQuestions } from "../lib/data";
import { shortDate, signed } from "../lib/format";

const PAGE = 40;

const COLUMNS: Column<QuestionRow>[] = [
  {
    key: "q",
    label: "Question",
    title: true,
    render: (q) => (
      <Link className={LINK} to={`/questions/${q.id}`}>
        {q.assetCode} {q.type}, {shortDate(q.decisionDate)}
      </Link>
    ),
  },
  { key: "split", label: "Split", render: (q) => q.split },
  { key: "result", label: "Result", render: (q) => (q.outcome === undefined ? "–" : q.outcome === 1 ? "Yes" : "No") },
  { key: "off", label: "P, OFF", align: "right", render: (q) => q.forecasts.nomem?.p.toFixed(2) ?? "–" },
  { key: "on", label: "P, ON", align: "right", render: (q) => q.forecasts.mem?.p.toFixed(2) ?? "–" },
  { key: "shift", label: "Shift", align: "right", render: (q) => (q.shift === undefined ? "–" : signed(q.shift, 2)) },
  { key: "gain", label: "Gain", align: "right", render: (q) => (q.brierGain === undefined ? "–" : signed(q.brierGain, 3)) },
];

export default function Questions() {
  const questions = useQuestions();
  const [type, setType] = useState("all");
  const [split, setSplit] = useState("all");
  const [asset, setAsset] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [minShift, setMinShift] = useState("0");
  const [limit, setLimit] = useState(PAGE);

  const all = questions.state === "ready" ? questions.data.questions : [];
  const assets = useMemo(() => [...new Set(all.map((q) => q.assetCode))].sort(), [all]);
  const shown = useMemo(
    () =>
      all.filter(
        (q) =>
          (type === "all" || q.type === type) &&
          (split === "all" || q.split === split) &&
          (asset === "all" || q.assetCode === asset) &&
          (outcome === "all" || String(q.outcome) === outcome) &&
          Math.abs(q.shift ?? 0) >= Number(minShift),
      ),
    [all, type, split, asset, outcome, minShift],
  );

  if (questions.state !== "ready") return <Status results={[questions]} />;
  if (all.length === 0) {
    return (
      <>
        <PageTitle title="Questions" />
        <p className="text-paper-2">The question file is empty, so there is nothing to list.</p>
      </>
    );
  }
  const set = (f: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    f(e.target.value);
    setLimit(PAGE);
  };
  return (
    <>
      <PageTitle title="Questions">
        Every one of the {all.length} questions in the headline run, with what each arm said. Shift is the memory-ON probability minus memory-OFF; gain is the Brier
        improvement from memory, positive when memory helped. Open a question to see the chart, the rationales and what was recalled.
      </PageTitle>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <select aria-label="Type" className={SELECT} value={type} onChange={set(setType)}>
          <option value="all">All types</option>
          <option value="DIRECTION">DIRECTION</option>
          <option value="BREAKOUT">BREAKOUT</option>
        </select>
        <select aria-label="Split" className={SELECT} value={split} onChange={set(setSplit)}>
          <option value="all">Dev and test</option>
          <option value="dev">Dev only</option>
          <option value="test">Test only</option>
        </select>
        <select aria-label="Asset" className={SELECT} value={asset} onChange={set(setAsset)}>
          <option value="all">All assets</option>
          {assets.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select aria-label="Outcome" className={SELECT} value={outcome} onChange={set(setOutcome)}>
          <option value="all">Any outcome</option>
          <option value="1">Resolved yes</option>
          <option value="0">Resolved no</option>
        </select>
        <select aria-label="Minimum shift" className={`${SELECT} col-span-2`} value={minShift} onChange={set(setMinShift)}>
          <option value="0">Any shift</option>
          <option value="0.05">Memory moved P by ≥ 0.05</option>
          <option value="0.1">Memory moved P by ≥ 0.10</option>
          <option value="0.2">Memory moved P by ≥ 0.20</option>
        </select>
      </div>
      <p className="mt-4 text-sm text-paper-2" aria-live="polite">
        {shown.length === all.length ? `All ${all.length} questions` : `${shown.length} of ${all.length} questions`}
      </p>
      <div className="mt-2">
        <StackTable columns={COLUMNS} rows={shown.slice(0, limit)} rowKey={(q) => q.id} href={(q) => `/questions/${q.id}`} empty="No question matches these filters." />
      </div>
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit(limit + PAGE)} className="mt-6 h-11 rounded-sm border border-rule-2 px-4 text-sm text-paper hover:border-paper-2">
          Show {Math.min(PAGE, shown.length - limit)} more
        </button>
      )}
    </>
  );
}
