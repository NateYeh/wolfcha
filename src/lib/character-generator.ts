import {
  generateJSON,
  generateCompletionStream,
  stripMarkdownCodeFences,
  type ResponseFormat,
} from "./llm";
import { withOutputLanguageRule } from "@/lib/prompt-language";
import {
  ALL_MODELS,
  GENERATOR_MODEL,
  PLAYER_MODELS,
  PROJECT_MODELS,
  filterPlayerModels,
  type AvatarStyle,
  type GameScenario,
  type ModelRef,
  type Persona,
  type PlayerMind,
} from "@/types/game";
import {
  getGeneratorModel,
  getGatewayModels,
  getPlayerModelPool,
  getSelectedModels,
  hasDashscopeKey,
  hasTokendanceKey,
  hasZenmuxKey,
  isCustomKeyEnabled,
  isTokenPayActive,
} from "@/lib/api-keys";
import { resolveAvailableModelRefs, withGatewayModels } from "./model-pool";
import { aiLogger } from "./ai-logger";
import { GAME_TEMPERATURE } from "./ai-config";
import { getRandomScenario } from "./scenarios";
import { resolveVoiceId, VOICE_PRESETS, type AppLocale } from "./voice-constants";
import { getI18n } from "@/i18n/translator";
import { parseLLMJson } from "./llm-json";

export interface GeneratedCharacter {
  /** 穩定角色 id（角色池角色才有；AI 即時生成的角色為 undefined）。 */
  id?: string;
  displayName: string;
  persona: Persona;
  playerMind?: PlayerMind;
  avatarSeed?: string;
  /** 頭像外觀的固定指定（手寫角色用）；未指定時依性別＋seed 產生。 */
  avatarStyle?: AvatarStyle;
}

export interface GeneratedCharacters {
  characters: GeneratedCharacter[];
}

export type Gender = "male" | "female" | "nonbinary";

const MODEL_DISPLAY_NAME_MAP: Array<{ match: RegExp; label: string }> = [
  { match: /gemini/i, label: "Gemini" },
  { match: /deepseek/i, label: "DeepSeek" },
  { match: /claude/i, label: "Claude" },
  { match: /qwen/i, label: "Qwen" },
  { match: /doubao/i, label: "Doubao" },
  { match: /bytedance|seed/i, label: "ByteDance" },
  { match: /openai|gpt/i, label: "OpenAI" },
  { match: /kimi|moonshot/i, label: "Kimi" },
];

const CHARACTER_GENERATOR_REASONING = { enabled: false } as const;
const CHARACTER_PERSONA_BATCH_SIZE = 3;
const CHARACTER_PERSONA_BATCH_MAX_TOKENS = 4200;
const CHARACTER_BATCH_MAX_ATTEMPTS = 2;
const CHARACTER_BATCH_RETRY_DELAY_MS = 800;

/** 生成來源標記（僅寫入 AI 日誌，不影響遊戲）。 */
const withLogSource = (payload: Record<string, unknown>, logSource?: string): string =>
  JSON.stringify(logSource ? { ...payload, source: logSource } : payload);

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getModelRefForModel(model: string): ModelRef {
  return (
    PROJECT_MODELS.find((ref) => ref.model === model) ??
    ALL_MODELS.find((ref) => ref.model === model) ??
    { provider: "zenmux" as const, model }
  );
}

