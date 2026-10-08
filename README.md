# fittingroom-sample-app

> **Generated. Do not edit here.** This is the fitted host for [Fitting Room](https://github.com/benpiticaru/fittingroom). It is regenerated from `examples/sample-app` in that repo by `node scripts/export-sample-app.mjs`; change it there.

A small TypeScript host app. It consumes `@fitting-room/*` as packages (registry versions, or `vendor/*.tgz` from `--pack`), never as source.

## Setup

```sh
npm ci
npm run dev:muslin   # the muslin: the real app with its API boundary swapped for synthetic fixtures
npm test             # vitest run
```

## Your first fitting

`docs/first-fitting.md` is the walkthrough, copied verbatim from Fitting Room. Its Setup block uses monorepo paths (`cd examples/sample-app`, `alias fit=...`). Here, skip both: run the `fit` commands from this repo's root as `npx fit ...` (the CLI is a devDependency). `--allow-self-host` in that doc is harmless here.

## What the export owns

Every file the export writes is overwritten on the next export. `.git/`, `.github/`, `node_modules/`, `dist/`, `dist-muslin/`, `vendor/*.tgz`, `package-lock.json` and local session and baseline files are yours and are never touched. Anything else is deleted on the next export.

## Pushing exports

The `sample-app-check` CI job in Fitting Room runs `--check --pack` against this repo, so the first push here, and every push after it, must come from an export made with `--pack` (it writes `vendor/*.tgz` and `package-lock.json`).

## Branches here

The Fitting Room nightly backlog runner watches only the Fitting Room repo. `fitting/*` branches and draft PRs in this repo are fittings, not work items.
