"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  buildAvatarUrl,
  getIdleLipsForSeed,
  getTalkingLips,
  getModelLogoUrl,
} from "@/lib/avatar-config";
import type { Gender } from "@/lib/character-generator";
import type { AvatarStyle, ModelRef } from "@/types/game";

interface TalkingAvatarProps {
  seed: string;
  gender?: Gender;
  style?: AvatarStyle;
  modelRef?: ModelRef;
  useModelLogo?: boolean;
  isTalking?: boolean;
  className?: string;
  alt?: string;
  scale?: number;
  translateY?: number;
}

interface ModelLogoAvatarProps {
  modelRef?: ModelRef;
  alt: string;
  className: string;
}

/** 模型 logo 頭像：刻意零 Hook，讓呼叫端能在呼叫任何 Hook 之前安全分派。 */
function ModelLogoAvatar({ modelRef, alt, className }: ModelLogoAvatarProps) {
  return <img src={getModelLogoUrl(modelRef)} alt={alt} className={className} />;
}

export function TalkingAvatar({ 
  seed, 
  gender,
  style,
  modelRef,
  useModelLogo = false,
  isTalking = false, 
  className = "",
  alt = "Avatar",
  scale = 120,
  translateY = -5,
}: TalkingAvatarProps) {
  // 在呼叫任何 Hook 之前就決定要用哪個元件，讓每個元件的 Hook 數量固定。
  // 原本寫法是「提早 return 之後才呼叫 Hook」：useModelLogo 一旦變動，
  // React 就會因 Hook 數量改變而拋錯（React Compiler 也無法編譯該元件）。
  if (useModelLogo) {
    return <ModelLogoAvatar modelRef={modelRef} alt={alt} className={className} />;
  }

  return (
    <TalkingAvatarAnimated
      seed={seed}
      gender={gender}
      style={style}
      isTalking={isTalking}
      className={className}
      alt={alt}
      scale={scale}
      translateY={translateY}
    />
  );
}

function TalkingAvatarAnimated({ 
  seed, 
  gender,
  style,
  isTalking = false, 
  className = "",
  alt = "Avatar",
  scale = 120,
  translateY = -5,
}: Omit<TalkingAvatarProps, "modelRef" | "useModelLogo">) {
  const TALKING_LIPS = useMemo(() => getTalkingLips(), []);
  const IDLE_LIPS = useMemo(() => getIdleLipsForSeed(seed), [seed]);
  
  const [currentLips, setCurrentLips] = useState(IDLE_LIPS);
  const [preloadedUrls, setPreloadedUrls] = useState<string[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lipIndexRef = useRef(0);

  // 预加载所有嘴型图片
  const allLipsUrls = useMemo(() => {
    const urls: string[] = [];
    // 预加载静止状态
    urls.push(buildAvatarUrl({ seed, gender, style, lips: IDLE_LIPS, scale, translateY, backgroundColor: "transparent" }));
    // 预加载说话状态
    for (const lips of TALKING_LIPS) {
      urls.push(buildAvatarUrl({ seed, gender, style, lips, scale, translateY, backgroundColor: "transparent" }));
    }
    return urls;
  }, [seed, gender, style, scale, translateY, IDLE_LIPS, TALKING_LIPS]);

  // 预加载图片
  useEffect(() => {
    const loaded: string[] = [];
    let mounted = true;

    const preload = async () => {
      for (const url of allLipsUrls) {
        if (!mounted) break;
        try {
          // 使用 Image 对象预加载
          const img = new Image();
          img.src = url;
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve(); // 即使失败也继续
          });
          loaded.push(url);
        } catch {
          // 忽略错误
        }
      }
      if (mounted) {
        setPreloadedUrls(loaded);
      }
    };

    preload();

    return () => {
      mounted = false;
    };
  }, [allLipsUrls]);

  // 说话动画
  useEffect(() => {
    if (isTalking) {
      // 开始说话动画
      lipIndexRef.current = 0;
      
      // 立即切换到第一个说话嘴型
      setCurrentLips(TALKING_LIPS[0]);
      
      // 定时切换嘴型（模拟说话）
      intervalRef.current = setInterval(() => {
        lipIndexRef.current = (lipIndexRef.current + 1) % TALKING_LIPS.length;
        setCurrentLips(TALKING_LIPS[lipIndexRef.current]);
      }, 120); // 每 120ms 切换一次，模拟说话节奏
    } else {
      // 停止说话，恢复静止状态
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setCurrentLips(IDLE_LIPS);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isTalking]);

  const currentUrl = buildAvatarUrl({ seed, gender, style, lips: currentLips, scale, translateY, backgroundColor: "transparent" });

  return (
    <>
      {/* 预加载的隐藏图片 */}
      <div className="hidden">
        {allLipsUrls.map((url) => (
          <img key={url} src={url} alt="" aria-hidden="true" />
        ))}
      </div>
      
      {/* 实际显示的头像 */}
      <img
        src={currentUrl}
        alt={alt}
        className={className}
      />
    </>
  );
}

