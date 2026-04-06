/**
 * Integration tests for AnvilCompletionGenerator.getCompletions method.
 *
 * Compiles samples/lsp_test.anvil and tests various completion heuristics
 * by simulating cursor positions at specific locations in the source code.
 */

import assert from 'node:assert';
import * as path from 'path';
import { describe, it, before } from 'mocha';
import { Position } from 'vscode-languageserver';

import { AnvilDocument } from '../../src/core/AnvilDocument';
import {
  AnvilCompletionGenerator,
  AnvilCompletionDetail,
} from '../../src/generators/AnvilCompletionGenerator';
import { AnvilServerSettings } from '../../src/utils/AnvilServerSettings';

const projectRoot = path.resolve(__dirname, '../../..');
const anvilBinaryPath = path.join(projectRoot, 'bin', 'anvil');
const sampleFile = 'samples/lsp_test.anvil';

describe('AnvilCompletionGenerator', function () {
  let doc: AnvilDocument;
  let fullPath: string;

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

  describe('register read completions', function () {
    describe('position after "*" in expression', function () {
      const AFTER_ASTERISK_POS = Position.create(100, 26); // After "*" in "*result_reg"
      let completions: AnvilCompletionDetail[];

      before(function () {
        completions = AnvilCompletionGenerator.getCompletions(
          AFTER_ASTERISK_POS,
          doc,
        );
      });

      it('should return completions after "*"', function () {
        assert.ok(
          completions.length > 0,
          'should return at least one completion',
        );
      });

      it('should suggest register names', function () {
        const registerNames = completions.map((c) => c.label);
        assert.ok(
          registerNames.includes('result_reg'),
          'should include "result_reg"',
        );
      });

      it('should return plain identifiers without snippets', function () {
        const resultRegCompletion = completions.find(
          (c) => c.label === 'result_reg',
        );
        assert.ok(resultRegCompletion, 'should find result_reg completion');
        assert.strictEqual(
          resultRegCompletion.insertText,
          'result_reg',
          'insertText should be plain identifier',
        );
      });
    });

    describe('position after "*" in top proc', function () {
      const TOP_PROC_AFTER_ASTERISK = Position.create(158, 15); // After typing "cycle *"

      it('should suggest registers from current proc scope', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          TOP_PROC_AFTER_ASTERISK,
          doc,
        );
        const registerNames = completions.map((c) => c.label);

        // Should include registers from top proc
        assert.ok(
          registerNames.includes('req_count') ||
            registerNames.includes('last_result'),
          'should include registers from top proc scope',
        );
      });
    });
  });

  describe('register write completions', function () {
    describe('position after "set "', function () {
      const AFTER_SET_POS = Position.create(92, 12); // After "set "
      let completions: AnvilCompletionDetail[];

      before(function () {
        completions = AnvilCompletionGenerator.getCompletions(
          AFTER_SET_POS,
          doc,
        );
      });

      it('should return completions after "set "', function () {
        assert.ok(
          completions.length > 0,
          'should return at least one completion',
        );
      });

      it('should suggest register names with assignment operator', function () {
        const resultRegCompletion = completions.find(
          (c) => c.label === 'result_reg',
        );
        assert.ok(resultRegCompletion, 'should find result_reg completion');
      });

      it('should include ":=" in insertText snippet', function () {
        const resultRegCompletion = completions.find(
          (c) => c.label === 'result_reg',
        );
        assert.ok(resultRegCompletion, 'should find result_reg completion');
        assert.match(
          resultRegCompletion.insertText,
          /:=/,
          'insertText should include ":=" operator',
        );
      });

      it('should include snippet placeholders', function () {
        const resultRegCompletion = completions.find(
          (c) => c.label === 'result_reg',
        );
        assert.ok(resultRegCompletion, 'should find result_reg completion');
        assert.match(
          resultRegCompletion.insertText,
          /\$/,
          'insertText should include snippet placeholders',
        );
      });
    });
  });

  describe('send/recv completions', function () {
    describe('position after "send "', function () {
      const AFTER_SEND_POS = Position.create(100, 14); // After typing "send "

      it('should suggest endpoint names', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_SEND_POS,
          doc,
        );
        const labels = completions.map((c) => c.label);
        assert.ok(labels.includes('endp'), 'should include "endp" endpoint');
      });
    });

    describe('position after "send endpoint."', function () {
      const AFTER_SEND_DOT_POS = Position.create(100, 19); // After "send endp."
      let completions: AnvilCompletionDetail[];

      before(function () {
        completions = AnvilCompletionGenerator.getCompletions(
          AFTER_SEND_DOT_POS,
          doc,
        );
      });

      it('should suggest message names for endpoint', function () {
        const labels = completions.map((c) => c.label);
        assert.ok(labels.includes('resp'), 'should include "resp" message');
      });

      it('should include parameter snippet for send', function () {
        const respCompletion = completions.find((c) => c.label === 'resp');
        assert.ok(respCompletion, 'should find resp completion');
        assert.match(
          respCompletion.insertText,
          /\(/,
          'insertText should include opening parenthesis',
        );
      });
    });

    describe('position after "recv "', function () {
      const AFTER_RECV_POS = Position.create(91, 24); // After typing "recv "

      it('should suggest endpoint names', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_RECV_POS,
          doc,
        );
        const labels = completions.map((c) => c.label);
        assert.ok(labels.includes('endp'), 'should include "endp" endpoint');
      });
    });

    describe('position after "recv endpoint."', function () {
      const AFTER_RECV_DOT_POS = Position.create(91, 29); // After "recv endp."
      let completions: AnvilCompletionDetail[];

      before(function () {
        completions = AnvilCompletionGenerator.getCompletions(
          AFTER_RECV_DOT_POS,
          doc,
        );
      });

      it('should suggest message names for endpoint', function () {
        const labels = completions.map((c) => c.label);
        assert.ok(labels.includes('req'), 'should include "req" message');
      });

      it('should not include parameter snippet for recv', function () {
        const reqCompletion = completions.find((c) => c.label === 'req');
        assert.ok(reqCompletion, 'should find req completion');
        // recv doesn't need parameters, so insertText should just be the name
        assert.strictEqual(
          reqCompletion.insertText,
          'req',
          'recv should not include parameter snippet',
        );
      });
    });

    describe('direction handling', function () {
      it('send should suggest "out" messages', function () {
        const AFTER_SEND_DOT_POS = Position.create(100, 19); // After typing "send endp."
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_SEND_DOT_POS,
          doc,
        );
        const labels = completions.map((c) => c.label);
        assert.ok(
          labels.includes('resp'),
          'send should include outgoing "resp" message',
        );
      });

      it('recv should suggest "in" messages', function () {
        const AFTER_RECV_DOT_POS = Position.create(91, 29); // After typing "recv endp."
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_RECV_DOT_POS,
          doc,
        );
        const labels = completions.map((c) => c.label);
        assert.ok(
          labels.includes('req'),
          'recv should include incoming "req" message',
        );
      });
    });
  });

  describe('typedef completions', function () {
    describe('position after ": " in register declaration', function () {
      const AFTER_COLON_POS = Position.create(82, 22); // After typing ": "

      it('should suggest type names', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_COLON_POS,
          doc,
        );
        assert.ok(completions.length > 0, 'should return completions');
      });

      it('should include built-in types', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_COLON_POS,
          doc,
        );
        const labels = completions.map((c) => c.label);
        assert.ok(
          labels.includes('logic') || labels.includes('logic[8]'),
          'should include built-in logic type',
        );
      });

      it('should return type completions in type context', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_COLON_POS,
          doc,
        );
        // Should return type completions - at minimum verify we get some completions
        // in a type context rather than being empty or returning irrelevant items
        assert.ok(completions.length > 0, 'should return type completions');

        // Verify completions are relevant by checking that they all have a hint of "type"
        const hasNonType = completions.find(
          (c) => !c.hint || !c.hint.toLowerCase().includes('type'),
        );

        if (hasNonType) {
          console.error(
            'non-type completion found when none are expected:',
            hasNonType.lspCompletionItem(),
          );
        }

        assert.ok(
          !!hasNonType === false,
          'should not have non-type completions',
        );
      });
    });

    describe('position after ": " in channel declaration', function () {
      const AFTER_CHAN_COLON_POS = Position.create(119, 21); // After typing ": "

      it('should suggest channel class names', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_CHAN_COLON_POS,
          doc,
        );
        const labels = completions.map((c) => c.label);
        assert.ok(
          labels.includes('Calc_ch'),
          'should include "Calc_ch" channel class',
        );
      });
    });
  });

  describe('spawn completions', function () {
    describe('position after "spawn "', function () {
      const AFTER_SPAWN_POS = Position.create(125, 11); // After "spawn " before "Worker"

      it('should suggest proc names', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_SPAWN_POS,
          doc,
        );
        const labels = completions.map((c) => c.label);
        assert.ok(labels.includes('Worker'), 'should include "Worker" proc');
      });

      it('should include parameter snippets with placeholders', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_SPAWN_POS,
          doc,
        );
        const workerCompletion = completions.find((c) => c.label === 'Worker');
        assert.ok(workerCompletion, 'should find Worker completion');
        assert.match(
          workerCompletion.insertText,
          /\(/,
          'should include opening parenthesis',
        );
        assert.match(
          workerCompletion.insertText,
          /\$\{?\d+/,
          'should include snippet placeholders like $1, $2',
        );
      });

      it('should include endpoint parameters in snippet', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_SPAWN_POS,
          doc,
        );
        const workerCompletion = completions.find((c) => c.label === 'Worker');
        assert.ok(workerCompletion, 'should find Worker completion');
        // Worker has one endpoint parameter: endp
        assert.match(
          workerCompletion.insertText,
          /endp/,
          'should reference endpoint parameter',
        );
      });
    });
  });

  describe('call completions', function () {
    describe('position after "call "', function () {
      const AFTER_CALL_POS = Position.create(93, 17); // After "call " before "add8"

      it('should suggest function names', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_CALL_POS,
          doc,
        );
        const labels = completions.map((c) => c.label);
        assert.ok(labels.includes('add8'), 'should include "add8" function');
        assert.ok(labels.includes('sub8'), 'should include "sub8" function');
      });

      it('should include parameter snippets with placeholders', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_CALL_POS,
          doc,
        );
        const add8Completion = completions.find((c) => c.label === 'add8');
        assert.ok(add8Completion, 'should find add8 completion');
        assert.match(
          add8Completion.insertText,
          /\(/,
          'should include opening parenthesis',
        );
        assert.match(
          add8Completion.insertText,
          /\$\{?\d+/,
          'should include snippet placeholders',
        );
      });

      it('should include function parameters in snippet', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_CALL_POS,
          doc,
        );
        const add8Completion = completions.find((c) => c.label === 'add8');
        assert.ok(add8Completion, 'should find add8 completion');
        // add8 has parameters: a, b
        assert.match(
          add8Completion.insertText,
          /a/,
          'should reference parameter a',
        );
        assert.match(
          add8Completion.insertText,
          /b/,
          'should reference parameter b',
        );
      });
    });
  });

  describe('construct completions', function () {
    describe('position after "TypeName::"', function () {
      const AFTER_ENUM_DOUBLE_COLON = Position.create(92, 56); // After "Op::" in "pkt.op == Op::"

      it('should suggest enum variants', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          AFTER_ENUM_DOUBLE_COLON,
          doc,
        );
        const labels = completions.map((c) => c.label);
        assert.ok(labels.includes('Add'), 'should include "Add" variant');
        assert.ok(labels.includes('Sub'), 'should include "Sub" variant');
        assert.ok(labels.includes('Nop'), 'should include "Nop" variant');
      });
    });

    describe('position after "RecordType::"', function () {
      it('should suggest record constructor', function () {
        // We don't have a position in the sample code that uses Packet::,
        // so skipping this test for now
        this.skip();
      });
    });
  });

  describe('fallback completions', function () {
    describe('position that does not match specific heuristics', function () {
      const GENERAL_POS = Position.create(159, 8); // Inside loop, general position
      let completions: AnvilCompletionDetail[];

      before(function () {
        completions = AnvilCompletionGenerator.getCompletions(GENERAL_POS, doc);
      });

      it('should return general keywords and identifiers', function () {
        assert.ok(completions.length > 0, 'should return completions');
      });

      it('should include control flow keywords', function () {
        const labels = completions.map((c) => c.label);
        // Should include keywords like let, if, loop, etc.
        const hasKeywords = labels.some((l) =>
          [
            'let',
            'if',
            'loop',
            'cycle',
            'send',
            'recv',
            'call',
            'spawn',
            'set',
          ].includes(l),
        );
        assert.ok(
          hasKeywords,
          'should include at least some control flow keywords',
        );
      });

      it('should include identifiers from AST', function () {
        const labels = completions.map((c) => c.label);
        const hasIdentifiers = labels.some((l) =>
          ['Worker', 'add8', 'sub8', 'Packet', 'Op', 'byte'].includes(l),
        );
        assert.ok(hasIdentifiers, 'should include identifiers from AST');
      });
    });

    describe('position in function body', function () {
      const INSIDE_FUNC_POS = Position.create(63, 8); // Inside add8 function

      it('should return completions inside function', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          INSIDE_FUNC_POS,
          doc,
        );
        assert.ok(
          completions.length > 0,
          'should return completions inside function',
        );
      });
    });
  });

  describe('edge cases', function () {
    describe('position in past end of file', function () {
      const END_POS = Position.create(99999, 999);

      it('should handle position beyond file content', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          END_POS,
          doc,
        );
        assert.ok(Array.isArray(completions), 'should return an array');
      });
    });

    describe('position in comments', function () {
      const COMMENT_POS = Position.create(1, 10); // inside comment on line 1

      // TODO
      it.skip('should not return completions in comment', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          COMMENT_POS,
          doc,
        );
        assert.strictEqual(
          completions.length,
          0,
          'should not return completions in comment',
        );
      });
    });

    describe('position in invalid context', function () {
      const INVALID_POS = Position.create(97, 15); // inside "8'd0"

      // TODO
      it.skip('should not return irrelevant completions in invalid context', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          INVALID_POS,
          doc,
        );
        assert.ok(
          completions.length === 0,
          'should not return irrelevant completions in invalid context',
        );
      });
    });
  });

  describe('completion details', function () {
    const GENERAL_POS = Position.create(159, 8);

    describe('lspKind property', function () {
      it('should assign appropriate LSP kinds to completions', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          GENERAL_POS,
          doc,
        );

        const hasValidKinds = completions.every((c) => c.lspKind !== undefined);
        assert.ok(hasValidKinds, 'should have valid lspKind values');
      });
    });

    describe('hint property', function () {
      it('should include hints for completions', function () {
        const completions = AnvilCompletionGenerator.getCompletions(
          GENERAL_POS,
          doc,
        );
        const add8Completion = completions.find((c) => c.label === 'add8');

        assert.ok(add8Completion, 'should find add8 completion');
        assert.ok(add8Completion.hint, 'should have a hint property');
        assert.ok(add8Completion.hint.length > 0, 'hint should not be empty');
      });
    });
  });
});
