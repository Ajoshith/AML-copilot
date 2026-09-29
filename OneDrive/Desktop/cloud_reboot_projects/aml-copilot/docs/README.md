# AML Investigation Co-Pilot — Documentation

The AML Investigation Co-Pilot is a working prototype of an AI assistant for anti-money-laundering (AML)
alert investigation. It gathers and explains the evidence on a flagged account, proves every fact it
states against the source records, and stops at a human analyst, who alone can decide the case.

These docs are organised with the [Diátaxis](https://diataxis.fr/) framework: four kinds of
documentation, each for a different need. Pick the column that matches what you are trying to do.

| I want to… | Read | Type |
|---|---|---|
| Get it running for the first time | [Tutorial: getting started](tutorials/getting-started.md) | Tutorial — learning by doing |
| Do one specific task | [How-to guides](#how-to-guides) | How-to — task recipes |
| Look up an exact fact (a route, a variable, a state) | [Reference](#reference) | Reference — dry, complete, accurate |
| Understand why it is built this way | [Explanation](#explanation) | Explanation — context and reasoning |

## Tutorials

- [Getting started](tutorials/getting-started.md): install, run the tests, start the app, investigate your first case.

## How-to guides

- [Run the live demo](how-to/run-the-demo.md)
- [Record cassettes against the live model](how-to/record-cassettes.md)
- [Switch the LLM provider or model](how-to/switch-llm-provider.md)
- [Refresh the source data and re-mine cases](how-to/refresh-source-data.md)
- [Run the evaluation](how-to/run-evaluation.md)

## Reference

- [HTTP API](reference/api.md): every route, role rule and status code.
- [Configuration](reference/configuration.md): environment variables and version constants.
- [Data model](reference/data-model.md): source IDs, case states, agent output schemas, tool classes.
- [Commands](reference/commands.md): every script and what it does.

## Explanation

- [Architecture](explanation/architecture.md): system context, building blocks and runtime flow (arc42-style).
- [Control guarantees](explanation/controls.md): the five safety properties, how each is enforced, and the test that proves it.
- [AI system card](explanation/system-card.md): intended use, out-of-scope use, data, evaluation results and known limitations.
- [Glossary](explanation/glossary.md): AML and project terms.

## Decisions

- [Architecture Decision Records](decisions/README.md): the significant design choices, one short record each.

## Other project documents

- [README](../README.md): project overview and quick commands.
- [DATA_LICENSES.md](../DATA_LICENSES.md): provenance and licence terms for every data source.
- [Demo deck](AML_CoPilot_Demo.pptx): 13-slide presentation for newcomers.

## How these docs were shaped

- **Diátaxis** for the overall structure, so tutorials, recipes, facts and reasoning never get mixed together.
- **[arc42](https://arc42.org/)** for the architecture document: a subset of its 12 sections sized to a prototype.
- **[Architecture Decision Records](https://adr.github.io/)** for design choices, in Michael Nygard's Context / Decision / Consequences form.
- **Model and system cards** for the AI system card: intended use, limitations and evaluation in one place.
- **U.S. Federal Reserve [SR 11-7](https://www.federalreserve.gov/supervisionreg/srletters/sr1107.htm)** model risk guidance, which banks apply to models like this one. It asks for documentation "sufficiently detailed to allow parties unfamiliar with a model to understand how the model operates, as well as its limitations and key assumptions." The system card and the controls document are written to that bar.
