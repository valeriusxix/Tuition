import type { LessonRow } from "@tuition/shared";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { BlobLink, Chip, INPUT, LINK, PageTitle, SELECT, Status } from "../components/ui";
import { useLessons } from "../lib/data";
import { shortDate, signed } from "../lib/format";

type Sort = "helpful" | "cited" | "newest";

const gain = (l: LessonRow): number => l.meanBrierGainWhenCited ?? Number.NEGATIVE_INFINITY;
const SORTS: Record<Sort, (a: LessonRow, b: LessonRow) => number> = {
  helpful: (a, b) => gain(b) - gain(a) || b.timesCited - a.timesCited,
  cited: (a, b) => b.timesCited - a.timesCited || gain(b) - gain(a),
  newest: (a, b) => b.createdSimDate.localeCompare(a.createdSimDate),
};

/** The body repeats the regime in words ("LESSON (DIRECTION, no clear trend, …): "); the chips already say it. */
const prose = (body: string): string => body.replace(/^LESSON \([^)]*\):\s*/, "");

const PAGE = 24;

function LessonCard({ l }: { l: LessonRow }) {
  const g = l.meanBrierGainWhenCited;
  return (
    <li className="rule-b py-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip>{l.type}</Chip>
        {l.regime.split("/").map((part, i) => (
          <Chip key={`${i}-${part}`}>{part}</Chip>
        ))}
        {l.adjustment !== "none" && (
          <Chip tone="pen">
            {l.adjustment} by {l.magnitude.toFixed(2)}
          </Chip>
        )}
        <span className="ml-auto font-mono text-xs text-paper-2">written {shortDate(l.createdSimDate)}</span>
      </div>
      <p className="mt-3 max-w-3xl text-paper">{prose(l.body)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-paper-2">
        <span>
          Cited <span className="font-mono text-paper">{l.timesCited}</span> of <span className="font-mono text-paper">{l.timesRecalled}</span> recalls
        </span>
        <span>
          Gain when cited <span className="font-mono text-paper">{g === null ? "–" : signed(g)}</span>
        </span>
        <Link className={LINK} to={`/questions/${l.questionId}`}>
          The question that taught it
        </Link>
        <span className="ml-auto">
          <BlobLink id={l.blobId} />
        </span>
      </div>
    </li>
  );
}

export default function Lessons() {
  const lessons = useLessons();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("helpful");
  const [type, setType] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const shown = useMemo(() => {
    if (lessons.state !== "ready") return [];
    const q = query.trim().toLowerCase();
    return lessons.data.lessons
      .filter((l) => (type === "all" || l.type === type) && (!q || `${l.body} ${l.regime} ${l.type}`.toLowerCase().includes(q)))
      .sort(SORTS[sort]);
  }, [lessons, query, sort, type]);

  if (lessons.state !== "ready") return <Status results={[lessons]} />;
  const total = lessons.data.lessons.length;
  if (total === 0) {
    return (
      <>
        <PageTitle title="Lessons" />
        <p className="text-paper-2">The headline run wrote no lessons, so there is nothing to list.</p>
      </>
    );
  }
  const cited = lessons.data.lessons.filter((l) => l.timesCited > 0).length;
  return (
    <>
      <PageTitle title="Lessons">
        {total} lessons the agent wrote to itself in the headline run, each one a blob on Walrus. {cited} were cited by at least one later forecast. A lesson's gain is
        measured on a handful of forecasts at most, so read it as a clue, not a finding.
      </PageTitle>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          aria-label="Search lessons"
          placeholder="Search lessons"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          className={`${INPUT} flex-1`}
        />
        <div className="flex gap-2">
          <select aria-label="Question type" className={`${SELECT} flex-1`} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            <option value="DIRECTION">DIRECTION</option>
            <option value="BREAKOUT">BREAKOUT</option>
          </select>
          <select aria-label="Sort" className={`${SELECT} flex-1`} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="helpful">Most helpful first</option>
            <option value="cited">Most cited first</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
      </div>
      <p className="mt-4 text-sm text-paper-2" aria-live="polite">
        {shown.length === total ? `All ${total} lessons` : `${shown.length} of ${total} lessons`}
      </p>
      {shown.length === 0 ? (
        <p className="mt-6 text-paper-2">No lesson matches that search.</p>
      ) : (
        <ul className="rule-t mt-2">
          {shown.slice(0, limit).map((l) => (
            <LessonCard key={l.blobId} l={l} />
          ))}
        </ul>
      )}
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit(limit + PAGE)} className="mt-6 h-11 rounded-sm border border-rule-2 px-4 text-sm text-paper hover:border-paper-2">
          Show {Math.min(PAGE, shown.length - limit)} more
        </button>
      )}
    </>
  );
}
