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
	CompletionItem,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TextDocumentConnection } from 'vscode-languageserver/lib/common/textDocuments';

import { AnvilLspUtils } from './utils/AnvilLspUtils';
import { AnvilServerSettings, DEFAULT_ANVIL_SERVER_SETTINGS, resolveShowSyntaxHelp, resolveTimingInfo } from './utils/AnvilServerSettings';
import { AnvilDocument } from './core/AnvilDocument';
import { LazyMap } from './utils/LazyMap';
import { AnvilDescriptionGenerator } from './generators/AnvilDescriptionGenerator';
import { AnvilCompletionGenerator} from './generators/AnvilCompletionGenerator';
import { AnvilSignatureHelpGenerator } from './generators/AnvilSignatureHelpGenerator';
import { AnvilInlayHintGenerator } from './generators/AnvilInlayHintGenerator';
import { AnvilAstNode, AnvilAstNodePath } from './core/ast/AnvilAst';
import { serverLogger } from './utils/logger';

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
			signatureHelpProvider: {
				triggerCharacters: AnvilSignatureHelpGenerator.TRIGGER_CHARS,
				retriggerCharacters: AnvilSignatureHelpGenerator.RETRIGGER_CHARS,
			},
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false
			},
			definitionProvider: true,
			typeDefinitionProvider: true,
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
			serverLogger.info('Workspace folder change event received.');
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
	const result = await connection.workspace.getConfiguration({
		scopeUri: resource,
		section: 'anvil'
	}) || DEFAULT_ANVIL_SERVER_SETTINGS;
	return result;
});

// Cache AnvilDocument instances for all open documents
const documentAnvilManagers = LazyMap.onCacheMiss<string, AnvilDocument | undefined>(resource => {
	const doc = documents.get(resource);
	return doc ? AnvilDocument.fromTextDocument(doc) : undefined;
});

const getAnvilDocumentForNode = (node: AnvilAstNode) => {
	const fullpath = node.absoluteSpan?.fullpath;
	if (!fullpath) return null;

	const doc =
		documentAnvilManagers.get('file://' + fullpath) ??
	    AnvilDocument.fromFilesystem(fullpath) ??
		null;

	return doc;
}






//
// LSP Basic File Events
//

const documentSubscribers = {
	onDidOpenTextDocument: connection.onDidOpenTextDocument,
	onDidChangeTextDocument: connection.onDidChangeTextDocument,
	onDidCloseTextDocument: connection.onDidCloseTextDocument,
    onWillSaveTextDocument: connection.onWillSaveTextDocument,
	onWillSaveTextDocumentWaitUntil: connection.onWillSaveTextDocumentWaitUntil,
	onDidSaveTextDocument: connection.onDidSaveTextDocument
} satisfies TextDocumentConnection;

// Monitor changes to files and configuration
connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	serverLogger.info('We received a miscellaneous file change event');

	// Observe if there's anvil files updated outside
	let hasChanges = false;
	for (let change of _change.changes) {
		const extensions = ['.anvil'];
		if (!extensions.some(ext => change.uri.endsWith(ext))) {
			return;
		}

		switch (change.type) {
			case FileChangeType.Created:
				serverLogger.info(`File created: ${change.uri}`);
				hasChanges = true;
				break;
			case FileChangeType.Changed:
				serverLogger.info(`File changed: ${change.uri}`);
				hasChanges = true;
				break;
			case FileChangeType.Deleted:
				serverLogger.info(`File deleted: ${change.uri}`);
				hasChanges = true;
				break;
		}
	}
	if (!hasChanges) {
		return;
	}
	connection.languages.diagnostics.refresh();
});

documentSubscribers.onDidOpenTextDocument = _e =>
	connection.onDidOpenTextDocument(e => {
		const document = e.textDocument;
		serverLogger.info(`Document opened: ${document.uri}`);
		documentAnvilManagers.get(document.uri); // preload AnvilDocument for the opened document

		_e(e);
	});

documentSubscribers.onDidChangeTextDocument = _e =>
	connection.onDidChangeTextDocument(e => {
		const anvilDocument = documentAnvilManagers.get(e.textDocument.uri);
		serverLogger.info(`Document ${e.textDocument.uri} changed with ${e.contentChanges.length} content changes.`);
		anvilDocument?.syncTextEdits(e.contentChanges);

		_e(e);
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

	const diagnostics =
		hasDiagnosticRelatedInformationCapability
			? await AnvilDescriptionGenerator.describeDiagnostics(anvilDocument, settings.maxNumberOfProblems)
			: [];

	serverLogger.info(`Diagnostics generated. ${diagnostics.length} problems. AST ${anvilDocument.anvilAst ? `available (${anvilDocument.isResultsUpToDate ? 'up-to-date' : 'outdated'}).` : 'not available.'}`);

	connection.languages.inlayHint.refresh();

	return {
		kind: DocumentDiagnosticReportKind.Full,
		items: diagnostics
	} satisfies DocumentDiagnosticReport;
});