export const sampleModelRefs = (count: number): ModelRef[] => {
  // 內建備援池：還沒抓過閘道器清單時使用。
  const builtinPool =
    PLAYER_MODELS.length > 0
      ? PLAYER_MODELS
      : [getModelRefForModel(GENERATOR_MODEL)];
  // 抓過閘道器清單就以它為準（閘道器新增模型不必改程式碼）；未內建的模型走
  // 自帶閘道器通道並用預設參數。
  const gatewayRefs = resolveAvailableModelRefs(getGatewayModels(), builtinPool);

  // 內建（專案／TokenPay）模式：使用者可在「設定 → AI 玩家模型池」勾選本輪要用
  // 的模型（空＝全部）。全選項都失效時退回全部，並留下紀錄（不靜默吞掉）。
  const applyPlayerPoolFilter = (pool: ModelRef[]): ModelRef[] => {
    const selected = getPlayerModelPool();
    if (selected.length === 0) return pool;
    const selectedSet = new Set(selected);
    const filtered = pool.filter((ref) => selectedSet.has(ref.model));
    if (filtered.length === 0) {
      console.warn("[sampleModelRefs] 勾選的模型都不在可用池子里，改用全部模型:", selected);
      return pool;
    }
    return filtered;
  };

  const pool = (() => {
    if (!isCustomKeyEnabled()) return applyPlayerPoolFilter(gatewayRefs);

    // When custom key is enabled, use ALL_MODELS as the full available pool
    const fullPool = withGatewayModels(
      ALL_MODELS.length > 0 ? ALL_MODELS : builtinPool,
      getGatewayModels(),
    );

    const allowedProviders = new Set<ModelRef["provider"]>();
    if (hasZenmuxKey()) allowedProviders.add("zenmux");
    if (hasDashscopeKey()) allowedProviders.add("dashscope");
    if (hasTokendanceKey()) allowedProviders.add("tokendance");
    if (allowedProviders.size === 0) return builtinPool;

    // Filter by allowed providers, then exclude non-player models
    const allowedPool = filterPlayerModels(
      fullPool.filter((ref) => allowedProviders.has(ref.provider))
    );
    if (allowedPool.length === 0) return builtinPool;

    // Filter by user's selected models - STRICTLY respect user selection
    const selectedModels = getSelectedModels();
    if (selectedModels.length === 0) return allowedPool;
    
    // Only use models the user explicitly selected
    const selectedPool = allowedPool.filter((ref) => selectedModels.includes(ref.model));
    
    // If user selected models but none are in allowedPool, try to find them in fullPool
    // This handles cases where user selected models from a different provider
    if (selectedPool.length === 0) {
      const fullSelectedPool = filterPlayerModels(
        fullPool.filter((ref) => selectedModels.includes(ref.model) && allowedProviders.has(ref.provider))
      );
      if (fullSelectedPool.length > 0) return fullSelectedPool;
      
      // Last resort: only return models that user actually selected, even if empty
      // This prevents using models the user didn't choose
      console.warn("[sampleModelRefs] User selected models not found in allowed pool:", selectedModels);
    }
    
    // Return only user-selected models, never fall back to all models
    return selectedPool.length > 0 ? selectedPool : allowedPool.slice(0, 1);
  })();

  if (!Number.isFinite(count) || count <= 0) return [];

  if (count <= pool.length) {
    return shuffleArray(pool).slice(0, count);
  }

  const out = shuffleArray(pool);
  while (out.length < count) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
};

const getModelDisplayName = (modelRef: ModelRef): string => {
  const raw = modelRef.model ?? "";
  const mapped = MODEL_DISPLAY_NAME_MAP.find((entry) => entry.match.test(raw))?.label;
  if (mapped) return mapped;
  const fallback = raw.split("/").pop() ?? raw;
  return fallback.split("-")[0] || fallback || "AI";
};

const createGenshinPersona = (voiceId?: string): Persona => {
  return {
    styleLabel: "neutral",
    voiceRules: ["concise"],
    mbti: "NA",
    gender: "nonbinary",
    age: 0,
    voiceId,
  };
};

export const buildGenshinModelRefs = (count: number): ModelRef[] => {
  return sampleModelRefs(count);
};

