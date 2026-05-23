// Public API for supply-guard-hook
export { parse, normalizePipName } from "./parser.ts";
export { evaluatePackage, evaluateCommand, worstDecision, DEFAULT_POLICY } from "./evaluator.ts";
export { checkThreatDb } from "./checks/threatDb.ts";
export { checkTyposquatting } from "./checks/typosquatting.ts";
export { checkMetadata } from "./checks/metadata.ts";
export { logDecision } from "./audit.ts";
export type {
  Ecosystem,
  ParsedInstall,
  Decision,
  RiskFactor,
  RiskResult,
  Policy,
  ThreatEntry,
  ThreatDB,
} from "./types.ts";
