# Anvil Language Server Development Guide

This document is for developers and maintainers working on the Anvil Language Server repository itself.

If you only want to install and use the language server, start with [`README.md`](README.md).
If you want the current end-user feature matrix, see [`LSP.md`](LSP.md).

## What Lives In This Repository

This repository contains three distinct pieces that work together:

1. `anvil/`
   The Anvil compiler/toolchain submodule. The language server does not parse Anvil source by itself; it shells out to the compiler and consumes its experimental AST JSON output.
2. `server/`
   The TypeScript language server implementation. This is the main codebase most contributors will work in.
3. `extensions/`
   Editor integrations that launch the server and contribute editor-specific configuration and syntax support.
   - `extensions/vscode/`
   - `extensions/vim/`

At the repository root, the canonical workflows are encoded in:

- `build.sh`
- `test.sh`
- `format.sh`

Prefer those scripts unless you have a specific reason to run component-local commands directly.

## High-Level Architecture

At runtime, the system looks like this:

1. An editor extension starts the TypeScript server over Node IPC.
2. The server receives LSP requests and keeps per-document state in memory.
3. When semantic information is needed, the server invokes the Anvil compiler with `-ast -json`.
4. The compiler returns diagnostics plus an AST payload.
5. The server parses that AST into typed wrapper objects and answers LSP requests such as hover, completion, signature help, definitions, references, diagnostics, and inlay hints.

The most important design constraint in this repository is that semantic features are compiler-backed. If the compiler output changes, the language server usually needs to change too.

## Repository Map

### Root

- `README.md`: user-facing installation and basic usage notes.
- `LSP.md`: feature support status.
- `build.sh`: build/install orchestration for all components.
- `test.sh`: test orchestration for all components.
- `format.sh`: formatting orchestration.
- `samples/`: shared Anvil source files used by server tests.
- `bin/anvil`: expected local compiler binary path after building the compiler.

### Language Server

- `server/src/server.ts`: LSP entrypoint, capability declaration, event wiring, and request routing.
- `server/src/core/AnvilDocument.ts`: per-document runtime state, cached AST/errors, compile debounce, edit tracking, and span mapping.
- `server/src/core/AnvilCompiler.ts`: wrapper around the `anvil` compiler process.
- `server/src/core/ast/`: typed AST schema and navigation helpers.
- `server/src/generators/`: feature-specific logic.
- `server/src/info/`: static completion and documentation metadata in JSON form.
- `server/src/utils/`: settings normalization, logging, span conversion, and small utilities.
- `server/test/`: TypeScript tests for compiler integration, AST metadata, hover/docs, completions, signature help, and inlay hints.

### Editor Extensions

- `extensions/vscode/`: VS Code packaging, grammar, configuration schema, and extension client.
- `extensions/vim/`: coc.nvim packaging, filetype detection, syntax, and extension client.

## Local Development Setup

### Prerequisites

You need:

- Node.js 22 or later.
- `npm`.
- `opam`, `dune`, and an OCaml toolchain if you need to build the bundled Anvil compiler.

The server tests depend on a working `bin/anvil`, so a compiler build is normally required for meaningful server development.

### Clone And Initialize

Clone with submodules if possible:

```bash
git clone --recurse-submodules https://github.com/wxwern/anvil-lsp.git
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive --remote
```

### Bootstrap Everything

The simplest full setup is:

```bash
./build.sh
```

That script will:

1. Build the `anvil/` submodule using `opam` and `dune`.
2. Install server dependencies and build/lint the server.
3. Install extension dependencies and build the editor clients.

If you only want the language server and not the editor clients:

```bash
./build.sh anvil server
```

### Important Setup Notes

- Always build Anvil before relying on server tests. The server expects `bin/anvil` to exist.
- The server expects a compiler version with experimental AST JSON support. The pinned submodule version in this repository is the supported one.
- Before running `dune` or `opam` commands manually inside `anvil/`, remember to load the `opam` environment:

```bash
eval $(opam env)
```

### Daily Development Commands

Use the root scripts when possible:

```bash
./format.sh
./build.sh
./test.sh
```

Component-specific variants:

```bash
./format.sh server
./build.sh server
./build.sh vscode
./build.sh vim
./test.sh server
```

Useful direct commands during server development:

```bash
cd server
npm run watch
npm run build
npm run test
npm run lint
npm run format
```

Notes:

- `./format.sh` intentionally does not format the `anvil/` submodule.
- In non-interactive environments, `./test.sh server` runs Mocha with a minimal reporter.
- The server test suite uses files in `samples/`.