// 小头像版本（用于聊天记录等）
interface TalkingAvatarSmallProps {
  seed: string;
  gender?: Gender;
  style?: AvatarStyle;
  modelRef?: ModelRef;
  useModelLogo?: boolean;
  isTalking?: boolean;
  className?: string;
  alt?: string;
}

export function TalkingAvatarSmall({ 
  seed, 
  gender,
  style,
  modelRef,
  useModelLogo = false,
  isTalking = false, 
  className = "w-8 h-8 rounded-full",
  alt = "Avatar",
}: TalkingAvatarSmallProps) {
  // 同 TalkingAvatar：先分派元件，再讓子元件無條件呼叫 Hook。
  if (useModelLogo) {
    return <ModelLogoAvatar modelRef={modelRef} alt={alt} className={className} />;
  }

  return (
    <TalkingAvatarSmallAnimated
      seed={seed}
      gender={gender}
      style={style}
      isTalking={isTalking}
      className={className}
      alt={alt}
    />
  );
}

function TalkingAvatarSmallAnimated({ 
  seed, 
  gender,
  style,
  isTalking = false, 
  className = "w-8 h-8 rounded-full",
  alt = "Avatar",
}: Omit<TalkingAvatarSmallProps, "modelRef" | "useModelLogo">) {
  const TALKING_LIPS = useMemo(() => getTalkingLips(), []);
  const IDLE_LIPS = useMemo(() => getIdleLipsForSeed(seed), [seed]);
  
  const [currentLips, setCurrentLips] = useState(IDLE_LIPS);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lipIndexRef = useRef(0);

  // 预加载 URL（透明背景）
  const preloadUrls = useMemo(() => {
    const urls: string[] = [];
    urls.push(buildAvatarUrl({ seed, gender, style, lips: IDLE_LIPS, backgroundColor: "transparent" }));
    for (const lips of TALKING_LIPS) {
      urls.push(buildAvatarUrl({ seed, gender, style, lips, backgroundColor: "transparent" }));
    }
    return urls;
  }, [seed, gender, style, IDLE_LIPS, TALKING_LIPS]);

  // 预加载
  useEffect(() => {
    for (const url of preloadUrls) {
      const img = new Image();
      img.src = url;
    }
  }, [preloadUrls]);

  // 说话动画
  useEffect(() => {
    if (isTalking) {
      lipIndexRef.current = 0;
      setCurrentLips(TALKING_LIPS[0]);
      
      intervalRef.current = setInterval(() => {
        lipIndexRef.current = (lipIndexRef.current + 1) % TALKING_LIPS.length;
        setCurrentLips(TALKING_LIPS[lipIndexRef.current]);
      }, 120);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setCurrentLips(IDLE_LIPS);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isTalking]);

  const currentUrl = buildAvatarUrl({ seed, gender, style, lips: currentLips, backgroundColor: "transparent" });

  return (
    <img
      src={currentUrl}
      alt={alt}
      className={className}
    />
  );
}
