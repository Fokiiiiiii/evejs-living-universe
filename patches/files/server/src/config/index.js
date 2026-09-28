"use strict";

const fs = require("fs");
const path = require("path");
const definitions = require("./schema");
const { createConfigManager } = require("./manager");

const X_EVE_LIVE_EVENT_DEFINITIONS = [
  {
    key: "liveEventsEnabled",
    defaultValue: false,
    envVar: "EVEJS_LIVE_EVENTS_ENABLED",
    envType: "boolean",
    description: [
      "Enables persistent server-side live events and their deadline-driven scheduler.",
      "Definitions remain individually disabled until their implementation and verification gates pass.",
    ],
    validValues: "true or false.",
  },
  {
    key: "liveEventsSchedulerIntervalMs",
    integer: true,
    defaultValue: 5000,
    envVar: "EVEJS_LIVE_EVENTS_SCHEDULER_INTERVAL_MS",
    envType: "number",
    minValue: 250,
    description:
      "Wall-clock interval for the live-event deadline queue. This scheduler does not run in the 100 ms space tick.",
    validValues: "Integer milliseconds greater than or equal to 250.",
  },
  {
    key: "liveEventsSchedulerBudgetMs",
    defaultValue: 2,
    envVar: "EVEJS_LIVE_EVENTS_SCHEDULER_BUDGET_MS",
    envType: "number",
    minValue: 0.1,
    description:
      "Maximum monotonic work time consumed by one live-event scheduler wake before due work is deferred.",
    validValues: "Positive number of milliseconds greater than or equal to 0.1.",
  },
  {
    key: "liveEventsMaxJobsPerPass",
    integer: true,
    defaultValue: 8,
    envVar: "EVEJS_LIVE_EVENTS_MAX_JOBS_PER_PASS",
    envType: "number",
    minValue: 1,
    maxValue: 100,
    description:
      "Maximum event work orders reconciled by one bounded scheduler wake.",
    validValues: "Integer from 1 through 100.",
  },
  {
    key: "liveEventsMaxActiveGlobal",
    integer: true,
    defaultValue: 2,
    envVar: "EVEJS_LIVE_EVENTS_MAX_ACTIVE_GLOBAL",
    envType: "number",
    minValue: 1,
    maxValue: 100,
    description:
      "Maximum non-terminal live-event records active across the universe.",
    validValues: "Integer from 1 through 100.",
  },
  {
    key: "liveEventsMaxActivePerSystem",
    integer: true,
    defaultValue: 1,
    envVar: "EVEJS_LIVE_EVENTS_MAX_ACTIVE_PER_SYSTEM",
    envType: "number",
    minValue: 1,
    maxValue: 10,
    description:
      "Maximum non-terminal live-event records assigned to one solar system.",
    validValues: "Integer from 1 through 10.",
  },
  {
    key: "xEveEnabled",
    defaultValue: false,
    envVar: "EVEJS_X_EVE_ENABLED",
    envType: "boolean",
    description: [
      "Enables the X-Eve economic kernel, balanced ledger, event inbox, and adaptive background scheduler.",
      "This first slice is disabled by default and does not yet settle native wallets, market orders, inventory, or contracts.",
    ],
    validValues: "true or false.",
  },
  {
    key: "xEveSchedulerIntervalMs",
    integer: true,
    defaultValue: 1000,
    envVar: "EVEJS_X_EVE_SCHEDULER_INTERVAL_MS",
    envType: "number",
    minValue: 250,
    maxValue: 60000,
    description:
      "Wall-clock interval for X-Eve's independent single-flight scheduler; it never runs inside the 100 ms space tick.",
    validValues: "Integer milliseconds from 250 through 60000.",
  },
  {
    key: "xEveSchedulerBudgetMs",
    defaultValue: 2,
    envVar: "EVEJS_X_EVE_SCHEDULER_BUDGET_MS",
    envType: "number",
    minValue: 0.1,
    maxValue: 10,
    description:
      "Maximum healthy-load synchronous work slice for one X-Eve scheduler pass.",
    validValues: "Number of milliseconds from 0.1 through 10.",
  },
  {
    key: "xEveDurabilityIntervalMs",
    integer: true,
    defaultValue: 2000,
    envVar: "EVEJS_X_EVE_DURABILITY_INTERVAL_MS",
    envType: "number",
    minValue: 500,
    maxValue: 60000,
    description:
      "Maximum wall-clock interval before X-Eve hands dirty state to the durable SQLite journal, even while writes remain continuous.",
    validValues: "Integer milliseconds from 500 through 60000.",
  },
  {
    key: "xEveMaxJobsPerPass",
    integer: true,
    defaultValue: 32,
    envVar: "EVEJS_X_EVE_MAX_JOBS_PER_PASS",
    envType: "number",
    minValue: 1,
    maxValue: 100,
    description:
      "Maximum X-Eve continuations handled in one scheduler pass within the configured time budget; overdue work remains queued.",
    validValues: "Integer from 1 through 100.",
  },
  {
    key: "xEveMaxRetryAttempts",
    integer: true,
    defaultValue: 8,
    envVar: "EVEJS_X_EVE_MAX_RETRY_ATTEMPTS",
    envType: "number",
    minValue: 1,
    maxValue: 100,
    description:
      "Maximum attempts for a deterministic X-Eve work failure before it is retained as a dead letter for inspection.",
    validValues: "Integer from 1 through 100.",
  },
  {
    key: "xEveTickSampleCount",
    integer: true,
    defaultValue: 20,
    envVar: "EVEJS_X_EVE_TICK_SAMPLE_COUNT",
    envType: "number",
    minValue: 10,
    maxValue: 120,
    description:
      "Recent runtime-tick samples used by X-Eve's admission governor.",
    validValues: "Integer from 10 through 120.",
  },
  {
    key: "xEveTickWarningMs",
    integer: true,
    defaultValue: 120,
    envVar: "EVEJS_X_EVE_TICK_WARNING_MS",
    envType: "number",
    minValue: 101,
    maxValue: 499,
    description:
      "Rolling p95 tick interval where X-Eve defers planning and maintenance work.",
    validValues: "Number of milliseconds from 101 through 499.",
  },
  {
    key: "xEveTickOverloadMs",
    integer: true,
    defaultValue: 130,
    envVar: "EVEJS_X_EVE_TICK_OVERLOAD_MS",
    envType: "number",
    minValue: 102,
    maxValue: 499,
    description:
      "Rolling p95 tick interval where X-Eve admits only tiny settlement and deadline continuations.",
    validValues: "Number of milliseconds from 102 through 499 and not below the warning threshold.",
  },
  {
    key: "xEveEmergencyShedMs",
    integer: true,
    defaultValue: 500,
    envVar: "EVEJS_X_EVE_EMERGENCY_SHED_MS",
    envType: "number",
    minValue: 130,
    maxValue: 599,
    description:
      "A single tick interval at this level immediately stops all X-Eve background work while preserving its queues.",
    validValues: "Number of milliseconds from 130 through 599.",
  },
  {
    key: "xEveUnplayableMs",
    integer: true,
    defaultValue: 600,
    envVar: "EVEJS_X_EVE_UNPLAYABLE_MS",
    envType: "number",
    minValue: 500,
    maxValue: 600,
    description:
      "Telemetry boundary for an unplayable tick interval; X-Eve already hard-sheds before reaching it.",
    validValues: "Number of milliseconds from 500 through 600.",
  },
  {
    key: "xEveRecoveryThresholdMs",
    integer: true,
    defaultValue: 115,
    envVar: "EVEJS_X_EVE_RECOVERY_THRESHOLD_MS",
    envType: "number",
    minValue: 100,
    maxValue: 119,
    description:
      "Tick p95 that must be regained before X-Eve begins its healthy recovery window.",
    validValues: "Number of milliseconds from 100 through 119.",
  },
  {
    key: "xEveRecoverySeconds",
    integer: true,
    defaultValue: 5,
    envVar: "EVEJS_X_EVE_RECOVERY_SECONDS",
    envType: "number",
    minValue: 1,
    maxValue: 60,
    description:
      "Healthy time required before deferred X-Eve planning resumes, preventing latency-mode flapping.",
    validValues: "Number of seconds from 1 through 60.",
  },];
 
