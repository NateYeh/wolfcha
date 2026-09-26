import type { GameState } from "@/types/game";
import { getI18n } from "@/i18n/translator";
import { getHunterShots } from "@/lib/rules/hunter-shots";

/**
 * 逐日「主持人公開記錄」：只陳述主持人公布過的客觀結果（出局、放逐、自爆、開槍、翻牌）。
 *
 * 為什麼要這一份：賽後感言原本只吃各日 AI 摘要（bullets），而摘要是「主持人公開事實」與
 * 「玩家當時的說法」混在同一串文字裡——模型會把某位玩家當時的錯誤主張當成事實再講一次
 * （例：某局有人說「10號是唯一沒被對跳的預言家」，結果後續感言照抄，但其實當時有對跳）。
 * 因此賽後另附這份純結構化事實，摘要則降級為「各方說法」。
 *
 * 刻意不收錄：夜間私有行動（守人、狼刀、用藥、查驗）與任何玩家說詞。
 */
export function buildPublicRecordForRemark(state: GameState): string[] {
  const { t } = getI18n();
  const lines: string[] = [];

  const days = new Set<number>();
  for (const key of Object.keys(state.nightHistory ?? {})) days.add(Number(key));
  for (const key of Object.keys(state.dayHistory ?? {})) days.add(Number(key));
  for (const key of Object.keys(state.dailySummaries ?? {})) days.add(Number(key));

  for (const day of [...days].sort((a, b) => a - b)) {
    const night = state.nightHistory?.[day];
    if (night && Array.isArray(night.deaths)) {
      const seats = night.deaths
        .filter((death) => death && typeof death.seat === "number")
        .map((death) => `${death.seat + 1}号`)
        .join("、");
      lines.push(
        seats
          ? t("specialEvents.publicRecordNightDeaths", { day, seats })
          : t("specialEvents.publicRecordPeacefulNight", { day })
      );
    }

    const record = state.dayHistory?.[day];
    if (!record) continue;

    const boom = record.selfDestruct;
    if (boom) {
      lines.push(
        boom.targetSeat !== undefined
          ? t("specialEvents.publicRecordBoom", { day, seat: boom.boomSeat + 1, target: boom.targetSeat + 1 })
          : t("specialEvents.publicRecordBoomNoTarget", { day, seat: boom.boomSeat + 1 })
      );
    }
    // 一天可能有多槍（槍鏈）：公開紀錄逐筆列出，不再只留最後一槍
    const shots = [...getHunterShots(record), ...getHunterShots(night)];
    for (const shot of shots) {
      // 公開紀錄不揭露槍種（獵人槍／狼王槍同一句）：誰是狼王不該由開槍公告洩漏
      lines.push(t("specialEvents.publicRecordShot", {
        day,
        seat: shot.hunterSeat + 1,
        target: shot.targetSeat + 1,
      }));
    }
    if (record.idiotRevealed) {
      lines.push(t("specialEvents.publicRecordIdiot", { day, seat: record.idiotRevealed.seat + 1 }));
    }
    if (record.executed) {
      lines.push(t("specialEvents.publicRecordExile", { day, seat: record.executed.seat + 1, votes: record.executed.votes }));
    } else if (record.voteTie) {
      lines.push(t("specialEvents.publicRecordExileTie", { day }));
    } else if (boom) {
      // 白狼王自爆會作廢當天的放逐投票，這是規則明定的結果，不是「紀錄缺失」。
      lines.push(t("specialEvents.publicRecordNoExile", { day }));
    }
  }

  return lines;
}
