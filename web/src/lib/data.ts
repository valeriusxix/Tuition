// Every page's data: /data/*.json, validated against the shared schema on load (§12.1). A file that does
// not match its schema is an error state, never a half-rendered page.
import {
  CurveFileSchema,
  LessonsFileSchema,
  LiveFileSchema,
  ProofFileSchema,
  QuestionsFileSchema,
  ReliabilityFileSchema,
  SummaryFileSchema,
} from "@tuition/shared";
import { useEffect, useState } from "react";
import type { z } from "zod";

export type Loaded<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };

const cache = new Map<string, Promise<unknown>>();

function load<S extends z.ZodType>(file: string, schema: S): Promise<z.infer<S>> {
  let pending = cache.get(file) as Promise<z.infer<S>> | undefined;
  if (!pending) {
    pending = fetch(`/data/${file}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`${file}.json: HTTP ${res.status}`);
        return res.json() as Promise<unknown>;
      })
      .then((json) => {
        const parsed = schema.safeParse(json);
        if (!parsed.success) throw new Error(`${file}.json does not match its schema`);
        return parsed.data;
      });
    pending.catch(() => cache.delete(file));
    cache.set(file, pending);
  }
  return pending;
}

function useData<S extends z.ZodType>(file: string, schema: S): Loaded<z.infer<S>> {
  const [result, setResult] = useState<Loaded<z.infer<S>>>({ state: "loading" });
  useEffect(() => {
    let live = true;
    load(file, schema).then(
      (data) => live && setResult({ state: "ready", data }),
      (error: unknown) => live && setResult({ state: "error", message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      live = false;
    };
  }, [file, schema]);
  return result;
}

export const useSummary = () => useData("summary", SummaryFileSchema);
export const useCurve = () => useData("curve", CurveFileSchema);
export const useReliability = () => useData("reliability", ReliabilityFileSchema);
export const useQuestions = () => useData("questions", QuestionsFileSchema);
export const useLessons = () => useData("lessons", LessonsFileSchema);
export const useLive = () => useData("live", LiveFileSchema);
export const useProof = () => useData("proof", ProofFileSchema);
