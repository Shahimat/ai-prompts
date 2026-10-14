type Range = [number, number];

interface Comment {
  type: string;
  value: string;
  range: Range;
}

interface Fixer {
  removeRange(range: Range): unknown;
}

interface Context {
  sourceCode: { text: string; getAllComments(): Comment[] };
  report(diagnostic: { node: Comment; message: string; fix: (fixer: Fixer) => unknown }): void;
}

const ANCHOR = /^ expect:[\w:.-]+$/;

const allowed = (comment: Comment): boolean =>
  comment.type === 'Shebang' || (comment.type === 'Line' && ANCHOR.test(comment.value));

function removal(text: string, comment: Comment): Range {
  const [start, end] = comment.range;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end);
  const lineEnd = newline === -1 ? text.length : newline;
  const alone =
    text.slice(lineStart, start).trim() === '' && text.slice(end, lineEnd).trim() === '';
  if (alone) return [lineStart, Math.min(lineEnd + 1, text.length)];
  return [text.slice(0, start).trimEnd().length, end];
}

export default {
  meta: { name: 'local' },
  rules: {
    'no-comments': {
      meta: { fixable: 'code' },
      create(context: Context) {
        return {
          Program() {
            const text = context.sourceCode.text;
            for (const comment of context.sourceCode.getAllComments()) {
              if (allowed(comment)) continue;
              context.report({
                node: comment,
                message: 'Комментарии в коде запрещены, кроме якорей `// expect:KEY`',
                fix: (fixer) => fixer.removeRange(removal(text, comment)),
              });
            }
          },
        };
      },
    },
  },
};
