import { ROBINHOOD } from "../config.mjs";
import { TRANSFER_TOPIC, TRANSFER_SINGLE_TOPIC } from "../discovery/onchain-events.mjs";
import {
  ORDER_FULFILLED_TOPIC,
  ROBINHOOD_SEAPORT,
} from "../discovery/seaport-activity.mjs";
import {
  ACCOUNT_ACQUISITION_TOPIC,
  ACCOUNT_ACTIVATION_TOPIC,
} from "./account-event-projection.mjs";

export { ACCOUNT_ACQUISITION_TOPIC, ACCOUNT_ACTIVATION_TOPIC };

export const TRANSFER_BATCH_TOPIC =
  "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";
export const BASE_INDEXER_STREAMS = Object.freeze({
  gogh_punk_transfers: Object.freeze({
    address: ROBINHOOD.canonicalCollection,
    topics: [TRANSFER_TOPIC],
  }),
  nft_transfers: Object.freeze({
    topics: [[TRANSFER_TOPIC, TRANSFER_SINGLE_TOPIC, TRANSFER_BATCH_TOPIC]],
  }),
  seaport_activity: Object.freeze({
    address: ROBINHOOD_SEAPORT,
    topics: [ORDER_FULFILLED_TOPIC],
  }),
});

export function protocolStreams(deployment) {
  const streams = { ...BASE_INDEXER_STREAMS };
  if (deployment?.status !== "DEPLOYED") return Object.freeze(streams);

  const registry = deployment?.contracts?.GoghPunkAccountRegistry?.address;
  const accountImplementation = deployment?.contracts?.GoghPunkAccountV1?.address;
  const policy = deployment?.contracts?.BrokerPolicyModule?.address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(registry ?? "")) {
    throw new TypeError("deployed manifest is missing GoghPunkAccountRegistry address");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(policy ?? "")) {
    throw new TypeError("deployed manifest is missing BrokerPolicyModule address");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(accountImplementation ?? "")) {
    throw new TypeError("deployed manifest is missing GoghPunkAccountV1 address");
  }

  if (registry) {
    streams.account_activations = Object.freeze({
      address: registry.toLowerCase(),
      implementation: accountImplementation.toLowerCase(),
      topics: Object.freeze([ACCOUNT_ACTIVATION_TOPIC]),
    });
  }
  streams.account_acquisitions = Object.freeze({
    topics: Object.freeze([ACCOUNT_ACQUISITION_TOPIC]),
  });
  if (policy) {
    streams.policy_activity = {
      address: policy.toLowerCase(),
      topics: [null],
    };
  }
  return Object.freeze(streams);
}
