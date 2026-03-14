# anvil-lsp

[Anvil](https://github.com/kisp-nus/anvil) [Language Server Protocol (LSP)](https://microsoft.github.io/language-server-protocol/) implementation, including prepared extensions for supported editors.


## Requires

- Anvil [`a5d68ad` or later](https://github.com/wxwern/anvil/tree/add-annotated-ast-output) with **experimental AST output** support.

- [Node.js](https://nodejs.org/en) version 22 or later.

To install the language server, view the [installation instructions](#language-server-installation) for your editor of choice.

To install a supported version of Anvil, view the [Anvil installation instructions](#anvil-installation).


## Feature Support

- [x] Inline Diagnostics
    - [x] Compile Errors
    - [ ] Compile Warnings
- [x] Hover Information
    - [x] Type info
    - [x] Definition info
    - [ ] Lifetime info
    - [ ] Documentation (from source doc comments)
    - [ ] Built-in syntax descriptions
- [x] Go to Definition
- [ ] Go to Type Definition
- [x] Find All References
- [x] Signature Help
    - [x] Spawn process arguments (`spawn <proc>(<args>)`)
    - [x] Endpoint message send arguments (`send <endpoint>.<message>(<args>)`)
    - [x] Record init field values (`Rec::{<field> = <value>; ... }`)
    - [x] Function call arguments (`call <identifier>(<args>)`)
    - [ ] ... TBA
- [x] Autocompletion
    - [x] Anvil keywords
    - [x] Document symbols
    - [x] Context-aware suggestions
        - [x] Function call suggestions (`call <identifier>(<args>)`)
        - [x] Endpoint message send/receive (`send`/`recv`) syntax
        - [x] Register read (`*`) syntax
        - [x] Register assign (`set`) syntax
        - [ ] Record init (`Rec::{field =`) syntax
        - [ ] Record read (`.field`) syntax
        - [x] Enum value syntax (`Enum::value`) syntax
        - [x] Type annotation syntax (`<identifier> : <type>`)
        - [x] Lifetime annotation syntax (`chan { <left/right> ... : <lifetime> }`)
        - [ ] Datatype-matched parameter values
        - ... TBA
    - [x] Snippets
        - [x] Automatic delimiter insertion
        - [x] Function call snippet (`call <identifier>(<args>)`)
        - [x] Spawn process snippet (`spawn <proc>(<args>)`)
        - [x] Record init snippet (`Rec::{<field> = <value>; ... }`)
        - ... TBA
- [x] Inlay Hints
    - [x] Timing Information
        - [x] Events
        - [x] Clock Cycle Hints
        - [x] Lifetime Hints
- [ ] Rename/Refactor symbol

(Checkboxes indicate implemented features)

**Warning:** Both the Anvil Compiler AST output and Language Server implementations are currently experimental.
They may have bugs and the AST API are subject to breaking changes. Use with caution.


## Language Server Installation

Extensions are experimental. They automatically integrate syntax highlighting and LSP support for Anvil files.

Available extensions for supported editors are included in the `extensions` folder.

- [VSCode](#vscode)
- [Vim/Neovim (`coc.nvim`)](#vimneovim-cocnvim)


### VSCode

1. Clone this repository, and build the extension:
    ```bash
    git clone https://github.com/wxwern/anvil-lsp.git
    cd anvil-lsp/extensions/vscode
    npm install
    npm run build
    ```

2. Open the Command Palette with `Ctrl/Cmd + Shift + P`.

3. Select **"Developer: Install Extension from Location..."**.

4. Navigate to this repository, then into `extensions`, and then `vscode`.

5. Select **"Open"** to install the extension.


### Vim/Neovim (coc.nvim)

This requires `coc.nvim` for out-of-the-box LSP support.

Use your favorite Vim/Neovim plugin manager to download, build and install the extension.
For example, with `vim-plug`:

1. Add the following to your `.vimrc` or `init.vim`:
    ```vim
    Plug 'wxwern/anvil-lsp', {
        \ 'rtp': 'extensions/vim',
        \ 'do': 'cd extensions/vim && npm install && npm run build'
        \ }
    ```
2. Restart Vim/Neovim, then run:
    ```vim
    :PlugInstall
    ```

<details>
    <summary>Manual installation</summary>

If you prefer to manage it manually (still requires `coc.nvim`):

1. Clone this repository, and build the extension:
    ```bash
    git clone https://github.com/wxwern/anvil-lsp.git
    cd anvil-lsp/extensions/vim
    npm install
    npm run build
    ```

2. Add the following to your `.vimrc` or `init.vim`:
    ```vim
    set rtp^=/path/to/anvil-lsp/extensions/vim
    ```

</details>


## Anvil Installation

The Anvil compiler is required for the language server to work, and must be built with experimental AST output support.

This repository includes a submodule of Anvil, pinned to a version with guaranteed compatibility with the language server.

1. Clone the repository with submodules:
    ```bash
    git clone --recurse-submodules https://github.com/wxwern/anvil-lsp.git
    ```

2. Build and install the pinned Anvil version with experimental AST output support:
    ```bash
    cd anvil-lsp/anvil
    eval $(opam env) && dune build --release && dune install
    ```


### Development Workflows

On *nix systems, run the build/test scripts in the root of the repository
to build/test all components (language server, anvil compiler, all editor extensions):
```bash
./build.sh
./test.sh
```

Or specify component(s) as argument(s) to build only said component, e.g.,
```bash
./build.sh anvil vscode
```