export const generateGenshinModeCharacters = async (
  count: number,
  modelRefs: ModelRef[]
): Promise<GeneratedCharacter[]> => {
  const modelUsageCounts = new Map<string, number>();
  const modelVoiceMap = new Map<string, string>();
  const resolvedRefs = modelRefs.length >= count ? modelRefs : buildGenshinModelRefs(count);

  return resolvedRefs.slice(0, count).map((modelRef) => {
    const modelLabel = getModelDisplayName(modelRef);
    const usageCount = modelUsageCounts.get(modelLabel) ?? 0;
    modelUsageCounts.set(modelLabel, usageCount + 1);
    const preferredName = usageCount === 0 ? modelLabel : `${modelLabel} ${usageCount + 1}`;

    let voiceId = modelVoiceMap.get(modelLabel);
    if (!voiceId) {
      const preset = VOICE_PRESETS[Math.floor(Math.random() * VOICE_PRESETS.length)];
      voiceId = preset?.id;
      if (voiceId) {
        modelVoiceMap.set(modelLabel, voiceId);
      }
    }

    return {
      displayName: preferredName,
      persona: createGenshinPersona(voiceId),
    };
  });
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

const isValidMbti = (v: unknown): v is string => typeof v === "string" && /^[A-Z]{4}$/.test(v.trim());

export interface BaseProfile {
  displayName: string;
  gender: Gender;
  age: number;
  mbti: string;
  basicInfo: string;
}

const normalizeBaseProfiles = (result: unknown): { profiles: BaseProfile[]; raw: unknown } => {
  if (isRecord(result) && Array.isArray(result.profiles)) {
    const profiles = result.profiles
      .map(normalizeBaseProfileItem)
      .filter((p): p is BaseProfile => p !== null);
    return { profiles, raw: result };
  }
  return { profiles: [], raw: result };
};

/**
 * 基础档案宽容归一：glm 等不支援 response_format 的模型会偶发吐出
 * 「INTJ-T」尾缀、小写 mbti、字符串年龄、大写性别等可修复偏差；
 * 无法归一的项返回 null，交由外层重试。
 */
const normalizeBaseProfileItem = (p: unknown): BaseProfile | null => {
  if (!isRecord(p)) return null;
  const genderRaw = typeof p.gender === "string" ? p.gender.trim().toLowerCase() : "";
  let gender: Gender | null = null;
  if (["male", "man", "男"].includes(genderRaw)) gender = "male";
  else if (["female", "woman", "女"].includes(genderRaw)) gender = "female";
  else if (genderRaw.includes("non")) gender = "nonbinary";
  if (!gender) return null;
  const ageRaw = p.age;
  const ageNum =
    typeof ageRaw === "number" && Number.isFinite(ageRaw) ? Math.floor(ageRaw)
    : typeof ageRaw === "string" && Number.isFinite(Number(ageRaw)) ? Math.floor(Number(ageRaw))
    : NaN;
  if (!Number.isFinite(ageNum)) return null;
  const mbtiRaw = typeof p.mbti === "string" ? p.mbti.toUpperCase() : "";
  const mbti = mbtiRaw.match(/[A-Z]{4}/)?.[0];
  if (!mbti) return null;
  const displayName = typeof p.displayName === "string" ? p.displayName.trim() : "";
  const basicInfo = typeof p.basicInfo === "string" ? p.basicInfo.trim() : "";
  if (!displayName || !basicInfo) return null;
  return { displayName, gender, age: ageNum, mbti, basicInfo };
};

const isValidGender = (g: unknown): g is Gender => g === "male" || g === "female" || g === "nonbinary";

const isValidBaseProfiles = (profiles: unknown, count: number): profiles is BaseProfile[] => {
  if (!Array.isArray(profiles) || profiles.length !== count) return false;
  const ok = profiles.every((p) => {
    if (!isRecord(p)) return false;
    if (typeof p.displayName !== "string" || !p.displayName.trim()) return false;
    if (!isValidGender(p.gender)) return false;
    if (typeof p.age !== "number" || !Number.isFinite(p.age) || p.age < 16 || p.age > 70) return false;
    if (!isValidMbti(p.mbti)) return false;
    if (typeof p.basicInfo !== "string" || !p.basicInfo.trim()) return false;
    return true;
  });

  if (!ok) return false;
  const names = profiles.map((p) => String(p.displayName).trim()).filter(Boolean);
  if (names.length !== count) return false;
  if (new Set(names).size !== count) return false;
  return true;
};

const buildBaseProfilesPrompt = (count: number, scenario: GameScenario) => {
  const { t } = getI18n();
  return t("characterGenerator.baseProfilesPrompt", {
    count,
    title: scenario.title,
    description: scenario.description,
    rolesHint: scenario.rolesHint,
  });
};

const buildCharacterSchemaLine = (p: BaseProfile): string => (
  `  { "displayName": "${p.displayName}", "persona": { "voiceRules": string[], "werewolfExperience": string, "vocabularyStyle": string, "reasoningStyle": string, "speechLengthHabit": string, "pressureStyle": string, "uncertaintyStyle": string, "mistakePattern": string, "wolfDeceptionStyle": string }, "playerMind": { "courage": string, "memoryBias": string, "suspicionThreshold": string, "selfProtection": string, "logicDepth": string, "tablePresence": string } }`
);

const normalizeGeneratedCharacters = (
  result: unknown
): { characters: GeneratedCharacter[]; raw: unknown } => {
  if (isRecord(result) && Array.isArray(result.characters)) {
    return { characters: result.characters as GeneratedCharacter[], raw: result };
  }
  return { characters: [], raw: result };
};

const PLAYER_MIND_REQUIRED_FIELDS: Array<keyof PlayerMind> = [
  "courage",
  "memoryBias",
  "suspicionThreshold",
  "selfProtection",
  "logicDepth",
  "tablePresence",
];

const PERSONA_TEXT_FIELDS = [
  "werewolfExperience",
  "vocabularyStyle",
  "reasoningStyle",
  "speechLengthHabit",
  "pressureStyle",
  "uncertaintyStyle",
  "mistakePattern",
  "wolfDeceptionStyle",
 ] as const satisfies ReadonlyArray<
  "werewolfExperience" |
  "vocabularyStyle" |
  "reasoningStyle" |
  "speechLengthHabit" |
  "pressureStyle" |
  "uncertaintyStyle" |
  "mistakePattern" |
  "wolfDeceptionStyle"
>;

const isValidPlayerMind = (mind: unknown): mind is PlayerMind => {
  if (!isRecord(mind)) return false;
  return PLAYER_MIND_REQUIRED_FIELDS.every((key) => (
    typeof mind[key] === "string" && mind[key].trim().length > 0
  ));
};

function parsePlayerMind(mind: unknown): PlayerMind | null {
  if (!isValidPlayerMind(mind)) return null;
  return {
    courage: mind.courage.trim(),
    memoryBias: mind.memoryBias.trim(),
    suspicionThreshold: mind.suspicionThreshold.trim(),
    selfProtection: mind.selfProtection.trim(),
    logicDepth: mind.logicDepth.trim(),
    tablePresence: mind.tablePresence.trim(),
  };
}

function parsePersonaForProfile(persona: unknown, profile: BaseProfile): Persona | null {
  if (!isRecord(persona)) return null;
  if (
    !Array.isArray(persona.voiceRules) ||
    persona.voiceRules.length === 0 ||
    persona.voiceRules.some((rule) => typeof rule !== "string" || !rule.trim()) ||
    PERSONA_TEXT_FIELDS.some((field) => (
      typeof persona[field] !== "string" || !persona[field].trim()
    ))
  ) {
    return null;
  }

  const normalized: Persona = {
    voiceRules: persona.voiceRules.map((rule) => rule.trim()),
    mbti: profile.mbti,
    gender: profile.gender,
    age: profile.age,
    basicInfo: profile.basicInfo,
  };

  for (const field of PERSONA_TEXT_FIELDS) {
    normalized[field] = (persona[field] as string).trim();
  }
  return normalized;
}

const isValidPersonaForProfile = (persona: unknown, profile: BaseProfile): persona is Persona => (
  isRecord(persona) &&
  Array.isArray(persona.voiceRules) &&
  persona.voiceRules.length > 0 &&
  PERSONA_TEXT_FIELDS.every((field) => (
    typeof persona[field] === "string" && persona[field].trim().length > 0
  )) &&
  persona.gender === profile.gender &&
  persona.age === profile.age &&
  persona.mbti === profile.mbti
);

function normalizeGeneratedCharacterForProfile(char: unknown, profile: BaseProfile): GeneratedCharacter | null {
  if (!isRecord(char)) return null;
  const rawName = typeof char.displayName === "string" ? char.displayName.trim() : "";
  if (!rawName) return null;
  const persona = parsePersonaForProfile(char.persona, profile);
  const playerMind = parsePlayerMind(char.playerMind);
  if (!persona || !playerMind) return null;

  return {
    displayName: rawName,
    persona,
    playerMind,
  };
}

const alignCharactersToProfiles = (
  chars: unknown,
  profiles: BaseProfile[]
): GeneratedCharacter[] | null => {
  if (!Array.isArray(chars)) {
    console.error("[alignCharacters] chars is not an array:", chars);
    return null;
  }
  if (chars.length !== profiles.length) {
    console.error(`[alignCharacters] length mismatch: ${chars.length} chars vs ${profiles.length} profiles`);
    return null;
  }
  const byName = new Map<string, GeneratedCharacter>();
  for (const c of chars as GeneratedCharacter[]) {
    if (!c || typeof c !== "object") {
      console.error("[alignCharacters] invalid character object:", c);
      return null;
    }
    const name = typeof c.displayName === "string" ? c.displayName.trim() : "";
    if (!name) {
      console.error("[alignCharacters] missing displayName:", c);
      return null;
    }
    if (byName.has(name)) {
      console.error("[alignCharacters] duplicate name:", name);
      return null;
    }
    byName.set(name, c);
  }
  const ordered: GeneratedCharacter[] = [];
  for (const profile of profiles) {
    const key = profile.displayName.trim();
    const rawCharacter = byName.get(key);
    if (!rawCharacter) {
      console.error(`[alignCharacters] character not found for profile: ${key}, available names:`, Array.from(byName.keys()));
      return null;
    }
    const c = normalizeGeneratedCharacterForProfile(rawCharacter, profile);
    if (!c || !isValidPersonaForProfile(c.persona, profile) || !isValidPlayerMind(c.playerMind)) {
      const p = isRecord(rawCharacter) ? rawCharacter.persona : undefined;
      console.error(`[alignCharacters] invalid persona for ${key}:`, {
        rawCharacter,
        normalizedCharacter: c,
        profile: { gender: profile.gender, age: profile.age, mbti: profile.mbti },
        isValid: c ? isValidPersonaForProfile(c.persona, profile) : false,
        isValidPlayerMind: c ? isValidPlayerMind(c.playerMind) : false,
        genderMatch: p?.gender === profile.gender,
        ageMatch: p?.age === profile.age,
        mbtiMatch: isRecord(p) ? String(p.mbti || "").trim() === profile.mbti : false,
      });
      return null;
    }
    ordered.push(c);
  }
  return ordered;
};

const buildFullPersonasPrompt = (
  scenario: GameScenario,
  allProfiles: BaseProfile[],
  outputProfiles: BaseProfile[] = allProfiles,
) => {
  const { t, locale } = getI18n();
  const outputNames = new Set(outputProfiles.map((profile) => profile.displayName));
  const roster = allProfiles
    .map((p, i) =>
      `${t("characterGenerator.rosterLine", {
          index: i + 1,
          name: p.displayName,
          gender: p.gender,
          age: p.age,
          basicInfo: p.basicInfo,
        })} ${outputNames.has(p.displayName)
          ? locale !== "en" ? "[本批输出]" : "[OUTPUT IN THIS BATCH]"
          : locale !== "en" ? "[仅作全局去重参考]" : "[CONTEXT ONLY FOR GLOBAL DIVERSITY]"}`
    )
    .join("\n");

  const schema = outputProfiles.map(buildCharacterSchemaLine).join(",\n");

  return t("characterGenerator.fullPersonasPrompt", {
    title: scenario.title,
    description: scenario.description,
    roster,
    count: outputProfiles.length,
    schema,
  });
};

const nonEmptyStringSchema = { type: "string", minLength: 1 } as const;

function buildBaseProfilesResponseFormat(count: number): ResponseFormat {
  return {
    type: "json_schema",
    json_schema: {
      name: "base_profiles",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["profiles"],
        properties: {
          profiles: {
            type: "array",
            minItems: count,
            maxItems: count,
            uniqueItems: true,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["displayName", "gender", "age", "mbti", "basicInfo"],
              properties: {
                displayName: nonEmptyStringSchema,
                gender: { type: "string", enum: ["male", "female"] },
                age: { type: "integer", minimum: 20, maximum: 55 },
                mbti: { type: "string", pattern: "^[A-Z]{4}$" },
                basicInfo: nonEmptyStringSchema,
              },
            },
          },
        },
      },
    },
  };
}

