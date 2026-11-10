// The blog post (AGENT.md §14), bundled from docs/BLOG_DRAFT.md so the repository and the site carry the
// same text. Its results table is filled from summary.json by `export --docs`, never typed by hand.
import { marked } from "marked";
import { useMemo } from "react";
import post from "../../../docs/BLOG_DRAFT.md?raw";

/** Drops the HTML comment markers that delimit the generated blocks. */
const clean = (md: string): string => md.replace(/<!--[\s\S]*?-->\n?/g, "");

export default function Blog() {
  const html = useMemo(() => marked.parse(clean(post), { async: false, gfm: true }), []);
  return <article className="blog" dangerouslySetInnerHTML={{ __html: html }} />;
}
