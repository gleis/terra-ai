# Terra-AI

Terra-AI is an Electron desktop app for reviewing Terraform workspaces locally. It renders a dependency graph from `terraform graph`, overlays plan results, drift, cost estimates, and security findings onto that graph, and sends the loaded Terraform context to a local Ollama model for questions and reviewable file-edit suggestions.

Everything runs on your machine. No workspace content is sent to a hosted service.

<img width="1807" height="1246" alt="terra-ai-ss" src="https://github.com/user-attachments/assets/2e4ffbd4-74fd-4838-a9ef-3cc3c94363ac" />

## What It Does

- Opens a Terraform workspace from your machine.
- Runs `terraform graph` against that workspace and converts the DOT output into a React Flow diagram.
- Retries once with `terraform init -reconfigure` if graph generation fails on the first pass.
- Recursively reads `.tf`, `.tfvars`, and `terragrunt.hcl` files (including nested module directories) and injects that context into the first AI chat request.
- Detects installed Ollama models and lets you choose from the locally available chat models.
- Streams AI responses into the sidebar and automatically requests a continuation if a reply is cut off by the token limit.
- Shows a diff review before any AI-proposed edit is written, including a multi-file review queue when a response touches several files.
- Runs `terraform fmt` and `terraform validate` automatically after each applied edit and surfaces the result.
- Visualizes `terraform plan`: nodes are colored by planned action (create / update / destroy / replace).
- Checks for state drift with `terraform plan -refresh-only` and highlights drifted resources.
- Runs a tfsec security scan (if installed) and badges affected nodes with their findings.
- Shows a node detail panel with the resource's HCL source, plan status, rough monthly cost estimate, and security findings.
- Lets you edit a resource's HCL directly in that panel and write it back to its file, with formatting and validation on save.
- Filters/highlights graph nodes with a search box.
- Persists chat history per workspace across app restarts.

## Tech Stack

- Electron
- React
- TypeScript
- `electron-vite`
- Tailwind CSS
- React Flow
- Dagre
- Ollama
- Terraform CLI (`graph`, `plan`, `fmt`, `validate`)
- tfsec (optional, for security scanning)

## Requirements

You need these installed locally:

- Node.js and npm
- Terraform on your `PATH`
- Ollama running locally on `http://127.0.0.1:11434` (override with the `OLLAMA_HOST` environment variable)
- At least one Ollama chat model installed locally

Optional:

- `tfsec` on your `PATH` for the `Scan` button (`brew install tfsec`). Without it, the scan reports that tfsec is not installed and the rest of the app works normally.
- Valid provider credentials and backend access for the `Plan` and `Drift` buttons, which run real `terraform plan` commands. The graph, AI chat, cost estimates, and security scan all work without them.

Recommended models for speed:

- `gemma3`
- `llama3.2`

Larger reasoning or coding-heavy models can work, but they are usually slower in the AI Insights pane.

## Start In Development

Install dependencies:

```bash
npm install
```

Start Ollama if it is not already running:

```bash
ollama serve
```

Pull one of the recommended faster models:

```bash
ollama pull gemma3
```

You can also use:

```bash
ollama pull llama3.2
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
5. Pick a local Ollama chat model from the AI Insights header.
6. Click a node to open its detail panel (source block, plan status, cost, findings) and use `Explain with AI` from there.
7. Use `Edit` in that panel to change the resource's HCL directly and save it back to its file.
8. Use `Plan` to color the graph by planned changes, `Drift` to check for state drift, and `Scan` to run tfsec.
9. Use the search box in the header to filter large graphs.
10. Use the AI sidebar to ask architecture or Terraform questions.
11. If the AI returns full-file code blocks with leading filename comments, click `Review & Apply` (or `Review all changes` for multi-file responses) to inspect the diff before writing to disk. Files are formatted and validated after each write.

## Feature Reference

### Graph Overlays

`Plan` runs `terraform plan -json` and colors each node border by its planned action:

| Color | Meaning |
| --- | --- |
| Green | will be created |
| Amber | will be updated |
| Red | will be destroyed or replaced |
| Fuchsia | drifted from configuration |

`Drift` runs `terraform plan -refresh-only` and highlights resources whose real-world state no longer matches the configuration.

`Scan` runs `tfsec` and adds a `⚠ n` badge to each affected node. Findings are listed in full in the node detail panel.

Nodes also carry a rough `~$n/mo` cost badge where the resource type is recognized.

Both plan and drift results are cleared with the `Clear` button in the status bar, or automatically when you load a different workspace.

### Node Detail Panel

Clicking a node opens a panel showing:

- The resource's actual HCL block, located by searching the workspace (brace-matched, so nested blocks are included) along with the file it came from
- Its planned action, if a plan or drift check has been run
- A rough monthly cost estimate
- Any tfsec findings for that resource
- An `Explain with AI` button that sends the resource to the AI sidebar

Resources defined inside external modules may not have a locatable source block; the panel says so rather than guessing.

### Editing A Resource In Place

`Edit` in the detail panel turns the source block into an editor:

- `Save Changes` (or ⌘/Ctrl + Enter) writes the block back into its file, then runs `terraform fmt` on that file and `terraform validate` on the workspace.
- `Cancel` (or Escape) discards the draft. An `unsaved changes` badge appears while the draft differs from what is on disk.
- Tab inserts two spaces instead of moving focus.
- After a successful save the graph reloads and the panel re-reads the block from disk, so you see the formatted result.
- If validation fails, the error is shown in the panel. The edit is still written — this reports the problem rather than silently reverting your work.

The block is re-located by resource address at save time rather than by remembered offsets, so a file that changed on disk since the panel was opened produces a clear error instead of a corrupted write. Only the targeted block is rewritten; everything else in the file is left byte-for-byte intact.

Unlike AI-proposed edits, your own edits are written directly without a diff review — you are the author, and the diff gate exists for changes you did not write.

### Reviewing AI Edits

AI-proposed edits are never written straight to disk:

1. The AI returns one or more code blocks, each starting with a filename comment (for example `# main.tf`).
2. `Review & Apply` (single file) or `Review all changes` (multi-file) opens a diff view showing added and removed lines against the file currently on disk. New files are marked as such.
3. You apply or skip each file individually, or apply all remaining files at once.
4. After each write, the app runs `terraform fmt` on the file and `terraform validate` on the workspace, then reports the result in the status bar — so a bad edit surfaces immediately.

