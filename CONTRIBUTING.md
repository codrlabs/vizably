# Contributing to Vizably

Thanks for your interest in contributing! This page covers what is specific
to vizably. For the general rules that apply to all codrlabs projects, see
[open.codrlabs.com/start/contributing/](https://open.codrlabs.com/start/contributing/).

## Before you start

1. Find (or open) an issue for the change you want to make.
2. Comment on the issue saying you'd like to work on it, and wait for
   @DevOlabode to confirm before starting. This keeps two people from
   ending up on the same thing.

## One issue, one branch, one PR

Each issue gets its own branch and its own pull request. Don't bundle
unrelated changes together.

Every branch starts from an up-to-date `main`:

```bash
git checkout main
git pull origin main
git checkout -b feat/short-description   # or fix/, chore/, docs/
```

## Running it locally

Follow the [Quick Start](README.md#-quick-start) in the README. In short:

```bash
# With Docker
docker compose up --build

# Or without Docker, in two terminals
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

The frontend runs at `http://localhost:5173` and the backend at
`http://localhost:3000`.

## Running the tests

```bash
# Backend
cd backend
npm test

# Frontend
cd frontend
npm run test:run
```

Make sure the tests pass before opening your PR.
