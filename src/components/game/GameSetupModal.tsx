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
import { getScenarios } from "@/lib/scenarios";
import {
  deleteCustomScenarioRemote,
  fetchCustomScenariosRemote,
  saveCustomScenarioRemote,
} from "@/lib/character-pool-api";
import { hasBuiltInParams, resolveAvailableModelRefs } from "@/lib/model-pool";
import type { CharacterPoolStatus } from "@/lib/character-pool-refill";
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
import { PLAYER_MODELS, filterPlayerModels, type GameScenario, type Role } from "@/types/game";

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
  isSpectatorMode: boolean;
  onSpectatorModeChange: (value: boolean) => void;
  bgmVolume: number;
  isSoundEnabled: boolean;
  isAiVoiceEnabled: boolean;
  isAutoAdvanceDialogueEnabled: boolean;
  onBgmVolumeChange: (value: number) => void;
  onSoundEnabledChange: (value: boolean) => void;
  onAiVoiceEnabledChange: (value: boolean) => void;
  onAutoAdvanceDialogueEnabledChange: (value: boolean) => void;
  /** 角色池狀態（預先生成的角色，開局直接抽用）。 */
  characterPool: CharacterPoolStatus;
  characterPoolError: string | null;
  onRefillCharacterPool: () => void;
  onRebuildCharacterPool: () => void;
  /** 綁定指定情境並重建整池（自訂情境或內建情境）。 */
  onRebuildWithScenario: (scenario: GameScenario) => void;
  /** 固定班底：開啟後不再自動生成新角色。 */
  onCharacterPoolLockChange: (locked: boolean) => void;
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
  isSpectatorMode,
  onSpectatorModeChange,
  bgmVolume,
  isSoundEnabled,
  isAiVoiceEnabled,
  isAutoAdvanceDialogueEnabled,
  onBgmVolumeChange,
  onSoundEnabledChange,
  onAiVoiceEnabledChange,
  onAutoAdvanceDialogueEnabledChange,
  characterPool,
  characterPoolError,
  onRefillCharacterPool,
  onRebuildCharacterPool,
  onRebuildWithScenario,
  onCharacterPoolLockChange,
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

  // 情境選擇與自訂情境表單：選定後按「換情境重建」生效。
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("random");
  // AI 玩家模型池：存放使用者在「設定」裡勾選的模型 id（空＝全部可用）。
  // 惰性初始化直接讀 localStorage；之後每次變更都同步寫回，因此不需要 effect 同步。
  const [modelPool, setModelPool] = useState<string[]>(() => getPlayerModelPool());
  const [modelPoolNotice, setModelPoolNotice] = useState("");
  // AI 服務連線：自帶 gateway（伺服器位址 + Key），同樣只存在本機瀏覽器。
  const [gatewayBaseUrl, setGatewayBaseUrlState] = useState(() => {
    const current = getTokendanceBaseUrl();
    return current === DEFAULT_GATEWAY_BASE_URL ? "" : current;
  });
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
  const baseUrlCheck = useMemo(
    () => normalizeGatewayBaseUrl(gatewayBaseUrl.trim() || DEFAULT_GATEWAY_BASE_URL),
    [gatewayBaseUrl],
  );

  const handleBaseUrlChange = (value: string) => {
    setGatewayBaseUrlState(value);
    setConnectionState("idle");
    setConnectionMessage("");
    if (!value.trim()) {
      // 清空＝回到出廠預設 gateway
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
    const check = normalizeGatewayBaseUrl(gatewayBaseUrl.trim() || DEFAULT_GATEWAY_BASE_URL);
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
  const [customScenarios, setCustomScenarios] = useState<GameScenario[]>([]);
  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [customRoles, setCustomRoles] = useState("");

  // 開啟設定時載入自訂情境清單（伺服器），並同步目前池綁定的情境。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const scenarios = await fetchCustomScenariosRemote();
      if (cancelled) return;
      setCustomScenarios(scenarios);
      setSelectedScenarioId(characterPool.scenarioId ?? "random");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, characterPool.scenarioId]);

  const allScenarios = useMemo(() => [...getScenarios(), ...customScenarios], [customScenarios]);

  const handleRebuildSelected = () => {
    if (selectedScenarioId === "random") {
      onRebuildCharacterPool();
      return;
    }
    const scenario = allScenarios.find((item) => item.id === selectedScenarioId);
    if (scenario) onRebuildWithScenario(scenario);
  };

  const canSaveCustom =
    customName.trim() !== "" && customDesc.trim() !== "" && customRoles.trim() !== "";
  const handleSaveCustom = () => {
    void (async () => {
      const saved = await saveCustomScenarioRemote({
        title: customName,
        description: customDesc,
        rolesHint: customRoles,
      });
      if (!saved) return;
      setCustomScenarios(await fetchCustomScenariosRemote());
      setCustomName("");
      setCustomDesc("");
      setCustomRoles("");
      setSelectedScenarioId(saved.id);
      onRebuildWithScenario(saved);
    })();
  };

  const handleDeleteCustom = () => {
    if (!selectedScenarioId.startsWith("custom_")) return;
    void (async () => {
      await deleteCustomScenarioRemote(selectedScenarioId);
      setCustomScenarios(await fetchCustomScenariosRemote());
      setSelectedScenarioId("random");
    })();
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

          <div className="border-t border-[var(--border-color)] pt-4">
            <div className="text-sm font-medium text-[var(--text-primary)]">{t("gameSetup.characterPool.title")}</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {characterPool.scenarioTitle
                ? t("gameSetup.characterPool.status", {
                    unused: characterPool.unused,
                    target: characterPool.target,
                    scenario: characterPool.scenarioTitle,
                  })
                : t("gameSetup.characterPool.empty")}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select value={selectedScenarioId} onValueChange={setSelectedScenarioId}>
                <SelectTrigger className="h-8 w-full text-xs sm:w-[280px]">
                  <SelectValue placeholder={t("gameSetup.characterPool.scenarioLabel")} />
                </SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  <SelectItem value="random">{t("gameSetup.characterPool.scenarioRandom")}</SelectItem>
                  <SelectGroup>
                    <SelectLabel>{t("gameSetup.characterPool.builtinGroup")}</SelectLabel>
                    {getScenarios().map((scenario) => (
                      <SelectItem key={scenario.id} value={scenario.id}>
                        {scenario.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {customScenarios.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>{t("gameSetup.characterPool.customGroup")}</SelectLabel>
                      {customScenarios.map((scenario) => (
                        <SelectItem key={scenario.id} value={scenario.id}>
                          {scenario.title}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={characterPool.refilling || characterPool.locked}
                onClick={onRefillCharacterPool}
              >
                {characterPool.refilling
                  ? t("gameSetup.characterPool.refilling")
                  : t("gameSetup.characterPool.refill")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                disabled={characterPool.refilling}
                onClick={handleRebuildSelected}
              >
                {t("gameSetup.characterPool.rebuild")}
              </Button>
              {selectedScenarioId.startsWith("custom_") && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-[var(--text-muted)]"
                  onClick={handleDeleteCustom}
                >
                  {t("gameSetup.characterPool.customDelete")}
                </Button>
              )}
            </div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {t("gameSetup.characterPool.scenarioSelectHint")}
            </div>

            {/* 固定班底：开启后不再自动生成，只用目前名单轮替 */}
            <div className="mt-3 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-[var(--text-primary)]">
                  {t("gameSetup.characterPool.lockedTitle")}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {characterPool.locked
                    ? t("gameSetup.characterPool.lockedOn")
                    : t("gameSetup.characterPool.lockedDescription")}
                </div>
              </div>
              <Switch
                className="shrink-0 mt-1"
                checked={characterPool.locked}
                onCheckedChange={onCharacterPoolLockChange}
                aria-label={t("gameSetup.characterPool.lockedTitle")}
              />
            </div>

            {/* 自訂情境表單：填好按「儲存並重建」，角色池會改用該情境生成 */}
            <div className="mt-3 space-y-2">
              <div className="text-xs font-medium text-[var(--text-primary)]">
                {t("gameSetup.characterPool.customHeading")}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  placeholder={t("gameSetup.characterPool.customNamePlaceholder")}
                  aria-label={t("gameSetup.characterPool.customName")}
                  maxLength={30}
                  className="h-8 text-xs"
                />
                <Input
                  value={customRoles}
                  onChange={(event) => setCustomRoles(event.target.value)}
                  placeholder={t("gameSetup.characterPool.customRolesPlaceholder")}
                  aria-label={t("gameSetup.characterPool.customRoles")}
                  maxLength={200}
                  className="h-8 text-xs"
                />
              </div>
              <textarea
                value={customDesc}
                onChange={(event) => setCustomDesc(event.target.value)}
                placeholder={t("gameSetup.characterPool.customDescPlaceholder")}
                aria-label={t("gameSetup.characterPool.customDesc")}
                rows={2}
                maxLength={400}
                className="w-full rounded-sm border border-[var(--border-color)] bg-transparent px-2 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
              <div>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!canSaveCustom || characterPool.refilling}
                  onClick={handleSaveCustom}
                >
                  {t("gameSetup.characterPool.customAdd")}
                </Button>
              </div>
            </div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">
              {characterPoolError
                ? t("gameSetup.characterPool.failed")
                : t("gameSetup.characterPool.hint")}
            </div>
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
              {!baseUrlCheck.ok && gatewayBaseUrl.trim() ? (
                <div className="text-xs text-[var(--color-warning,#c0392b)]">
                  {t(`gameSetup.connection.invalid.${baseUrlCheck.reason}`)}
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
