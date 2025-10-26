# anvil-lsp

[Anvil](https://github.com/jasonyu1996/anvil) [Language Server Protocol (LSP)](https://microsoft.github.io/language-server-protocol/) implementation, including prepared extensions for supported editors.


## Supported Features

(Checkboxes indicate implemented features)

- [x] Inline Diagnostics (Warnings/Errors)
- [ ] Hover Information \[WIP\]
- [ ] Go to Definition \[WIP\]
- [ ] Find References
- [ ] Rename/Refactor symbol
- [ ] Autocompletion
- [ ] Semantic Syntax Highlighting


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
    Plug 'wxwern/anvil-lsp', { 'rtp': 'extensions/vim', 'do': 'npm install && npm run build' }
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
