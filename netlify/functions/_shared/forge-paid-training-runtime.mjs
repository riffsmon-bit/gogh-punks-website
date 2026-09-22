import artifact from '../../../deployments/robinhood-paid-training.json' with {type:'json'};
import trainingArtifact from '../../../deployments/robinhood-forge-training.json' with {type:'json'};
import { validatePaidRelease, assertPaidSkillCoverage, createPaidTrainingCoordinator } from '../../../broker/src/v4/skill-forge/paid-training.mjs';
import { createForgeRpcClients } from '../../../broker/src/v4/skill-forge/rpc-clients.mjs';

export const currentPaidTrainingRelease = () => assertPaidSkillCoverage(validatePaidRelease(artifact),trainingArtifact);
export function forgePaidTrainingRuntime() {
  const release=currentPaidTrainingRelease();
  return createPaidTrainingCoordinator({release,clients:createForgeRpcClients()});
}