### Source-Of-Truth Files vs Generated Output

Do not edit compiled output directly.

Generated/build artifacts include:

- `server/out/`
- `extensions/vscode/client/out/`
- `extensions/vim/out/`

Edit the corresponding source files under `src/` instead.

Also treat `node_modules/` as install output, not source.

## Language Server Runtime Architecture

### Entry Point: `server/src/server.ts`

`server.ts` is the orchestration layer. It is responsible for:

- creating the LSP connection
- tracking client capabilities
- registering server capabilities
- wiring document lifecycle events
- loading and caching per-document settings
- creating and caching `AnvilDocument` instances
- routing each LSP request to the appropriate feature implementation

The server currently declares support for:

- diagnostics
- hover
- definition
- type definition
- references
- completion and completion resolve
- signature help
- inlay hints

There is no rename/refactor support yet.

### Document State: `server/src/core/AnvilDocument.ts`

`AnvilDocument` is the core runtime object for a single `.anvil` file.

It owns:

- the current `TextDocument`
- the latest parsed `AnvilAst`
- the latest compiler errors/warnings
- compile locking to avoid overlapping compiler runs
- debounced compilation for diagnostics
- post-AST edit tracking so stale AST spans can still be mapped back into the live buffer

This class is important because the compiler only knows about the text snapshot it was given at compile time. Users can continue typing after that point. `AnvilDocument` tries to bridge that gap by tracking subsequent edits and remapping AST positions into current LSP positions.

That remapping is explicitly experimental. If you are changing position-sensitive features, read this file carefully.

### Compiler Bridge: `server/src/core/AnvilCompiler.ts`

`AnvilCompiler` shells out to the Anvil compiler process.

Key facts:

- It runs `anvil -ast -json`.
- For open documents, it can pass in-memory file contents via `-stdin`.
- It currently supports compiling one file at a time for language-server purposes.
- It parses JSON compiler output into a normalized `AnvilCompilationResult`.
- It converts compiler diagnostics into a shape that the LSP layer can use.
- It parses compiler AST output into `AnvilAst`.

If the compiler output format changes, this file and the AST schema are the first places to check.

### AST Schema And Navigation: `server/src/core/ast/`

This directory has two distinct responsibilities:

1. `schema.ts`
   Zod schemas and TypeScript types describing the compiler AST payload.
2. `AnvilAst.ts`
   Rich wrapper/navigation APIs over parsed AST data.

`AnvilAstNode` is the main abstraction used by feature code. It provides:

- typed traversal
- name/kind/type accessors
- span and absolute-span handling
- definition/reference lookup helpers
- event/timing information access

If compiler AST shape changes, update `schema.ts` first, then adjust `AnvilAst.ts` helper logic as needed.

### Static Metadata: `server/src/info/`

This directory contains JSON lookup tables used for documentation and completion behavior.

- `completion-info.json`
  Built-in keyword/operator completion metadata, snippets, categories, scope rules, and timing completions.
- `ast-node-info.json`
  Human-readable names, documentation text, and examples for AST node kinds.
- `parsed.ts`
  Zod-validated loader and typed wrapper layer over those JSON files.

These files are a major source of user-facing hover text and built-in completion descriptions.

If the JSON comments and the runtime behavior ever disagree, treat `server/src/info/parsed.ts` as the source of truth. That file defines the accepted schema, the normalization rules, and the back-fill behavior actually used at runtime.

#### `completion-info.json`

`completion-info.json` has three runtime sections:

1. `kind`
   Maps AST node lookup keys to completion metadata for AST-backed symbols.
2. `builtInKeywordCompletions`
   Maps built-in source tokens to one or more completion variants.
3. `timingCompletions`
   Maps timing-annotation syntax patterns to completion snippets used only inside message timing annotations.

The accepted top-level shape is effectively:

```json
{
  "kind": {
    "<kind-or-kind/type>": { "hint": "...", "lspKind": "..." }
  },
  "builtInKeywordCompletions": {
    "<keyword>": {
      "category": "... or [...]",
      "hint": "... or [...]",
      "lspKind": "... or [...]",
      "astKind": "... / null / [...]",
      "description": "... / null / [...]",
      "snippet": "... / null / [...]",
      "scope": "... / null / [...]"
    }
  },
  "timingCompletions": {
    "lifetime": {
      "<pattern>": {
        "hint": "...",
        "insertText": "...",
        "lspKind": "...",
        "astKind": "...",
        "description": "..."
      }
    },
    "sync": {
      "<pattern>": {
        "hint": "...",
        "insertText": "...",
        "lspKind": "...",
        "astKind": "...",
        "description": "..."
      }
    }
  }
}
```

