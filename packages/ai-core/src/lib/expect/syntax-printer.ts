import ts from 'typescript';

export function extractionPrinter() {
  const printer = ts.createPrinter({ removeComments: true });
  const printed = new WeakMap<ts.Node, string>();
  return (node: ts.Node, source = node.getSourceFile()): string => {
    const reusable =
      node.pos >= 0 &&
      (node.flags & ts.NodeFlags.Synthesized) === 0 &&
      ts.getOriginalNode(node) === node &&
      node.getSourceFile() === source;
    const previous = reusable ? printed.get(node) : undefined;
    if (previous !== undefined) return previous;
    const text = printer.printNode(ts.EmitHint.Unspecified, node, source);
    if (reusable) printed.set(node, text);
    return text;
  };
}
