/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	TextDocumentSyncKind,
	InitializeResult,
	DocumentDiagnosticReportKind,
	type DocumentDiagnosticReport,
	FileChangeType,
} from 'vscode-languageserver/node';

import {
	TextDocument,
} from 'vscode-languageserver-textdocument';

import { AnvilServerSettings, DEFAULT_ANVIL_SERVER_SETTINGS } from './AnvilLspUtils';
import { AnvilDocument } from './AnvilDocument';
import { LazyMap } from './LazyMap';
import { AnvilDescriptionGenerator } from './AnvilDescriptionGenerator';


//
// INITIAL SETUP
//

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);

// Basic LSP Client Capabilities tracking
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;




//
// INITIALIZATION
//

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
			completionProvider: {
				resolveProvider: true,
				// triggers
				triggerCharacters: [
					'.', '*'
				]
			},
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false
			},
			definitionProvider: true,
			referencesProvider: true,
			hoverProvider: true
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





//
// GLOBAL CACHE
//

// The global settings, used when the `workspace/configuration` request is not supported by the client.
let globalSettings: AnvilServerSettings = DEFAULT_ANVIL_SERVER_SETTINGS;

// Cache the settings of all open documents
const documentSettings = LazyMap.onCacheMissAsync<string, Thenable<AnvilServerSettings>>(async resource => {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings).then(s => s || DEFAULT_ANVIL_SERVER_SETTINGS)
	}
	const result = connection.workspace.getConfiguration({
		scopeUri: resource,
		section: 'anvil'
	});
	return result.then(s => s || DEFAULT_ANVIL_SERVER_SETTINGS);
});

// Cache AnvilDocument instances for all open documents
const documentAnvilManagers = LazyMap.onCacheMiss<string, AnvilDocument | undefined>(resource => {
	const doc = documents.get(resource);
	return doc ? AnvilDocument.fromTextDocument(doc) : undefined;
});






//
// LSP Basic File Events
//

// Monitor changes to files and configuration
connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received a miscellaneous file change event');

	// Observe if there's anvil files updated outside
	let hasChanges = false;
	for (let change of _change.changes) {
		const extensions = ['.anvil'];
		if (!extensions.some(ext => change.uri.endsWith(ext))) {
			return;
		}

		switch (change.type) {
			case FileChangeType.Created:
				connection.console.log(`File created: ${change.uri}`);
				hasChanges = true;
				break;
			case FileChangeType.Changed:
				connection.console.log(`File changed: ${change.uri}`);
				hasChanges = true;
				break;
			case FileChangeType.Deleted:
				connection.console.log(`File deleted: ${change.uri}`);
				hasChanges = true;
				break;
		}
	}
	if (!hasChanges) {
		return;
	}
	connection.languages.diagnostics.refresh();
});

connection.onDidOpenTextDocument(e => {
	const document = e.textDocument;
	documentAnvilManagers.get(document.uri); // preload AnvilDocument for the opened document
});

connection.onDidChangeTextDocument(e => {
	const anvilDocument = documentAnvilManagers.get(e.textDocument.uri);
	anvilDocument?.syncTextEdits(e.contentChanges);
});

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = (
			(change.settings['anvil'] || globalSettings)
		);
	}
	connection.languages.diagnostics.refresh();
});

documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
	documentAnvilManagers.delete(e.document.uri);
});





//
// LSP FEATURES
//

// Diagnostics
connection.languages.diagnostics.on(async (params) => {
	const EMPTY = {
		kind: DocumentDiagnosticReportKind.Full,
		items: []
	} satisfies DocumentDiagnosticReport;

	const document = documents.get(params.textDocument.uri);
	if (document === undefined) return EMPTY;

	const anvilDocument = documentAnvilManagers.get(document.uri);
	if (!anvilDocument) return EMPTY;

	const settings = await documentSettings.get(document.uri);

	await anvilDocument.scheduleCompileDebounced(settings);

	AnvilDescriptionGenerator.DEBUG = !!settings.debug;

	const diagnostics =
		hasDiagnosticRelatedInformationCapability
			? await AnvilDescriptionGenerator.describeDiagnostics(anvilDocument, settings.maxNumberOfProblems)
			: [];

	return {
		kind: DocumentDiagnosticReportKind.Full,
		items: diagnostics
	} satisfies DocumentDiagnosticReport;
});


// Hover

connection.onHover(async (params) => {
	console.log('Hover event received at position', params.position, 'in document', params.textDocument.uri);

	const document = documents.get(params.textDocument.uri);
	if (document === undefined) return null;

	const settings = await documentSettings.get(document.uri);
	const D = !!settings.debug;

	AnvilDescriptionGenerator.DEBUG = D;

	const anvilDocument = documentAnvilManagers.get(document.uri);
	if (!anvilDocument) return !D ? null : {
		contents: {
			kind: 'markdown',
			value: 'Hover failed: Anvil document not available'
		}
	};


	if (!anvilDocument.anvilAst) {
		await anvilDocument.compile(settings);
	}

	if (!anvilDocument.anvilAst) {
		console.log(`AST not yet available for document ${document.uri}`);
		return !D ? null : {
			contents: {
				kind: 'markdown',
				value: 'AST information for hover not yet available'
			}
		};
	}

	const position = params.position;
	const node = anvilDocument.getClosestAnvilNodeToLspPosition(position);

	if (!node) {
		console.log(`No hover result found`);
		return !D ? null : {
			contents: {
				kind: 'markdown',
				value: 'No information available (cannot find AST node at position)'
			}
		};
	}

	return {
		contents: {
			kind: 'markdown',
			value: await AnvilDescriptionGenerator.describeNode(node, anvilDocument)
		}
	};


});





//
// BEGIN
//

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