Important details by section:

- `kind`
  Keys are either `kind` or `kind/type`, matching AST lookup behavior.
- `kind.hint`
  Used as the short detail string on AST-backed completion items.
- `kind.lspKind`
  Must match an `CompletionItemKind` enum member name such as `Function`, `Module`, `Struct`, or `Enum`.
- `builtInKeywordCompletions` entries allow scalar-or-array fields.
  Arrays are expanded in parallel into concrete completion variants by `expandKeywordVariants()` in `parsed.ts`.
- `builtInKeywordCompletions.category`
  Used by `AnvilCompletionGenerator` to filter keyword subsets in specific contexts.
- `builtInKeywordCompletions.hint`
  Shown as the completion detail text for the built-in item.
- `builtInKeywordCompletions.lspKind`
  Controls the LSP completion kind of the built-in item.
- `builtInKeywordCompletions.astKind`
  Associates the completion variant with an AST node kind. This is used mainly to back-fill missing documentation from `ast-node-info.json`, not to resolve symbols.
- `builtInKeywordCompletions.description`
  Markdown documentation shown in completion docs. If omitted or `null` and `astKind` is present, `parsed.ts` back-fills it from `ast-node-info.json`.
- `builtInKeywordCompletions.snippet`
  Insert text used for the completion. If different from the label, it is emitted as an LSP snippet.
- `builtInKeywordCompletions.scope`
  Parsed into one of three forms: global, delimiter-based, or AST-node-based scope. Important caveat: this is normalized and tested, but it is not currently enforced by the completion generator, so treat it as intended scope metadata rather than active filtering logic.
- `timingCompletions.lifetime`
  Used only by the timing-annotation heuristic for the first lifetime annotation inside message signatures.
- `timingCompletions.sync`
  Used only by the timing-annotation heuristic for later sync-mode annotations.
- `timingCompletions.*.insertText`
  Drives the exact timing snippet inserted into the buffer.
- `timingCompletions.*.astKind`
  Exists for documentation back-fill and semantic labeling; it is not used to locate AST nodes directly.
- `timingCompletions` keys containing `%s`
  Are expanded manually by `AnvilCompletionGenerator` against sibling message names in the current channel class.
- `timingCompletions._substitutionPatterns`
  Is currently validated by `parsed.ts`, but the runtime completion code does not consume it. Actual `%s` expansion is hard-coded in `AnvilCompletionGenerator` today.
- String-valued `_comment` entries are ignored intentionally.

Actual runtime consumers of `completion-info.json`:

- `AnvilCompletionGenerator.getAllEntries()` and `AnvilCompletionDetail.snippetFromNode()` use `completionInfo.getKindMetadata()`.
- `AnvilCompletionGenerator.getAnvilBuiltinCompletions()` uses `completionInfo.knownKeywords` and `completionInfo.getKeywordMetadata()`.
- `AnvilCompletionGenerator.checkTimingAnnotHeuristics()` uses `completionInfo.knownLifetimeTimingKeys`, `getLifetimeTimingEntry()`, `knownSyncTimingKeys`, and `getSyncTimingEntry()`.

One subtle behavior in `parsed.ts`: when `getKindMetadata()` is given an `AnvilAstNode`, typedef nodes may be reclassified to `data_type/record` or `data_type/variant` so that named structs and enums surface as `Struct` or `Enum` completions rather than generic `Type` completions.

#### `ast-node-info.json`

`ast-node-info.json` maps AST node lookup keys to human-facing explanation content.

The accepted shape is effectively:

```json
{
  "kind": {
    "<kind-or-kind/type>": {
      "name": "...",
      "description": "...",
      "examples": "...",
      "internal": false
    }
  }
}
```

Property behavior:

- Keys are either `kind` or `kind/type`.
  Use `kind/type` when the AST `type` discriminator changes the user-facing meaning, such as `expr/binop`, `expr/send`, or `data_type/record`.
- `name`
  Short human-readable label for the node. Used by hover-description code when naming node kinds.
- `description`
  Markdown prose used in the "Anvil Info" explanation section and also used as a fallback documentation source for completion and timing-completion entries that specify `astKind` but omit their own `description`.
- `examples`
  Optional markdown code examples appended only when explanation rendering is enabled and the caller requested examples.
