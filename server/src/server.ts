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
	TextDocumentPositionParams,
	CompletionItem,
	InlayHintKind,
} from 'vscode-languageserver/node';

import {
	TextDocument,
} from 'vscode-languageserver-textdocument';

import { AnvilLspUtils, AnvilServerSettings, DEFAULT_ANVIL_SERVER_SETTINGS } from './AnvilLspUtils';
import { AnvilDocument } from './AnvilDocument';
import { LazyMap } from './LazyMap';
import { AnvilDescriptionGenerator } from './AnvilDescriptionGenerator';
import {AnvilCompletionDetail, AnvilCompletionGenerator} from './AnvilCompletionGenerator';
import {text} from 'stream/consumers';
import {AnvilAstNode} from './AnvilAst';


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
				triggerCharacters: AnvilCompletionGenerator.TRIGGER_CHARS
			},
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false
			},
			definitionProvider: true,
			referencesProvider: true,
			hoverProvider: true,
			inlayHintProvider: true
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

const getAnvilDocumentForNode = (node: AnvilAstNode) => {
	const fullpath = node.location?.fullpath;
	if (!fullpath) return null;

	const doc = documentAnvilManagers.get('file://' + fullpath);
	return doc ?? null;
}






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
	connection.languages.inlayHint.refresh();
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
			value: await AnvilDescriptionGenerator.describeNode(node, anvilDocument, getAnvilDocumentForNode)
		}
	};


});


// Definitions
connection.onDefinition(async (params) => {
	const document = documents.get(params.textDocument.uri);
	if (document === undefined) return null;

	const settings = await documentSettings.get(document.uri);

	const anvilDocument = documentAnvilManagers.get(document.uri);
	if (!anvilDocument) return null;

	if (!anvilDocument.anvilAst) {
		await anvilDocument.compile(settings);
	}

	const ast = anvilDocument.anvilAst;
	if (!ast) {
		console.log(`AST not yet available for document ${document.uri}`);
		return null;
	}

	const position = params.position;

	const node = anvilDocument.getClosestAnvilNodeToLspPosition(position);
	const identifierUnderCursor = anvilDocument.getClosestIdentifierToLspPosition(position);

	if (!node) {
		console.log(`No definition result found`);
		return null;
	}

	let allDefs = node.definitions;
	if (!allDefs || allDefs.length === 0) {
		console.log(`No definitions found for node at position`);
		return null;
	}

	const updatedDefs = allDefs.filter(def =>
		!!(ast.goTo(def)?.names.includes(identifierUnderCursor ?? ''))
	);

	const defs = updatedDefs.length > 0 ? updatedDefs : allDefs;

	console.log(`Found ${defs.length} definition(s) for node at position`);

	return defs.map(def => {
		return {
			uri: "file://" + def.fullpath,
			range: AnvilLspUtils.anvilSpanToLspRange(def.span)
		}
	});
});

// References
connection.onReferences(async (params) => {
	const document = documents.get(params.textDocument.uri);
	if (document === undefined) return null;

	const settings = await documentSettings.get(document.uri);

	const anvilDocument = documentAnvilManagers.get(document.uri);
	if (!anvilDocument) return null;

	if (!anvilDocument.anvilAst) {
		await anvilDocument.compile(settings);
	}

	if (!anvilDocument.anvilAst) {
		console.log(`AST not yet available for document ${document.uri}`);
		return null;
	}

	const position = params.position;
	const node = anvilDocument.getClosestAnvilNodeToLspPosition(position);

	if (!node) {
		console.log(`No reference result found`);
		return null;
	}

	const loc = node.location;
	if (!loc) {
		console.log(`Node unexpectedly does not have a valid location`);
		return null;
	}

	const refs = anvilDocument.anvilAst?.referencesTo(loc);
	if (!refs || refs.length === 0) {
		console.log(`No references found for node at position`);
		return null;
	}

	console.log(`Found ${refs.length} reference(s) for node at position`);

	return refs.map(ref => {
		return {
			uri: "file://" + ref.fullpath,
			range: AnvilLspUtils.anvilSpanToLspRange(ref.span)
		}
	});
});


// Completions
connection.onCompletion((params): CompletionItem[] => {

	const anvilDocument = documentAnvilManagers.get(params.textDocument.uri);
	if (!anvilDocument) {
		console.log(`Completion request received for document ${params.textDocument.uri}, but AnvilDocument is not available.`);
		return [];
	}

	const completionDetails = AnvilCompletionGenerator.getCompletions(params.position, anvilDocument);

	console.log(`Found ${completionDetails.length} completion(s) for the current context.`);

	return completionDetails.map(c => c.lspCompletionItem());
});

connection.onCompletionResolve(async (item: CompletionItem) => {
	const data = item.data;
	if (data instanceof AnvilCompletionDetail) {
		item.documentation = {
			kind: 'markdown',
			value: await data.details()
		};
	}
	return item;
});


// Inlay Hints
connection.languages.inlayHint.on(async (params) => {
	const uri = params.textDocument.uri;
	const settings = await documentSettings.get(uri);

	if (!(settings.inlayHints?.timingInfo)) {
		return [];
	}

	const anvilDocument = documentAnvilManagers.get(uri);
	if (!anvilDocument) return [];

	if (!anvilDocument.anvilAst) {
		await anvilDocument.compile(settings);
	}

	if (!anvilDocument.anvilAst) {
		console.log(`AST not yet available for document ${uri}`);
		return [];
	}

	const lineCount = anvilDocument.textDocument.lineCount;

	const locs = anvilDocument.anvilAst.getAll(anvilDocument.filepath);

	let inlineInject: {[lineno: number]: string} = [];
	let maxTextLen = 0;

	for (let loc of locs) {
		const node = anvilDocument.anvilAst?.goTo(loc);
		if (!node) continue;
		const event = node.event;
		if (!event) continue;

		const lspPos = AnvilLspUtils.anvilLocToLspLoc(loc.span.start);
		inlineInject[lspPos.line] = event;
		maxTextLen = Math.max(maxTextLen, event.length);
	}

	maxTextLen = Math.pow(2, Math.ceil(Math.log2(maxTextLen)));

	console.log(`Found ${Object.keys(inlineInject)} inlay hints for document ${uri}`);

	const inlineRanges: [number, string][] = [];
	for (let line = 0; line < lineCount; line++) {
		if (inlineInject[line]) {
			const text = inlineInject[line];
			if (text.length < maxTextLen) {
				// pad with spaces to ensure inlay hints are aligned
				inlineRanges.push([line, ' '.repeat(maxTextLen - text.length) + text]);
			} else {
				inlineRanges.push([line, text]);
			}
		} else {
			inlineRanges.push([line, ' '.repeat(maxTextLen)]);
		}
	}

	return inlineRanges.map(([position, text]) => {
		return {
			position: { line: position, character: 0 },
			label: text,
			kind: InlayHintKind.Type
		};
	});
});

//
// BEGIN
//

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
