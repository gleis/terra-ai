# Terra-AI

Terra-AI is an Electron desktop app for exploring Terraform workspaces locally. It renders a dependency graph from `terraform graph`, lets you inspect resources visually, and sends the loaded Terraform context to a local Ollama model for questions and file-edit suggestions.

## What It Does

- Opens a Terraform workspace from your machine.
- Runs `terraform graph` against that workspace and converts the DOT output into a React Flow diagram.
- Retries once with `terraform init -reconfigure` if graph generation fails on the first pass.
- Reads `.tf` files and `terragrunt.hcl` from the selected workspace and injects that context into the first AI chat request.
- Accepts AI responses that include full-file code blocks and can write those files back into the selected workspace.

## Tech Stack

- Electron
- React
- TypeScript
- `electron-vite`
- React Flow
- Dagre
- Ollama

## Requirements

You need these installed locally:

- Node.js and npm
- Terraform on your `PATH`
- Ollama running locally on `http://127.0.0.1:11434`
- At least one Ollama model used by the UI dropdown, currently `gemma4` or `llama3`

## Start In Development

Install dependencies:

```bash
npm install
```

Start Ollama if it is not already running:

```bash
ollama serve
```

Pull one of the models the UI expects:

```bash
ollama pull gemma4
```

Run the desktop app:

```bash
npm run dev
```

## First Run Workflow

1. Launch the app with `npm run dev`.
2. Click `Load Workspace`.
3. Choose a directory that contains Terraform files.
4. Terra-AI runs `terraform graph` in that directory and renders the graph.
5. Click a node to ask for an explanation of that resource.
6. Use the AI sidebar to ask architecture or Terraform questions.
7. If the AI returns a full-file code block with a leading filename comment, click `Apply Edit` to write it back to disk.

## How The AI Integration Works

- The main process sends chat requests directly to Ollama from Electron, which avoids browser CORS issues.
- On the first chat request for a loaded workspace, the app reads top-level `.tf` files and `terragrunt.hcl` and prepends them as system context.
- The model is instructed to return complete file contents when proposing edits.
- The renderer extracts the filename from the first comment line in a code block and uses that to overwrite the target file in the selected workspace.

## Important Limitations

- This is a local desktop tool, not a hosted service.
- Terraform parsing is based on `terraform graph`, so the selected workspace still needs to be valid enough for Terraform to initialize and graph.
- Workspace context loading currently reads only top-level `.tf` files plus `terragrunt.hcl` from the chosen directory. It does not recurse into nested module directories.
- The model selector is hard-coded to `gemma4` and `llama3`.
- File writes are based on the filename the model returns. The app strips leading slashes before writing, but it does not do deeper path validation.

## Useful Scripts

```bash
npm run dev
npm run start
npm run typecheck
npm run lint
npm run build
npm run build:mac
npm run build:win
npm run build:linux
```

Notes:

- `npm run dev` starts the app in development with Electron and Vite.
- `npm run start` launches the production preview build through `electron-vite preview`.
- `npm run build` type-checks and builds the main, preload, and renderer bundles.

## Project Structure

```text
src/main/                 Electron main process and IPC handlers
src/preload/              Preload bridge exposing safe APIs to the renderer
src/renderer/src/         React application
src/renderer/src/utils/   DOT parsing and graph layout helpers
example-terraform/        Example Terraform workspace for testing
out/                      Built output
```

## Tested Locally

The repository builds successfully with:

```bash
npm run typecheck
npm run build
```
