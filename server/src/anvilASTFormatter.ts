import { AnvilAST, AnvilUnknownNode } from './anvilAST';

export class AnvilASTDescriber {
	private AnvilASTDescriber() {}

	static describeNode(ast: AnvilAST, node: AnvilUnknownNode): string {
		if (ast.isExprNode(node)) {
			const heading = `**\`${node.data.type}\` expression**\n\n`;
			return heading;
		}
		return '';
	}
}