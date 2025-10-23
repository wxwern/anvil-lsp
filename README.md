# anvil-lsp

[Anvil](https://github.com/jasonyu1996/anvil) [Language Server Protocol (LSP)](https://microsoft.github.io/language-server-protocol/) implementation, including prepared extensions for supported editors.


## Supported Features

(Checkboxes indicate implemented features)

- [x] Inline Diagnostics (Warnings/Errors)
- [ ] Hover Information [WIP]
- [ ] Go to Definition [WIP]
- [ ] Find References
- [ ] Rename/Refactor symbol
- [ ] Autocompletion


## Installing the Extensions

### VSCode
Install from Releases page or directly from VSCode Marketplace:

(todo...)

### coc.nvim
Use your favorite Vim/Neovim plugin manager to install the extension. For example, with `vim-plug`:

```vim
Plug 'wxwern/anvil-lsp', { 'rtp': 'extensions/coc-nvim', 'do': 'npm install && npm run build' }
```

