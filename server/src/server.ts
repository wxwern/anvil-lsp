/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	DocumentDiagnosticReportKind,
	type DocumentDiagnosticReport
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import {
	AnvilCompilationResult,
	AnvilCompiler
} from './anvilCompiler';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true
			},
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false
			}
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface AnvilServerSettings {
	maxNumberOfProblems: number;
	projectRoot?: string;
	anvilBinaryPath?: string;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: AnvilServerSettings = { maxNumberOfProblems: 1000 };
let globalSettings: AnvilServerSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings = new Map<string, Thenable<AnvilServerSettings>>();

// Global compile lock to avoid concurrent compilations
let globalCompileLock: {[key: string]: Promise<AnvilCompilationResult>} = {};

// Global pending compile flags to debounce multiple compile requests
let globalPendingCompile: {[key: string]: boolean} = {};

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = (
			(change.settings.anvilLanguageServer || defaultSettings)
		);
	}
	// Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
	// We could optimize things here and re-fetch the setting first can compare it
	// to the existing setting, but this is out of scope for this example.
	connection.languages.diagnostics.refresh();
});

function getDocumentSettings(resource: string): Thenable<AnvilServerSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'anvilLanguageServer'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

async function convertAnvilCompilerResultToDiagnostics(result: AnvilCompilationResult, textDocument: TextDocument): Promise<Diagnostic[]> {
	let problems = 0;
	const settings = await getDocumentSettings(textDocument.uri);
	
	const diagnostics: Diagnostic[] = [];
	if (!result || !result.errors) return diagnostics;

	// Convert it to diagnostics information
	for (let error of result.errors) {
		problems++;
		if (problems > settings.maxNumberOfProblems) {
			break;
		}

		const errorTypeString = { 
			'warning': 'Warning',
			'error': 'Error'
		}

		const errorTypeDiagnosticSeverity = {
			'warning': DiagnosticSeverity.Warning,
			'error': DiagnosticSeverity.Error
		}

		const diagnostic: Diagnostic = {
			severity: errorTypeDiagnosticSeverity[error.type] || DiagnosticSeverity.Error,
			range: {
				start: {
					line: Math.max(0, error.startLine - 1),
					character: Math.max(0, error.startCol),
				},
				end: {
					line: Math.max(0, error.endLine - 1),
					character: Math.max(0, error.endCol)
				}
			},
			message: error.message,
			source: 'anvil'
		};

		if (hasDiagnosticRelatedInformationCapability) {
			diagnostic.relatedInformation = [
				{
					location: {
						uri: textDocument.uri,
						range: diagnostic.range
					},
					message: `Anvil Compiler ${errorTypeString[error.type] || 'Error'}`,
				}
			];
		}

		diagnostics.push(diagnostic);
	}
	return diagnostics;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});


connection.languages.diagnostics.on(async (params) => {
	const document = documents.get(params.textDocument.uri);
	if (document !== undefined) {
		return {
			kind: DocumentDiagnosticReportKind.Full,
			items: await delayedValidateTextDocument(document)
		} satisfies DocumentDiagnosticReport;
	} else {
		// We don't know the document. We can either try to read it from disk
		// or we don't report problems for it.
		return {
			kind: DocumentDiagnosticReportKind.Full,
			items: []
		} satisfies DocumentDiagnosticReport;
	}
});


let pendingValidationRequests: { [uri: string]: { timeout: NodeJS.Timeout, cancel: () => void } } = {};
async function delayedValidateTextDocument(textDocument: TextDocument): Promise<Diagnostic[]> {
	pendingValidationRequests[textDocument.uri]?.cancel();

	return new Promise((resolve) => {
		const timeout = setTimeout(async () => {
			delete pendingValidationRequests[textDocument.uri];
			const diagnostics = await validateTextDocument(textDocument);
			resolve(diagnostics);
		}, 500);

		const cancel = () => {
			clearTimeout(timeout);
			delete pendingValidationRequests[textDocument.uri];
			resolve([]);
		};
		
		pendingValidationRequests[textDocument.uri] = { timeout, cancel };
	});
}

async function validateTextDocument(textDocument: TextDocument): Promise<Diagnostic[]> {

	if (globalPendingCompile[textDocument.uri]) {
		// There's an ongoing compilation for this document, do not run now.
		globalPendingCompile[textDocument.uri] = true;
		const result = await globalCompileLock[textDocument.uri];
		return await convertAnvilCompilerResultToDiagnostics(result, textDocument);
	}

	globalCompileLock[textDocument.uri] = (async () => {
		let result: AnvilCompilationResult | undefined;
		while (!result || globalPendingCompile[textDocument.uri]) {
			delete globalPendingCompile[textDocument.uri];

			const settings = await getDocumentSettings(textDocument.uri);

			const compiler = new AnvilCompiler(settings.projectRoot, settings.anvilBinaryPath);
			const filePath = textDocument.uri.replace('file://', '');
			const fileData = { [filePath]: textDocument.getText() };

			result = await compiler.compile(filePath, fileData);
		}
		return result;
	})();

	const result = await globalCompileLock[textDocument.uri];
	delete globalCompileLock[textDocument.uri];
	delete globalPendingCompile[textDocument.uri];

	return await convertAnvilCompilerResultToDiagnostics(result, textDocument);
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received a file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		// The pass parameter contains the position of the text document in
		// which code complete got requested. For the example we ignore this
		// info and always provide the same completion items.
		return [
			{
				label: 'TypeScript',
				kind: CompletionItemKind.Text,
				data: 1
			},
			{
				label: 'JavaScript',
				kind: CompletionItemKind.Text,
				data: 2
			}
		];
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		if (item.data === 1) {
			item.detail = 'TypeScript details';
			item.documentation = 'TypeScript documentation';
		} else if (item.data === 2) {
			item.detail = 'JavaScript details';
			item.documentation = 'JavaScript documentation';
		}
		return item;
	}
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
