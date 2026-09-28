"use strict";

/**
 * EVE.js — Main Entry Point
 *
 * Boots the world with every stage enabled and starts the TCP server.
 * The startup sequence itself lives in bootstrap.js so other callers — the
 * gameplay test harness in particular — can boot the same world with the
 * listeners and durable owners switched off.
 */

// This process is the durable owner for every runtime table not delegated to
// the wallet or scheduler authority. Set the role before any dependency can
// import gameStore transitively.
process.env.EVEJS_GAMESTORE_OWNER_ROLE = "world";
process.env.EVEJS_GAMESTORE_OWNER_INSTANCE =
  `world-supervisor:${process.pid}:${require("node:crypto").randomUUID()}`;

const path = require("path");

// Logs used to be written to server/logs. Move them to the data root's logs folder before
// anything below writes a log. After the first start there is nothing left to move, and an
// EVEJS_DATA_ROOT set on purpose is never filled from the checkout.
const {
  adoptLegacyDataDir,
  describeAdoption,
} = require(path.join(__dirname, "./src/config/dataRootMigration"));
const legacyLogsAdoption = adoptLegacyDataDir("logs", path.join(__dirname, "logs"));

const { bootWorld } = require(path.join(__dirname, "./bootstrap"));
const database = require(path.join(__dirname, "./src/gameStore"));
const {
  installOwnerProcessShutdown,
} = require(path.join(__dirname, "./src/gameStore/ownerProcessShutdown"));
const rotatingLog = require(path.join(__dirname, "./src/utils/rotatingLog"));
const log = require(path.join(__dirname, "./src/utils/logger"));

const legacyLogsMessage = describeAdoption("server/logs", legacyLogsAdoption);
if (legacyLogsMessage) {
  if (legacyLogsAdoption.status === "moved") {
    log.info(legacyLogsMessage);
  } else {
    log.warn(legacyLogsMessage);
  }
}

// This process owns its signals and exit codes. The store only shuts down when
// asked; Ctrl+C, a lost owner lease and process exit all come through here.
installOwnerProcessShutdown(database);

// Longest wait for the log files before a failed start exits anyway.
const FAILED_START_LOG_FLUSH_MS = 2000;

// main startup

let bootedWorld;

// Defer the final listener stage until optional runtimes recover.
void bootWorld({ appName: "eve.js server", startTCP: false })
  .then(async (world) => {
    bootedWorld = world;
    const config = require(path.join(__dirname, "./src/config"));

    try {
      const liveEventRuntime = require(path.join(
        __dirname,
        "./src/space/liveEvents/liveEventRuntime",
      ));
      database.registerShutdownHook("live-event-runtime", () => {
        const result = liveEventRuntime.stop();
        if (!result || result.success !== true) {
          throw new Error(result && result.errorMsg || "LIVE_EVENT_STOP_FAILED");
        }
        return result;
      });
      const liveEventStartOptions = config.liveEventsEnabled === true
        ? { spaceRuntime: require(path.join(__dirname, "./src/space/runtime")) }
        : {};
      const liveEventStartResult = liveEventRuntime.start(liveEventStartOptions);
      if (
        liveEventStartResult &&
        liveEventStartResult.success === true &&
        liveEventStartResult.data &&
        liveEventStartResult.data.enabled === true
      ) {
        log.info(
          `[LiveEvents] Scheduler ready: queued=${Number(liveEventStartResult.data.queueSize) || 0}.`,
        );
        log.spacer();
      }
    } catch (error) {
      log.err(`[LiveEvents] Failed startup: ${error.message}`);
      log.spacer();
    }

    try {
      const xEveRuntime = require(path.join(
        __dirname,
        "./src/services/xEve/xEveRuntime",
      ));
      database.registerShutdownHook("x-eve-runtime", () => {
        const result = xEveRuntime.stop();
        if (!result || result.success !== true) {
          throw new Error(result && result.errorMsg || "X_EVE_STOP_FAILED");
        }
        return result;
      });
      const xEveStartOptions = config.xEveEnabled === true
        ? { spaceRuntime: require(path.join(__dirname, "./src/space/runtime")) }
        : {};
      const xEveStartResult = xEveRuntime.start(xEveStartOptions);
      if (
        config.xEveEnabled === true &&
        (
          !xEveStartResult ||
          xEveStartResult.success !== true ||
          !xEveStartResult.data ||
          xEveStartResult.data.started !== true
        )
      ) {
        throw new Error(xEveStartResult && xEveStartResult.errorMsg || "X_EVE_RUNTIME_NOT_READY");
      }
      if (
        xEveStartResult &&
        xEveStartResult.success === true &&
        xEveStartResult.data &&
        xEveStartResult.data.enabled === true
      ) {
        const reconcileResult = require(path.join(
          __dirname,
          "./src/services/xEve/xEveEventBridge",
        )).reconcileRecentLivingEconomyEvents();
        if (!reconcileResult || reconcileResult.success !== true) {
          throw new Error(
            `Living Economy journal reconciliation failed: ` +
            `${reconcileResult && reconcileResult.errorMsg || "UNKNOWN"}`,
          );
        }
        log.info(
          `[X-Eve] Economic kernel ready: queued=${Number(xEveStartResult.data.scheduler.backlogTotal) || 0}.`,
        );
        log.spacer();
      }
    } catch (error) {
      if (config.xEveEnabled === true) {
        throw error;
      }
      log.err(`[X-Eve] Failed startup: ${error.message}`);
      log.spacer();
    }

    const startTCPServer = require(path.join(__dirname, "./src/network/tcp"));
    world.tcpServer = await startTCPServer(world.serviceManager);
    return world;
  })
  .catch(async (error) => {
    if (bootedWorld && typeof bootedWorld.shutdown === "function") {
      log.err(`[Startup] Failed after world initialization: ${error.message}`);
      try {
        const shutdownResult = await bootedWorld.shutdown();
        if (!shutdownResult || shutdownResult.success !== true) {
          log.err(
            `[Startup] World cleanup failed: ${shutdownResult && shutdownResult.errorMsg || "UNKNOWN"}`,
          );
        }
      } catch (shutdownError) {
        log.err(`[Startup] World cleanup failed: ${shutdownError.message}`);
      }
    }
    // bootWorld logs and unwinds its own failures; optional runtime and TCP
    // failures above are unwound through the returned world shutdown handle.
    await Promise.race([
      rotatingLog.flushAll(),
      new Promise((resolve) => setTimeout(resolve, FAILED_START_LOG_FLUSH_MS)),
    ]).catch(() => null);
    process.exit(1);
  });