### How The AI Integration Works

- The main process sends chat requests directly to Ollama from Electron, which avoids browser CORS issues. The endpoint defaults to `http://127.0.0.1:11434` and can be changed with `OLLAMA_HOST`.
- The app queries Ollama for the installed local models and populates the model selector dynamically.
- On the first chat request for a loaded workspace, the app recursively reads `.tf`, `.tfvars`, and `terragrunt.hcl` files (skipping `.terraform`, `.git`, and `node_modules`, capped at 200 files and 6 levels deep) and prepends them as system context. Long files are truncated to keep the context fast.
- The app sends requests with model thinking disabled for more direct visible answers in the sidebar.
- If Ollama truncates a reply because of token limits, the app automatically asks it to continue and appends the rest of the answer.
- The model is instructed to return complete file contents when proposing edits, and may propose edits across several files in one response.
- Chat history is saved per workspace in `localStorage` and restored when you reload that workspace. `Clear Chat` discards it.

## Important Limitations

- This is a local desktop tool, not a hosted service.
- Terraform parsing is based on `terraform graph`, so the selected workspace still needs to be valid enough for Terraform to initialize and graph.
- `Plan` and `Drift` run real `terraform plan` commands, so they need working provider credentials and a valid backend for the workspace.
- Cost badges are very rough built-in estimates (small/default sizing, us-east-1) for architecture review only — not real pricing. Use Infracost or the AWS calculator for real numbers.
- The security scan requires `tfsec` on your `PATH` (`brew install tfsec`).
- The app works best with local chat-oriented Ollama models. Smaller models such as `gemma3` or `llama3.2` generally feel faster in the UI.
- File writes are based on the filename the model returns. The app resolves the target path and refuses to write outside the selected workspace (absolute paths and `../` traversal are blocked), and only accepts `.tf`, `.tfvars`, and `.hcl` filenames from code blocks.

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
src/main/index.ts                        Electron main process, IPC handlers, terraform/tfsec/Ollama calls
src/preload/index.ts                     Preload bridge exposing safe APIs to the renderer
src/preload/index.d.ts                   Types for the bridged API
src/renderer/src/App.tsx                 Main React application
src/renderer/src/types.ts                Shared renderer types
src/renderer/src/components/
  DiffModal.tsx                          Diff review + multi-file apply queue
  NodeDetailPanel.tsx                    Per-resource source, plan, cost, findings
src/renderer/src/utils/
  dotParser.ts                           terraform graph DOT -> React Flow
  layout.ts                              Dagre auto-layout
  diff.ts                                LCS line diff
  costEstimates.ts                       Rough monthly cost lookup table
example-terraform/                       Example Terraform workspace for testing
out/                                     Built output
```

### IPC Handlers

| Channel | Purpose |
| --- | --- |
| `dialog:openDirectory` | Workspace directory picker |
| `terraform:graph` | `terraform graph`, with one auto-`init` retry |
| `terraform:plan` | `terraform plan -json`, optionally `-refresh-only` for drift |
| `terraform:validate` | `terraform fmt` on a file plus `terraform validate -json` |
| `security:scan` | `tfsec --format json` |
| `workspace:readFiles` | Recursive Terraform file collection for AI context |
| `workspace:readFile` | Single file read, used to build diffs |
| `workspace:writeFile` | Sandboxed write inside the workspace |
| `workspace:findResource` | Locate a resource's HCL block by graph label |
| `workspace:updateResource` | Replace a single HCL block in place, leaving the rest of the file untouched |
| `ollama:listModels` / `ollama:generate` / `ollama:stream` | Local model access |

## Security Notes

- Filenames returned by the AI are treated as untrusted. Writes are resolved against the workspace root and rejected if they escape it, so absolute paths and `../` traversal cannot write outside the selected directory.
- Only `.tf`, `.tfvars`, and `.hcl` filenames are accepted from AI code blocks.
- No edit is written without an explicit diff review and confirmation.
- All Terraform and tfsec commands run against the selected workspace directory only.

## Tested Locally

The repository builds successfully with:

```bash
npm run typecheck
npm run build
```