// Hover
connection.onHover(async (params) => {
	serverLogger.info('Hover event received at position', params.position, 'in document', params.textDocument.uri);

	const document = documents.get(params.textDocument.uri);
	if (document === undefined) return null;

	const settings = await documentSettings.get(document.uri);
	const D = !!settings.debug;
	const showSyntaxHelp = resolveShowSyntaxHelp(settings.showSyntaxHelp);
	const showTimingInfo = resolveTimingInfo(settings.showTimingInfo);

	const anvilDocument = documentAnvilManagers.get(document.uri);
	if (!anvilDocument) return !D ? null : {
		contents: {
			kind: 'markdown',
			value: '**Error:** No information available (AnvilDocument not available)'
		}
	};


	if (!anvilDocument.anvilAst) {
		await anvilDocument.compile(settings);
	}

	if (!anvilDocument.anvilAst) {
		return !D ? null : {
			contents: {
				kind: 'markdown',
				value: '**Error:** No information available (AST information unavailable)'
			}
		};
	}

	const position = params.position;
	const node = anvilDocument.getClosestAnvilNodeToLspPosition(position);

	if (!node) {
		return !D ? null : {
			contents: {
				kind: 'markdown',
				value: '**Error:** No information available (cannot find AST node at position)'
			}
		};
	}

	return {
		contents: {
			kind: 'markdown',
			value: AnvilDescriptionGenerator.describeNode(node, anvilDocument, getAnvilDocumentForNode, {
				code: true,
				documentation: true,
				definitions: true,
				lifetime: showTimingInfo.onHover,
				explanations: showSyntaxHelp.onHover,
				examples: showSyntaxHelp.includeExamples,
				debug: D,
			})
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
		return null;
	}

	const position = params.position;

	const node = anvilDocument.getClosestAnvilNodeToLspPosition(position);
	const identifierUnderCursor = anvilDocument.getClosestIdentifierToLspPosition(position);

	if (!node) {
		return null;
	}

	let allDefs = node.definitions;
	if (!allDefs || allDefs.length === 0) {
		serverLogger.info(`No definitions found for node at position`);
		return null;
	}

	const updatedDefs = allDefs.filter(def =>
		!!(ast.node(def)?.names.includes(identifierUnderCursor ?? ''))
	);

	const defs = updatedDefs.length > 0 ? updatedDefs : allDefs;

	serverLogger.info(`Found ${defs.length} definition(s) for node at position`);

	return defs.map(def => {
		return {
			uri: "file://" + def.fullpath,
			range:
				documentAnvilManagers.get("file://" + def.fullpath)?.getLspRangeOfAnvilSpan(def.span) ??
				AnvilLspUtils.anvilSpanToLspRange(def.span)
		}
	});
});


// Type Definitions
connection.onTypeDefinition(async (params) => {
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
		return null;
	}

	const position = params.position;

	const node = anvilDocument.getClosestAnvilNodeToLspPosition(position);
	const identifierUnderCursor = anvilDocument.getClosestIdentifierToLspPosition(position);

	if (!node) {
		return null;
	}

	let allDefs = node.definitions;
	if (!allDefs || allDefs.length === 0) {
		serverLogger.info(`No type definitions found for node at position`);
		return null;
	}

	const typeDefs = allDefs.filter(def => {
		const n = ast.node(def);
		return n?.satisfiesKind('type_def') || n?.satisfiesKind('type_element_def');
	});

	const updatedDefs = typeDefs.filter(def =>
		!!(ast.node(def)?.names.includes(identifierUnderCursor ?? ''))
	);

	const defs = updatedDefs.length > 0 ? updatedDefs : allDefs;

	if (defs.length === 0) {
		serverLogger.info(`No type definitions found for node at position`);
		return null;
	}

	serverLogger.info(`Found ${defs.length} type definition(s) for node at position`);

	return defs.map(def => {
		return {
			uri: "file://" + def.fullpath,
			range:
				documentAnvilManagers.get("file://" + def.fullpath)?.getLspRangeOfAnvilSpan(def.span) ??
				AnvilLspUtils.anvilSpanToLspRange(def.span)
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
		return null;
	}

	const position = params.position;
	const node = anvilDocument.getClosestAnvilNodeToLspPosition(position);

	if (!node) {
		return null;
	}

	const loc = node.absoluteSpan;
	if (!loc) {
		return null;
	}

	const refs = anvilDocument.anvilAst?.referencesTo(loc);
	if (!refs || refs.length === 0) {
		serverLogger.info(`No references found for node at position`);
		return null;
	}

	serverLogger.info(`Found ${refs.length} reference(s) for node at position`);

	return refs.map(ref => {
		return {
			uri: "file://" + ref.fullpath,
			range:
				documentAnvilManagers.get("file://" + ref.fullpath)?.getLspRangeOfAnvilSpan(ref.span) ??
				AnvilLspUtils.anvilSpanToLspRange(ref.span)
		}
	});
});


// Completions
connection.onCompletion(async (params) => {

	const anvilDocument = documentAnvilManagers.get(params.textDocument.uri);
	if (!anvilDocument) {
		serverLogger.info(`Completion request received for document ${params.textDocument.uri}, but AnvilDocument is not available.`);
		return [];
	}

	const completionDetails = AnvilCompletionGenerator.getCompletions(params.position, anvilDocument);
	const settings = await documentSettings.get(params.textDocument.uri);

	serverLogger.info(`Found ${completionDetails.length} completion(s) for the current context.`);

	return completionDetails.map(c => c.lspCompletionItem({ allowOOOSnippet: settings.snippets?.fancy }));
});

connection.onCompletionResolve(async (item: CompletionItem) => {
	const filepath = item.data?.filepath;
	const nodepath = item.data?.nodepath;
	const plainDesc = item.data?.desc || '';
	const source: 'builtinKeyword' | 'astNode' | undefined = item.data?.source;

	// Fetch settings for the currently active document if possible; fall back to globals.
	// (CompletionResolve has no document URI, so we use the most-recently-resolved settings.)
	const resolvedSettings = globalSettings;
	const showSyntaxHelp = resolveShowSyntaxHelp(resolvedSettings.showSyntaxHelp);
	const showTimingInfo = resolveTimingInfo(resolvedSettings.showTimingInfo);

	// Whether to include the explanation (desc / explanations segment) for this item.
	const includeExplanation = (() => {
		switch (showSyntaxHelp.onAutocomplete) {
			case 'none':          return false;
			case 'anvilKeywords': return source === 'builtinKeyword';
			case 'all':           return true;
		}
	})();

	if (plainDesc && typeof plainDesc === 'string' && !filepath) {
		item.documentation = {
			kind: 'markdown',
			value: includeExplanation ? plainDesc : ''
		};
		return item;
	}
	if (filepath && typeof filepath === 'string' && Array.isArray(nodepath)) {
		const fileUri = 'file://' + filepath;
		const nodepathResolved = nodepath as AnvilAstNodePath;

		const doc = documentAnvilManagers.get(fileUri);
		if (doc) {
			const node = doc.anvilAst?.root(filepath)?.unsafeTraverse(...nodepathResolved);
			if (node) {
				const defDesc = AnvilDescriptionGenerator.describeNode(node, doc, getAnvilDocumentForNode, {
					code: true,
					documentation: true,
					definitions: true,
					lifetime: showTimingInfo.onAutocomplete,
					explanations: includeExplanation,
					examples: showSyntaxHelp.includeExamples,
				}) || '';

				let descs = [];
				if (plainDesc && includeExplanation) descs.push(plainDesc);
				if (defDesc) descs.push(defDesc);

				item.documentation = {
					kind: 'markdown',
					value: descs.join('\n\n---\n\n')
				};
				return item;
			}
		};
	}
	item.documentation = {
		kind: 'markdown',
		value: 'No additional information available'
	};
	return item;
});


// Signature Help
connection.onSignatureHelp(async (params) => {
	const anvilDocument = documentAnvilManagers.get(params.textDocument.uri);
	if (!anvilDocument) {
		serverLogger.info(`Signature help request received for document ${params.textDocument.uri}, but AnvilDocument is not available.`);
		return null;
	}

	if (!anvilDocument.anvilAst) {
		const settings = await documentSettings.get(params.textDocument.uri);
		await anvilDocument.compile(settings);
	}

	if (!anvilDocument.anvilAst) {
		serverLogger.info(`AST not yet available for signature help in document ${params.textDocument.uri}`);
		return null;
	}

	serverLogger.info(`Signature help requested at position ${params.position.line}:${params.position.character}`);

	const result = AnvilSignatureHelpGenerator.getSignatureHelp(
		params.position,
		anvilDocument,
		getAnvilDocumentForNode,
	);

	serverLogger.info(`Signature help result: ${result ? `${result.signatures.length} signature(s)` : 'null'}`);

	return result;
});


// Inlay Hints
connection.languages.inlayHint.on(async (params) => {
	const uri = params.textDocument.uri;
	const settings = await documentSettings.get(uri);

	const anvilDocument = documentAnvilManagers.get(uri);

	if (!anvilDocument) return [];

	if (!anvilDocument.anvilAst) {
		await anvilDocument.compile(settings);
	}

	const inlayHints = AnvilInlayHintGenerator.generateInlayHints(anvilDocument, settings);

	serverLogger.info(`Found ${inlayHints.length} inlay hint(s) for document ${uri}`);

	return inlayHints;
});


//
// BEGIN
//

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(documentSubscribers);

// Listen on the connection
connection.listen();
