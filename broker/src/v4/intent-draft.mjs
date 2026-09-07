import { collectingIntentConfirmation, defaultAskIntent,
  normalizePunkCollectingIntent } from "./collecting-intent.mjs";

const STYLE_PATTERNS = Object.freeze([
  ["PIXEL_ART", /\bpixel(?:\s+art)?\b/i], ["GENERATIVE", /\bgenerative\b/i],
  ["ABSTRACT", /\babstract\b/i], ["PHOTOGRAPHY", /\bphotograph(?:y|ic)?\b/i],
  ["ANIME", /\banime\b/i], ["PFP", /\bpfps?\b/i],
  ["VAN_GOGH_INSPIRED", /\b(?:van\s+)?gogh(?:-inspired|\s+inspired)?\b/i],
  ["RETRO", /\bretro\b/i], ["THREE_D", /\b3d\b/i], ["CYBERPUNK", /\bcyberpunk\b/i],
  ["CUTE", /\bcute\b/i], ["DARK", /\bdark\b/i], ["WEIRD", /\bweird\b/i],
  ["EXPERIMENTAL", /\bexperimental\b/i], ["MINIMAL", /\bminimal(?:ist)?\b/i],
  ["SURREAL", /\bsurreal\b/i], ["HAND_DRAWN", /\bhand[ -]?drawn\b/i],
]);
const NUMBER_WORDS = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10 });
const ADDRESS = /^0x[0-9a-f]{40}$/;
const SPECIFIC_TARGET = /\b(?:this|that|specific)\s+(?:mint|collection|contract|project)\b|\bonly\s+(?:mint|collect)\s+(?:from\s+)?(?:this|that)\b/i;

function decimalEthToWei(value) {
  if (!/^(?:0|[1-9]\d*|\.\d+|\d+\.\d+)$/.test(value)) throw new TypeError("ETH amount is invalid");
  const [wholeValue, fractionValue = ""] = value.startsWith(".") ? ["0", value.slice(1)] : value.split(".");
  if (fractionValue.length > 18) throw new TypeError("ETH amount has too many decimals");
  return (BigInt(wholeValue) * 10n ** 18n
    + BigInt((fractionValue || "0").padEnd(18, "0"))).toString();
}

function matchEth(text, pattern) {
  const match = text.match(pattern);
  const value = match?.slice(1).find(Boolean);
  return value ? decimalEthToWei(value) : null;
}

function boundedUserText(value) {
  if (typeof value !== "string") throw new TypeError("conversation message is required");
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!text || Buffer.byteLength(text, "utf8") > 8_000) throw new TypeError("conversation message is invalid");
  return text;
}

function count(value) {
  if (/^\d+$/.test(value)) return Number(value);
  return NUMBER_WORDS[value.toLowerCase()] ?? null;
}

