import type { DriverMatchScore } from "./ai";

export interface PredictiveDispatchScoreInput {
  distanceKm: number;
  rating?: number;
  avgResponseTimeSec?: number;
  completionRate?: number;
  behaviorScore?: number;
  etaMinutes?: number;
  locationAgeSeconds?: number;
  idleMinutes?: number;
}

export interface PredictiveDispatchScoreResult {
  score: number;
  scoreBreakdown: NonNullable<DriverMatchScore["scoreBreakdown"]>;
}

const MATCH_WEIGHTS = {
  distance: 0.28,
  eta: 0.20,
  behavior: 0.20,
  rating: 0.12,
  responseSpeed: 0.10,
  completionRate: 0.07,
  idleBonus: 0.03,
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function roundScore(value: number, digits: number = 3): number {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

export function scoreDriverForDispatch(input: PredictiveDispatchScoreInput): PredictiveDispatchScoreResult {
  const distanceKm = Number.isFinite(input.distanceKm) ? Math.max(0, Number(input.distanceKm)) : 25;
  const rating = Number.isFinite(input.rating) ? Number(input.rating) : 3;
  const avgResponseTimeSec = Number.isFinite(input.avgResponseTimeSec) ? Math.max(0, Number(input.avgResponseTimeSec)) : 60;
  const completionRateRaw = Number.isFinite(input.completionRate) ? Number(input.completionRate) : 0.8;
  const behaviorScoreRaw = Number.isFinite(input.behaviorScore) ? Number(input.behaviorScore) : 50;
  const derivedEtaMinutes = Number.isFinite(input.etaMinutes) ? Number(input.etaMinutes) : distanceKm * 2.5;
  const locationAgeSeconds = Number.isFinite(input.locationAgeSeconds) ? Math.max(0, Number(input.locationAgeSeconds)) : 0;
  const idleMinutes = Number.isFinite(input.idleMinutes) ? Math.max(0, Number(input.idleMinutes)) : 0;

  const completionRate = completionRateRaw > 1 ? completionRateRaw / 100 : completionRateRaw;
  const behaviorScore = behaviorScoreRaw > 1 ? behaviorScoreRaw / 100 : behaviorScoreRaw;
  const distanceScore = clamp01(1 - distanceKm / 25);
  const etaScore = clamp01(1 - derivedEtaMinutes / 35);
  const ratingScore = clamp01((rating - 1) / 4);
  const responseScore = clamp01(1 - avgResponseTimeSec / 300);
  const completionScore = clamp01(completionRate);
  const behaviorNorm = clamp01(behaviorScore);
  const idleScore = clamp01(idleMinutes / 20);
  const freshnessPenalty = locationAgeSeconds > 0 ? clamp01(1 - locationAgeSeconds / 300) : 1;

  const rawScore =
    distanceScore * MATCH_WEIGHTS.distance +
    etaScore * MATCH_WEIGHTS.eta +
    behaviorNorm * MATCH_WEIGHTS.behavior +
    ratingScore * MATCH_WEIGHTS.rating +
    responseScore * MATCH_WEIGHTS.responseSpeed +
    completionScore * MATCH_WEIGHTS.completionRate +
    idleScore * MATCH_WEIGHTS.idleBonus;

  const finalScore = roundScore(rawScore * (0.7 + freshnessPenalty * 0.3));

  return {
    score: finalScore,
    scoreBreakdown: {
      distance: roundScore(distanceScore),
      eta: roundScore(etaScore),
      behavior: roundScore(behaviorNorm),
      rating: roundScore(ratingScore),
      responseSpeed: roundScore(responseScore),
      completionRate: roundScore(completionScore),
      idleBonus: roundScore(idleScore),
      final: finalScore,
      etaMinutes: roundScore(derivedEtaMinutes, 2),
      locationAgeSeconds: roundScore(locationAgeSeconds, 0),
    },
  };
}
