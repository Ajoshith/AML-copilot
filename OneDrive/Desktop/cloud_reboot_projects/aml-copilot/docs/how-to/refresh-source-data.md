# How to refresh the source data and re-mine cases

The repository ships with everything the tests and demo need: a Parquet slice of the real transactions
for the eight mined accounts (`data/slice/`), the generated overlay (`data/overlay/`) and the FFIEC
corpus (`src/policy/typologies.yaml`). Only follow this guide to pull a newer sanctions list, rebuild the
red-flag corpus, or mine a different set of cases.

## 1. Download the real sources

```bash
bun run data:fetch
```

This downloads into the gitignored `data/raw/`:

- IBM AMLworld `HI-Small_Trans.csv`: 5,078,345 transactions with laundering labels (about 475 MB), from Hugging Face.
- The OFAC SDN and alternate-name lists from the U.S. Treasury. The download date becomes the list version stamped into every `sdn:` source ID.
- FFIEC BSA/AML Manual Appendix F, scraped into `src/policy/typologies.yaml`.

## 2. Mine cases and build the overlay

If the transactions changed, re-derive the exchange rates first, because the overlay and alerts use them:

```bash
bun run scripts/derive-fx-rates.ts
```

```bash
bun run data:select-cases
```

```bash
bun run data:build-overlay
```

`select-cases` picks eight accounts from real structural signals and the dataset's own `Is Laundering`
labels, and writes `data/overlay/cases.json`. `build-overlay` generates the synthetic KYC profiles,
notes for those accounts, raises their alerts by running the monitoring rules, and writes a fresh
`data/slice/transactions.parquet`.

## 3. Bump versions and re-record

- If `typologies.yaml` changed, bump `POLICY_VERSION` in `src/config.ts`.
- Any change to the data an agent sees changes its prompt, so re-record cassettes ([how](record-cassettes.md)).

## 4. Verify

```bash
bun test
```

## Licensing

The committed slice is a derivative of CDLA-Sharing-1.0 data and stays under that licence. Never commit
the full CSV. See [DATA_LICENSES.md](../../DATA_LICENSES.md).
