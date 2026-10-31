const cron = require('node-cron');
const { processDailyRoi } = require('./roiService');
function startRoiScheduler() {
  const timezone = process.env.CRON_TIMEZONE || 'Asia/Kolkata';
  // Runs at midnight in the configured timezone. Unique database indexes protect overlapping instances.
  const task = cron.schedule('0 0 * * *', async () => {
    console.log(`[cron] Starting daily ROI processing (${timezone})`);
    try {
      const result = await processDailyRoi();
      console.log('[cron] Daily ROI result:', JSON.stringify(result));
    } catch (error) {
      console.error('[cron] Daily ROI processing failed:', error.message);
    }
  }, { scheduled: true, timezone });
  console.log(`ROI scheduler registered: 00:00 daily (${timezone})`);
  return task;
}
module.exports = { startRoiScheduler };
