import { lazy, Suspense } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router";

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
  ["/calibration", "Calibration"],
  ["/lessons", "Lessons"],
  ["/questions", "Questions"],
  ["/live", "Live"],
  ["/verify", "Verify"],
  ["/method", "Method"],
  ["/blog", "Blog"],
];

function NotFound() {
  return (
    <p className="text-neutral-300">
      No such page.{" "}
      <Link className="text-accent underline" to="/">
        Back to the overview
      </Link>
    </p>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="mx-auto max-w-5xl px-4 pb-16">
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-neutral-800 py-3 text-sm">
          <Link to="/" className="mr-2 font-mono text-accent">
            Tuition
          </Link>
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "text-neutral-50" : "text-neutral-400 hover:text-neutral-200")}>
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="pt-8">
          <Suspense fallback={<p className="text-neutral-400">Loading…</p>}>
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
      </div>
    </BrowserRouter>
  );
}