- `internal`
  Marks compiler/internal nodes that should not show the user-facing "Anvil Info" section. The entry still exists and can still be looked up programmatically.
- String-valued `_comment` entries are ignored intentionally.

Actual runtime consumers of `ast-node-info.json`:

- `AnvilDescriptionGenerator` uses `astNodeInfo.getFor(node)` to render the explanation block in hover and completion docs.
- `CompletionInfo` uses it indirectly to back-fill missing descriptions in `completion-info.json`.

`AstNodeInfo.getFor()` does more than a plain `kind/type` lookup. It prefers:

1. `kind/type` over `kind`
2. underlying `data_type/record` or `data_type/variant` entries for typedef-like nodes
3. literal subtype entries such as `literal/decimal` for `expr/literal` nodes

That fallback order is important when you are adding docs for broad AST families versus specific sub-kinds.

### Feature Implementations: `server/src/generators/`

The language server keeps most request-specific logic in feature generators.

- `AnvilDescriptionGenerator.ts`
  Diagnostics formatting plus hover documentation generation.
- `AnvilCompletionGenerator.ts`
  Built-in and AST-driven completion logic, including syntax heuristics and snippets.
- `AnvilSignatureHelpGenerator.ts`
  Signature help heuristics and signature construction.
- `AnvilInlayHintGenerator.ts`
  Timing/lifetime inlay hints.

These modules are the usual entry points when you want to change a user-visible language feature.

### Settings Flow

Server settings are defined in `server/src/utils/AnvilServerSettings.ts`.

Important settings include:

- `anvil.maxNumberOfProblems`
- `anvil.projectRoot`
- `anvil.executablePath`
- `anvil.showTimingInfo`
- `anvil.showSyntaxHelp`
- `anvil.debug`

Two important details:

1. The server supports both coarse boolean and structured object forms for `showTimingInfo` and `showSyntaxHelp`.
2. The editor-facing configuration schema is duplicated manually in extension manifests.

That means when you add or change a setting, you usually must update all of:

- `server/src/utils/AnvilServerSettings.ts`
- `extensions/*/package.json`

If you forget one of those, the server and editor UI will drift out of sync.

### LSP Request Lifecycle

A typical semantic request works like this:

1. The editor sends an LSP request.
2. `server.ts` looks up the current `AnvilDocument` and settings.
3. If necessary, the document compiles via `AnvilCompiler`.
4. The compiler output is converted into `AnvilAst` plus normalized diagnostics.
5. A generator or AST helper turns that state into an LSP response.

Diagnostics are slightly special:

- diagnostics use debounced compilation
- a successful diagnostics pass also drives later features by populating the AST cache
- diagnostics refreshes also trigger inlay hint refreshes

## How To Change Specific Parts Of The Language Server

### Add Or Change A User Setting

Update:

1. `server/src/utils/AnvilServerSettings.ts`
2. `extensions/*/package.json`
4. Any logic in generators or `server.ts` that consumes the setting
5. Tests if behavior changes

If the setting affects hover/completion/inlay hints, check both resolution helpers:

- `resolveShowTimingInfo`
- `resolveShowSyntaxHelp`

### Change Compiler Invocation Or Project Resolution

Start in `server/src/core/AnvilCompiler.ts`.

Typical reasons include:

- compiler CLI changes
- AST output changes
- input file handling changes
- project root resolution changes
- alternate executable lookup behavior

Also review:

- `server/src/core/AnvilDocument.ts`
- `server/test/core/AnvilCompiler.test.ts`
- `README.md` if installation expectations changed

### Change The AST Schema After A Compiler Update

Start in this order:

1. `server/src/core/ast/schema.ts`
2. `server/src/core/ast/AnvilAst.ts`
3. `server/src/core/AnvilCompiler.ts`
4. affected generators
5. tests

Symptoms of schema drift usually look like:

- JSON parse succeeds but AST parsing fails
- hover/completion/navigation suddenly become empty
- definition or reference lookup breaks
- timing/lifetime hints disappear or become incorrect

### Change Diagnostics

Diagnostics come from compiler output and are translated in two steps:

1. `AnvilCompiler` normalizes compiler errors.
2. `AnvilDescriptionGenerator.describeDiagnostics()` converts them into LSP diagnostics.

Change `AnvilDescriptionGenerator.ts` when you want to change:

- diagnostic severity mapping
- range mapping behavior
- related information
- displayed messages for dependency/import errors

### Change Hover Text And Documentation

