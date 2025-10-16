import { AnvilAST } from './anvilAST';

export class AnvilASTDescriber {
	private AnvilASTDescriber() {}

	static describeNode(ast: AnvilAST, node: unknown): string {
		if (ast.isExprNode(node)) {
			const heading = `**\`${node.expression.type}\` expression**\n\n`;
			return heading;
		}
		return '';
	}
}