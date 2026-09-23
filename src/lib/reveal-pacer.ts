import { delay } from "./game-flow-controller";

/**
 * 逐票落地的節奏器。
 *
 * 舊行為：等所有人的票都回傳（Promise.all）才一次全部顯示——最後一席慢，全桌都卡著看不到票。
 * 新行為：票**一到就寫進 UI**；節奏器只保證相鄰兩次揭示至少間隔 `minGapMs`，
 * 保留「逐票落地」的視覺節拍，不再讓先回傳的票等後回傳的票。
 */
export const createRevealPacer = (minGapMs: number): ((reveal: () => void) => Promise<void>) => {
  let lastRevealAt = 0;
  let chain: Promise<void> = Promise.resolve();
  return (reveal: () => void): Promise<void> => {
    chain = chain.then(async () => {
      const wait = lastRevealAt + minGapMs - Date.now();
      if (wait > 0) await delay(wait);
      lastRevealAt = Date.now();
      reveal();
    });
    return chain;
  };
};