const LIVING_PROFILE_DEFINITIONS = [
  {
    key: "familyEstateEnabled",
    defaultValue: false,
    envVar: "EVEJS_FAMILY_ESTATE_ENABLED",
    envType: "boolean",
    description: "Enables the shared corporation family estate.",
    validValues: "true or false.",
  },
  {
    key: "familyEstateLogisticsEnabled",
    defaultValue: true,
    envVar: "EVEJS_FAMILY_ESTATE_LOGISTICS_ENABLED",
    envType: "boolean",
    description: "Enables arrival-settled estate restoration logistics.",
    validValues: "true or false.",
  },
  {
    key: "ambientTrafficEnabled",
    defaultValue: false,
    envVar: "EVEJS_AMBIENT_TRAFFIC_ENABLED",
    envType: "boolean",
    description: "Enables virtual and materialized regional NPC traffic.",
    validValues: "true or false.",
  },
  {
    key: "livingUniverseEnabled",
    defaultValue: false,
    envVar: "EVEJS_LIVING_UNIVERSE_ENABLED",
    envType: "boolean",
    description: "Enables the persistent NPC pilot population.",
    validValues: "true or false.",
  },
  {
    key: "industrialHirelingsEnabled",
    defaultValue: false,
    envVar: "EVEJS_INDUSTRIAL_HIRELINGS_ENABLED",
    envType: "boolean",
    description: "Enables player-owned industrial hireling contracts.",
    validValues: "true or false.",
  },
  {
    key: "industrialMiningCrewsEnabled",
    defaultValue: false,
    envVar: "EVEJS_INDUSTRIAL_MINING_CREWS_ENABLED",
    envType: "boolean",
    description: "Enables player-owned industrial mining crews.",
    validValues: "true or false.",
  },
  {
    key: "industrialMiningCrewsVirtualProductionEnabled",
    defaultValue: false,
    envVar: "EVEJS_INDUSTRIAL_MINING_CREWS_VIRTUAL_PRODUCTION_ENABLED",
    envType: "boolean",
    description: "Enables off-grid aggregate mining-crew production.",
    validValues: "true or false.",
  },
  {
    key: "industrialMiningCrewsEconomyEnabled",
    defaultValue: false,
    envVar: "EVEJS_INDUSTRIAL_MINING_CREWS_ECONOMY_ENABLED",
    envType: "boolean",
    description: "Allows mining crews to interact with Living Economy stock.",
    validValues: "true or false.",
  },
  {
    key: "livingUniversePopulationSize",
    integer: true,
    defaultValue: 400,
    envVar: "EVEJS_LIVING_UNIVERSE_POPULATION_SIZE",
    envType: "number",
    minValue: 1,
    maxValue: 5000,
    description: "Persistent Living Universe actor count.",
    validValues: "Integer from 1 through 5000.",
  },
  {
    key: "livingUniverseMaxMaterializedPerSystem",
    integer: true,
    defaultValue: 48,
    envVar: "EVEJS_LIVING_UNIVERSE_MAX_MATERIALIZED_PER_SYSTEM",
    envType: "number",
    minValue: 1,
    maxValue: 500,
    description: "Maximum materialized NPC ships in one solar system.",
    validValues: "Integer from 1 through 500.",
  },
  {
    key: "livingUniverseMaxMaterializedGlobal",
    integer: true,
    defaultValue: 120,
    envVar: "EVEJS_LIVING_UNIVERSE_MAX_MATERIALIZED_GLOBAL",
    envType: "number",
    minValue: 1,
    maxValue: 2000,
    description: "Global physical NPC ship budget.",
    validValues: "Integer from 1 through 2000.",
  },
  {
    key: "livingUniverseMaterializationsPerTick",
    integer: true,
    defaultValue: 2,
    envVar: "EVEJS_LIVING_UNIVERSE_MATERIALIZATIONS_PER_TICK",
    envType: "number",
    minValue: 1,
    maxValue: 20,
    description: "Maximum flight groups materialized per scheduler tick.",
    validValues: "Integer from 1 through 20.",
  },
  {
    key: "livingUniverseSchedulerBudgetMs",
    defaultValue: 8,
    envVar: "EVEJS_LIVING_UNIVERSE_SCHEDULER_BUDGET_MS",
    envType: "number",
    minValue: 1,
    maxValue: 50,
    description: "Soft work budget for one virtual-flight scheduler pass.",
    validValues: "Number of milliseconds from 1 through 50.",
  },
  {
    key: "livingUniverseMaxDueFlightsPerTick",
    integer: true,
    defaultValue: 64,
    envVar: "EVEJS_LIVING_UNIVERSE_MAX_DUE_FLIGHTS_PER_TICK",
    envType: "number",
    minValue: 1,
    maxValue: 1000,
    description: "Maximum empty-system flight transitions processed per pass.",
    validValues: "Integer from 1 through 1000.",
  },
  {
    key: "livingUniversePilotSyncBatchSize",
    integer: true,
    defaultValue: 128,
    envVar: "EVEJS_LIVING_UNIVERSE_PILOT_SYNC_BATCH_SIZE",
    envType: "number",
    minValue: 16,
    maxValue: 1000,
    description: "Maximum changed synthetic pilots synchronized per pass.",
    validValues: "Integer from 16 through 1000.",
  },
  {
    key: "livingUniverseOffGridTravelTimeMultiplier",
    defaultValue: 1,
    envVar: "EVEJS_LIVING_UNIVERSE_OFFGRID_TRAVEL_TIME_MULTIPLIER",
    envType: "number",
    minValue: 1,
    maxValue: 100,
    description: "Multiplier for unobserved virtual travel only.",
    validValues: "Number from 1 through 100.",
  },
  {
    key: "livingUniverseOffGridActivityTimeMultiplier",
    defaultValue: 1,
    envVar: "EVEJS_LIVING_UNIVERSE_OFFGRID_ACTIVITY_TIME_MULTIPLIER",
    envType: "number",
    minValue: 1,
    maxValue: 100,
    description: "Multiplier for unobserved virtual activity timers only.",
    validValues: "Number from 1 through 100.",
  },
  {
    key: "livingConflictEnabled",
    defaultValue: true,
    envVar: "EVEJS_LIVING_CONFLICT_ENABLED",
    envType: "boolean",
    description: "Enables persistent witnessed and off-grid NPC conflicts.",
    validValues: "true or false.",
  },
  {
    key: "livingConflictCampaignsEnabled",
    defaultValue: true,
    envVar: "EVEJS_LIVING_CONFLICT_CAMPAIGNS_ENABLED",
    envType: "boolean",
    description: "Enables named regional conflict campaigns.",
    validValues: "true or false.",
  },
  {
    key: "livingConflictRoamingEnabled",
    defaultValue: true,
    envVar: "EVEJS_LIVING_CONFLICT_ROAMING_ENABLED",
    envType: "boolean",
    description: "Enables persistent roaming groups and temporary gate camps.",
    validValues: "true or false.",
  },
  {
    key: "livingEconomyEnabled",
    defaultValue: false,
    envVar: "EVEJS_LIVING_ECONOMY_ENABLED",
    envType: "boolean",
    description: "Enables the conserved regional Living Economy.",
    validValues: "true or false.",
  },
  {
    key: "livingEconomyWorkBudgetMs",
    defaultValue: 4,
    envVar: "EVEJS_LIVING_ECONOMY_WORK_BUDGET_MS",
    envType: "number",
    minValue: 0.5,
    maxValue: 25,
    description: "Synchronous work slice for one Living Economy pulse.",
    validValues: "Number from 0.5 through 25.",
  },
];
 
