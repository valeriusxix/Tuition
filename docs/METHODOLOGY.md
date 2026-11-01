# Methodology

> Maintained alongside the code; AGENT.md §8 in plain words. Filled in as each part is built.

## Questions
_(Day 2: decision dates, DIRECTION and BREAKOUT definitions, threshold rule, dev/test split.)_

## Leakage controls
_(Anonymised, rebased prompts; fresh memory namespaces per run; writes only at simulated resolve time.)_

## Arms
_(base, nomem, mem: same model, prompt template, settings and question order for the two LLM arms.)_

## Metrics
_(Brier, log loss, accuracy, ECE, reliability, Brier skill vs base, learning curve.)_

## Statistical test
_(Paired block bootstrap by decision week over the test split; 2,000 seeded resamples.)_

## Honest limitations
_(Small sample, crypto only, LLM sampling noise, the managed relayer sees plaintext.)_
