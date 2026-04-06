/**
 * Integration tests for AnvilSignatureHelpGenerator.getSignatureHelp method.
 *
 * Compiles samples/lsp_test.anvil and tests signature help for different contexts:
 * - spawn expressions with proc parameters
 * - call expressions with function parameters
 * - send expressions with message parameters
 * - record initialization with field parameters
 */

import assert from 'node:assert';
import * as path from 'path';
import { describe, it, before } from 'mocha';
import { Position, SignatureHelp } from 'vscode-languageserver';

import { AnvilDocument } from '../../src/core/AnvilDocument';
import { AnvilSignatureHelpGenerator } from '../../src/generators/AnvilSignatureHelpGenerator';
import { AnvilAstNode } from '../../src/core/ast/AnvilAst';
import { AnvilServerSettings } from '../../src/utils/AnvilServerSettings';

const projectRoot = path.resolve(__dirname, '../../..');
const anvilBinaryPath = path.join(projectRoot, 'bin', 'anvil');
const sampleFile = 'samples/lsp_test.anvil';

describe('AnvilSignatureHelpGenerator', function () {
  let doc: AnvilDocument;
  let fullPath: string;

  const getSupplementaryDoc = (_node: AnvilAstNode): AnvilDocument | null => {
    return null;
  };

  before(async function () {
    this.timeout(15_000);

    fullPath = path.join(projectRoot, sampleFile);
    doc = AnvilDocument.fromFilesystem(fullPath)!;
    assert.ok(doc, 'AnvilDocument must be loaded from the filesystem');

    const settings = {
      projectRoot,
      executablePath: anvilBinaryPath,
    } satisfies AnvilServerSettings;
    const compiled = await doc.compile(settings);

    assert.ok(compiled, 'lsp_test.anvil must compile successfully');
    assert.ok(doc.anvilAst, 'AST must be present after compilation');
  });

  describe('spawn signature help', function () {
    describe('hovering over spawn Worker(', function () {
      const AFTER_OPEN_PAREN = Position.create(125, 18); // spawn Worker(|
      let help: SignatureHelp | null;

      before(function () {
        help = AnvilSignatureHelpGenerator.getSignatureHelp(
          AFTER_OPEN_PAREN,
          doc,
          getSupplementaryDoc,
        );
      });

      it('should return signature help for spawn', function () {
        assert.ok(help, 'should return signature help');
      });

      it('should have exactly one signature', function () {
        if (!help) this.skip();
        assert.strictEqual(
          help!.signatures.length,
          1,
          'should have exactly one signature',
        );
      });

      it('should set activeSignature to 0', function () {
        if (!help) this.skip();
        assert.strictEqual(
          help!.activeSignature,
          0,
          'activeSignature should be 0',
        );
      });

      it('should set activeParameter to 0', function () {
        if (!help) this.skip();
        assert.strictEqual(
          help!.activeParameter,
          0,
          'activeParameter should be 0 for first parameter',
        );
      });

      it('should include proc name in signature label', function () {
        if (!help) this.skip();
        const label = help!.signatures[0].label;
        assert.match(
          label,
          /Worker/,
          'signature label should include proc name "Worker"',
        );
      });

      it('should include endpoint parameter in signature', function () {
        if (!help) this.skip();
        const sig = help!.signatures[0];
        assert.ok(
          sig.parameters && sig.parameters.length > 0,
          'should have parameters',
        );
        const paramLabels = sig.parameters.map((p) =>
          typeof p.label === 'string' ? p.label : '',
        );
        assert.ok(
          paramLabels.some((l) => l.includes('endp')),
          'should include endpoint parameter "endp"',
        );
      });

      it('should include documentation', function () {
        if (!help) this.skip();
        const sig = help!.signatures[0];
        assert.ok(sig.documentation, 'should include documentation');
        assert.strictEqual(
          typeof sig.documentation,
          'object',
          'documentation should be MarkupContent',
        );
      });

      it('should format documentation as markdown', function () {
        if (!help) this.skip();
        const sig = help!.signatures[0];
        assert.ok(
          sig.documentation &&
            typeof sig.documentation === 'object' &&
            'kind' in sig.documentation,
          'should have documentation object with kind property',
        );
        assert.strictEqual(
          sig.documentation.kind,
          'markdown',
          'documentation should be markdown',
        );
      });
    });
  });

  describe('call signature help', function () {
    describe('hovering over call add8(', function () {
      const AFTER_OPEN_PAREN = Position.create(93, 22); // call add8(|
      let help: SignatureHelp | null;

      before(function () {
        help = AnvilSignatureHelpGenerator.getSignatureHelp(
          AFTER_OPEN_PAREN,
          doc,
          getSupplementaryDoc,
        );
      });

      it('should return signature help for call', function () {
        assert.ok(help, 'should return signature help');
      });

      it('should have exactly one signature', function () {
        if (!help) this.skip();
        assert.strictEqual(
          help!.signatures.length,
          1,
          'should have exactly one signature',
        );
      });

      it('should set activeParameter to 0 initially', function () {
        if (!help) this.skip();
        assert.strictEqual(
          help!.activeParameter,
          0,
          'activeParameter should be 0 for first parameter',
        );
      });

      it('should include function name in signature label', function () {
        if (!help) this.skip();
        const label = help!.signatures[0].label;
        assert.match(
          label,
          /add8/,
          'signature label should include function name "add8"',
        );
      });

      it('should include function parameters in signature', function () {
        if (!help) this.skip();
        const sig = help!.signatures[0];
        assert.ok(
          sig.parameters && sig.parameters.length === 2,
          'should have 2 parameters',
        );
        const paramLabels = sig.parameters.map((p) =>
          typeof p.label === 'string' ? p.label : '',
        );
        assert.ok(
          paramLabels.some((l) => l.includes('a')),
          'should include parameter "a"',
        );
        assert.ok(
          paramLabels.some((l) => l.includes('b')),
          'should include parameter "b"',
        );
      });

      it('should include documentation', function () {
        if (!help) this.skip();
        const sig = help!.signatures[0];
        assert.ok(sig.documentation, 'should include documentation');
      });
    });

    describe('hovering over call sub8(', function () {
      const AFTER_OPEN_PAREN = Position.create(95, 22); // call sub8(|

      it('should return signature help for sub8', function () {
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          AFTER_OPEN_PAREN,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'should return signature help');
      });

      it('should include function name in signature label', function () {
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          AFTER_OPEN_PAREN,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        const label = help.signatures[0].label;
        assert.match(
          label,
          /sub8/,
          'signature label should include function name "sub8"',
        );
      });
    });

    describe('active parameter tracking', function () {
      it('should track first parameter', function () {
        const FIRST_PARAM = Position.create(93, 22); // call add8(|
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          FIRST_PARAM,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        assert.strictEqual(
          help.activeParameter,
          0,
          'activeParameter should be 0',
        );
      });

      it('should track second parameter after comma', function () {
        const SECOND_PARAM = Position.create(93, 31); // call add8(pkt.lhs, |
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          SECOND_PARAM,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        assert.strictEqual(
          help.activeParameter,
          1,
          'activeParameter should be 1 after first comma',
        );
      });

      it('should end signature help after closing paren', function () {
        const AFTER_ARGS = Position.create(93, 40); // call add8(pkt.lhs, pkt.rhs)|
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          AFTER_ARGS,
          doc,
          getSupplementaryDoc,
        );
        assert.strictEqual(
          help,
          null,
          'should return null after closing paren (expected behavior)',
        );
      });
    });
  });

  describe('send signature help', function () {
    describe('hovering over send endp.resp(', function () {
      const AFTER_OPEN_PAREN = Position.create(100, 24); // send endp.resp(|
      let help: SignatureHelp | null;

      before(function () {
        help = AnvilSignatureHelpGenerator.getSignatureHelp(
          AFTER_OPEN_PAREN,
          doc,
          getSupplementaryDoc,
        );
      });

      it('should return signature help for send', function () {
        assert.ok(help, 'should return signature help');
      });

      it('should have exactly one signature', function () {
        if (!help) this.skip();
        assert.strictEqual(
          help!.signatures.length,
          1,
          'should have exactly one signature',
        );
      });

      it('should set activeParameter to 0', function () {
        if (!help) this.skip();
        assert.strictEqual(
          help!.activeParameter,
          0,
          'activeParameter should be 0 for send (single value)',
        );
      });

      it('should include endpoint and message names in label', function () {
        if (!help) this.skip();
        const label = help!.signatures[0].label;
        assert.match(
          label,
          /endp/,
          'signature label should include endpoint name "endp"',
        );
        assert.match(
          label,
          /resp/,
          'signature label should include message name "resp"',
        );
      });

      it('should have single parameter for value', function () {
        if (!help) this.skip();
        const sig = help!.signatures[0];
        assert.ok(
          sig.parameters && sig.parameters.length === 1,
          'should have exactly 1 parameter',
        );
        const paramLabel =
          typeof sig.parameters[0].label === 'string'
            ? sig.parameters[0].label
            : '';
        assert.match(
          paramLabel,
          /value/,
          'parameter should be labeled "value"',
        );
      });

      it('should include documentation', function () {
        if (!help) this.skip();
        const sig = help!.signatures[0];
        assert.ok(sig.documentation, 'should include documentation');
      });
    });
  });

  describe('record init signature help', function () {
    describe('hovering over Packet::{', function () {
      // lsp_test.anvil doesn't have a Packet::{...} construction in the file

      it('should return signature help for record initialization', function () {
        this.skip();
      });

      it('should hint all record fields as parameters', function () {
        this.skip();
      });

      it('should show multiple fields', function () {
        this.skip();
      });
    });
  });

  describe('edge cases', function () {
    describe('position outside signature context', function () {
      it('should return null for position with no signature trigger', function () {
        const NO_CONTEXT = Position.create(10, 5); // In a comment
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          NO_CONTEXT,
          doc,
          getSupplementaryDoc,
        );
        assert.strictEqual(
          help,
          null,
          'should return null for non-signature context',
        );
      });

      it('should return null for position before opening delimiter', function () {
        const BEFORE_PAREN = Position.create(125, 16); // spawn Worker|
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          BEFORE_PAREN,
          doc,
          getSupplementaryDoc,
        );
        assert.strictEqual(
          help,
          null,
          'should return null before opening paren',
        );
      });

      it('should end signature help after closing delimiter', function () {
        const AFTER_CLOSE = Position.create(125, 22); // spawn Worker(le);|
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          AFTER_CLOSE,
          doc,
          getSupplementaryDoc,
        );
        assert.strictEqual(
          help,
          null,
          'should return null after closing paren',
        );
      });
    });

    describe('undefined or invalid identifiers', function () {
      // lsp_test.anvil does not have invalid identifiers to test against

      it('should return null for non-existent proc name', function () {
        this.skip();
      });

      it('should return null for non-existent function name', function () {
        this.skip();
      });

      it('should return null for non-existent endpoint or message', function () {
        this.skip();
      });

      it('should return null for non-existent record type', function () {
        this.skip();
      });
    });

    describe('boundary conditions', function () {
      it('should handle position at start of file', function () {
        const START = Position.create(0, 0);
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          START,
          doc,
          getSupplementaryDoc,
        );
        assert.strictEqual(help, null, 'should return null at start of file');
      });

      it('should handle position at end of file', function () {
        const END = Position.create(200, 0);
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          END,
          doc,
          getSupplementaryDoc,
        );
        assert.strictEqual(
          help,
          null,
          'should return null at end of file (no signature context)',
        );
      });
    });
  });

  describe('documentation generation', function () {
    describe('signature documentation', function () {
      it('should include markdown documentation for proc', function () {
        const SPAWN_POS = Position.create(125, 18); // spawn Worker(|
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          SPAWN_POS,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        const sig = help.signatures[0];
        assert.ok(sig.documentation, 'should have documentation');
        assert.ok(
          sig.documentation &&
            typeof sig.documentation === 'object' &&
            'value' in sig.documentation,
          'should have documentation object with value property',
        );
        const docValue = sig.documentation.value;
        assert.ok(docValue.length > 0, 'documentation should not be empty');
        assert.match(
          docValue,
          /\S/,
          'documentation should have non-whitespace content',
        );
        assert.match(
          docValue,
          /Worker|proc/i,
          'documentation should reference Worker or proc',
        );
      });

      it('should include markdown documentation for function', function () {
        const CALL_POS = Position.create(93, 22); // call add8(|
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          CALL_POS,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        const sig = help.signatures[0];
        assert.ok(sig.documentation, 'should have documentation');
        assert.ok(
          sig.documentation &&
            typeof sig.documentation === 'object' &&
            'value' in sig.documentation,
          'should have documentation object with value property',
        );
        const docValue = sig.documentation.value;
        assert.ok(docValue.length > 0, 'documentation should not be empty');
        assert.match(
          docValue,
          /\S/,
          'documentation should have non-whitespace content',
        );
        assert.match(
          docValue,
          /add8|func/i,
          'documentation should reference add8 or func',
        );
      });

      it('should include markdown documentation for message', function () {
        const SEND_POS = Position.create(100, 24); // send endp.resp(|
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          SEND_POS,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        const sig = help.signatures[0];
        assert.ok(sig.documentation, 'should have documentation');
        assert.ok(
          sig.documentation &&
            typeof sig.documentation === 'object' &&
            'value' in sig.documentation,
          'should have documentation object with value property',
        );
        const docValue = sig.documentation.value;
        assert.ok(docValue.length > 0, 'documentation should not be empty');
      });
    });

    describe('documentation format', function () {
      it('should use markdown markup content', function () {
        const CALL_POS = Position.create(93, 22);
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          CALL_POS,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        const sig = help.signatures[0];
        assert.ok(
          sig.documentation &&
            typeof sig.documentation === 'object' &&
            'kind' in sig.documentation,
          'should have documentation object with kind property',
        );
        assert.strictEqual(
          sig.documentation.kind,
          'markdown',
          'should use markdown kind',
        );
      });

      it('should include code blocks in documentation', function () {
        const CALL_POS = Position.create(93, 22);
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          CALL_POS,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        const sig = help.signatures[0];
        assert.ok(
          sig.documentation &&
            typeof sig.documentation === 'object' &&
            'value' in sig.documentation,
          'should have documentation object with value property',
        );
        const docValue = sig.documentation.value;
        assert.match(
          docValue,
          /```/,
          'documentation should include code blocks',
        );
      });
    });
  });

  describe('parameter information', function () {
    describe('parameter labels', function () {
      it('should provide parameter labels for proc endpoints', function () {
        const SPAWN_POS = Position.create(125, 18); // spawn Worker(|
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          SPAWN_POS,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        const sig = help.signatures[0];
        assert.ok(
          sig.parameters && sig.parameters.length > 0,
          'should have parameters',
        );
        sig.parameters.forEach((param) => {
          assert.ok(param.label, 'each parameter should have a label');
          assert.ok(
            typeof param.label === 'string',
            'parameter label should be string',
          );
        });
      });

      it('should provide parameter labels for function args', function () {
        const CALL_POS = Position.create(93, 22); // call add8(|
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          CALL_POS,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        const sig = help.signatures[0];
        assert.ok(
          sig.parameters && sig.parameters.length === 2,
          'should have 2 parameters',
        );
        sig.parameters.forEach((param) => {
          assert.ok(param.label, 'each parameter should have a label');
          assert.ok(
            typeof param.label === 'string',
            'parameter label should be string',
          );
        });
      });
    });

    describe('parameter count', function () {
      it('should have correct parameter count for Worker (1 endpoint)', function () {
        const SPAWN_POS = Position.create(125, 18);
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          SPAWN_POS,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        const sig = help.signatures[0];
        assert.strictEqual(
          sig.parameters?.length,
          1,
          'Worker should have 1 endpoint parameter',
        );
      });

      it('should have correct parameter count for add8 (2 args)', function () {
        const CALL_POS = Position.create(93, 22);
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          CALL_POS,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        const sig = help.signatures[0];
        assert.strictEqual(
          sig.parameters?.length,
          2,
          'add8 should have 2 parameters',
        );
      });

      it('should have correct parameter count for send (1 value)', function () {
        const SEND_POS = Position.create(100, 24);
        const help = AnvilSignatureHelpGenerator.getSignatureHelp(
          SEND_POS,
          doc,
          getSupplementaryDoc,
        );
        assert.ok(help, 'signature help should not be null');
        const sig = help.signatures[0];
        assert.strictEqual(
          sig.parameters?.length,
          1,
          'send should have 1 value parameter',
        );
      });
    });
  });
});
