import { currentTrainingRelease, forgeTrainingRuntime } from './_shared/forge-training-runtime.mjs';
import { reconcileTrainingBatch } from '../../broker/src/v4/skill-forge/training-reconciler.mjs';

export async function runForgeTrainingReconciliation({ releaseReader = currentTrainingRelease,
  runtimeFactory = () => forgeTrainingRuntime('worker') } = {}) {
  if (!['OWNER_CANARY','PAUSED'].includes(releaseReader().status)) return { skipped:true,reason:'FORGE_TRAINING_NOT_RELEASED',publicTransactions:0 };
  let runtime;
  try { runtime = await runtimeFactory(); }
  catch (error) {
    if (error.message !== 'FORGE_TRAINING_DATABASE_UNAVAILABLE') throw error;
    return { skipped:true,reason:'FORGE_TRAINING_DATABASE_UNAVAILABLE',publicTransactions:0 };
  }
  const { release,clients,store } = runtime;
  return reconcileTrainingBatch({ store,clients,expectedRuntimeHash:release.progressionCodeHash,
    expectedSnapshotHash:release.snapshotHash,limit:4,maxDurationMs:20000 });
}
export default async function handler() {
  const result = await runForgeTrainingReconciliation();
  if (!result.skipped || result.reason !== 'FORGE_TRAINING_NOT_RELEASED')
    console.log(JSON.stringify({ event:'FORGE_TRAINING_RECONCILIATION',...result }));
}
export const config = { schedule:'* * * * *' };