Hover handling starts in `server/src/server.ts` and is rendered by `AnvilDescriptionGenerator.describeNode()`.

You will often need to change one or more of:

- `server/src/generators/AnvilDescriptionGenerator.ts`
- `server/src/info/ast-node-info.json`
- `server/src/info/completion-info.json`
- `server/src/info/parsed.ts`

Use `ast-node-info.json` when the change is primarily documentation content for an AST node kind.
Use `completion-info.json` when the change is about built-in keyword/operator metadata.

### Change Completion Behavior

Completion logic lives in `server/src/generators/AnvilCompletionGenerator.ts`.

There are two broad categories of completions:

1. AST-driven completions
   User-defined symbols, types, endpoints, messages, and related semantic items.
2. Built-in completions
   Keywords, operators, timing constructs, and snippets sourced from `completion-info.json`.

This file contains many heuristic entry points based on text before the cursor, for example:

- register reads with `*`
- register writes with `set`
- `send` and `recv`
- `spawn`
- `call`
- type annotations
- timing annotations

If you add a new context-sensitive completion, follow the existing pattern:

1. detect the syntax context from the prefix text
2. return early if the heuristic matches
3. otherwise fall back to broader AST and built-in completion sets

When built-in completion descriptions or snippets change, also update `server/src/info/completion-info.json`.

### Change Completion Documentation Popups

Completion documentation is produced in `server.ts` during `onCompletionResolve`.

That path combines:

- raw description text carried on the completion item
- optional AST-backed definition/description text from `AnvilDescriptionGenerator`
- current `showSyntaxHelp` and `showTimingInfo` settings

If completion labels are correct but the docs popup is wrong, the fix may be in `onCompletionResolve`, not in `AnvilCompletionGenerator`.

### Change Signature Help

Signature help is handled in `server/src/generators/AnvilSignatureHelpGenerator.ts`.

Current support is heuristic-based for:

- `spawn <proc>(...)`
- `call <func>(...)`
- `send <endpoint>.<message>(...)`
- record initialization syntax

When adjusting signature help:

- verify regex/prefix parsing carefully
- make sure active parameter counting still works for nested delimiters
- keep the generated signature label and documentation in sync with hover behavior

### Change Definitions, Type Definitions, Or References

The routing lives in `server.ts`, but the real semantic behavior depends heavily on `AnvilAstNode` helpers.

Check:

- `server/src/server.ts`
- `server/src/core/ast/AnvilAst.ts`
- `server/src/core/AnvilDocument.ts`

Definition-related bugs are often one of:

- wrong node chosen under cursor
- span mapping drift after edits
- compiler missing or changing definition annotations
- filtering logic choosing the wrong definition candidate

### Change Inlay Hints Or Timing/Lifetime Presentation

Timing hints live in `server/src/generators/AnvilInlayHintGenerator.ts`.

Timing and lifetime descriptions used in hover live in `server/src/generators/AnvilDescriptionGenerator.ts` together with:

- `server/src/utils/AnvilCycleTimeFormatter.ts`
- `server/src/utils/AnvilCycleTimeCalculator.ts`

If you change timing semantics or cycle formatting, verify both hover output and inlay hints.

### Change Logging Or Debugging Behavior

Logging lives in `server/src/utils/logger.ts`.

During tests, logs are suppressed unless `DEBUG` is set. That is intentional so the test output stays readable.

### Change VS Code Integration

The VS Code extension has three layers:

1. `extensions/vscode/package.json`
   Extension manifest, language contribution, settings schema, grammar registration.
2. `extensions/vscode/client/src/extension.ts`
   Launches the server with `vscode-languageclient` over IPC.
3. `extensions/vscode/grammar.json`
   Syntax highlighting grammar.

Important behavior:

- the extension manifest `main` points to `client/out/extension`
- the client resolves the server entrypoint as `server/out/server.js`
- `extensions/vscode/server` is a symlink to `../../server`

That symlink assumption matters for local development and packaging.

If you change settings or language registration, update `package.json`.
If you change how the server is launched, update `client/src/extension.ts`.
If you change syntax highlighting, update `grammar.json` and possibly `anvil.configuration.json`.

### Change coc.nvim Integration

The coc.nvim extension has these pieces:

- `extensions/vim/package.json`
- `extensions/vim/src/index.ts`
- `extensions/vim/esbuild.mjs`
- `extensions/vim/ftdetect/anvil.vim`
- `extensions/vim/syntax/anvil.vim`

Important behavior:

