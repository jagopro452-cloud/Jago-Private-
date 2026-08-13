export interface FeatureFlags {
  useGatewayFacade: boolean;
  useEventOutbox: boolean;
  useLocationService: boolean;
  useMatchingService: boolean;
  useTripService: boolean;
  useSafetyService: boolean;
  useVoiceAssistantV2: boolean;
  enableExperimentalVoiceBooking: boolean;
  enableAiMobilityBrain: boolean;
  useDynamicPricingV2: boolean;
  useParcelHyperlocalService: boolean;
  useCarShareIntercityService: boolean;
  enablePredictiveSuggestions: boolean;
  enableRouteDeviationGuardian: boolean;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const val = String(raw).trim().toLowerCase();
  if (val === "1" || val === "true" || val === "yes" || val === "on") return true;
  if (val === "0" || val === "false" || val === "no" || val === "off") return false;
  return fallback;
}

export const featureFlags: FeatureFlags = {
  useGatewayFacade: envBool("FF_GATEWAY_FACADE", false),
  useEventOutbox: envBool("FF_EVENT_OUTBOX", false),
  useLocationService: envBool("FF_LOCATION_SERVICE", false),
  useMatchingService: envBool("FF_MATCHING_SERVICE", false),
  useTripService: envBool("FF_TRIP_SERVICE", false),
  useSafetyService: envBool("FF_SAFETY_SERVICE", false),
  useVoiceAssistantV2: envBool("FF_VOICE_ASSISTANT_V2", false),
  enableExperimentalVoiceBooking: envBool("FF_VOICE_BOOKING", false),
  enableAiMobilityBrain: envBool("FF_AI_MOBILITY_BRAIN", false),
  useDynamicPricingV2: envBool("FF_DYNAMIC_PRICING_V2", false),
  useParcelHyperlocalService: envBool("FF_PARCEL_HYPERLOCAL_SERVICE", false),
  useCarShareIntercityService: envBool("FF_CARSHARE_INTERCITY_SERVICE", false),
  enablePredictiveSuggestions: envBool("FF_PREDICTIVE_SUGGESTIONS", true),
  enableRouteDeviationGuardian: envBool("FF_ROUTE_DEVIATION_GUARDIAN", true),
};
