import { Plugin } from '@opencode/plugin';
import { isOperatorCentric, registerGuards } from '#guards';
import { registerTools } from '#tools';

export default Plugin.define({
  id: 'oc3',
  async setup(ctx) {
    const root = ctx.location.directory;
    if (!(await isOperatorCentric(root))) return;
    await registerGuards(ctx);
    await registerTools(ctx);
  },
});
