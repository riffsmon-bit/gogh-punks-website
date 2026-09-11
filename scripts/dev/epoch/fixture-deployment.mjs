import { readFile } from 'node:fs/promises';
import { keccak256 } from 'viem';

// Only disposable local worlds. Never persist or import this fixture into server code.
export async function epochFixtureDeployment(world) {
  const deployment = JSON.parse(await readFile(new URL('../../../deployments/robinhood-epoch-proposal.json', import.meta.url), 'utf8'));
  const record = async (contract, label) => {
    const event = world.history.find(x => x.label === `Deploy ${label}`);
    if (!event) throw Error('DISPOSABLE_DEPLOYMENT_REQUIRED');
    return { address: contract.address, deploymentTransaction: event.hash, deploymentBlock: Number(event.block),
      runtimeBytecodeHash: keccak256(await world.client.getCode({ address: contract.address })), verificationStatus: 'VERIFIED' };
  };
  deployment.status = 'DEPLOYED';
  deployment.contracts.GoghPunkAgentAccount = await record(world.implementation, 'GoghEpochAgentAccount');
  deployment.contracts.GoghPunkAgentAccountRegistry = await record(world.factory, 'GoghEpochAccountRegistry');
  deployment.epochAuthority = { wrapper: await record(world.wrapper, 'GoghPunkSessionWrapper'),
    epochs: await record(world.epochs, 'GoghPunkSessionWrapper'), progression: await record(world.progression, 'GoghEpochSkillProgression') };
  deployment.reusedContracts = { ArtAdapterRegistry: world.adapters.address,
    AutomatedSeaDropStudioFreeMintAdapter: world.adapter.address, SeaDrop: world.venue.address };
  for (const key of Object.keys(deployment.configuration)) deployment.configuration[key] = true;
  deployment.authorization = { deploymentAuthorized: true, automaticSubmissionEnabled: true };
  deployment.notes = 'IN-MEMORY DISPOSABLE FIXTURE; NOT PRODUCTION VERIFICATION OR AUTHORIZATION';
  return deployment;
}
