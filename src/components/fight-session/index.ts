/**
 * Fight Session design foundation (Phase 5.6B1): presentational building blocks for Prepare,
 * Live and Recap. Not used by the dashboard yet; integration is Phase 5.6B2/B3.
 */
export * from "./types";
export * from "./adapters";
export { SessionStatusIndicator, StatusStrip } from "./SessionStatus";
export { CharacterLine, FightScoreboard, RatingSummary, SessionResults } from "./Scoreboard";
export { ActivityList, LastMatch, RoundStrip } from "./Activity";
export {
  EndSessionControl,
  SessionActionBar,
  SessionFeedback,
  StartSessionButton,
} from "./SessionControls";
export { OverlayAccessCard, OverlayDock } from "./OverlayAccess";
export { SessionStage } from "./SessionStage";
