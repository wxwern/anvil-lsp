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

import { AnvilAST, AnvilSpan } from './anvilAST';

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

// The example settings
interface AnvilServerSettings {
	maxNumberOfProblems: number;
	projectRoot?: string;
	executablePath?: string;
	debug?: boolean;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: AnvilServerSettings = { maxNumberOfProblems: 1000 };
let globalSettings: AnvilServerSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings = new Map<string, Thenable<AnvilServerSettings>>();

// Global compile lock to avoid concurrent compilations
let globalCompileLock: { [key: string]: Promise<AnvilCompilationResult> } = {};

// Global compile result cache to avoid re-processing the same result
let globalCompileResultCache: { [key: string]: AnvilCompilationResult } = {};

// Global pending compile flags to debounce multiple compile requests
let globalPendingCompile: { [key: string]: boolean } = {};

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = (
			(change.settings['anvil'] || globalSettings)
		);
	}
	// Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
	// We could optimize things here and re-fetch the setting first can compare it
	// to the existing setting, but this is out of scope for this example.
	connection.languages.diagnostics.refresh();
});

function getDocumentSettings(resource: string): Thenable<AnvilServerSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings).then(s => s || defaultSettings)
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'anvil'
		});
		documentSettings.set(resource, result);
	}
	return result.then(s => s || defaultSettings);
}

