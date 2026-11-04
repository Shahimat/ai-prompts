import { Plugin } from '@opencode/plugin';
import { isOperatorCentric, registerGuards } from '#guards';
import { registerOpsBrief } from '#ops-brief';
import { registerPlanBridge } from '#plan-bridge';
import { registerSessionBrief } from '#session-brief';
import { registerTools } from '#tools';

export default Plugin.define({
  id: 'oc3',
  async setup(ctx) {
    const root = ctx.location.directory;
    await registerPlanBridge(ctx);
    if (!(await isOperatorCentric(root))) return;
    await registerGuards(ctx);
    await registerTools(ctx);
    const cleanups = [await registerSessionBrief(ctx), await registerOpsBrief(ctx)];
    return async () => {
      for (const cleanup of cleanups) await cleanup();
    };
  },
});

export { appendBridgeEvent, plannerGuard, readBridge } from '#plan-bridge';
export { docsGuard } from '#guards';
