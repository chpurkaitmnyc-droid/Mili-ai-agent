/**
 * ============================================================================
 * services/schedulerService.js — Persistent Daily Cron Scheduler
 * ============================================================================
 * Manages daily automated Kirana credit recovery runs using node-cron.
 * Features:
 *   - Configured with timezone "Asia/Kolkata"
 *   - Persists state in data/scheduler_config.json
 *   - Auto-restores and starts active job on server boot if enabled === true
 *   - helper setDailySchedule(hour24, minute, enabled)
 * ============================================================================
 */

const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const automationEngine = require("./automationEngine");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const SCHEDULER_CONFIG_FILE = path.join(DATA_DIR, "scheduler_config.json");

const DEFAULT_CONFIG = {
  enabled: false,
  cronExpression: "0 10 * * *",
  timeLabel: "10:00 AM",
  hour: 10,
  minute: 0,
  timezone: "Asia/Kolkata",
  lastRun: null,
  lastResult: null,
};

class SchedulerService {
  constructor() {
    this.activeTask = null;
    this.initConfig();
  }

  initConfig() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(SCHEDULER_CONFIG_FILE)) {
      fs.writeFileSync(SCHEDULER_CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    }
  }

  readConfig() {
    try {
      this.initConfig();
      return JSON.parse(fs.readFileSync(SCHEDULER_CONFIG_FILE, "utf-8"));
    } catch (_e) {
      return { ...DEFAULT_CONFIG };
    }
  }

  saveConfig(cfg) {
    try {
      fs.writeFileSync(SCHEDULER_CONFIG_FILE, JSON.stringify(cfg, null, 2));
    } catch (e) {
      console.error("❌ [schedulerService] Error writing scheduler_config.json:", e.message);
    }
  }

  /**
   * Sets and persists daily schedule.
   *
   * @param {number} hour24 - 0 to 23
   * @param {number} minute - 0 to 59
   * @param {boolean} [enabled=true]
   */
  setDailySchedule(hour24, minute, enabled = true) {
    const h = parseInt(hour24, 10);
    const m = parseInt(minute, 10);

    if (isNaN(h) || h < 0 || h > 23 || isNaN(m) || m < 0 || m > 59) {
      throw new Error("Invalid schedule time: hour must be 0-23, minute 0-59.");
    }

    const cronExpr = `${m} ${h} * * *`;
    const period = h >= 12 ? "PM" : "AM";
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    const displayMin = m < 10 ? `0${m}` : m;
    const timeLabel = `${displayHour}:${displayMin} ${period}`;

    const config = this.readConfig();
    config.cronExpression = cronExpr;
    config.hour = h;
    config.minute = m;
    config.timeLabel = timeLabel;
    config.enabled = Boolean(enabled);
    this.saveConfig(config);

    // Restart cron task
    this.restartTask();

    console.log(`⏰ [schedulerService] Scheduled daily Kirana recovery at ${timeLabel} (${cronExpr}) [Enabled: ${config.enabled}]`);
    return config;
  }

  /**
   * Stops any running cron task and restarts if enabled.
   */
  restartTask() {
    if (this.activeTask) {
      this.activeTask.stop();
      this.activeTask = null;
    }

    const config = this.readConfig();
    if (!config.enabled) {
      console.log("⏰ [schedulerService] Scheduler is currently paused/disabled.");
      return;
    }

    if (!cron.validate(config.cronExpression)) {
      console.error(`❌ [schedulerService] Invalid cron expression: "${config.cronExpression}"`);
      return;
    }

    this.activeTask = cron.schedule(
      config.cronExpression,
      async () => {
        console.log(`\n🔔 [schedulerService] Triggering daily automated Kirana recovery run at ${new Date().toLocaleTimeString()}...`);
        try {
          const result = await automationEngine.runOverdueFollowupWorkflow();
          const currentConfig = this.readConfig();
          currentConfig.lastRun = new Date().toISOString();
          currentConfig.lastResult = {
            totalOverdueCustomers: result.totalOverdueCustomers,
            processedCount: result.processedCount,
            totalOverdueAmount: result.totalOverdueAmount,
          };
          this.saveConfig(currentConfig);
        } catch (err) {
          console.error("❌ [schedulerService] Error executing scheduled workflow:", err.message);
        }
      },
      {
        timezone: "Asia/Kolkata",
      }
    );

    console.log(`✅ [schedulerService] Active cron task running: "${config.cronExpression}" (Asia/Kolkata)`);
  }

  /**
   * Called on server startup to restore persisted scheduler.
   */
  initOnBoot() {
    const config = this.readConfig();
    if (config.enabled) {
      console.log(`⏰ [schedulerService] Restoring active daily schedule: ${config.timeLabel} (${config.cronExpression})`);
      this.restartTask();
    } else {
      console.log(`⏰ [schedulerService] Persisted schedule is set to: ${config.timeLabel} [Inactive]`);
    }
  }

  getStatus() {
    const config = this.readConfig();
    return {
      ...config,
      isRunning: Boolean(this.activeTask),
    };
  }
}

// Singleton instance
const schedulerService = new SchedulerService();

module.exports = {
  schedulerService,
  SchedulerService,
};
