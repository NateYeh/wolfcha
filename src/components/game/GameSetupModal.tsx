"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SoundSettingsSection } from "@/components/game/SettingsModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import { ROSTER_POOL_IDS } from "@/lib/roster-pool-ids";
import { hasBuiltInParams, resolveAvailableModelRefs } from "@/lib/model-pool";
import {
  getGatewayModels,
  getPlayerModelPool,
  setGatewayModels,
  setPlayerModelPool,
} from "@/lib/api-keys";
import {
  getTokendanceApiKey,
  getTokendanceBaseUrl,
  setTokendanceApiKey,
  setTokendanceBaseUrl,
} from "@/lib/api-keys";
import { DEFAULT_GATEWAY_BASE_URL, normalizeGatewayBaseUrl } from "@/lib/gateway-url";
import { PLAYER_MODELS, filterPlayerModels, type Role } from "@/types/game";

/** Return the unique roles present in the default configuration for a given player count. */
function getAvailableRoles(playerCount: number): Role[] {
  const configs: Record<number, Role[]> = {
    8: ["Werewolf", "Seer", "Witch", "Hunter", "Villager"],
    9: ["Werewolf", "Seer", "Witch", "Hunter", "Villager"],
    10: ["Werewolf", "WhiteWolfKing", "Seer", "Witch", "Hunter", "Guard", "Villager"],
    11: ["Werewolf", "WhiteWolfKing", "Seer", "Witch", "Hunter", "Guard", "Idiot", "Villager"],
    12: ["Werewolf", "WhiteWolfKing", "Seer", "Witch", "Hunter", "Guard", "Idiot", "Villager"],
  };
  return configs[playerCount] ?? configs[10];
}

interface GameSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerCount: number;
  onPlayerCountChange: (value: number) => void;
  preferredRole: Role | "";
  onPreferredRoleChange: (value: Role | "") => void;
  isGenshinMode: boolean;
  onGenshinModeChange: (value: boolean) => void;
  rosterPoolId: string;
  onRosterPoolChange: (value: string) => void;
  isSpectatorMode: boolean;
  onSpectatorModeChange: (value: boolean) => void;
  isAcquaintanceGame: boolean;
  onAcquaintanceModeChange: (value: boolean) => void;
  bgmVolume: number;
  isSoundEnabled: boolean;
  isAiVoiceEnabled: boolean;
  isAutoAdvanceDialogueEnabled: boolean;
  onBgmVolumeChange: (value: number) => void;
  onSoundEnabledChange: (value: boolean) => void;
  onAiVoiceEnabledChange: (value: boolean) => void;
  onAutoAdvanceDialogueEnabledChange: (value: boolean) => void;
}


