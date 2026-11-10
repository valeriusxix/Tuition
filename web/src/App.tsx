import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router";
import { REPO } from "./lib/links";

const Overview = lazy(() => import("./pages/Overview"));
const Calibration = lazy(() => import("./pages/Calibration"));
const Lessons = lazy(() => import("./pages/Lessons"));
const Questions = lazy(() => import("./pages/Questions"));
const QuestionDetail = lazy(() => import("./pages/QuestionDetail"));
const Live = lazy(() => import("./pages/Live"));
const Verify = lazy(() => import("./pages/Verify"));
const Method = lazy(() => import("./pages/Method"));
const Blog = lazy(() => import("./pages/Blog"));

const NAV: [string, string][] = [
  ["/", "Overview"],
  ["/lessons", "Lessons"],
  ["/questions", "Questions"],
  ["/calibration", "Calibration"],
  ["/live", "Live"],
  ["/verify", "Verify"],
  ["/method", "Method"],
  ["/blog", "Blog"],
];

/** One title per page, and scroll to the top on navigation. */
function RouteEffects() {
  const { pathname } = useLocation();
  useEffect(() => {
    const page = NAV.find(([to]) => (to === "/" ? pathname === "/" : pathname.startsWith(to)))?.[1];
    document.title = page && page !== "Overview" ? `${page} · Tuition` : "Tuition";
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="max-w-xl">
      <p className="display text-3xl">No such page.</p>
      <p className="mt-3 text-paper-2">
        <Link className="text-paper underline decoration-pen underline-offset-2" to="/">
          Back to the overview
        </Link>
      </p>
    </div>
  );
}

function Wordmark() {
  return (
    <Link to="/" className="display-italic relative inline-block pb-1 text-xl leading-none text-paper" aria-label="Tuition, overview">
      Tuition
      <span aria-hidden className="absolute right-0 bottom-0 left-0 h-[2px] rounded-full bg-pen" style={{ transform: "rotate(-1deg)" }} />
    </Link>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteEffects />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
        Skip to content
      </a>
      <header className="rule-b sticky top-0 z-40 bg-ink/95 backdrop-blur-[2px]">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 sm:px-6">
          <div className="shrink-0 py-3">
            <Wordmark />
          </div>
          <nav aria-label="Main" className="scroll-strip -mr-4 flex min-w-0 flex-1 gap-1 overflow-x-auto sm:mr-0 sm:justify-end">
            {NAV.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `relative flex h-12 shrink-0 items-center px-3 text-sm whitespace-nowrap sm:h-12 ${
                    isActive ? "text-paper after:absolute after:right-3 after:bottom-0 after:left-3 after:h-[2px] after:bg-pen" : "text-paper-2 hover:text-paper"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 pt-10 pb-20 sm:px-6 sm:pt-14">
        <Suspense fallback={<p className="text-paper-2">Loading…</p>}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/calibration" element={<Calibration />} />
            <Route path="/lessons" element={<Lessons />} />
            <Route path="/questions" element={<Questions />} />
            <Route path="/questions/:id" element={<QuestionDetail />} />
            <Route path="/live" element={<Live />} />
            <Route path="/verify" element={<Verify />} />
            <Route path="/method" element={<Method />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="rule-t mx-auto max-w-6xl px-4 py-8 text-sm text-paper-2 sm:px-6">
        <p>
          <span className="display-italic text-paper">The market charges tuition. Tuition keeps the notes.</span>
        </p>
        <p className="mt-2">
          Total Recall hackathon (Tatum × Walrus), 2026.{" "}
          <a className="underline decoration-rule-2 underline-offset-2 hover:decoration-pen" href={REPO}>
            Source, decision log and raw run data
          </a>
          .
        </p>
      </footer>
    </BrowserRouter>
  );
}
