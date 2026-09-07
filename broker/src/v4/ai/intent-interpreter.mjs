import { PUNK_COLLECTING_INTENT_JSON_SCHEMA, collectingIntentConfirmation,
  normalizePunkCollectingIntent } from "../collecting-intent.mjs";

export async function interpretPunkCollectingIntent({ router, message, currentIntent, context,
  now = new Date() }) {
  const current = normalizePunkCollectingIntent(currentIntent, now);
  const result = await router.run("INTERPRET_INTENT", {
    instructions: `You interpret owner language into PunkCollectingIntentV1. Preserve every
unchanged field from the current intent. Never broaden permissions unless the owner said so.
Never disable simulation for AUTONOMOUS. Values denominated in ETH must be converted exactly to
decimal wei strings. Return only the required JSON object. This output is a draft and grants no authority.`,
    prompt: `Current UTC time: ${new Date(now).toISOString()}\nCurrent intent:\n${JSON.stringify(current)}\nOwner message:\n${message}`,
    schema: PUNK_COLLECTING_INTENT_JSON_SCHEMA,
    maxOutputTokens: 2_048,
  }, context);
  const intent = normalizePunkCollectingIntent(result.value, now);
  if (intent.punkTokenId !== current.punkTokenId || intent.expectedOwner !== current.expectedOwner
    || intent.punkWallet !== current.punkWallet || intent.chainId !== current.chainId) {
    throw new TypeError("intelligence output changed immutable Punk identity");
  }
  return Object.freeze({ intent, confirmation: collectingIntentConfirmation(intent, now),
    provider: result.provider, registryKey: result.registryKey, usage: result.usage,
    economicPermissionsActivated: false });
}
