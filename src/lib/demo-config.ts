import { fetchWithTimeout, RequestTimeoutError } from "@/lib/request-timeout";

export type DemoModePublicConfigSnapshot = {
  source: "database";
  enabled: boolean;
  active: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  serverNow: string;
};

const DEMO_CONFIG_ENDPOINT = "/api/demo-config";
const DEMO_CONFIG_TIMEOUT_MS = 10_000;

let cachedDemoModeConfig: DemoModePublicConfigSnapshot | null = null;
let inFlightDemoModeConfigRequest: Promise<DemoModePublicConfigSnapshot> | null = null;

export function getDefaultDemoModeConfigSnapshot(now: Date = new Date()): DemoModePublicConfigSnapshot {
  return {
    source: "database",
    enabled: false,
    active: false,
    startsAt: null,
    expiresAt: null,
    serverNow: now.toISOString(),
  };
}

export function getCachedDemoModeConfig(): DemoModePublicConfigSnapshot | null {
  return cachedDemoModeConfig;
}

export function setCachedDemoModeConfig(snapshot: DemoModePublicConfigSnapshot) {
  cachedDemoModeConfig = snapshot;
}

export function isCachedDemoModeActiveClient(): boolean {
  return cachedDemoModeConfig?.active ?? false;
}

// Dev server 編譯／GC 停頓可能造成瞬時逾時；逾時自動重試一次（間隔 1 秒），避免一次卡頓就把開局判成非演示模式。
async function fetchDemoConfigResponse(): Promise<Response> {
  try {
    return await fetchWithTimeout(DEMO_CONFIG_ENDPOINT, {
      method: "GET",
      cache: "no-store",
    }, DEMO_CONFIG_TIMEOUT_MS);
  } catch (error) {
    if (!(error instanceof RequestTimeoutError)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return await fetchWithTimeout(DEMO_CONFIG_ENDPOINT, {
      method: "GET",
      cache: "no-store",
    }, DEMO_CONFIG_TIMEOUT_MS);
  }
}

export async function fetchDemoModeConfigClient(forceRefresh = false): Promise<DemoModePublicConfigSnapshot> {
  if (!forceRefresh && cachedDemoModeConfig) {
    return cachedDemoModeConfig;
  }

  if (!forceRefresh && inFlightDemoModeConfigRequest) {
    return inFlightDemoModeConfigRequest;
  }

  const request = fetchDemoConfigResponse()
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch demo config: ${response.status}`);
      }

      const payload = (await response.json()) as Partial<DemoModePublicConfigSnapshot>;
      const snapshot: DemoModePublicConfigSnapshot = {
        source: "database",
        enabled: payload.enabled === true,
        active: payload.active === true,
        startsAt: typeof payload.startsAt === "string" ? payload.startsAt : null,
        expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null,
        serverNow:
          typeof payload.serverNow === "string"
            ? payload.serverNow
            : new Date().toISOString(),
      };

      setCachedDemoModeConfig(snapshot);
      return snapshot;
    })
    .catch((error) => {
      console.error("[demo-config] Failed to fetch client config", error);
      const fallback = getDefaultDemoModeConfigSnapshot();
      setCachedDemoModeConfig(fallback);
      return fallback;
    })
    .finally(() => {
      if (inFlightDemoModeConfigRequest === request) {
        inFlightDemoModeConfigRequest = null;
      }
    });

  inFlightDemoModeConfigRequest = request;
  return request;
}
