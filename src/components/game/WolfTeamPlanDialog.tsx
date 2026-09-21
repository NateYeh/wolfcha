"use client";

import { useState } from "react";
import { WerewolfIcon } from "@/components/icons/FlatIcons";
import type { GameState, Player } from "@/types/game";
import { isWolfRole } from "@/types/game";
import type { HumanWolfTeamPlanChoice } from "@/lib/game-master";
import { useTranslations } from "next-intl";

/** 狼隊分工代碼：與 WolfTeamPlan.postures 的白名單一致。 */
type WolfPosture = "jump" | "charge" | "hook" | "deep";

const POSTURES: WolfPosture[] = ["jump", "charge", "hook", "deep"];

interface WolfTeamPlanDialogProps {
  gameState: GameState;
  humanPlayer: Player;
  onSubmit: (choice: HumanWolfTeamPlanChoice) => void;
  onDelegate: () => void;
}

/**
 * 真人狼的第一夜分工對話框：取代 AI 主導狼，由真人指派誰悍跳、誰上警、各自分工。
 * 填完後交給 buildHumanWolfTeamPlan 清洗（非法座位／代碼一律降級），不在此重複驗證。
 */
export function WolfTeamPlanDialog({
  gameState,
  humanPlayer,
  onSubmit,
  onDelegate,
}: WolfTeamPlanDialogProps) {
  const t = useTranslations();
  const wolves = gameState.players.filter((p) => isWolfRole(p.role) && p.alive);
  const [postures, setPostures] = useState<Record<number, WolfPosture>>(() =>
    Object.fromEntries(wolves.map((wolf) => [wolf.seat, "deep" as WolfPosture]))
  );
  const [signup, setSignup] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState("");
  const [delegating, setDelegating] = useState(false);

  /** 悍跳全場只留一個：點別人悍跳時，原悍跳者退回潛伏。 */
  const pickPosture = (seat: number, code: WolfPosture) => {
    setPostures((prev) => {
      const next: Record<number, WolfPosture> = { ...prev };
      if (code === "jump") {
        for (const key of Object.keys(next)) {
          if (next[Number(key)] === "jump" && Number(key) !== seat) next[Number(key)] = "deep";
        }
      }
      next[seat] = code;
      return next;
    });
  };

  const jumpSeat = wolves.find((wolf) => postures[wolf.seat] === "jump")?.seat ?? null;

  const handleConfirm = () => {
    onSubmit({
      jumpSeat: jumpSeat === null ? 0 : jumpSeat + 1,
      signupSeats: wolves.filter((wolf) => signup[wolf.seat]).map((wolf) => wolf.seat + 1),
      postures: Object.fromEntries(
        wolves.map((wolf) => [String(wolf.seat + 1), postures[wolf.seat] ?? "deep"])
      ),
      reason,
    });
  };

  const handleDelegate = () => {
    setDelegating(true);
    onDelegate();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg border border-[#3e2723] bg-[#1a1512] p-5 text-[#f0e6d2]">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-wolf)]">
            <WerewolfIcon size={16} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-bold">{t("wolfTeamPlanDialog.title")}</div>
            <div className="text-xs text-[#a09080]">
              {t("wolfTeamPlanDialog.subtitle", {
                seat: humanPlayer.seat + 1,
                name: humanPlayer.displayName,
              })}
            </div>
          </div>
        </div>

        <div className="mb-3 text-xs leading-relaxed text-[#a09080]">
          {t("wolfTeamPlanDialog.legend")}
        </div>

        <div className="flex flex-col gap-2">
          {wolves.map((wolf) => (
            <div
              key={wolf.playerId}
              className={`flex flex-wrap items-center gap-2 rounded p-2 ${
                wolf.isHuman ? "bg-[#3e2723]" : "bg-[#2a201a]"
              }`}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-wolf)] text-[10px] font-bold text-white">
                {wolf.seat + 1}
              </div>
              <span className="min-w-0 flex-1 truncate text-xs sm:text-sm">
                {wolf.isHuman ? t("wolfTeamPlanDialog.you") : wolf.displayName}
              </span>
              <div className="flex gap-1">
                {POSTURES.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => pickPosture(wolf.seat, code)}
                    className={`rounded px-2 py-1 text-[11px] transition-colors ${
                      postures[wolf.seat] === code
                        ? "bg-[var(--color-wolf)] text-white"
                        : "bg-[#1a1512] text-[#a09080] hover:text-[#f0e6d2]"
                    }`}
                  >
                    {t(`wolfTeamPlanDialog.posture.${code}` as Parameters<typeof t>[0])}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setSignup((prev) => ({ ...prev, [wolf.seat]: !prev[wolf.seat] }))
                }
                className={`rounded px-2 py-1 text-[11px] transition-colors ${
                  signup[wolf.seat]
                    ? "bg-[#8d6e63] text-white"
                    : "bg-[#1a1512] text-[#a09080] hover:text-[#f0e6d2]"
                }`}
              >
                {t("wolfTeamPlanDialog.signup")}
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 text-xs text-[#a09080]">{t("wolfTeamPlanDialog.hint")}</div>

        <div className="mt-4">
          <div className="mb-1 text-xs text-[#a09080]">{t("wolfTeamPlanDialog.reasonLabel")}</div>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={60}
            placeholder={t("wolfTeamPlanDialog.reasonPlaceholder")}
            className="w-full rounded border border-[#3e2723] bg-[#120e0c] px-2 py-1 text-sm text-[#f0e6d2] outline-none placeholder:text-[#6b5a4d]"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleDelegate}
            disabled={delegating}
            className="rounded border border-[#3e2723] px-3 py-2 text-xs text-[#a09080] transition-colors hover:text-[#f0e6d2] disabled:opacity-50"
          >
            {t("wolfTeamPlanDialog.delegate")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded bg-[var(--color-wolf)] px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
          >
            {t("wolfTeamPlanDialog.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
