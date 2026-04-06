/**
 * Integration tests for AnvilInlayHintGenerator.generateInlayHints method.
 *
 * Compiles samples/lsp_test.anvil and tests inlay hint generation with
 * different settings and scenarios including timing information, modes,
 * debug output, and edge cases.
 */

import assert from 'node:assert';
import * as path from 'path';
import { describe, it, before } from 'mocha';
import { InlayHint, InlayHintKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { AnvilDocument } from '../../src/core/AnvilDocument';
import { AnvilInlayHintGenerator } from '../../src/generators/AnvilInlayHintGenerator';
import { AnvilServerSettings } from '../../src/utils/AnvilServerSettings';

const projectRoot = path.resolve(__dirname, '../../..');
const anvilBinaryPath = path.join(projectRoot, 'bin', 'anvil');
const sampleFile = 'samples/lsp_test.anvil';

describe('AnvilInlayHintGenerator', function () {
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

  describe('basic timing hints', function () {
    const CYCLE_PREFIX_FULL = 'cycle ';
    const THREAD_HEADER_FULL = /___ thread \d+ ___/;

    describe('with showTimingInfo: "full"', function () {
      const settings = {
        projectRoot,
        executablePath: anvilBinaryPath,
        showTimingInfo: { asInlayHints: 'full' as const },
      } satisfies AnvilServerSettings;

      let hints: InlayHint[];

      before(function () {
        hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
      });

      it('should return hints', function () {
        assert.ok(hints.length > 0, 'should return at least one hint');
      });

      it('should have valid positions', function () {
        for (const hint of hints) {
          assert.ok(hint.position, 'hint should have position');
          assert.ok(
            typeof hint.position.line === 'number',
            'position line should be a number',
          );
          assert.ok(
            typeof hint.position.character === 'number',
            'position character should be a number',
          );
        }
      });

      it('should have labels with timing info', function () {
        // At least some hints should have timing info like "cycle 1" or thread headers like "___ thread 0 ___"
        const hasTimingInfo = hints.some(
          (hint) =>
            typeof hint.label === 'string' &&
            (new RegExp(`${CYCLE_PREFIX_FULL}\\d+`).test(hint.label) ||
              THREAD_HEADER_FULL.test(hint.label)),
        );
        assert.ok(
          hasTimingInfo,
          'should have hints with timing info format (cycle info or thread headers)',
        );
      });

      it('should have kind = InlayHintKind.Type', function () {
        for (const hint of hints) {
          assert.strictEqual(
            hint.kind,
            InlayHintKind.Type,
            'hint kind should be Type',
          );
        }
      });

      it('should have prefix hints at line start', function () {
        // Prefix hints should be at character 0
        const prefixHints = hints.filter(
          (hint) => hint.position.character === 0,
        );
        assert.ok(
          prefixHints.length > 0,
          'should have at least one prefix hint at character 0',
        );
      });

      it('should have postfix hints at line end', function () {
        // Postfix hints should be at non-zero character positions (end of line)
        const postfixHints = hints.filter(
          (hint) => hint.position.character > 0,
        );
        // Some hints should be postfix (for sustained events)
        assert.ok(postfixHints.length > 0, 'should have postfix hints');
      });
    });
  });

  describe('mode testing', function () {
    const SUSTAINED_SYMBOL = '↘';
    const SUSTAINED_SYMBOL_ASCII = '~>';
    const SUSTAINED_TEXT_PATTERN = /sustained till .+ ends/;

    describe('showTimingInfo: "none"', function () {
      const settings = {
        projectRoot,
        executablePath: anvilBinaryPath,
        showTimingInfo: { asInlayHints: 'none' as const },
      } satisfies AnvilServerSettings;

      it('should return empty array', function () {
        const hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
        assert.strictEqual(
          hints.length,
          0,
          'should return no hints when mode is none',
        );
      });
    });

    describe('showTimingInfo: false', function () {
      const settings = {
        projectRoot,
        executablePath: anvilBinaryPath,
        showTimingInfo: false,
      } satisfies AnvilServerSettings;

      it('should return empty array', function () {
        const hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
        assert.strictEqual(
          hints.length,
          0,
          'should return no hints when showTimingInfo is false',
        );
      });
    });

    describe('showTimingInfo: "condensed"', function () {
      const settings = {
        projectRoot,
        executablePath: anvilBinaryPath,
        showTimingInfo: { asInlayHints: 'condensed' as const },
      } satisfies AnvilServerSettings;

      let hints: InlayHint[];

      before(function () {
        hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
      });

      it('should return hints in condensed format', function () {
        assert.ok(hints.length > 0, 'should return hints in condensed mode');
      });

      it('should use condensed format with symbols (↘) when sustained events exist', function () {
        const sustainedHints = hints.filter(
          (hint) =>
            typeof hint.label === 'string' &&
            (hint.label.includes(SUSTAINED_SYMBOL) ||
              hint.label.includes(SUSTAINED_SYMBOL_ASCII)),
        );
        assert.ok(
          sustainedHints.length > 0,
          'should have sustained hints with condensed symbol',
        );
      });

      it('should not use verbose "sustained till" text', function () {
        // Should not have verbose text in condensed mode
        const hasVerboseText = hints.some(
          (hint) =>
            typeof hint.label === 'string' &&
            hint.label.includes('sustained till'),
        );
        assert.ok(
          !hasVerboseText,
          'condensed mode should not use verbose "sustained till" text',
        );
      });
    });

    describe('showTimingInfo: "full"', function () {
      const settings = {
        projectRoot,
        executablePath: anvilBinaryPath,
        showTimingInfo: { asInlayHints: 'full' as const },
      } satisfies AnvilServerSettings;

      let hints: InlayHint[];

      before(function () {
        hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
      });

      it('should return hints in full format', function () {
        assert.ok(hints.length > 0, 'should return hints in full mode');
      });

      it('should use verbose format ("sustained till X ends") when sustained events exist', function () {
        const sustainedHints = hints.filter(
          (hint) =>
            typeof hint.label === 'string' &&
            SUSTAINED_TEXT_PATTERN.test(hint.label),
        );
        assert.ok(
          sustainedHints.length > 0,
          'should have sustained hints with verbose text',
        );
      });
    });

    describe('compare condensed vs full mode', function () {
      const settingsCondensed = {
        projectRoot,
        executablePath: anvilBinaryPath,
        showTimingInfo: { asInlayHints: 'condensed' as const },
      } satisfies AnvilServerSettings;

      const settingsFull = {
        projectRoot,
        executablePath: anvilBinaryPath,
        showTimingInfo: { asInlayHints: 'full' as const },
      } satisfies AnvilServerSettings;

      it('should produce different output formats', function () {
        const condensedHints = AnvilInlayHintGenerator.generateInlayHints(
          doc,
          settingsCondensed,
        );
        const fullHints = AnvilInlayHintGenerator.generateInlayHints(
          doc,
          settingsFull,
        );

        assert.ok(
          condensedHints.length > 0,
          'condensed mode should return hints',
        );
        assert.ok(fullHints.length > 0, 'full mode should return hints');

        const hasCondensedSymbol = condensedHints.some(
          (h) =>
            typeof h.label === 'string' &&
            (h.label.includes(SUSTAINED_SYMBOL) ||
              h.label.includes(SUSTAINED_SYMBOL_ASCII)),
        );
        const hasFullVerbose = fullHints.some(
          (h) =>
            typeof h.label === 'string' && SUSTAINED_TEXT_PATTERN.test(h.label),
        );

        assert.ok(
          hasCondensedSymbol || hasFullVerbose,
          'at least one mode should have sustained events',
        );
        assert.ok(
          hasCondensedSymbol,
          'condensed mode should have sustained events with symbol',
        );
        assert.ok(
          hasFullVerbose,
          'full mode should have sustained events with verbose text',
        );
      });
    });
  });

  describe('event information', function () {
    const CYCLE_PREFIX_FULL = 'cycle ';
    const SUSTAINED_TEXT_PATTERN = /sustained till .+ ends/;

    const settings = {
      projectRoot,
      executablePath: anvilBinaryPath,
      showTimingInfo: { asInlayHints: 'full' as const },
    } satisfies AnvilServerSettings;

    describe('event format in hint labels', function () {
      let hints: InlayHint[];

      before(function () {
        hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
      });

      it('should show format: cycle info without thread prefix', function () {
        const eventHints = hints.filter((hint) => {
          const label = typeof hint.label === 'string' ? hint.label : '';
          return new RegExp(`${CYCLE_PREFIX_FULL}\\d`).test(label);
        });

        assert.ok(
          eventHints.length > 0,
          'should have hints with event format cycle <cycles>',
        );

        // Check the first few formats match expected pattern
        for (const hint of eventHints.slice(0, 5)) {
          const label = typeof hint.label === 'string' ? hint.label : '';
          assert.match(
            label,
            new RegExp(`${CYCLE_PREFIX_FULL}\\d`),
            'event hint should match cycle <delays> pattern',
          );
        }
      });

      it('should show cycle numbers', function () {
        const knownDelayHints = hints.filter((hint) => {
          const label = typeof hint.label === 'string' ? hint.label : '';
          return new RegExp(`${CYCLE_PREFIX_FULL}\\d+`).test(label);
        });

        assert.ok(
          knownDelayHints.length > 0,
          'should have hints with known cycle numbers',
        );
      });
    });

    describe('sustained events', function () {
      it('should have postfix hints for sustained events', function () {
        const hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);

        const postfixHints = hints.filter(
          (hint) =>
            hint.position.character > 0 &&
            typeof hint.label === 'string' &&
            SUSTAINED_TEXT_PATTERN.test(hint.label),
        );

        assert.ok(
          postfixHints.length > 0,
          'should have postfix hints for sustained events',
        );
      });
    });
  });

  describe('block markers', function () {
    const LONE_MARKER = ' ─ ';
    const LONE_MARKER_ASCII = ' - ';
    const START_MARKER = ' ┌ ';
    const START_MARKER_ASCII = ',- ';
    const CONT_MARKER = ' │ ';
    const CONT_MARKER_ASCII = '|  ';
    const END_MARKER = ' └ ';
    const END_MARKER_ASCII = "'- ";

    const settings = {
      projectRoot,
      executablePath: anvilBinaryPath,
      showTimingInfo: { asInlayHints: 'full' as const },
    } satisfies AnvilServerSettings;

    describe('single-line cycle markers', function () {
      it('should have dash marker for lone lines', function () {
        const hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);

        const loneMarkerHints = hints.filter((hint) => {
          const label = typeof hint.label === 'string' ? hint.label : '';
          return (
            label.includes(LONE_MARKER) || label.includes(LONE_MARKER_ASCII)
          );
        });

        assert.ok(
          loneMarkerHints.length > 0,
          'should have lone line markers for a clock cycle on a single line',
        );
      });
    });

    describe('multi-line cycle markers', function () {
      let hints: InlayHint[];

      before(function () {
        hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
      });

      it('should have bracketed markers for blocks', function () {
        const hasStartMarker = hints.some((hint) => {
          const label = typeof hint.label === 'string' ? hint.label : '';
          return (
            label.includes(START_MARKER) || label.includes(START_MARKER_ASCII)
          );
        });
        const hasContMarker = hints.some((hint) => {
          const label = typeof hint.label === 'string' ? hint.label : '';
          return (
            label.includes(CONT_MARKER) || label.includes(CONT_MARKER_ASCII)
          );
        });
        const hasEndMarker = hints.some((hint) => {
          const label = typeof hint.label === 'string' ? hint.label : '';
          return label.includes(END_MARKER) || label.includes(END_MARKER_ASCII);
        });

        // Should have at least some block structure
        const hasBlockStructure =
          hasStartMarker || hasContMarker || hasEndMarker;
        assert.ok(
          hasBlockStructure,
          'should have bracketed markers for a clock cycle spanning multiple lines',
        );
      });

      it('should always have a connected set of block markers', function () {
        const startLines = new Set<number>();
        const endLines = new Set<number>();
        const contLines = new Set<number>();

        for (const hint of hints) {
          const label = typeof hint.label === 'string' ? hint.label : '';
          if (
            label.endsWith(START_MARKER) ||
            label.endsWith(START_MARKER_ASCII)
          ) {
            startLines.add(hint.position.line);
          } else if (
            label.endsWith(END_MARKER) ||
            label.endsWith(END_MARKER_ASCII)
          ) {
            endLines.add(hint.position.line);
          } else if (
            label.endsWith(CONT_MARKER) ||
            label.endsWith(CONT_MARKER_ASCII)
          ) {
            contLines.add(hint.position.line);
          }
        }

        // Every start must be followed by continuations till the end
        for (const i of startLines) {
          let isEnd = false;
          for (let line = i + 1; line < doc.textDocument.lineCount; line++) {
            if (endLines.has(line)) {
              isEnd = true;
              break;
            } else if (contLines.has(line)) {
              continue;
            }
            assert.fail(
              `start marker at line ${i} unexpectedly stopped continuation at line ${line}`,
            );
          }

          assert.ok(
            isEnd,
            `start marker at line ${i} does not have a matching end marker`,
          );
        }

        // Every end must be preceded by a start or cont above it
        // This checks for any lone disconnected end markers not caught by the start check
        for (const i of endLines) {
          assert.ok(
            startLines.has(i - 1) || contLines.has(i - 1),
            `end marker at line ${i} is not connected to a start or continuation marker above it`,
          );
        }

        // Every cont must have a start or cont above it and an end below it
        // This checks for any lone disconnected cont markers not caught by the start/end checks
        for (const i of contLines) {
          assert.ok(
            startLines.has(i - 1) || contLines.has(i - 1),
            `continuation marker at line ${i} is not connected to a start or continuation marker above it`,
          );
          assert.ok(
            endLines.has(i + 1) || contLines.has(i + 1),
            `continuation marker at line ${i} is not connected to an end or continuation marker below it`,
          );
        }
      });
    });
  });

  describe('edge cases', function () {
    const settings = {
      projectRoot,
      executablePath: anvilBinaryPath,
      showTimingInfo: { asInlayHints: 'full' as const },
    } satisfies AnvilServerSettings;

    describe('empty document', function () {
      it('should not crash and return empty array', function () {
        // Create a minimal document without AST
        const textDoc = TextDocument.create(
          'file:///test.anvil',
          'anvil',
          0,
          '',
        );
        const emptyDoc = AnvilDocument.fromTextDocument(textDoc);

        const hints = AnvilInlayHintGenerator.generateInlayHints(
          emptyDoc,
          settings,
        );
        assert.ok(Array.isArray(hints), 'should return an array');
        assert.strictEqual(
          hints.length,
          0,
          'should return empty array for document without AST',
        );
      });
    });

    describe('document without AST', function () {
      it('should return empty array', function () {
        // Create document without compiling
        const textDoc = TextDocument.create(
          'file:///test.anvil',
          'anvil',
          0,
          'proc top () { cycle 1 }',
        );
        const uncompiled = AnvilDocument.fromTextDocument(textDoc);

        const hints = AnvilInlayHintGenerator.generateInlayHints(
          uncompiled,
          settings,
        );
        assert.strictEqual(
          hints.length,
          0,
          'should return empty array when no AST is available',
        );
      });
    });

    describe('document with no timing information', function () {
      it('should handle gracefully', async function () {
        this.timeout(10_000);

        const textDoc = TextDocument.create(
          'file:///simple.anvil',
          'anvil',
          0,
          'proc top () { cycle 1 }',
        );
        const simpleDoc = AnvilDocument.fromTextDocument(textDoc);
        await simpleDoc.compile(settings);
        const hints = AnvilInlayHintGenerator.generateInlayHints(
          simpleDoc,
          settings,
        );

        assert.ok(Array.isArray(hints), 'should return an array');
      });
    });

    describe('hint count is reasonable', function () {
      let hints: InlayHint[];

      before(function () {
        hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
      });

      it('should not be zero', function () {
        assert.ok(
          hints.length > 0,
          'should return at least one hint for compiled document',
        );
      });

      it('should be reasonable for document size', function () {
        const lineCount = doc.textDocument.lineCount;

        assert.ok(
          hints.length >= lineCount / 2,
          'suspiciously low hints generated per line (hints might not be generated correctly)',
        );
        assert.ok(
          hints.length <= lineCount * 3,
          'suspiciously many hints generated per line (hints might not be generated correctly)',
        );
      });
    });
  });

  describe('position verification', function () {
    const settings = {
      projectRoot,
      executablePath: anvilBinaryPath,
      showTimingInfo: { asInlayHints: 'full' as const },
    } satisfies AnvilServerSettings;

    describe('prefix hints', function () {
      let hints: InlayHint[];

      before(function () {
        hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
      });

      it('should have prefix hints for all lines', function () {
        const lineCount = doc.textDocument.lineCount;
        const prefixHints = hints.filter((h) => h.position.character === 0);
        assert.ok(
          prefixHints.length == lineCount,
          'prefix hint count does not match expected amount',
        );

        const linesWithPrefixHints = new Set(
          prefixHints.map((h) => h.position.line),
        );
        for (let line = 0; line < lineCount; line++) {
          assert.ok(
            linesWithPrefixHints.has(line),
            `line ${line} should have a prefix hint (but is missing)`,
          );
        }
      });
    });

    describe('postfix hints', function () {
      let hints: InlayHint[];

      before(function () {
        hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
      });

      it('should exist', function () {
        const postfixHints = hints.filter((h) => h.position.character > 0);

        if (postfixHints.length === 0) {
          assert.fail(
            'should have some postfix hints for blocking or sustained events, but found none',
          );
        }
      });
    });
  });

  describe('alignment', function () {
    const settings = {
      projectRoot,
      executablePath: anvilBinaryPath,
      showTimingInfo: { asInlayHints: 'full' as const },
    } satisfies AnvilServerSettings;

    describe('prefix hint padding', function () {
      let hints: InlayHint[];

      before(function () {
        hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
      });

      it('should have consistent length for alignment', function () {
        const prefixHints = hints.filter((h) => h.position.character === 0);

        const lengths = prefixHints.map(
          (h) => (typeof h.label === 'string' ? h.label : '').length,
        );

        assert.ok(
          lengths.every((l) => l === lengths[0]),
          'all prefix hints should have the same length for alignment',
        );
      });

      it('should use power-of-2 alignment', function () {
        const prefixHints = hints.filter((h) => h.position.character === 0);

        if (prefixHints.length > 0) {
          const lengths = prefixHints.map(
            (h) => (typeof h.label === 'string' ? h.label : '').length,
          );
          const maxLength = Math.max(...lengths);

          const isPowerOf2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
          assert.ok(
            isPowerOf2(maxLength) || maxLength >= 8,
            `max hint length ${maxLength} should be power of 2 or >= 8 for alignment`,
          );
        }
      });
    });
  });

  describe('label format', function () {
    const settings = {
      projectRoot,
      showTimingInfo: { asInlayHints: 'full' as const },
    } satisfies AnvilServerSettings;

    describe('label is a string', function () {
      let hints: InlayHint[];

      before(function () {
        hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
      });

      it('should have string labels', function () {
        for (const hint of hints) {
          assert.ok(
            typeof hint.label === 'string',
            'hint label should be a string',
          );
        }
      });
    });

    describe('labels are not empty', function () {
      let hints: InlayHint[];

      before(function () {
        hints = AnvilInlayHintGenerator.generateInlayHints(doc, settings);
      });

      it('should have non-empty labels (allowing whitespace only for prefix hints)', function () {
        for (const hint of hints) {
          assert.ok(hint.label !== undefined, 'hint should have a label');

          assert.ok(
            typeof hint.label === 'string',
            'hint label should be a string',
          );

          if (hint.position.character !== 0) {
            assert.ok(
              hint.label.trim().length > 0,
              'non-prefix hint labels should not be empty or whitespace only',
            );
          }
        }
      });
    });
  });
});