const rootDir = path.resolve(__dirname, "../../..");
const profilePath = path.join(rootDir, "evejs.config.x-eve.json");
const localProfilePath = path.join(rootDir, "evejs.config.x-eve.local.json");

function readProfile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("X-Eve profile must contain a JSON object: " + filePath);
  }
  return value;
}

// Keep the public profile as first-install defaults and local overrides as environment values.
const profile = readProfile(profilePath);
const localProfile = readProfile(localProfilePath);
const pluginDefinitions = [
  ...X_EVE_LIVE_EVENT_DEFINITIONS,
  ...LIVING_PROFILE_DEFINITIONS,
];
const pluginDefinitionKeys = new Set(
  pluginDefinitions.map((definition) => definition.key),
);
const baseDefinitionKeys = new Set(definitions.map((definition) => definition.key));
const customDefinitions = pluginDefinitions.filter(
  (definition) => !baseDefinitionKeys.has(definition.key),
);
const schemaDefinitions = [...definitions, ...customDefinitions].map((definition) => {
  if (!Object.prototype.hasOwnProperty.call(profile, definition.key)) {
    return definition;
  }
  const value = profile[definition.key];
  if (typeof value !== typeof definition.defaultValue) {
    throw new TypeError(
      "X-Eve profile value has the wrong type for " + definition.key,
    );
  }
  return { ...definition, defaultValue: value };
});

const definitionsByKey = new Map(
  schemaDefinitions.map((definition) => [definition.key, definition]),
);
for (const [sourceName, values] of [
  ["X-Eve profile", profile],
  ["X-Eve local profile", localProfile],
]) {
  for (const [key, value] of Object.entries(values)) {
    const definition = definitionsByKey.get(key);
    if (!pluginDefinitionKeys.has(key) || !definition) {
      throw new Error("Unknown " + sourceName + " setting: " + key);
    }
    if (
      !["boolean", "number", "string"].includes(typeof value) ||
      typeof value !== typeof definition.defaultValue
    ) {
      throw new TypeError(sourceName + " value has the wrong type for " + key);
    }
  }
}
for (const [key, value] of Object.entries({ ...profile, ...localProfile })) {
  const definition = definitionsByKey.get(key);
  if (!definition.envVar) {
    throw new Error("X-Eve profile setting has no environment binding: " + key);
  }
  if (process.env[definition.envVar] === undefined) {
    process.env[definition.envVar] = String(value);
  }
}

module.exports = createConfigManager({
  rootDir,
  schemaDefinitions,
});
