import { getAddress } from "viem";
import { getAdminExportToken } from "./_shared/config.mjs";
import { listCaptures } from "./_shared/database.mjs";
import { PublicError, publicFailure } from "./_shared/http.mjs";
import { safeEqual } from "./_shared/session.mjs";

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values) {
  return `${values.map(csvCell).join(",")}\n`;
}

function authorize(request) {
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !safeEqual(supplied, getAdminExportToken())) {
    throw new PublicError(401, "UNAUTHORIZED", "A valid export token is required.");
  }
}

function csvResponse(body, filename) {
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "text/csv; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

export default async function handler(request) {
  try {
    authorize(request);
    const captures = await listCaptures();
    const path = new URL(request.url).pathname;
    if (path === "/api/admin/gtd-export.csv") {
      const output = captures
        .map((row) =>
          csvRow([getAddress(row.wallet_address), row.allocation_limit, "0"]),
        )
        .join("");
      return csvResponse(output, "gogh-punks-gtd-opensea.csv");
    }
    if (path === "/api/admin/gtd-captures.csv") {
      let output = csvRow([
        "wallet",
        "discord_user_id",
        "discord_username",
        "discord_display_name",
        "allocation_limit",
        "price_eth",
        "verified_at",
        "role_sync_state",
        "role_synced_at",
      ]);
      for (const row of captures) {
        output += csvRow([
          getAddress(row.wallet_address),
          row.discord_user_id,
          row.discord_username,
          row.discord_display_name,
          row.allocation_limit,
          "0",
          row.verified_at?.toISOString?.() ?? row.verified_at,
          row.role_sync_state,
          row.role_synced_at?.toISOString?.() ?? row.role_synced_at,
        ]);
      }
      return csvResponse(output, "gogh-punks-gtd-captures.csv");
    }
    throw new PublicError(404, "NOT_FOUND", "The export route was not found.");
  } catch (error) {
    return publicFailure(error);
  }
}

export const config = {
  path: ["/api/admin/gtd-export.csv", "/api/admin/gtd-captures.csv"],
  method: "GET",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowLimit: 10,
    windowSize: 60,
  },
};