export function GameSetupModal({
  open,
  onOpenChange,
  playerCount,
  onPlayerCountChange,
  preferredRole,
  onPreferredRoleChange,
  isGenshinMode,
  onGenshinModeChange,
  rosterPoolId,
  onRosterPoolChange,
  isSpectatorMode,
  onSpectatorModeChange,
  isAcquaintanceGame,
  onAcquaintanceModeChange,
  bgmVolume,
  isSoundEnabled,
  isAiVoiceEnabled,
  isAutoAdvanceDialogueEnabled,
  onBgmVolumeChange,
  onSoundEnabledChange,
  onAiVoiceEnabledChange,
  onAutoAdvanceDialogueEnabledChange,
}: GameSetupModalProps) {
  const t = useTranslations();

  const PLAYER_COUNT_OPTIONS = [
    { value: 8, label: t("gameSetup.playerCount.8.title"), description: t("gameSetup.playerCount.8.description"), roles: t("gameSetup.playerCount.8.roles") },
    { value: 9, label: t("gameSetup.playerCount.9.title"), description: t("gameSetup.playerCount.9.description"), roles: t("gameSetup.playerCount.9.roles") },
    { value: 10, label: t("gameSetup.playerCount.10.title"), description: t("gameSetup.playerCount.10.description"), roles: t("gameSetup.playerCount.10.roles") },
    { value: 11, label: t("gameSetup.playerCount.11.title"), description: t("gameSetup.playerCount.11.description"), roles: t("gameSetup.playerCount.11.roles") },
    { value: 12, label: t("gameSetup.playerCount.12.title"), description: t("gameSetup.playerCount.12.description"), roles: t("gameSetup.playerCount.12.roles") },
  ];

  const roleLabels = useMemo<Record<Role, string>>(
    () => ({
      Villager: t("roles.villager"),
      Werewolf: t("roles.werewolf"),
      WhiteWolfKing: t("roles.whiteWolfKing"),
      Seer: t("roles.seer"),
      Witch: t("roles.witch"),
      Hunter: t("roles.hunter"),
      Guard: t("roles.guard"),
      Idiot: t("roles.idiot"),
    }),
    [t]
  );

  const roleDescriptions = useMemo<Record<Role, string>>(
    () => ({
      Villager: t("gameSetup.rolePreference.desc.villager"),
      Werewolf: t("gameSetup.rolePreference.desc.werewolf"),
      WhiteWolfKing: t("gameSetup.rolePreference.desc.whiteWolfKing"),
      Seer: t("gameSetup.rolePreference.desc.seer"),
      Witch: t("gameSetup.rolePreference.desc.witch"),
      Hunter: t("gameSetup.rolePreference.desc.hunter"),
      Guard: t("gameSetup.rolePreference.desc.guard"),
      Idiot: t("gameSetup.rolePreference.desc.idiot"),
    }),
    [t]
  );

  const availableRoles = useMemo(() => getAvailableRoles(playerCount), [playerCount]);

  // AI 玩家模型池：存放使用者在「設定」裡勾選的模型 id（空＝全部可用）。
  // 惰性初始化直接讀 localStorage；之後每次變更都同步寫回，因此不需要 effect 同步。
  const [modelPool, setModelPool] = useState<string[]>(() => getPlayerModelPool());
  const [modelPoolNotice, setModelPoolNotice] = useState("");
  // AI 服務連線：自帶 gateway（伺服器位址 + Key），同樣只存在本機瀏覽器。
  const [gatewayBaseUrl, setGatewayBaseUrlState] = useState(() => getTokendanceBaseUrl());
  const [gatewayKey, setGatewayKeyState] = useState(() => getTokendanceApiKey());
  // 自帶 gateway 回報的模型清單（抓過才有）；這份清單就是模型池的來源。
  const [gatewayModels, setGatewayModelsState] = useState<string[]>(() => getGatewayModels());

  // 模型池來源：抓過閘道器清單就以它為準（閘道器之後新增模型不必再改程式碼），
  // 還沒抓過才用內建清單；未內建的模型走自帶閘道器通道並使用預設參數。
  const builtinModelOptions = useMemo(() => filterPlayerModels(PLAYER_MODELS), []);
  const playerModelOptions = useMemo(
    () => resolveAvailableModelRefs(gatewayModels, builtinModelOptions),
    [gatewayModels, builtinModelOptions],
  );
  const [connectionState, setConnectionState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [connectionMessage, setConnectionMessage] = useState("");
  // gateway 有清單、但沒有內建參數的模型（會用預設 temperature／reasoning）。
  const gatewayOnlyModels = useMemo(
    () => gatewayModels.filter((model) => !hasBuiltInParams(model)),
    [gatewayModels],
  );
  // 空字串＝還沒設定（不是錯誤）；其餘才驗格式。
  const baseUrlCheck = useMemo(() => normalizeGatewayBaseUrl(gatewayBaseUrl.trim()), [gatewayBaseUrl]);
  // 伺服器不再提供位址與金鑰：兩者都填了才算設定完成。
  const gatewayConfigured = baseUrlCheck.ok && gatewayKey.trim().length > 0;

  const handleBaseUrlChange = (value: string) => {
    setGatewayBaseUrlState(value);
    setConnectionState("idle");
    setConnectionMessage("");
    if (!value.trim()) {
      // 清空＝沒有設定 gateway
      setTokendanceBaseUrl("");
      return;
    }
    const check = normalizeGatewayBaseUrl(value);
    // 只在合法時寫入，避免把無效位址存進設定而之後每次開局都打不通
    if (check.ok) setTokendanceBaseUrl(check.url);
  };

  const handleGatewayKeyChange = (value: string) => {
    setGatewayKeyState(value);
    setConnectionState("idle");
    setConnectionMessage("");
    setTokendanceApiKey(value.trim());
  };

  const handleTestConnection = async () => {
    const check = normalizeGatewayBaseUrl(gatewayBaseUrl.trim());
    if (!check.ok) {
      setConnectionState("fail");
      setConnectionMessage(t(`gameSetup.connection.invalid.${check.reason}`));
      return;
    }
    setConnectionState("testing");
    setConnectionMessage("");
    try {
      // 連線測試改抓模型清單（GET /models）：不會因為「探針模型不在道閘道器上」誤判失敗，
      // 順便拿到該閘道器實際提供的模型，可用來更新模型池。
      const response = await fetch("/api/gateway-models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tokendance-Api-Key": gatewayKey.trim(),
          "X-Tokendance-Base-Url": check.url,
        },
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; models?: string[]; count?: number }
        | null;
      if (data?.ok && data.models?.length) {
        setGatewayModels(data.models);
        setGatewayModelsState(data.models);
        setConnectionState("ok");
        setConnectionMessage(t("gameSetup.connection.okWithModels", { count: data.models.length }));
        // 已勾選但閘道器沒有的模型要剔除，否則開局一定會打不通。
        if (modelPool.length > 0) {
          const available = modelPool.filter((model) => data.models?.includes(model));
          if (available.length !== modelPool.length) applyModelPool(available);
        }
        return;
      }
      setConnectionState("fail");
      setConnectionMessage(data?.error || t("gameSetup.connection.fail"));
    } catch (error) {
      console.error("[GameSetupModal] 讀取模型清單失敗", error);
      setConnectionState("fail");
      setConnectionMessage(t("gameSetup.connection.fail"));
    }
  };

  const applyModelPool = (next: string[]) => {
    // 全選時收斂成空陣列（＝全部），避免與「未勾選」語意混淆。
    const allSelected = playerModelOptions.length > 0 && next.length >= playerModelOptions.length;
    const stored = allSelected ? [] : next;
    setPlayerModelPool(stored);
    setModelPool(stored);
  };

  const toggleModel = (model: string) => {
    const current = modelPool.length === 0 ? playerModelOptions.map((ref) => ref.model) : modelPool;
    const next = current.includes(model) ? current.filter((item) => item !== model) : [...current, model];
    if (next.length === 0) {
      setModelPoolNotice(t("gameSetup.modelPool.minOne"));
      return;
    }
    setModelPoolNotice("");
    applyModelPool(next);
  };
  // Reset preferred role if it's no longer available for the current player count
  const effectivePreferredRole = preferredRole && availableRoles.includes(preferredRole) ? preferredRole : "";

  useEffect(() => {
    if (preferredRole && !availableRoles.includes(preferredRole)) {
      onPreferredRoleChange("");
    }
  }, [preferredRole, availableRoles, onPreferredRoleChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-[var(--text-primary)]">{t("gameSetup.title")}</DialogTitle>
          <DialogDescription className="text-[var(--text-muted)]">
            {t("gameSetup.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <div className="text-sm font-medium text-[var(--text-primary)]">{t("gameSetup.playerCountLabel")}</div>
            <Select
              value={String(playerCount)}
              onValueChange={(value) => onPlayerCountChange(Number(value))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("gameSetup.selectPlayerCount")} />
              </SelectTrigger>
              <SelectContent>
                {PLAYER_COUNT_OPTIONS.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={String(option.value)}
                    label={option.label}
                    description={`${option.description}｜${option.roles}`}
                  />
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isGenshinMode && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-[var(--text-primary)]">{t("gameSetup.rosterPool.label")}</div>
              <Select value={rosterPoolId} onValueChange={onRosterPoolChange}>
                <SelectTrigger>
                  <SelectValue placeholder={t("gameSetup.rosterPool.label")} />
                </SelectTrigger>
                <SelectContent>
                  {ROSTER_POOL_IDS.map((poolId) => (
                    <SelectItem key={poolId} value={poolId} label={t(`rosterPools.${poolId}.name`)} />
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!isSpectatorMode && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-[var(--text-primary)]">{t("gameSetup.rolePreference.label")}</div>
              <Select
                value={effectivePreferredRole || "_random"}
                onValueChange={(value) => onPreferredRoleChange(value === "_random" ? "" : (value as Role))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("gameSetup.rolePreference.random")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="_random"
                    label={t("gameSetup.rolePreference.random")}
                    description={t("gameSetup.rolePreference.randomDesc")}
                  />
                  {availableRoles.map((role) => (
                    <SelectItem
                      key={role}
                      value={role}
                      label={roleLabels[role]}
                      description={roleDescriptions[role]}
                    />
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-[var(--text-muted)]">
                {t("gameSetup.rolePreference.hint")}
              </div>
            </div>
          )}

          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[var(--text-primary)]">{t("gameSetup.genshinMode.title")}</div>
            <div className="text-xs text-[var(--text-muted)]">
              {t("gameSetup.genshinMode.description")}
            </div>
            </div>
            <Switch className="shrink-0 mt-1" checked={isGenshinMode} onCheckedChange={onGenshinModeChange} />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[var(--text-primary)]">{t("gameSetup.spectatorMode.title")}</div>
            <div className="text-xs text-[var(--text-muted)]">
              {t("gameSetup.spectatorMode.description")}
            </div>
            </div>
            <Switch className="shrink-0 mt-1" checked={isSpectatorMode} onCheckedChange={onSpectatorModeChange} />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[var(--text-primary)]">{t("gameSetup.acquaintanceMode.title")}</div>
            <div className="text-xs text-[var(--text-muted)]">
              {t("gameSetup.acquaintanceMode.description")}
            </div>
            </div>
            <Switch className="shrink-0 mt-1" checked={isAcquaintanceGame} onCheckedChange={onAcquaintanceModeChange} />
          </div>

          <div className="border-t border-[var(--border-color)] pt-4">
            <div className="text-sm font-medium text-[var(--text-primary)]">{t("gameSetup.connection.title")}</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">{t("gameSetup.connection.description")}</div>
            <div className="mt-2 space-y-2">
              <div className="space-y-1">
                <div className="text-xs text-[var(--text-muted)]">{t("gameSetup.connection.baseUrlLabel")}</div>
                <Input
                  value={gatewayBaseUrl}
                  onChange={(event) => handleBaseUrlChange(event.target.value)}
                  placeholder={DEFAULT_GATEWAY_BASE_URL}
                  aria-label={t("gameSetup.connection.baseUrlLabel")}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-[var(--text-muted)]">{t("gameSetup.connection.keyLabel")}</div>
                <Input
                  type="password"
                  value={gatewayKey}
                  onChange={(event) => handleGatewayKeyChange(event.target.value)}
                  placeholder={t("gameSetup.connection.keyPlaceholder")}
                  aria-label={t("gameSetup.connection.keyLabel")}
                  className="h-8 text-xs"
                  autoComplete="new-password"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={connectionState === "testing" || !gatewayKey.trim() || !baseUrlCheck.ok}
                  onClick={() => void handleTestConnection()}
                >
                  {connectionState === "testing" ? t("gameSetup.connection.testing") : t("gameSetup.connection.testAndFetch")}
                </Button>
                {connectionMessage ? (
                  <span className={connectionState === "ok" ? "text-xs text-[var(--color-success)]" : "text-xs text-[var(--color-warning,#c0392b)]"}>
                    {connectionMessage}
                  </span>
                ) : null}
              </div>
              {gatewayBaseUrl.trim() && !baseUrlCheck.ok ? (
                <div className="text-xs text-[var(--color-warning,#c0392b)]">
                  {t(`gameSetup.connection.invalid.${baseUrlCheck.reason}`)}
                </div>
              ) : null}
              {!gatewayConfigured && (!gatewayBaseUrl.trim() || baseUrlCheck.ok) ? (
                <div className="text-xs text-[var(--color-warning,#c0392b)]">
                  {t("gameSetup.connection.notConfigured")}
                </div>
              ) : null}
              {gatewayModels.length > 0 ? (
                <div className="text-xs text-[var(--text-muted)]">
                  {t("gameSetup.connection.listHint", { count: gatewayModels.length })}
                </div>
              ) : null}
            </div>
          </div>

          <div className="border-t border-[var(--border-color)] pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-[var(--text-primary)]">{t("gameSetup.modelPool.title")}</div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setModelPoolNotice(""); applyModelPool([]); }}
              >
                {t("gameSetup.modelPool.all")}
              </Button>
            </div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {t("gameSetup.modelPool.description")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {playerModelOptions.map((ref) => {
                const active = modelPool.length === 0 || modelPool.includes(ref.model);
                return (
                  <button
                    key={`${ref.provider}:${ref.model}`}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleModel(ref.model)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-[var(--color-accent)] text-[var(--text-primary)]"
                        : "border-[var(--border-color)] text-[var(--text-muted)] opacity-60"
                    }`}
                  >
                    {ref.model}
                  </button>
                );
              })}
            </div>
            {gatewayOnlyModels.length > 0 ? (
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {t("gameSetup.connection.gatewayOnly", { models: gatewayOnlyModels.join("、") })}
              </div>
            ) : null}
            <div className="mt-2 text-xs text-[var(--text-muted)]">
              {modelPoolNotice
                ? <span className="text-[var(--color-warning,#c0392b)]">{modelPoolNotice}</span>
                : t("gameSetup.modelPool.summary", {
                    count: modelPool.length === 0 ? playerModelOptions.length : modelPool.length,
                    total: playerModelOptions.length,
                  })}
            </div>
          </div>

          <div className="border-t border-[var(--border-color)] pt-4">
            <div className="text-sm font-medium text-[var(--text-primary)] mb-3">{t("gameSetup.soundLabel")}</div>
            <SoundSettingsSection
              bgmVolume={bgmVolume}
              isSoundEnabled={isSoundEnabled}
              isAiVoiceEnabled={isAiVoiceEnabled}
              isAutoAdvanceDialogueEnabled={isAutoAdvanceDialogueEnabled}
              onBgmVolumeChange={onBgmVolumeChange}
              onSoundEnabledChange={onSoundEnabledChange}
              onAiVoiceEnabledChange={onAiVoiceEnabledChange}
              onAutoAdvanceDialogueEnabledChange={onAutoAdvanceDialogueEnabledChange}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
