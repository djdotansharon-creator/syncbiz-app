"use client";
import { createContext, useContext } from "react";

export type CenterModule = "jingles" | null;

type CenterModuleCtx = {
  active: CenterModule;
  setActive: (m: CenterModule) => void;
};

export const CenterModuleContext = createContext<CenterModuleCtx>({
  active: null,
  setActive: () => {},
});

export function useCenterModule(): CenterModuleCtx {
  return useContext(CenterModuleContext);
}
