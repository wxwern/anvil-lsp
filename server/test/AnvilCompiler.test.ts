/**
 * Test script for the updated AnvilCompiler with JSON support
 */

import { AnvilCompiler } from '../src/AnvilCompiler';
import * as path from 'path';

import assert from "node:assert";
import { beforeEach } from 'mocha';

/** Simple hash code for strings (from Java's String.hashCode()) */
function hashCode(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const chr = str.charCodeAt(i);
		hash = (hash << 5) - hash + chr;
		hash |= 0; // Convert to 32bit integer
	}
	return hash;
}

describe('AnvilCompiler', () => {
	let projectRoot: string;
	let compiler: AnvilCompiler;

	beforeEach(() => {
		projectRoot = path.resolve(__dirname, '../..');
		compiler = new AnvilCompiler(projectRoot);
	});

	it('should compile valid file and produce expected output', async () => {
		const validResult = await compiler.compile('samples/valid.anvil');
		assert.strictEqual(validResult.success, true, 'Expected compilation to succeed');
		assert.strictEqual(validResult.errors.length, 0, 'Expected no errors');
		assert.ok(validResult.stdout && validResult.stdout.length > 0, 'Expected non-empty stdout');
		const outputHash = hashCode(validResult.stdout!);
		assert.strictEqual(outputHash, 8627852);
	});

	it('should handle compilation errors and produce correct error information', async () => {
		const invalidResult = await compiler.compile('samples/invalid.anvil');
		assert.strictEqual(invalidResult.success, false, 'Expected compilation to fail');
		assert.ok(invalidResult.errors.length > 0, 'Expected at least one error');
		const error = invalidResult.errors[0];
		assert.ok(error.filepath.endsWith('samples/invalid.anvil'), 'Filepath does not match expected samples/invalid.anvil');
		assert.strictEqual(error.span.start.line, 19);
		assert.strictEqual(error.span.start.col, 12);
		assert.strictEqual(error.span.end.line, 19);
		assert.strictEqual(error.span.end.col, 43);
		assert.ok(error.message.includes('Borrow checking failed'), 'Error message does not contain expected text fragment');
	});

	it('should handle non-existent file and produce an appropriate error', async () => {
		const nonExistentResult = await compiler.compile('samples/nonexistent.anvil');
		assert.strictEqual(nonExistentResult.success, false, 'Expected compilation to fail');
		assert.ok(nonExistentResult.errors.length > 0, 'Expected at least one error');
		const errorMessage = nonExistentResult.errors[0].message;
		assert.ok(errorMessage.includes('No such file or directory'));
	});

	it('should compile file with import statements successfully', async () => {
		const importResult = await compiler.compile('samples/import.anvil');
		assert.strictEqual(importResult.success, true, 'Expected compilation to succeed');
		assert.strictEqual(importResult.errors.length, 0, 'Expected no errors');
	});
});
