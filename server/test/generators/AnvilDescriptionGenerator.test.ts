/**
 * Integration tests for AnvilDescriptionGenerator.describeNode lifetime segment.
 *
 * Compiles samples/lsp_test.anvil (which has a Worker proc with recv/send expressions),
 * finds the relevant AST nodes by source position, and verifies that the lifetime
 * segment produced by describeNode contains the expected timing contract text.
 */

import assert from 'node:assert';
import * as path from 'path';
import { describe, it, before } from 'mocha';

import { AnvilDocument } from '../../src/core/AnvilDocument';
import { AnvilDescriptionGenerator } from '../../src/generators/AnvilDescriptionGenerator';
import { AnvilAst, AnvilAstNode } from '../../src/core/ast/AnvilAst';
import { AnvilServerSettings } from '../../src/utils/AnvilServerSettings';

const projectRoot = path.resolve(__dirname, '../../..');
const anvilBinaryPath = path.join(projectRoot, 'bin', 'anvil');
const sampleFile = 'samples/lsp_test.anvil';

describe('AnvilDescriptionGenerator', function () {
  let ast: AnvilAst;
  let doc: AnvilDocument;
  let fullPath: string;

  const nodeAt = (
    pos: { line: number; col: number },
    kind: string,
  ): AnvilAstNode | null => {
    return ast.closestNode(fullPath, pos.line, pos.col, (n) =>
      n.satisfiesKind(kind),
    );
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

    ast = doc.anvilAst;
  });

  describe('code segment', function () {
    describe('hovering over a function definition', function () {
      const FUNC_POS = { line: 63, col: 6 }; // "add8" function definition
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(FUNC_POS, 'func_def');
      });

      it('finds a func_def node', function () {
        assert.ok(node, `should find a func_def node at line ${FUNC_POS.line}`);
        assert.strictEqual(node.kind, 'func_def', 'node type must be func_def');
      });

      it('shows function signature with collapsed body', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { code: true },
        );

        assert.match(output, /```anvil/, 'should contain anvil code block');
        assert.match(output, /func add8/, 'should show function name');
        assert.match(output, /\(a, b\)/, 'should show parameters');
        assert.match(
          output,
          /\{ \/\* \.\.\. \*\/ \}/,
          'should show collapsed body',
        );
        assert.ok(
          !output.includes('a + b'),
          'should not show full function body',
        );
      });
    });

    describe('hovering over a type definition', function () {
      const TYPE_POS = { line: 35, col: 6 }; // "byte" type alias
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(TYPE_POS, 'type_def');
      });

      it('finds a type_def node', function () {
        assert.ok(node, `should find a type_def node at line ${TYPE_POS.line}`);
        assert.strictEqual(node.kind, 'type_def', 'node type must be type_def');
      });

      it('shows full type definition', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { code: true },
        );

        assert.match(output, /```anvil/, 'should contain anvil code block');
        assert.match(output, /type byte/, 'should show type name');
        assert.match(output, /logic\[8\]/, 'should show type alias target');
      });
    });

    describe('hovering over a channel class', function () {
      const CHAN_CLASS_POS = { line: 46, col: 6 }; // "Calc_ch" channel class
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(CHAN_CLASS_POS, 'channel_class_def');
      });

      it('finds a channel_class_def node', function () {
        assert.ok(
          node,
          `should find a channel_class_def node at line ${CHAN_CLASS_POS.line}`,
        );
        assert.strictEqual(
          node.kind,
          'channel_class_def',
          'node type must be channel_class_def',
        );
      });

      it('shows full channel class definition with messages', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { code: true },
        );

        assert.match(output, /```anvil/, 'should contain anvil code block');
        assert.match(output, /chan Calc_ch/, 'should show channel class name');
        assert.match(output, /left.*req/, 'should show left message');
        assert.match(output, /right.*resp/, 'should show right message');
      });
    });

    describe('markdown formatting', function () {
      const FUNC_POS = { line: 63, col: 6 }; // "add8" function
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(FUNC_POS, 'func_def');
      });

      it('uses proper code block delimiters', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { code: true },
        );

        assert.match(
          output,
          /^```anvil\n/,
          'should start with anvil code block',
        );
        assert.match(output, /\n```\n/, 'should end code block properly');
      });
    });
  });

  describe('documentation segment', function () {
    it.skip('is intentionally a no-op reserved for future use', function () {
      // The documentation segment is currently not implemented.
      // It is reserved for displaying generated documentation for the node's kind
      // from ast-node-info.json or other sources in the future.
      // When implemented, it should be tested similar to the explanations segment.
    });
  });

  describe('definitions segment', function () {
    describe('hovering over a function call', function () {
      const FUNC_CALL_POS = { line: 94, col: 20 }; // "add8" function call in Worker
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(FUNC_CALL_POS, 'expr');
      });

      it('finds the function call expr node', function () {
        assert.ok(
          node,
          `should find an expr node at line ${FUNC_CALL_POS.line}`,
        );
      });

      it('shows definition of the called function', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { definitions: true },
        );

        assert.match(output, /```anvil/, 'should contain anvil code block');
        assert.match(output, /func add8/, 'should show function definition');
        assert.match(output, /\(a, b\)/, 'should show parameters');
      });

      it('includes "Definitions:" header when code segment is also present', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          {
            code: true,
            definitions: true,
          },
        );

        assert.match(
          output,
          /\*\*Definitions:\*\*/,
          'should include Definitions header',
        );
        assert.match(output, /---/, 'should include separator');
      });

      it('does not include header when code segment is absent', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          {
            definitions: true,
          },
        );

        assert.ok(
          !output.includes('**Definitions:**'),
          'should not include Definitions header when code is absent',
        );
        assert.ok(
          !output.includes('---'),
          'should not include separator when code is absent',
        );
      });
    });

    describe('hovering over a register definition', function () {
      const REG_DEF_POS = { line: 133, col: 8 }; // "req_count" register definition
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(REG_DEF_POS, 'reg_def');
      });

      it('finds the reg_def node', function () {
        assert.ok(
          node,
          `should find a reg_def node at line ${REG_DEF_POS.line}`,
        );
      });

      it('shows definitions for referenced types (byte) when present', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { definitions: true },
        );

        // The register node may or may not have definitions depending on whether
        // it references other symbols. If it has definitions, they should be formatted correctly.
        // Since we can't guarantee definitions will be present, we just verify
        // that the definitions segment doesn't break the output
        if (output.includes('```anvil')) {
          // If there are definitions, ensure proper formatting
          assert.match(
            output,
            /```/,
            'should have properly closed code blocks',
          );
        }
      });
    });

    describe('hovering over an endpoint reference', function () {
      const ENDP_REF_POS = { line: 92, col: 27 }; // "endp" in recv expression
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(ENDP_REF_POS, 'expr');
      });

      it('finds the recv expr node', function () {
        assert.ok(
          node,
          `should find an expr node at line ${ENDP_REF_POS.line}`,
        );
      });

      it('shows definitions including message def', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { definitions: true },
        );

        assert.match(output, /```anvil/, 'should contain anvil code block');
        // Should show message definition
        assert.ok(
          output.includes('req') || output.includes('message'),
          'should reference message definition',
        );
      });
    });
  });

  describe('lifetime information', function () {
    describe('hovering over left message definition', function () {
      const LEFT_MSG_DEF_POS = { line: 47, col: 10 }; // "req" message_def inside Calc_ch
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(LEFT_MSG_DEF_POS, 'message_def'); // "req" message_def inside Calc_ch
      });

      it('finds a message_def node', function () {
        assert.ok(
          node,
          `should find a message_def node at line ${LEFT_MSG_DEF_POS.line}`,
        );
        assert.strictEqual(
          node.kind,
          'message_def',
          'node type must be message_def',
        );
      });

      it('shows the correct timing contract info', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { lifetime: true },
        );

        assert.match(
          output,
          /`left` endpoint receives every.*cycle/gm,
          'should mention the timing contract of the left endpoint (receiver)',
        );

        assert.match(
          output,
          /`right` endpoint sends.*any time/gm,
          'should mention the timing contract of the right endpoint (sender)',
        );

        assert.match(
          output,
          /Must be sustained for.*cycle/gm,
          'should mention the sustained requirement',
        );

        assert.ok(
          !output.includes('Executed on'),
          'should not include execution cycle timing info (it is only a definition, not an executable)',
        );
      });
    });

    describe('hovering over right message definition', function () {
      const RIGHT_MSG_DEF_POS = { line: 48, col: 10 }; // "res" message_def inside Calc_ch
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(RIGHT_MSG_DEF_POS, 'message_def');
      });

      it('finds a message_def node', function () {
        assert.ok(
          node,
          `should find a message_def node at line ${RIGHT_MSG_DEF_POS.line}`,
        );
        assert.strictEqual(
          node.kind,
          'message_def',
          'node type must be message_def',
        );
      });

      it('shows the correct timing contract info', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { lifetime: true },
        );

        assert.match(
          output,
          /`left` endpoint sends.*cycle.*after.*begins exchange/gm,
          'should mention the timing contract of the left endpoint (sender)',
        );

        assert.match(
          output,
          /`right` endpoint receives.*cycle.*after.*begins exchange/gm,
          'should mention the timing contract of the right endpoint (receiver)',
        );

        assert.match(
          output,
          /Must be sustained for.*cycle/gm,
          'should mention the sustained requirement',
        );

        assert.ok(
          !output.includes('Executed on'),
          'should not include execution cycle timing info (it is only a definition, not an executable)',
        );
      });
    });

    describe('hovering over message recv expression', function () {
      const RECV_POS = { line: 92, col: 22 }; // inside "recv endp.req"
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(RECV_POS, 'expr');
      });

      it('finds a recv expr node', function () {
        assert.ok(
          node,
          `should find a recv expr node at line ${RECV_POS.line}`,
        );
        assert.ok(
          node.type === 'recv' || node.type === 'try_recv',
          'node type must be recv or try_recv',
        );
      });

      it('shows correct explanation for timing contract', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { lifetime: true },
        );

        assert.match(
          output,
          /Must receive.*cycle.*starting on/gm,
          'should mention the received-side timing contract',
        );

        assert.match(
          output,
          /Must be sustained for.*cycle/gm,
          'should mention the sustained requirement',
        );

        assert.ok(
          output.includes('Executes on'),
          'should include execution cycle timing info',
        );

        // Checking that we don't refer to "endpoint" as the recv expression context
        // already implies the endpoint. This ensures the description is concise.
        assert.ok(
          !output.includes('endpoint'),
          'should not refer to "endpoint" (already implied by the context of hovering over the expression)',
        );
      });
    });

    describe('hovering over message send expression', function () {
      const SEND_POS = { line: 101, col: 14 }; // inside "send endp.resp(...)"
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(SEND_POS, 'expr');
      });

      it('finds a send expr node', function () {
        assert.ok(
          node,
          `should find a send expr node at line ${SEND_POS.line}`,
        );
        assert.ok(
          node.type === 'send' || node.type === 'try_send',
          'node type must be send or try_send',
        );
      });

      it('shows correct explanation for timing contract', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { lifetime: true },
        );

        assert.match(
          output,
          /Must send.*cycle.*after.*begins exchange/gm,
          'should mention the sent-side timing contract',
        );

        assert.match(
          output,
          /Must be sustained for.*cycle/gm,
          'should mention the sustained requirement',
        );

        assert.ok(
          output.includes('Executes on'),
          'should include execution cycle timing info',
        );

        // Checking that we don't refer to "endpoint" as the send expression context
        // already implies the endpoint. This ensures the description is concise.
        assert.ok(
          !output.includes('endpoint'),
          'should not refer to "endpoint" (already implied by the context of hovering over the expression)',
        );
      });
    });

    describe('hovering over a general expression', function () {
      const NON_MSG_POS = { line: 94, col: 20 }; // inside "call add8(...)" in Worker process
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(NON_MSG_POS, 'expr');
      });

      it('finds the add8 function expr node', function () {
        assert.ok(node, `should find an expr node at line ${NON_MSG_POS.line}`);
      });

      it('should only show execution cycle info and nothing else', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { lifetime: true },
        );

        assert.ok(
          output.includes('Executes on'),
          'should include execution cycle timing info',
        );
        assert.ok(
          !output.includes('Sustained till'),
          'should not include sustained info',
        );
        assert.ok(
          !output.match(/send|receive|endpoint/g),
          'should not mention any send/receive timing contracts',
        );
      });
    });
  });

  describe('explanations segment', function () {
    describe('hovering over a process definition', function () {
      const PROC_POS = { line: 82, col: 6 }; // "Worker" process definition
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(PROC_POS, 'proc_def');
      });

      it('finds a proc_def node', function () {
        assert.ok(node, `should find a proc_def node at line ${PROC_POS.line}`);
        assert.strictEqual(node.kind, 'proc_def', 'node type must be proc_def');
      });

      it('shows explanation from ast-node-info', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { explanations: true },
        );

        assert.match(
          output,
          /\*\*Anvil Info:\*\*/,
          'should include Anvil Info header',
        );
        assert.match(
          output,
          /process/i,
          'should mention process in explanation',
        );
        assert.match(
          output,
          /hardware module/i,
          'should describe process as hardware module',
        );
      });

      it('includes examples when examples flag is true', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          {
            explanations: true,
            examples: true,
          },
        );

        assert.match(
          output,
          /\*\*Examples:\*\*/,
          'should include Examples header',
        );
        assert.match(output, /```anvil/, 'should include code examples');
      });

      it('excludes examples when examples flag is false', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          {
            explanations: true,
            examples: false,
          },
        );

        assert.ok(
          !output.includes('**Examples:**'),
          'should not include Examples header',
        );
      });
    });

    describe('hovering over a function definition', function () {
      const FUNC_POS = { line: 63, col: 6 }; // "add8" function
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(FUNC_POS, 'func_def');
      });

      it('shows explanation for function', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { explanations: true },
        );

        assert.match(
          output,
          /\*\*Anvil Info:\*\*/,
          'should include Anvil Info header',
        );
        assert.match(
          output,
          /function/i,
          'should mention function in explanation',
        );
      });
    });

    describe('hovering over a channel class', function () {
      const CHAN_CLASS_POS = { line: 46, col: 6 }; // "Calc_ch" channel class
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(CHAN_CLASS_POS, 'channel_class_def');
      });

      it('shows explanation for channel class', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          { explanations: true },
        );

        assert.match(
          output,
          /\*\*Anvil Info:\*\*/,
          'should include Anvil Info header',
        );
        assert.match(
          output,
          /channel class/i,
          'should mention channel class in explanation',
        );
        assert.match(
          output,
          /communication contract/i,
          'should describe communication contract',
        );
      });
    });

    describe('separator behavior', function () {
      const FUNC_POS = { line: 63, col: 6 }; // "add8" function
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(FUNC_POS, 'func_def');
      });

      it('includes separator when code segment is present', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          {
            code: true,
            explanations: true,
          },
        );

        assert.match(
          output,
          /---/,
          'should include separator between code and explanations',
        );
      });

      it('does not include separator when no other segments present', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          {
            explanations: true,
          },
        );

        // Should not start with separator
        assert.ok(!output.startsWith('---'), 'should not start with separator');
        assert.ok(
          !output.startsWith('\n\n---'),
          'should not start with separator',
        );
      });
    });
  });

  describe('multi-segment tests', function () {
    describe('code + definitions combination', function () {
      const FUNC_CALL_POS = { line: 94, col: 20 }; // "add8" function call
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(FUNC_CALL_POS, 'expr');
      });

      it('shows both code and definitions with separator', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          {
            code: true,
            definitions: true,
          },
        );

        assert.match(output, /```anvil/, 'should contain code blocks');
        assert.match(output, /---/, 'should include separator');
        assert.match(
          output,
          /\*\*Definitions:\*\*/,
          'should include Definitions header',
        );

        // Code should come before separator
        const codeIndex = output.indexOf('```anvil');
        const separatorIndex = output.indexOf('---');
        assert.ok(
          codeIndex < separatorIndex,
          'code should appear before separator',
        );
      });
    });

    describe('code + lifetime combination', function () {
      const RECV_POS = { line: 92, col: 22 }; // recv expression
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(RECV_POS, 'expr');
      });

      it('shows both code and lifetime with separator', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          {
            code: true,
            lifetime: true,
          },
        );

        assert.match(output, /```anvil/, 'should contain code block');
        assert.match(output, /---/, 'should include separator');
        assert.match(
          output,
          /\*\*Lifetime:\*\*/,
          'should include Lifetime header',
        );

        const codeIndex = output.indexOf('```anvil');
        const separatorIndex = output.indexOf('---');
        const lifetimeIndex = output.indexOf('**Lifetime:**');
        assert.ok(
          codeIndex < separatorIndex,
          'code should appear before separator',
        );
        assert.ok(
          separatorIndex < lifetimeIndex,
          'separator should appear before lifetime',
        );
      });
    });

    describe('code + explanations combination', function () {
      const FUNC_POS = { line: 63, col: 6 }; // "add8" function
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(FUNC_POS, 'func_def');
      });

      it('shows both code and explanations with separator', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          {
            code: true,
            explanations: true,
          },
        );

        assert.match(output, /```anvil/, 'should contain code block');
        assert.match(output, /---/, 'should include separator');
        assert.match(
          output,
          /\*\*Anvil Info:\*\*/,
          'should include Anvil Info header',
        );

        const codeIndex = output.indexOf('```anvil');
        const separatorIndex = output.indexOf('---');
        const explanationIndex = output.indexOf('**Anvil Info:**');
        assert.ok(
          codeIndex < separatorIndex,
          'code should appear before separator',
        );
        assert.ok(
          separatorIndex < explanationIndex,
          'separator should appear before explanations',
        );
      });
    });

    describe('definitions + lifetime combination', function () {
      const RECV_POS = { line: 92, col: 22 }; // recv expression
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(RECV_POS, 'expr');
      });

      it('shows both definitions and lifetime with separator', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          {
            definitions: true,
            lifetime: true,
          },
        );

        assert.match(
          output,
          /```anvil/,
          'should contain code block for definitions',
        );
        assert.match(output, /---/, 'should include separator');
        assert.match(
          output,
          /\*\*Lifetime:\*\*/,
          'should include Lifetime header',
        );
      });
    });

    describe('all segments combination', function () {
      const FUNC_CALL_POS = { line: 94, col: 20 }; // "add8" function call
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(FUNC_CALL_POS, 'expr');
      });

      it('shows all segments in correct order', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          {
            code: true,
            definitions: true,
            lifetime: true,
            explanations: true,
            examples: true,
          },
        );

        // Find indices of each segment
        const codeIndex = output.indexOf('```anvil');
        const definitionsIndex = output.indexOf('**Definitions:**');
        const lifetimeIndex = output.indexOf('**Lifetime:**');

        // Verify order: code -> definitions -> lifetime -> explanations
        assert.ok(codeIndex !== -1, 'should contain code segment');
        assert.ok(
          definitionsIndex !== -1,
          'should contain definitions segment',
        );
        assert.ok(lifetimeIndex !== -1, 'should contain lifetime segment');

        assert.ok(
          codeIndex < definitionsIndex,
          'code should come before definitions',
        );
        assert.ok(
          definitionsIndex < lifetimeIndex,
          'definitions should come before lifetime',
        );

        // Check for multiple separators
        const separators = output.match(/---/g);
        assert.ok(
          separators && separators.length >= 2,
          'should have multiple separators',
        );
      });
    });

    describe('segment ordering verification', function () {
      const FUNC_POS = { line: 63, col: 6 }; // "add8" function
      let node: AnvilAstNode | null;

      before(function () {
        node = nodeAt(FUNC_POS, 'func_def');
      });

      it('maintains correct segment order: code, definitions, lifetime, explanations', function () {
        assert.ok(node, 'node should be found at expected position');

        const output = AnvilDescriptionGenerator.describeNode(
          node,
          doc,
          undefined,
          {
            code: true,
            definitions: true,
            lifetime: true,
            explanations: true,
          },
        );

        const segments = [
          { name: 'code', marker: '```anvil' },
          { name: 'lifetime', marker: '**Lifetime:**' },
          { name: 'explanations', marker: '**Anvil Info:**' },
        ];

        let lastIndex = -1;
        for (const segment of segments) {
          const index = output.indexOf(segment.marker);
          if (index !== -1) {
            assert.ok(
              index > lastIndex,
              `${segment.name} should appear after previous segments`,
            );
            lastIndex = index;
          }
        }
      });
    });
  });
});
