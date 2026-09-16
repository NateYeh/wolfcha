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
  deleteCustomScenario,
  loadCustomScenarios,
  saveCustomScenario,
} from "@/lib/custom-scenarios";
import type { CharacterPoolStatus } from "@/lib/character-pool-refill";
import type { GameScenario, Role } from "@/types/game";

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
  const [customScenarios, setCustomScenarios] = useState<GameScenario[]>([]);
  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [customRoles, setCustomRoles] = useState("");

  // 開啟設定時載入自訂情境清單，並同步目前池綁定的情境。
  useEffect(() => {
    if (!open) return;
    // setState 包在 requestAnimationFrame：避開 effect 內同步 setState 的串聯渲染。
    const frame = requestAnimationFrame(() => {
      setCustomScenarios(loadCustomScenarios());
      setSelectedScenarioId(characterPool.scenarioId ?? "random");
    });
    return () => cancelAnimationFrame(frame);
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
    const saved = saveCustomScenario({
      title: customName,
      description: customDesc,
      rolesHint: customRoles,
    });
    if (!saved) return;
    setCustomScenarios(loadCustomScenarios());
    setCustomName("");
    setCustomDesc("");
    setCustomRoles("");
    setSelectedScenarioId(saved.id);
    onRebuildWithScenario(saved);
  };

  const handleDeleteCustom = () => {
    if (!selectedScenarioId.startsWith("custom_")) return;
    deleteCustomScenario(selectedScenarioId);
    setCustomScenarios(loadCustomScenarios());
    setSelectedScenarioId("random");
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
      <DialogContent className="w-[92vw] max-w-md">
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
                disabled={characterPool.refilling}
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