function buildPersonaBatchResponseFormat(profiles: BaseProfile[]): ResponseFormat {
  const personaTextProperties = Object.fromEntries(
    PERSONA_TEXT_FIELDS.map((field) => [field, nonEmptyStringSchema]),
  );
  const playerMindProperties = Object.fromEntries(
    PLAYER_MIND_REQUIRED_FIELDS.map((field) => [field, nonEmptyStringSchema]),
  );

  return {
    type: "json_schema",
    json_schema: {
      name: "character_batch",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["characters"],
        properties: {
          characters: {
            type: "array",
            minItems: profiles.length,
            maxItems: profiles.length,
            uniqueItems: true,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["displayName", "persona", "playerMind"],
              properties: {
                displayName: {
                  type: "string",
                  enum: profiles.map((profile) => profile.displayName),
                },
                persona: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "voiceRules",
                    ...PERSONA_TEXT_FIELDS,
                  ],
                  properties: {
                    voiceRules: {
                      type: "array",
                      minItems: 1,
                      items: nonEmptyStringSchema,
                    },
                    ...personaTextProperties,
                  },
                },
                playerMind: {
                  type: "object",
                  additionalProperties: false,
                  required: PLAYER_MIND_REQUIRED_FIELDS,
                  properties: playerMindProperties,
                },
              },
            },
          },
        },
      },
    },
  };
}