async function convertAnvilCompilerResultToDiagnostics(result: AnvilCompilationResult, textDocument: TextDocument): Promise<Diagnostic[]> {
	let problems = 0;
	const settings = await getDocumentSettings(textDocument.uri);

	const diagnostics: Diagnostic[] = [];
	if (!result || !result.errors) return diagnostics;

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
					character: Math.max(0, error.startCol - 1),
				},
				end: {
					line: Math.max(0, error.endLine - 1),
					character: Math.max(0, error.endCol - 1)
				}
			},
			message: error.message,
			source: 'anvil'
		};

		if (hasDiagnosticRelatedInformationCapability) {
			diagnostic.relatedInformation = [];

			const mainMessage = `Anvil Compiler ${errorTypeString[error.type] || 'Error'}`;

			if (error.supplementaryInfo) {
				for (let info of error.supplementaryInfo) {
					diagnostic.relatedInformation.push({
						location: {
							uri: textDocument.uri,
							range: {
								start: {
									line: Math.max(0, info.startLine - 1),
									character: Math.max(0, info.startCol - 1)
								},
								end: {
									line: Math.max(0, info.endLine - 1),
									character: Math.max(0, info.endCol - 1)
								}
							}
						},
						message: `${mainMessage} (${info.message})`
					});
				}

			} else {
				diagnostic.relatedInformation = [
					{
						location: {
							uri: textDocument.uri,
							range: Object.assign({}, diagnostic.range)
						},
						message: mainMessage
					}
				];
			}
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

		//delete globalCompileResultCache[textDocument.uri];

		while (!result || globalPendingCompile[textDocument.uri]) {
			delete globalPendingCompile[textDocument.uri];

			const settings = await getDocumentSettings(textDocument.uri);

			const compiler = new AnvilCompiler(settings.projectRoot, settings.executablePath);
			const filePath = textDocument.uri.replace('file://', '');
			const fileData = { [filePath]: textDocument.getText() };

			result = await compiler.compile(filePath, fileData);
		}

		const prevAst = globalCompileResultCache[textDocument.uri]?.ast;

		if (!result || !result.ast) {
			result.ast = prevAst;
		}

		globalCompileResultCache[textDocument.uri] = result;

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

function resolveTextInRange(document: TextDocument, span: AnvilSpan): string | undefined {
	let textInRange;
	if (span) {
		textInRange = document?.getText({
			start: { line: span.start.line - 1, character: span.start.col },
			end: { line: span.end.line - 1, character: span.end.col }
		});
	}
	const lines = textInRange?.split('\n') || [];

	if (lines.length == 1) {
		return lines[0];
	} else if (lines.length > 1) {
		return lines[0] + '...';
	}

	return undefined;
}

function resolveIdentifierAtPosition(document: TextDocument, position: { line: number, character: number }): string | undefined {
	const l = position.line;
	let c = position.character;

	let characters = [];
	while (c > 0 && (characters.length === 0 || characters[characters.length - 1]?.match(/[a-zA-Z0-9_]/))) {
		c--;
		characters.push(document.getText({
			start: { line: l, character: c },
			end: { line: l, character: c + 1 }
		}));
	}
	characters.reverse();

	c = position.character;
	while (characters[characters.length - 1]?.match(/[a-zA-Z0-9_]/)) {
		characters.push(document.getText({
			start: { line: l, character: c },
			end: { line: l, character: c + 1 }
		}));
		c++;
	}

	if (characters.length == 0) {
		return undefined;
	}

	return characters.filter(x => x).filter(x => x?.match(/[a-zA-Z0-9_]/)).join('');
}




connection.onHover(async _event => {
	console.log('Hover event received');

	const settings = await getDocumentSettings(_event.textDocument.uri);

	const uri = _event.textDocument.uri;
	const document = documents.get(uri);

	const ast = globalCompileResultCache[uri]?.ast;

	console.log(`AST available: ${!!ast}`);

	if (!document || !ast) {
		return null;
	}

	const position = _event.position;
	const offset = document.offsetAt(position);

	const path = uri.replace('file://', '');

	const navigation = ast.getNavigationToLocation(path, position.line + 1, position.character + 1);

	if (!navigation) {
		console.log(`No navigation found`);
		return null;
	}

	console.log(`Navigation found: ${navigation.length} path components`);
	console.log(navigation);

	// TODO: Show useful information
	const DEBUG = settings.debug;

	const navigationFlattened = navigation.join(' > ');
	const navigationInfo = ast.getInfoForNavigation(path, navigation)
	const navigationInfoStr = JSON.stringify(navigationInfo, null, 2);

	const span = navigationInfo?.span;

	const resolvedDefinitions = ast.navigateToDefinitionTree(path, navigation);
	const resolvedDefinitionsFlattened = resolvedDefinitions?.map(def => {
		const filename = def.filename.split('/').pop() || def.filename;

		const info = ast.getInfoForNavigation(def.filename, def.navigation);
		const span = info?.span;
		const spanStr = span ? `${filename}:${span.start.line}:${span.start.col}` : "";

		const trace = DEBUG ? "- `" + def.navigation.join(' > ') + "`" + (spanStr ? ` (${spanStr})` : '') : '';

		const textInRange = resolveTextInRange(documents.get('file://' + def.filename) || document, span);
		if (textInRange) {
			const wrap = (info?.kind == "expr" ? info.type : info?.kind);
			return "- (" + wrap + ")\n\n  - `" + textInRange + "`\n\n  " + trace;
		}

		return trace;
	});

	const wrap = (navigationInfo?.kind == "expr" ? navigationInfo.type : navigationInfo?.kind);
	return {
		contents: {
			kind: 'markdown',
			value:
				"`(" + wrap + ") " + resolveTextInRange(document, span) + "`\n\n"
				+ (DEBUG ? "**AST Path Resolution:** `" + navigationFlattened + "`" : "")
				+ (resolvedDefinitions ? "\n\n---\n\n**Definitions:**\n" + resolvedDefinitionsFlattened?.join('\n') : '')
				+ (DEBUG && navigationInfoStr ? "\n\n---\n\n**AST Node:**\n```\n" + navigationInfoStr + "\n```" : '')

		}
	};


});

connection.onDefinition(_event => {
	console.log('Definition event received');

	const uri = _event.textDocument.uri;
	const document = documents.get(uri);

	const ast = globalCompileResultCache[uri]?.ast;

	console.log(`AST available: ${!!ast}`);

	if (!document || !ast) {
		return null;
	}

	const position = _event.position;
	const offset = document.offsetAt(position);

	const path = uri.replace('file://', '');

	const navigation = ast.getNavigationToLocation(path, position.line + 1, position.character + 1);

	if (!navigation) {
		console.log(`No navigation found`);
		return null;
	}

	console.log(`Navigation found: ${navigation.length} path components`);
	console.log(navigation);

	const definitionTree = ast.navigateToDefinitionTree(path, navigation);

	if (!definitionTree || definitionTree.length == 0) {
		console.log(`No definition found`);
		return null;
	}

	console.log(`Definition found: ${definitionTree.length} possible locations`);
	console.log(definitionTree);

	const identifier = resolveIdentifierAtPosition(document, position);

	console.log(`Identifier under location: "${identifier}"`);

	return definitionTree.map(def => {
		const filename = def.filename;
		const info = ast.getInfoForNavigation(filename, def.navigation);
		const span = info?.span;

		const name = info?.name;
		const hasName = name && identifier && name === identifier;

		const id = info?.id;
		const ids = info?.id || info?.ids || [];
		const hasId = identifier && (id === identifier || ids.includes(identifier));

		const isUnknown = info?.name === undefined && info?.id === undefined && info?.ids === undefined;

		if (span && (hasName || hasId || isUnknown)) {
			return {
				uri: 'file://' + filename,
				range: {
					start: { line: span.start.line - 1, character: span.start.col },
					end: { line: span.end.line - 1, character: span.end.col }
				}
			};
		}

		return null;
	}).filter(loc => !!loc);
});

connection.onReferences(_event => {
	console.log('References event received');

	const uri = _event.textDocument.uri;
	const document = documents.get(uri);
	const ast = globalCompileResultCache[uri]?.ast;
	console.log(`AST available: ${!!ast}`);

	if (!document || !ast) {
		return null;
	}

	const position = _event.position;
	const offset = document.offsetAt(position);
	const path = uri.replace('file://', '');
	const navigation = ast.getNavigationToLocation(path, position.line + 1, position.character + 1);
	if (!navigation) {
		console.log(`No navigation found`);
		return null;
	}
	console.log(`Navigation found: ${navigation.length} path components`);
	console.log(navigation);
	const references = ast.findReferencesToNavigation(path, navigation);
	if (!references || references.length == 0) {
		console.log(`No references found`);
		return null;
	}

	console.log(`References found: ${references.length} locations`);
	return references.map(ref => {
		const filename = ref.filename;
		const info = ast.getInfoForNavigation(filename, ref.navigation);
		const span = info?.span;

		if (span) {
			return {
				uri: 'file://' + filename,
				range: {
					start: { line: span.start.line - 1, character: span.start.col },
					end: { line: span.end.line - 1, character: span.end.col }
				}
			};
		}

		return null;
	}).filter(loc => !!loc);
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {

		const textDocument = documents.get(_textDocumentPosition.textDocument.uri);
		if (!textDocument) {
			return [];
		}

		const filename = textDocument.uri.replace('file://', '');
		const ast = globalCompileResultCache[textDocument.uri]?.ast;

		// Resolve text before the cursor.
		const textBeforeCursor = textDocument.getText({
			start: { line: _textDocumentPosition.position.line, character: 0 },
			end: _textDocumentPosition.position
		});

		console.log(`Completion event received. Text before cursor: "${textBeforeCursor}"`);

		const astLine = _textDocumentPosition.position.line + 1;
		const astCol = _textDocumentPosition.position.character;

		let completionItems: CompletionItem[] = []
		let allowAnvilKeywords = true;

		//
		// HEURISTIC: Dot-notation completion
		//

		const dotTokenSetBeforeCursor = textBeforeCursor.match(/(^|^.+\s)(([a-zA-Z0-9_]+\.)+[a-zA-Z0-9_]*)$/);

		if (dotTokenSetBeforeCursor) {
			const nonApplicableLeadingStr = dotTokenSetBeforeCursor[1].trim();
			const components = dotTokenSetBeforeCursor[2].split('.');

			console.log(`Dot-notation completion triggered.`);
			console.log(`  Non-applicable leading string: "${nonApplicableLeadingStr}"`);
			console.log(`  Dot-separated components: ${components.join(' > ')}`);

			const trailingComponent = components.pop() || '';
			const leadingComponents = components;

			console.log(`  Leading components: ${leadingComponents.join(' > ')}`);
			console.log(`  Trailing component: "${trailingComponent}"`);

			// Attempt to resolve the leading components to a type
			// TODO: we only do 1 for now

			if (leadingComponents.length > 0) {

				// Attempt to resolve leading component
				const compDefNav = ast?.lookupDefinitionForIdentifier(filename, leadingComponents[0], astLine, astCol);
				if (!compDefNav || compDefNav.length == 0) {
					console.log(`  Could not resolve leading component ${leadingComponents[0]} to a type`);
					return [];
				}

				let compDefInfo = ast?.getInfoForNavigation(compDefNav[0].filename, compDefNav[0].navigation);
				if (!compDefInfo) {
					console.log(`  Could not get info for leading component ${leadingComponents[0]}`);
					return [];
				}

				// Check if it's an endpoint
				if (ast?.isEndpointNode(compDefInfo)) {
					console.log(`  Leading component ${leadingComponents[0]} is endpoint of type ${compDefInfo.name}`);

					const channelClassDefNav = compDefNav.find(def => def.navigation[0] === 'channel_classes');
					if (!channelClassDefNav) {
						// No channel class found
						return [];
					}

					const ccDefInfo = ast?.getInfoForNavigation(channelClassDefNav.filename, channelClassDefNav.navigation);
					if (!ccDefInfo || !ast?.isChannelClassNode(ccDefInfo)) {
						// Unexpectedly not a channel class
						return [];
					}

					let prefixedDir = nonApplicableLeadingStr.match(/\b(send|recv)\b$/)?.[1] || null;

					for (let msgI = 0; msgI < ccDefInfo.messages.length; msgI++) {
						const msg = ccDefInfo.messages[msgI];

						console.log(`  Channel class ${compDefInfo.name} has message ${msg.name}`);

						if (!msg.name.startsWith(trailingComponent)) {
							// Not a prefix match
							continue;
						}

						const dir = ((compDefInfo.dir === "left") !== (msg.dir === "in")) ? "send" : "recv";

						if (prefixedDir && prefixedDir !== dir) {
							// Not a direction match
							continue;
						}

						const nav = channelClassDefNav.navigation.concat(['messages', msgI]);

						completionItems.push({
							label: msg.name,
							kind: dir === "send" ? CompletionItemKind.Function : CompletionItemKind.Value,
							data: { filename: channelClassDefNav.filename, navigation: nav },
							detail: `${compDefInfo.name} (${dir})`,
						});
					}

					return completionItems;
				}
			}
		}

		//
		// HEURISTIC: register read with prefix *
		//
		if (textBeforeCursor.match(/(^|[\s\(\[{])\*[a-zA-Z0-9_]*$/)) {
			console.log(`Register read completion triggered.`);

			const identifierPrefix = textBeforeCursor.match(/\*([a-zA-Z0-9_]*)$/)?.[1] || '';
			console.log(`  Identifier prefix: "${identifierPrefix}"`);

			// Suggest all registers
			completionItems.push(
				...(ast?.getIdentifiers()
					.filter(id => id.startsWith(identifierPrefix))
					.map((id) => {

						// Obtain register definition
						const def = ast?.getIdentifierNavigation(id)?.[0];
						const info = def ? ast?.getInfoForNavigation(def.filename, def.navigation) : null;
						if (info?.kind !== 'reg_def') return null;

						// Return completion item
						return {
							label: id,
							kind: CompletionItemKind.Variable,
							data: id,
							detail: `(register)`
						};
					})
					.filter(item => item !== null)
				) || []
			);

			return completionItems;
		}


		completionItems.push(...(ast?.getIdentifiers().map((id) => {
			let kind: CompletionItemKind = CompletionItemKind.Text;
			let desc: string | undefined = undefined;

			const defNav = ast?.getIdentifierNavigation(id)?.[0];
			if (defNav) {
				const info = ast?.getInfoForNavigation(defNav.filename, defNav.navigation);
				switch (info?.kind) {
					case 'expr':
						kind = CompletionItemKind.Variable;
						break;

					case 'reg_def':
						kind = CompletionItemKind.Variable;
						desc = `(register)`;
						break;

					case 'channel_class_def':
						kind = CompletionItemKind.Class;
						desc = `(channel)`;
						break;

					case 'struct_def':
						kind = CompletionItemKind.Struct;
						desc = `(struct)`;
						break;

					case 'func_def':
						kind = CompletionItemKind.Function;
						desc = `(function)`;
						break;

					case 'proc_def':
						kind = CompletionItemKind.Module;
						desc = `(process)`;
						break;

					case 'macro_def':
						kind = CompletionItemKind.Constant;
						desc = `(macro)`;
						break;

					case 'endpoint_def':
						kind = CompletionItemKind.Interface;
						desc = `(endpoint)`;
						break;

					case 'message_def':
						kind = CompletionItemKind.Method;
						desc = `(message)`;
						break;
				}
			}

			return {
				label: id,
				kind: kind,
				data: defNav,
				detail: desc
			};
		}) ?? []));


		//
		// Anvil keywords
		//
		if (allowAnvilKeywords) {
			/*
			syn keyword anvilType logic int dyn
syn keyword anvilStorageModifier left right extern
syn keyword anvilOtherModifier shared assigned\ by import generate generate_seq

" Declaration keywords and names
syn keyword anvilDeclaration struct enum proc spawn type func const reg chan

syn keyword anvilControl call loop recursive if else try recurse recv send dprint dfinish set cycle sync match put ready in probe
syn keyword anvilOtherKeywords with let
			 */

			const populateKeywords = (labels: string[], desc: string, kind?: CompletionItemKind) => {
				completionItems.push(...labels.map((label) => {
					return {
						label: label,
						kind: kind || CompletionItemKind.Keyword,
						data: label,
						detail: desc
					};
				}));
			};

			populateKeywords([
				'left', 'right', 'extern',
				'shared', 'assigned by', 'import', 'generate', 'generate_seq',
			], '(modifier)');

			populateKeywords([
				'logic', 'int', 'dyn',
			], '(type)');

			populateKeywords([
				'struct', 'enum', 'proc', 'spawn', 'type', 'func', 'const', 'reg', 'chan',
			], '(declaration)');

			populateKeywords([
				'call', 'loop', 'recursive', 'if', 'else', 'try', 'recurse', 'recv', 'send',
				'dprint', 'dfinish', 'set', 'cycle', 'sync',  'match', 'put',  'ready', 'in',
				'probe',
			], '(control)');

			populateKeywords(['with'], '(other)');
			populateKeywords(['let'], '(other)');

			completionItems.push(...[
				['>>', 'wait', 'wait for evaluation of lhs before evaluating rhs'],
				[':=', 'assign', 'assign rhs value to lhs'],
				[';', 'join', 'evaluate lhs and rhs simulataneously'],
			].map(([text, kindStr, detail]) => {
				let kind: CompletionItemKind = CompletionItemKind.Operator;
				return {
					label: text,
					kind: kind,
					data: text,
					detail: '(' + kindStr + '): ' + detail,
				};
			}));
		}

		return completionItems;
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {

		if (item.data) {
			// Check if .filename and .navigation are present
			if ("filename" in item.data && "navigation" in item.data) {
				const filename = item.data.filename;
				const navigation = item.data.navigation;

				const defNav = { filename, navigation };
				const ast = globalCompileResultCache['file://' + filename]?.ast;
				const defInfo = ast?.getInfoForNavigation(filename, navigation);

				if (!defInfo || !defInfo.span) {
					return item;
				}

				const document = documents.get('file://' + filename);
				if (!document) {
					return item;
				}

				const span = defInfo.span;
				if (!span) {
					return item;
				}

				const textInRange = resolveTextInRange(document, span);
				if (textInRange) {
					item.documentation = {
						kind: 'markdown',
						value:
							"```anvil\n" + textInRange + "\n```\n\n"
					};
				}
			}
		}
		return item;
	}
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
