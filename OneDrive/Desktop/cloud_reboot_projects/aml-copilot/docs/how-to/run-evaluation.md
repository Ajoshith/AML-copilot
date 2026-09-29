# How to run the evaluation

Measure the pipeline against the dataset's real `Is Laundering` ground truth.

## Steps

1. Make sure cassettes exist for all eight cases ([how](record-cassettes.md)).
2. Run:

   ```bash
   bun run evaluate
   ```

The script replays every mined case and reports:

- **Confusion matrix:** AI recommendation against the real `Is Laundering` label.
- **Verifier block rate**, with the reason for each block.
- **Grounding pass rate:** the share of material facts with a resolvable source and matching recomputation.
- **Cost and latency per case**, from the token usage stored in each cassette.

## Reading the results

This is a baseline over eight hand-picked cases, not a statistical sample. It shows the measurement
pipeline is wired to real ground truth. It is not evidence of model quality at scale. The current
results and their limits are written up in the [AI system card](../explanation/system-card.md#evaluation).

If you seeded placeholder cassettes, the results describe the placeholders, and cost and latency read
as zero because placeholders carry no token usage.
