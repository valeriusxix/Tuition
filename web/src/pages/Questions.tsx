import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { PageTitle, SELECT, Status, TableWrap, TD, TDN, TH, THN } from "../components/ui";
import { useQuestions } from "../lib/data";
import { signed } from "../lib/format";

export default function Questions() {
  const questions = useQuestions();
  const navigate = useNavigate();
  const [type, setType] = useState("all");
  const [split, setSplit] = useState("all");
  const [asset, setAsset] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [minShift, setMinShift] = useState("0");

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
  return (
    <>
      <PageTitle title="Questions">Every question in the headline run (the rerun), with what each arm said. Shift is memory ON minus memory OFF.</PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <select aria-label="Type" className={SELECT} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          <option value="DIRECTION">DIRECTION</option>
          <option value="BREAKOUT">BREAKOUT</option>
        </select>
        <select aria-label="Split" className={SELECT} value={split} onChange={(e) => setSplit(e.target.value)}>
          <option value="all">Dev and test</option>
          <option value="dev">Dev</option>
          <option value="test">Test</option>
        </select>
        <select aria-label="Asset" className={SELECT} value={asset} onChange={(e) => setAsset(e.target.value)}>
          <option value="all">All assets</option>
          {assets.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select aria-label="Outcome" className={SELECT} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="all">Any outcome</option>
          <option value="1">Yes</option>
          <option value="0">No</option>
        </select>
        <select aria-label="Minimum shift" className={SELECT} value={minShift} onChange={(e) => setMinShift(e.target.value)}>
          <option value="0">Any shift</option>
          <option value="0.05">|shift| ≥ 0.05</option>
          <option value="0.1">|shift| ≥ 0.10</option>
          <option value="0.2">|shift| ≥ 0.20</option>
        </select>
      </div>
      <p className="mb-3 text-sm text-neutral-400">
        {shown.length} of {all.length} questions
      </p>
      <TableWrap>
        <table className="w-full text-sm">
          <thead className="bg-neutral-900">
            <tr>
              <th className={TH}>Decision</th>
              <th className={TH}>Question</th>
              <th className={TH}>Result</th>
              <th className={THN}>OFF</th>
              <th className={THN}>ON</th>
              <th className={THN}>Shift</th>
              <th className={THN}>Gain</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((q) => (
              <tr key={q.id} onClick={() => void navigate(`/questions/${q.id}`)} className="cursor-pointer border-t border-neutral-800 hover:bg-neutral-900">
                <td className={`${TD} font-mono`}>{q.decisionDate}</td>
                <td className={TD}>
                  <Link className="text-accent underline-offset-2 hover:underline" to={`/questions/${q.id}`}>
                    {q.assetCode} {q.type}
                  </Link>
                </td>
                <td className={TD}>{q.outcome === undefined ? "-" : q.outcome === 1 ? "Yes" : "No"}</td>
                <td className={TDN}>{q.forecasts.nomem?.p.toFixed(2) ?? "-"}</td>
                <td className={TDN}>{q.forecasts.mem?.p.toFixed(2) ?? "-"}</td>
                <td className={TDN}>{q.shift === undefined ? "-" : signed(q.shift, 2)}</td>
                <td className={TDN}>{q.brierGain === undefined ? "-" : signed(q.brierGain, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
