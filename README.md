# anvil-lsp

[Anvil](https://github.com/kisp-nus/anvil) [Language Server Protocol (LSP)](https://microsoft.github.io/language-server-protocol/) implementation, including prepared extensions for supported editors.


## Requires

- Anvil [`15eea4e` or later](https://github.com/wxwern/anvil/tree/add-annotated-ast-output) with **experimental AST output** support.

- [Node.js](https://nodejs.org/en) version 22 or later.

To install the language server, view the [installation instructions](#installation) for your editor of choice.


## Feature Support

- [x] Inline Diagnostics
    - [x] Compile Errors
    - [ ] Compile Warnings
- [x] Hover Information
    - [x] Type info
    - [x] Definition info
    - [ ] Lifetime info
- [x] Go to Definition
- [ ] Go to Type Definition
- [x] Find All References
- [x] Autocompletion
    - [x] Anvil keywords
    - [x] Document symbols
    - [x] Context-aware suggestions
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
        - [x] Spawn process snippet (`spawn <proc>(<args>)`)
        - [x] Record init snippet (`Rec::{<field> = <value>, ... }`)
        - ... TBA
- [x] Inlay Hints
    - [x] Timing Information
- [ ] Rename/Refactor symbol

(Checkboxes indicate implemented features)

**Warning:** Both the Anvil Compiler AST output and Language Server implementations are currently experimental.
They may have bugs and the AST API are subject to breaking changes. Use with caution.


## Installation

Extensions are experimental. They automatically integrate syntax highlighting and LSP support for Anvil files.

Available extensions for supported editors are included in the `extensions` folder.

- [VSCode](#vscode)
- [Vim](#vim)


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


### Vim

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

Or if you prefer to manage it locally:


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
