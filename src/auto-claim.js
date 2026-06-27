const axios = require('axios');
const { getApiConfig } = require('./api-config');

/**
 * Try to claim the BHVR "Store Featured Weekly" mystery box for the player.
 *
 * Probes  GET  /api/v1/mystery-box/status
 * Claims  POST /api/v1/mystery-box/StoreFeaturedWeekly/claim   (empty body)
 *
 * Returns:
 *   { claimed: boolean, message: string, reward?: { currency, amount }, error?: boolean }
 *
 * `headerOverrides` is the optional proxy-captured live game header set; it
 * makes the claim request indistinguishable from a real game call.
 */
async function tryClaimWeeklyBox({ apiKey, platform, headerOverrides }) {
    if (!apiKey || !platform) {
        return { claimed: false, error: true, message: 'Auto-claim skipped: missing api-key or platform' };
    }

    const cfg = getApiConfig(platform, apiKey, headerOverrides);

    let status;
    try {
        status = await axios.get(`${cfg.baseUrl}/api/v1/mystery-box/status`, {
            headers: cfg.headers,
            timeout: 10000,
            validateStatus: () => true,
        });
    } catch (err) {
        return { claimed: false, error: true, message: `Mystery-box status check failed: ${err.message}` };
    }

    if (status.status !== 200) {
        return { claimed: false, error: true, message: `Mystery-box status returned HTTP ${status.status}` };
    }

    const featured = status.data?.mysteryBoxes?.StoreFeaturedWeekly;
    if (!featured) {
        return { claimed: false, message: 'Mystery box: no StoreFeaturedWeekly entry in response' };
    }

    if (!featured.canClaimCurrentBox) {
        // Format the next-available time if present.
        const next = featured.currentClaimEndTime
            ? new Date(featured.currentClaimEndTime).toLocaleString()
            : 'next reset';
        return { claimed: false, message: `Weekly box already claimed (next: ${next})` };
    }

    let claim;
    try {
        claim = await axios.post(
            `${cfg.baseUrl}/api/v1/mystery-box/StoreFeaturedWeekly/claim`,
            '',
            {
                headers: cfg.headers,
                timeout: 10000,
                validateStatus: () => true,
            }
        );
    } catch (err) {
        return { claimed: false, error: true, message: `Mystery-box claim failed: ${err.message}` };
    }

    if (claim.status !== 200) {
        return { claimed: false, error: true, message: `Mystery-box claim returned HTTP ${claim.status}` };
    }

    const reward = claim.data?.mysteryBox?.reward?.[0];
    if (reward && reward.amount != null && reward.currency) {
        const amt = Number(reward.amount).toLocaleString();
        return {
            claimed: true,
            message: `Weekly mystery box claimed: +${amt} ${reward.currency}`,
            reward: { currency: reward.currency, amount: reward.amount },
        };
    }

    return { claimed: true, message: 'Weekly mystery box claimed' };
}

module.exports = { tryClaimWeeklyBox };
