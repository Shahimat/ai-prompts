import { createInterface } from 'node:readline/promises';

export interface Option {
  key: string;
  label: string;
}

export interface Prompter {
  interactive: boolean;
  choose: (question: string, options: Option[]) => Promise<string>;
  text: (question: string) => Promise<string>;
  say: (text: string) => void;
}

export function terminalPrompter(): Prompter {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const ask = async (question: string): Promise<string> => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await rl.question(question)).trim();
    } finally {
      rl.close();
    }
  };
  return {
    interactive,
    say: (text) => {
      console.log(text);
    },
    text: ask,
    choose: async (question, options) => {
      console.log(question);
      options.forEach((o, i) => {
        console.log(`  ${i + 1}. ${o.label}`);
      });
      for (;;) {
        const answer = await ask('> ');
        const byNumber = options[Number.parseInt(answer, 10) - 1];
        const chosen = byNumber ?? options.find((o) => o.key === answer);
        if (chosen !== undefined) return chosen.key;
        console.log(`выберите 1–${options.length}`);
      }
    },
  };
}
