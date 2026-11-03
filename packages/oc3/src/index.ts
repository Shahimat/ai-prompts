import { Plugin } from '@opencode/plugin';
import { isOperatorCentric, registerGuards } from '#guards';
import { registerOpsBrief } from '#ops-brief';
import { registerPlanBridge } from '#plan-bridge';
import { registerTools } from '#tools';

export default Plugin.define({
  id: 'oc3',
  async setup(ctx) {
    const root = ctx.location.directory;
    await registerPlanBridge(ctx);
    if (!(await isOperatorCentric(root))) return;
    await registerGuards(ctx);
    await registerTools(ctx);
    return registerOpsBrief(ctx);
  },
});

export { appendBridgeEvent, plannerGuard, readBridge } from '#plan-bridge';
export { docsGuard } from '#guards';
