import type { LessonRow } from "@tuition/shared";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { BlobLink, Chip, PageTitle, SELECT, Status } from "../components/ui";
import { useLessons } from "../lib/data";
import { signed } from "../lib/format";

type Sort = "helpful" | "cited" | "newest";

const gain = (l: LessonRow): number => l.meanBrierGainWhenCited ?? Number.NEGATIVE_INFINITY;
const SORTS: Record<Sort, (a: LessonRow, b: LessonRow) => number> = {
  helpful: (a, b) => gain(b) - gain(a) || b.timesCited - a.timesCited,
  cited: (a, b) => b.timesCited - a.timesCited || gain(b) - gain(a),
  newest: (a, b) => b.createdSimDate.localeCompare(a.createdSimDate),
};

function LessonCard({ l }: { l: LessonRow }) {
  return (
    <li className="rounded border border-neutral-800 p-4">
      <div className="flex flex-wrap gap-2">
        <Chip>{l.type}</Chip>
        {l.regime.split("/").map((part, i) => (
          <Chip key={`${i}-${part}`}>{part}</Chip>
        ))}
        {l.adjustment !== "none" && (
          <Chip>
            {l.adjustment} {l.magnitude.toFixed(2)}
          </Chip>
        )}
      </div>
      <p className="mt-3 whitespace-pre-line text-neutral-200">{l.body}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-neutral-400">Written (simulated)</dt>
          <dd className="font-mono text-neutral-200">{l.createdSimDate}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Cited / recalled</dt>
          <dd className="font-mono text-neutral-200">
            {l.timesCited} / {l.timesRecalled}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-400">Mean gain when cited</dt>
          <dd className="font-mono text-neutral-200">{l.meanBrierGainWhenCited === null ? "-" : signed(l.meanBrierGainWhenCited)}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">From question</dt>
          <dd>
            <Link className="text-accent underline-offset-2 hover:underline" to={`/questions/${l.questionId}`}>
              Open
            </Link>
          </dd>
        </div>
      </dl>
      <p className="mt-3">
        <BlobLink id={l.blobId} />
      </p>
    </li>
  );
}

export default function Lessons() {
  const lessons = useLessons();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("helpful");
  const [type, setType] = useState("all");
  const shown = useMemo(() => {
    if (lessons.state !== "ready") return [];
    const q = query.trim().toLowerCase();
    return lessons.data.lessons
      .filter((l) => (type === "all" || l.type === type) && (!q || `${l.body} ${l.regime} ${l.type}`.toLowerCase().includes(q)))
      .sort(SORTS[sort]);
  }, [lessons, query, sort, type]);

  if (lessons.state !== "ready") return <Status results={[lessons]} />;
  return (
    <>
      <PageTitle title="Lessons">
        Every lesson the agent wrote in the headline run (the rerun), each stored as a blob on Walrus. The blob link returns encrypted bytes. A lesson's gain is measured on
        a handful of forecasts at most, so read it as a clue, not a finding.
      </PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          aria-label="Search lessons"
          placeholder="Search lessons"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500"
        />
        <select aria-label="Question type" className={SELECT} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          <option value="DIRECTION">DIRECTION</option>
          <option value="BREAKOUT">BREAKOUT</option>
        </select>
        <select aria-label="Sort" className={SELECT} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="helpful">Most helpful</option>
          <option value="cited">Most cited</option>
          <option value="newest">Newest</option>
        </select>
      </div>
      <p className="mb-3 text-sm text-neutral-400">
        {shown.length} of {lessons.data.lessons.length} lessons
      </p>
      <ul className="space-y-3">
        {shown.map((l) => (
          <LessonCard key={l.blobId} l={l} />
        ))}
      </ul>
    </>
  );
}