export function draftStrategyFromConversation({ message, punkTokenId, expectedOwner, punkWallet,
  currentIntent = null, targetContract = null }, now = new Date()) {
  const text = boundedUserText(message);
  const base = currentIntent
    ? normalizePunkCollectingIntent(currentIntent, now)
    : defaultAskIntent({ punkTokenId, expectedOwner, punkWallet }, now);
  if (String(base.punkTokenId) !== String(punkTokenId)
    || base.expectedOwner !== String(expectedOwner).toLowerCase()
    || base.punkWallet !== String(punkWallet).toLowerCase()) {
    throw new TypeError("Current strategy authority does not match the selected Punk");
  }
  const next = structuredClone(base);
  const changes = [];
  const ambiguous = [];

  if (/\bautonomous(?:ly)?\b|\bgo shopping\b/i.test(text)) {
    next.operatingMode = "AUTONOMOUS"; changes.push("MODE_AUTONOMOUS");
  } else if (/\bassist\b/i.test(text)) {
    next.operatingMode = "ASSIST"; changes.push("MODE_ASSIST");
  } else if (/\bask(?: me)? first\b|\brecommend only\b/i.test(text)) {
    next.operatingMode = "ASK"; changes.push("MODE_ASK");
  }
  if (/\bfree(?: only)?\b|\bfree mints?\b/i.test(text)) {
    next.mintMode = "FREE_ONLY"; next.maxMintPriceWei = "0"; changes.push("FREE_ONLY");
  }
  const reserve = matchEth(text,
    /(?:keep|leave|reserve|minimum reserve(?: of)?)\s+(\.\d+|\d+(?:\.\d+)?)\s*(?:eth|ether)\b/i);
  if (reserve !== null) { next.minimumReserveWei = reserve; changes.push("MINIMUM_RESERVE"); }
  const maxGas = matchEth(text,
    /(?:max(?:imum)?|over|more than|above)\s+(\.\d+|\d+(?:\.\d+)?)\s*(?:eth|ether)\s+(?:of\s+)?gas|(?:gas(?: on a mint)?(?: is| under| below| max(?:imum)?)?)\s+(\.\d+|\d+(?:\.\d+)?)\s*(?:eth|ether)/i);
  if (maxGas !== null) { next.maxGasPerMintWei = maxGas; changes.push("MAX_GAS"); }
  const daily = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,3})\s+(?:max(?:imum)?\s+)?(?:mints?|pieces?|things?)\s+(?:per day|today|daily)\b/i)
    ?? text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,3})\s+max(?:imum)?\s+(?:per day|today|daily)\b/i)
    ?? text.match(/\bmax(?:imum)?\s+(?:of\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,3})\s+(?:per day|today|daily)\b/i);
  if (daily) {
    const value = count(daily[1]);
    if (Number.isInteger(value) && value >= 1 && value <= 100) {
      next.dailyMintLimit = value; changes.push("DAILY_LIMIT");
    } else ambiguous.push("DAILY_LIMIT");
  }
  const total = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,5})\s+(?:(?:free|paid)\s+)?(?:mints?|pieces?|things?)\s+(?:total|overall|for (?:this|the) strategy)\b/i)
    ?? text.match(/\b(?:total|overall|strategy)\s+(?:mint )?(?:limit|max(?:imum)?)\s+(?:of\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,5})\b/i)
    ?? text.match(/\bmax(?:imum)?\s+(?:of\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,5})\s+(?:mints?|pieces?|things?)\s+(?:total|overall)\b/i)
    ?? text.match(/\bmax(?:imum)?\s+(?:of\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,5})\s+mints?\b(?!\s+(?:per day|today|daily))/i)
    ?? text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,5})\s+mints?\s+max(?:imum)?\b(?!\s+(?:per day|today|daily))/i)
    ?? text.match(/\bmax(?:imum)?\s+mints?\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,5})\b/i);
  if (total) {
    const value = count(total[1]);
    if (Number.isInteger(value) && value >= 1 && value <= 10_000) {
      next.totalMintLimit = value; changes.push("TOTAL_LIMIT");
    } else ambiguous.push("TOTAL_LIMIT");
  } else {
    const missionQuantity = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,5})\s+(?:(?:free|paid)\s+)?mints?\b(?!\s+(?:per day|today|daily|total|overall))/i);
    if (missionQuantity) {
      const value = count(missionQuantity[1]);
      if (Number.isInteger(value) && value >= 1 && value <= 10_000) {
        next.totalMintLimit = value; changes.push("TOTAL_LIMIT");
        if (!daily && value <= 100) {
          next.dailyMintLimit = value; changes.push("DAILY_LIMIT");
        }
      } else ambiguous.push("TOTAL_LIMIT");
    } else if (/\b(?:max(?:imum)?\s+mints?|mints?\s+max(?:imum)?)\b/i.test(text)) {
      ambiguous.push("TOTAL_LIMIT");
    }
  }
  const supply = text.match(/(?:supply|collections?)\s*(?:under|below|less than|<|above)?\s*([\d,]+)/i)
    ?? text.match(/(?:nothing|no collections?)\s+(?:above|over)\s+([\d,]+)\s*(?:supply)?/i);
  if (supply) {
    const value = Number(supply[1].replaceAll(",", ""));
    if (Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000_000) {
      next.maximumCollectionSupply = value; changes.push("MAX_SUPPLY");
    } else ambiguous.push("MAX_SUPPLY");
  }
  const onlinePresenceOptional = /\b(?:website|site)(?:\s+(?:and|or|\/))?\s+(?:social(?:\s+(?:profile|account))?|x(?:\s+account)?|twitter)?\s+(?:is|are\s+)?optional\b|\b(?:do\s+not|don't|dont|no\s+need\s+to)\s+require\s+(?:a\s+)?(?:website|site|social(?:\s+(?:profile|account))?)/i.test(text);
  const websiteOrSocial = /\b(?:website|site)\s+(?:or|\/\s*)\s+(?:social(?:\s+(?:profile|account))?|x(?:\s+account)?|twitter)\b|\b(?:social(?:\s+(?:profile|account))?|x(?:\s+account)?|twitter)\s+(?:or|\/\s*)\s+(?:website|site)\b/i.test(text);
  if (onlinePresenceOptional) {
    next.requiresWebsite = false;
    next.requiresSocial = false;
    next.preferredSocialPlatforms = [];
    delete next.onlinePresenceRequirement;
    changes.push("ONLINE_PRESENCE_OPTIONAL");
  } else if (websiteOrSocial) {
    next.requiresWebsite = false;
    next.requiresSocial = false;
    next.preferredSocialPlatforms = [];
    next.onlinePresenceRequirement = "WEBSITE_OR_SOCIAL";
    changes.push("REQUIRE_WEBSITE_OR_SOCIAL");
  } else {
    const websiteRequired = /\b(?:with|requires?|only).*\bwebsite\b|\bwebsite required\b/i.test(text);
    const xRequired = /\b(?:with|requires?|only).*\b(?:x(?: account)?|twitter)\b|\b(?:x account|twitter) required\b/i.test(text);
    if (websiteRequired || xRequired) delete next.onlinePresenceRequirement;
    if (websiteRequired) {
      next.requiresWebsite = true; changes.push("REQUIRE_WEBSITE");
    }
    if (xRequired) {
      next.requiresSocial = true;
      next.preferredSocialPlatforms = [...new Set([...next.preferredSocialPlatforms, "X"])];
      changes.push("REQUIRE_X");
    }
  }
  const prefer = new Set(next.preferences.prefer);
  const avoid = new Set(next.preferences.avoid);
  for (const [style, pattern] of STYLE_PATTERNS) {
    if (!pattern.test(text)) continue;
    const negative = new RegExp(`(?:no|not|don't|dont|stop collecting|avoid|less)\\s+(?:\\w+\\s+){0,2}${pattern.source}`, "i").test(text);
    if (negative) { avoid.add(style); prefer.delete(style); changes.push(`AVOID_${style}`); }
    else { prefer.add(style); avoid.delete(style); changes.push(`PREFER_${style}`); }
  }
  if (SPECIFIC_TARGET.test(text)) {
    const target = String(targetContract ?? "").toLowerCase();
    if (!ADDRESS.test(target)) ambiguous.push("TARGET_CONTRACT");
    else if (next.blockedContracts.includes(target)) ambiguous.push("BLOCKED_TARGET_CONTRACT");
    else {
      next.allowedContracts = [target];
      changes.push("TARGET_CONTRACT");
    }
  }
  next.preferences = { prefer: [...prefer], avoid: [...avoid] };
  next.requireSimulation = true;
  const intent = normalizePunkCollectingIntent(next, now);
  return Object.freeze({
    status: ambiguous.length ? "NEEDS_CLARIFICATION" : "PENDING_OWNER_CONFIRMATION",
    intent, confirmation: collectingIntentConfirmation(intent, now),
    changes: Object.freeze([...new Set(changes)]), ambiguous: Object.freeze(ambiguous),
    economicPermissionsActivated: false,
  });
}
