import { ExtensionContext, services, workspace, LanguageClient, NodeModule, TransportKind, LanguageClientOptions } from 'coc.nvim'

export async function activate(context: ExtensionContext): Promise<void> {
  const serverOptions : NodeModule = {
    module: "./server/out/server.js",
    transport: TransportKind.ipc,
    args: ["--node-ipc"],
  }

  const clientOptions : LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'anvil', pattern: '**/*.anvil' }],
    initializationOptions: {},
    markdown: {
      isTrusted: true,
      supportHtml: true,
    },
  }

  const client = new LanguageClient(
    'anvil',
    'Anvil Language Server',
    serverOptions,
    clientOptions
  )

  // register the language client
  context.subscriptions.push(services.registerLanguageClient(client));

  // autocmd BufRead,BufNewFile *.anvil set filetype=anvil
  context.subscriptions.push(
    workspace.registerAutocmd({
      event: 'BufRead',
      pattern: '*.anvil',
      callback: () => {
        workspace.nvim.command('set filetype=anvil', true);
      },
    }),
    workspace.registerAutocmd({
      event: 'BufNewFile',
      pattern: '*.anvil',
      callback: () => {
        workspace.nvim.command('set filetype=anvil', true);
      },
    })
  );
}
