# anvil-lsp

[Anvil](https://github.com/kisp-nus/anvil) [Language Server Protocol (LSP)](https://microsoft.github.io/language-server-protocol/) implementation, including prepared extensions for supported editors.


## Requires

- Anvil [`c35f25d`](https://github.com/wxwern/anvil/commit/c35f25d) or later with AST output support.

- [Node.js](https://nodejs.org/en) version 18 or later.


## Feature Support

(Checkboxes indicate implemented features)

- [ ] Inline Diagnostics (Warnings/Errors)
- [ ] Hover Information
    - [ ] Type info
    - [ ] Lifetime info
- [ ] Go to Definition
- [ ] Find All References
- [ ] Autocompletion
- [ ] Event Inlay Hints
- [ ] Rename/Refactor symbol


## Installing Editor Extensions

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