export async function generateCharacters(
  count: number,
  scenario?: GameScenario,
  options?: {
    onBaseProfiles?: (profiles: BaseProfile[]) => void;
    onCharacter?: (index: number, character: GeneratedCharacter) => void;
    /** 標記這批生成的來源（例如角色池背景補充），只寫進 AI 日誌方便事後區分。 */
    logSource?: string;
  }
): Promise<GeneratedCharacter[]> {
  const usedScenario = scenario ?? getRandomScenario();
  const basePrompt = buildBaseProfilesPrompt(count, usedScenario);
  const baseModel = getGeneratorModel();
  const baseStartedAt = Date.now();
  // 基础档案阶段同样套重试：glm 不吃 response_format，坏样本是随机现象。
  // TokenPay 付费路径不重试，避免重复计费。
  const baseMaxAttempts = isTokenPayActive() ? 1 : CHARACTER_BATCH_MAX_ATTEMPTS;
  // 語言規則在此接上：request 與 log 共用同一份陣列，兩者才逐字相同
  const BASE_PROMPT_MESSAGES = withOutputLanguageRule([{ role: "user", content: basePrompt }]);

  let baseProfiles: BaseProfile[] = [];
  let baseLastRaw: unknown;
  let baseLastError: unknown = null;
  for (let attempt = 1; attempt <= baseMaxAttempts; attempt += 1) {
    try {
      const baseResult = await generateJSON<unknown>({
        model: baseModel,
        messages: BASE_PROMPT_MESSAGES,
        temperature: GAME_TEMPERATURE.CHARACTER_GENERATION,
        max_tokens: Math.max(2400, count * 350 + 600),
        reasoning: CHARACTER_GENERATOR_REASONING,
        response_format: buildBaseProfilesResponseFormat(count),
      });
      baseLastRaw = baseResult;
      const normalized = normalizeBaseProfiles(baseResult);
      baseProfiles = normalized.profiles;
      if (!isValidBaseProfiles(baseProfiles, count)) {
        throw new Error("Base profile generation returned invalid schema");
      }
      await aiLogger.log({
        type: "character_generation",
        request: { model: baseModel, messages: BASE_PROMPT_MESSAGES },
        response: {
          content: JSON.stringify(baseProfiles),
          rawResponse: withLogSource({ stage: "base_profiles", attempt }, options?.logSource),
          duration: Date.now() - baseStartedAt,
        },
      });
      break;
    } catch (error) {
      baseLastError = error;
      if (attempt >= baseMaxAttempts) break;
      console.warn(
        `[character-gen] base profiles 第 ${attempt} 次失败（${String(error)}），重试`,
      );
      await aiLogger.log({
        type: "character_generation",
        request: { model: baseModel, messages: BASE_PROMPT_MESSAGES },
        response: {
          content: "",
          raw: baseLastRaw === undefined ? "" : JSON.stringify(baseLastRaw),
          rawResponse: withLogSource({ stage: "base_profiles", attempt }, options?.logSource),
          duration: Date.now() - baseStartedAt,
        },
        error: String(error),
        retrying: true,
      });
    }
  }
  if (!isValidBaseProfiles(baseProfiles, count)) {
    throw baseLastError ?? new Error("Base profile generation returned invalid schema");
  }
  options?.onBaseProfiles?.(baseProfiles);

  const finalizedCharacters: GeneratedCharacter[] = [];
  const emitCharacter = (index: number, character: GeneratedCharacter) => {
    finalizedCharacters[index] = character;
    options?.onCharacter?.(index, character);
    console.log(`[character-gen] emitted character ${index}: ${character.displayName}`);
  };

  const generatePersonaBatchAttempt = async (
    batchProfiles: BaseProfile[],
    batchStartIndex: number,
    retrying: boolean,
    logSource?: string,
  ): Promise<GeneratedCharacter[]> => {
    const batchStartedAt = Date.now();
    const batchModel = getGeneratorModel();
    const fullPrompt = buildFullPersonasPrompt(
      usedScenario,
      baseProfiles,
      batchProfiles,
    );
    const FULL_PROMPT_MESSAGES = withOutputLanguageRule([{ role: "user", content: fullPrompt }]);
    const batchCharacters: GeneratedCharacter[] = [];
    const emittedLocalIndices = new Set<number>();
    let accumulatedContent = "";

    try {
      // 三人一批并行生成，避免九人长输出达到 token 上限；每批只调用一次。
      const stream = generateCompletionStream({
        model: batchModel,
        messages: FULL_PROMPT_MESSAGES,
        temperature: GAME_TEMPERATURE.CHARACTER_PERSONA,
        max_tokens: CHARACTER_PERSONA_BATCH_MAX_TOKENS,
        reasoning: CHARACTER_GENERATOR_REASONING,
        response_format: buildPersonaBatchResponseFormat(batchProfiles),
      });

      for await (const chunk of stream) {
        accumulatedContent += chunk;
        const cleaned = stripMarkdownCodeFences(accumulatedContent);
        const characterPattern = /\{\s*"displayName"\s*:\s*"[^"]+"\s*,\s*"persona"\s*:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\s*,\s*"playerMind"\s*:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\s*\}/g;
        const matches = cleaned.match(characterPattern);

        for (const match of matches ?? []) {
          const rawCharacter = parseLLMJson<GeneratedCharacter>(match);
          if (!rawCharacter?.displayName) continue;
          const localIndex = batchProfiles.findIndex(
            (profile, index) =>
              profile.displayName === rawCharacter.displayName &&
              !emittedLocalIndices.has(index),
          );
          if (localIndex === -1) continue;

          const profile = batchProfiles[localIndex];
          const normalized = normalizeGeneratedCharacterForProfile(rawCharacter, profile);
          if (
            !normalized ||
            !isValidPersonaForProfile(normalized.persona, profile) ||
            !isValidPlayerMind(normalized.playerMind)
          ) {
            continue;
          }

          const voiceId = resolveVoiceId(
            normalized.persona.voiceId,
            normalized.persona.gender,
            normalized.persona.age,
            "zh-CN" as AppLocale,
          );
          const character: GeneratedCharacter = {
            displayName: profile.displayName,
            persona: {
              ...normalized.persona,
              basicInfo: profile.basicInfo,
              voiceId,
              relationships: undefined,
            },
            playerMind: normalized.playerMind,
          };
          emittedLocalIndices.add(localIndex);
          batchCharacters[localIndex] = character;
          emitCharacter(batchStartIndex + localIndex, character);
        }
      }

      if (batchCharacters.filter(Boolean).length < batchProfiles.length) {
        const fullResult = parseLLMJson<unknown>(stripMarkdownCodeFences(accumulatedContent));
        if (!fullResult) {
          throw new Error(`Character batch ${batchStartIndex} returned invalid JSON`);
        }
        const normalized = normalizeGeneratedCharacters(fullResult);
        const aligned = alignCharactersToProfiles(normalized.characters, batchProfiles);
        if (!aligned) {
          throw new Error(`Character batch ${batchStartIndex} returned invalid schema`);
        }

        aligned.forEach((character, localIndex) => {
          if (batchCharacters[localIndex]) return;
          const profile = batchProfiles[localIndex];
          const voiceId = resolveVoiceId(
            character.persona.voiceId,
            character.persona.gender,
            character.persona.age,
            "zh-CN" as AppLocale,
          );
          const completed: GeneratedCharacter = {
            displayName: profile.displayName,
            persona: {
              ...character.persona,
              basicInfo: profile.basicInfo,
              voiceId,
              relationships: undefined,
            },
            playerMind: character.playerMind,
          };
          batchCharacters[localIndex] = completed;
          emitCharacter(batchStartIndex + localIndex, completed);
        });
      }

      await aiLogger.log({
        type: "character_generation",
        request: {
          model: batchModel,
          messages: FULL_PROMPT_MESSAGES,
        },
        response: {
          content: JSON.stringify(batchCharacters.map((c) => ({
            displayName: c.displayName,
            hiddenCommunicationProfile: {
              werewolfExperience: c.persona.werewolfExperience,
              vocabularyStyle: c.persona.vocabularyStyle,
              reasoningStyle: c.persona.reasoningStyle,
              speechLengthHabit: c.persona.speechLengthHabit,
              pressureStyle: c.persona.pressureStyle,
              uncertaintyStyle: c.persona.uncertaintyStyle,
              mistakePattern: c.persona.mistakePattern,
              wolfDeceptionStyle: c.persona.wolfDeceptionStyle,
            },
            playerMind: c.playerMind,
          }))),
          duration: Date.now() - batchStartedAt,
          rawResponse: withLogSource({ batchStartIndex }, logSource),
        },
      });
      return batchCharacters;
    } catch (error) {
      await aiLogger.log({
        type: "character_generation",
        request: {
          model: batchModel,
          messages: FULL_PROMPT_MESSAGES,
        },
        response: {
          content: accumulatedContent,
          duration: Date.now() - batchStartedAt,
          raw: accumulatedContent,
          rawResponse: withLogSource({ batchStartIndex }, logSource),
        },
        error: String(error),
        retrying,
      });
      throw error;
    }
  };

  /**
   * 重試包裝：模型偶爾會吐出壞掉的 JSON（例如字串漏掉結尾引號），使整批作廢。
   * 這種瑕疵是抽樣随機現象，重新取一次通常就好了。
   *
   * TokenPay 付費路徑不重試：已經收到部分內容再打一次等於重複計費。
   */
  const generatePersonaBatch = async (
    batchProfiles: BaseProfile[],
    batchStartIndex: number,
    logSource?: string,
  ): Promise<GeneratedCharacter[]> => {
    const maxAttempts = isTokenPayActive() ? 1 : CHARACTER_BATCH_MAX_ATTEMPTS;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await generatePersonaBatchAttempt(batchProfiles, batchStartIndex, attempt < maxAttempts, logSource);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) break;
        console.warn(
          `[character-gen] batch ${batchStartIndex} 第 ${attempt} 次失敗（${String(error)}），重試`,
        );
        await new Promise((resolve) => setTimeout(resolve, CHARACTER_BATCH_RETRY_DELAY_MS));
      }
    }

    throw lastError;
  };

  const batchTasks: Promise<GeneratedCharacter[]>[] = [];
  for (let start = 0; start < baseProfiles.length; start += CHARACTER_PERSONA_BATCH_SIZE) {
    batchTasks.push(
      generatePersonaBatch(
        baseProfiles.slice(start, start + CHARACTER_PERSONA_BATCH_SIZE),
        start,
        options?.logSource,
      ),
    );
  }
  const batchResults = await Promise.allSettled(batchTasks);
  const failedBatch = batchResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failedBatch) throw failedBatch.reason;
  if (finalizedCharacters.filter(Boolean).length !== baseProfiles.length) {
    throw new Error("Character generation returned incomplete batches");
  }
  return finalizedCharacters;
}
