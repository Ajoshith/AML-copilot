# Tutorial: getting started

In this tutorial you will install the project, prove its safety properties with the test suite,
start the app, and investigate a real case end to end. It takes about 15 minutes and needs no API key.

By the end you will have:

- run 92 automated tests
- opened the investigator workbench in your browser
- walked a case from alert to a recorded human decision
- clicked a citation through to the real transaction behind it

## Before you start

You need [Bun](https://bun.sh) 1.4 or later. Check with:

```bash
bun --version
```

## 1. Install dependencies

From the project root:

```bash
bun install
```

This installs the backend and the `ui/` workspace together.

## 2. Run the test suite

```bash
bun test
```

You should see `92 pass, 0 fail`. The tests use `AML_LLM_MODE=replay`, the default, which reads
recorded model responses ("cassettes") instead of calling a model. Each test seeds the cassettes
it needs, so the suite runs offline and needs no API key.

What you just proved: every material fact is sourced, confidential content is role-gated, prompt
injection is inert, the SAR decision is human-only, and runs are replayable. See
[Control guarantees](../explanation/controls.md) for which test proves which property.

## 3. Give the demo some model output

The app runs the real pipeline, so every AI step needs a cassette. Recorded cassettes are not
committed to git (`fixtures/cassettes/` is gitignored), so a fresh clone has none. Choose one:

- **No API key:** seed clearly-labelled placeholder cassettes.

  ```bash
  bun run scripts/seed-demo-cassettes.ts
  ```

  These are hand-written stand-ins, not real model output. Fine for learning the app.

  > **Warning:** placeholder cassettes use the same keys as real recordings. If you already have
  > recorded cassettes in `fixtures/cassettes/`, seeding overwrites them. Back up that folder first,
  > or skip this step.

- **With an Anthropic API key:** record real model output. See [Record cassettes](../how-to/record-cassettes.md).

## 4. Start the API and the UI

Open two terminals. In the first:

```bash
bun run dev:api
```

You should see `Elysia API listening on http://localhost:8787`. In the second:

```bash
bun run dev:ui
```

Open the URL Vite prints (normally `http://localhost:5173`).

## 5. Investigate your first case

1. **Pick a case.** The left panel is the alert queue. Click **C-001**, or press `J`.
2. **Run it.** The case shows *Ready to investigate*. Click **Run investigation**. The pipeline
   stepper at the top fills in as each step completes. With cassettes, this takes seconds.
3. **Read the recommendation.** The Overview tab leads with the AI's recommendation and its
   confidence, then the *Why* memo: bottom line first, then the activity pattern, customer profile,
   red flags and alternative explanations.
4. **Check a fact.** Open the **Evidence** tab. Each point ends in citation badges. Green badges are
   real data; amber badges are generated overlay data. Click one: a panel opens showing the actual
   record, for example a transaction's amount, sender, receiver and timestamp. Press `Esc` to close it.
5. **See the red flags.** Open the **Typology** tab. Each match quotes the regulator's own red-flag
   wording from FFIEC Appendix F.
6. **Decide.** Open the **Decision** tab. Choose a disposition *different* from the one marked
   **AI pick**. An *override reason* box appears and becomes mandatory. Fill in the rationale and
   the override reason (20+ characters each) and click **Record decision**.

The case moves to **Decided**. Your override is recorded separately in the audit log so
automation-bias can be measured later.

## 6. See a safety control bite

In the top bar, switch the role from **Analyst** to **Read-only**. The case content disappears,
replaced by *Case content is restricted for this role*. The server refused the request; the UI did
not simply hide it. Switch back to **Analyst**.

Now open **C-005** and run it. The stepper stops at *Analytics*, marked with a cross: the account
holder matched a real entry on the U.S. Treasury sanctions list, so the case went straight to the
sanctions team and the AML steps never ran.

## Where next

- [Run the live demo](../how-to/run-the-demo.md): the scripted five-minute version of the walkthrough above.
- [Architecture](../explanation/architecture.md): how the pieces fit together.
- [AI system card](../explanation/system-card.md): what the AI is for, and where it falls short.
