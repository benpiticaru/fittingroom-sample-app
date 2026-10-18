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

## Try it in containers

Needs only git and Docker or Podman. This repo is an export made with `--pack`, so both images build from what is here, locally: `pull_policy: build`, nothing pulled from a Fitting Room registry, no key. Build from a clean checkout. A clone of this repo is one; a fresh local export (`node scripts/export-sample-app.mjs --pack --dest <dir>`) is not a git repository yet, so commit it first (the first line below), or the build has no `REV` and the container has no `.git` to clone:

```sh
git init -q -b main && git add -A && git commit -qm "sample app"   # a fresh export only
REV=$(git rev-parse HEAD) docker compose up --build
```

Open `http://127.0.0.1:8080`, pick a persona, pin, Submit. The fitting is a `fitting/<id>` branch in the `fitting-repo` volume; it is not pushed (there is no remote). Copy one out with the `git bundle` command in Fitting Room's `docs/reference/muslin-build.md`.

- The network use is the base-image and package pulls of the two builds, and nothing else.
- Changing the publish line in compose.yaml exposes the fitting to the network.
- `docker compose down` stops it (add `-v` to delete the fittings). `down`, `exec` and `logs` need no `REV`; only a build does.
- `node compose-smoke.mjs [docker|podman]` is the smoke test. Fitting Room's CI runs it on every release merge. It deletes the two demo images and uses its own volume, never `fitting-repo`.
- **Podman:** `podman compose up` uses the same file and nothing Docker-only. But `podman compose` hands the file to an external provider (podman-compose or docker-compose), and its support for `pull_policy: build` varies. The maintainers have not run it yet. On SELinux hosts, add `,z` to the source bind (`.:/src:ro,z`).

## What the export owns

Every file the export writes is overwritten on the next export. `.git/`, `.github/`, `node_modules/`, `dist/`, `dist-muslin/` and local session and baseline files are yours and are never touched. An export made with `--pack` also owns `vendor/*.tgz` (tarballs for older versions are deleted) and regenerates `package-lock.json`. Anything else is deleted on the next export.

## Pushing exports

The `sample-app-check` CI job in Fitting Room runs `--check --pack` against this repo, so the first push here, and every push after it, must come from an export made with `--pack` (it writes `vendor/*.tgz` and `package-lock.json`).

## Branches here

The Fitting Room nightly backlog runner watches only the Fitting Room repo. `fitting/*` branches and draft PRs in this repo are fittings, not work items.