- the client bundle is built with esbuild to `out/index.js`
- it resolves the server as `../server/out/server.js`
- `extensions/vim/server` is a symlink to `../../server`
- the extension also registers autocmds to mark `*.anvil` files as `filetype=anvil`

If coc.nvim startup breaks, verify the built bundle path and the relative server path first.

### Change Syntax Highlighting

Syntax highlighting is editor-specific.

- VS Code uses `extensions/vscode/grammar.json`.
- Vim/coc.nvim uses `extensions/vim/syntax/anvil.vim` and `ftdetect/anvil.vim`.

Language-server semantic features are separate from syntax highlighting. Many changes require touching both areas if you are introducing new language constructs.

## Testing Strategy

### What The Current Tests Cover

The server test suite includes coverage for:

- compiler invocation and error parsing
- static JSON metadata loading and validation
- completion heuristics
- signature help
- hover/description generation
- timing/lifetime inlay hints

Tests live under `server/test/`.

Most semantic tests compile files from `samples/`, so sample files are part of the test harness.

### Running Tests

From the root:

```bash
./test.sh server
```

Or directly:

```bash
cd server
npm run test
```

If tests fail because the compiler is missing, build Anvil first:

```bash
./build.sh anvil
```

### When To Add Or Update Tests

Add or update tests whenever you change:

- compiler JSON parsing
- AST schema interpretation
- completion heuristics
- hover rendering
- signature help parsing
- timing/inlay hint formatting
- settings normalization that affects behavior

If you change feature behavior and no test clearly exercises it, add one.

### Samples And Fixtures

The `samples/` directory contains the Anvil source files used by tests.

Use it when:

- you need richer semantic fixtures than unit mocks would provide
- you are testing cross-node relationships such as definitions, references, timing, endpoints, or procedure signatures

Keep sample changes intentional. Many tests rely on stable source locations.

## Common Maintainer Pitfalls

- Forgetting to initialize or build the `anvil/` submodule before running server tests.
- Editing generated `out/` files instead of `src/` files.
- Updating server settings without updating both extension manifests.
- Changing compiler AST assumptions without updating `schema.ts` and related tests.
- Breaking completion/signature heuristics by changing regexes without testing nested delimiters or partial input.
- Forgetting that completion documentation is partly assembled in `onCompletionResolve`, not only in the completion generator.
- Assuming references are cross-file-complete; current support is constrained by compiler data.
- Forgetting that extension packaging currently depends on local `server` symlinks.

## Troubleshooting

### The Server Starts But Semantic Features Are Empty

Check:

1. `bin/anvil` exists.
2. the configured `anvil.executablePath` is correct.
3. the compiler version supports experimental AST JSON output.
4. `server/src/core/ast/schema.ts` still matches the compiler output.

### Tests Fail With Compiler Errors Or Missing Binary

Run:

```bash
./build.sh anvil
```

If building manually inside `anvil/`, remember:

```bash
eval $(opam env)
```

### Hover/Definition Locations Are Wrong After Edits

Investigate `server/src/core/AnvilDocument.ts`.

The likely cause is the post-AST edit tracking/remapping logic. This is one of the more delicate parts of the server.

### A New Setting Appears In The Server But Not In The Editor UI

Update the extension manifest configuration schema:

- `extensions/*/package.json`

### Completion Labels Look Right But Documentation Is Missing Or Wrong

Check both:

- `server/src/generators/AnvilCompletionGenerator.ts`
- `server/src/server.ts` completion resolve handler

## Suggested Workflow For Non-Trivial Changes

1. Build the compiler and server first.
2. Reproduce the behavior with an existing `samples/` file or add a focused sample.
3. Change the smallest relevant layer.
4. Run `./build.sh server`.
5. Run `./test.sh server`.
6. If editor behavior is involved, also rebuild the affected extension.

For most language-feature changes, the smallest relevant layer is one of:

- AST schema
- compiler wrapper
- a single generator
- extension configuration schema

## Files New Maintainers Should Read First

If you are new to this repository, read these in order:

1. `README.md`
2. `MAINTAINERS.md`
3. `build.sh`
4. `test.sh`
5. `server/src/server.ts`
6. `server/src/core/AnvilDocument.ts`
7. `server/src/core/AnvilCompiler.ts`
8. `server/src/core/ast/schema.ts`
9. `server/src/core/ast/AnvilAst.ts`
10. `server/src/generators/`

That sequence gives the fastest path to understanding how requests enter the system, when compilation happens, and where feature behavior lives.
