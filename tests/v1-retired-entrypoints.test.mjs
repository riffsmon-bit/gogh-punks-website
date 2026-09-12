import test from 'node:test';
import assert from 'node:assert/strict';
import { V1_SHUTDOWN_AT_MS } from '../netlify/functions/_shared/broker-migration-state.mjs';
import { runSelectedAutomationV3, runAllAutomationV3 } from '../netlify/functions/broker-autonomy-v3-run.mjs';
import { prepareOwnerPaidAutomationV3 } from '../netlify/functions/broker-autonomy-v3-owner-run.mjs';
import { enrollAutomationV3Punk } from '../netlify/functions/_shared/automation-v3-worker-state.mjs';
import { runScheduledAutomationV3Lane } from '../netlify/functions/_shared/automation-v3-lane-handler.mjs';
import { runAutomatedSeaDropWorker } from '../scripts/run-automated-seadrop-worker.mjs';

test('historical fixture clocks never reopen retired production entrypoints', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: V1_SHUTDOWN_AT_MS + 1 });
  let touched = false;
  const denied = async () => { touched = true; throw Error('RETIRED_OPERATION_MUST_NOT_RUN'); };
  const deps = { environment: {}, readPunk: denied, runOnce: denied,
    runWorker: denied, enroll: denied, database: { query: denied, connect: denied } };
  await assert.rejects(runSelectedAutomationV3({ tokenId: '93' }, deps), { code: 'V1_REGISTRATION_CLOSED' });
  await assert.rejects(runAllAutomationV3({ all: true }, deps), { code: 'V1_REGISTRATION_CLOSED' });
  await assert.rejects(enrollAutomationV3Punk({}, deps), { code: 'V1_REGISTRATION_CLOSED' });
  await assert.rejects(prepareOwnerPaidAutomationV3({ tokenId: '93' }, deps), { code: 'V1_RETIRED' });
  await assert.rejects(runAutomatedSeaDropWorker({ BROKER_AUTOMATION_V2_ENABLED: 'true' }, deps), { code: 'V1_RETIRED' });
  assert.equal((await runScheduledAutomationV3Lane(5, deps)).status, 'DISABLED');
  assert.equal(touched, false);
});
